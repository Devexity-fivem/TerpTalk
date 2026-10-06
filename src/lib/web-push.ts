import webpush from "web-push"
import { after } from "next/server"
import { prisma } from "@/lib/prisma"

// ─── Web Push: a delivery channel for existing notifications ────────
// Push never creates state of its own. A Notification row is written by
// notify()/notifyMany() exactly as before (prefs, blocks, bans, dedupe
// all applied there); for a small allowlist of high-value types the same
// logical notification is ALSO offered to the member's opted-in browsers.
// Push failure can never fail the source action: every path here catches,
// and delivery runs after the response via after()/waitUntil.

/** Which logical notifications are worth an OS-level interruption.
 *  Intentionally quiet: replies, mentions, accepted answers, and two
 *  TerpBot assists (weekly digest, Plant Doctor follow-up). Reactions,
 *  follows, chat, diary updates, and other assists stay in-app only. */
export function pushCategory(n: { type: string; groupKey?: string | null }): string | null {
  switch (n.type) {
    case "REPLY":
    case "MENTION":
    case "ACCEPTED_ANSWER":
      return n.type
    case "BOT_ASSIST": {
      // botAssist groupKey = `bot-assist:<kind>:<userId>`
      const kind = n.groupKey?.split(":")[1]
      return kind === "weekly-digest" || kind === "pd-followup" ? kind : null
    }
    default:
      return null
  }
}

export function pushConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
}

let vapidSet = false
function ensureVapid(): boolean {
  if (!pushConfigured()) return false
  if (!vapidSet && !g.__ttPush?.transport) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "https://terp-talk.vercel.app",
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!
    )
    vapidSet = true
  }
  return true
}

type Transport = (
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  opts: { TTL: number; urgency: "normal" | "high" }
) => Promise<{ statusCode: number }>

// Process-global state: script runners can load this module twice (ESM +
// CJS instances), so the test seam and the out-of-request pending set
// live on globalThis to stay shared across instances.
const g = globalThis as unknown as { __ttPush?: { transport: Transport | null; pending: Set<Promise<unknown>> } }
const shared = (g.__ttPush ??= { transport: null, pending: new Set() })
const transport: Transport = (sub, payload, opts) =>
  shared.transport ? shared.transport(sub, payload, opts) : webpush.sendNotification(sub, payload, opts)

/** Test seam — swaps the HTTPS sender for a deterministic fake so the
 *  real cleanup/counter/telemetry logic can be exercised in-process. */
export function setPushTransportForTests(t: Transport | null) {
  shared.transport = t
}

// 404/410 = the push service says the subscription is gone for good.
const GONE = new Set([404, 410])
// Consecutive transient failures before a subscription is treated as dead.
const MAX_FAILURES = 5
// Per member, newest first — a member with many stale browsers can't fan
// one notification into an unbounded number of requests.
const MAX_SUBS_PER_USER = 10

// Only root-relative internal links survive; anything else lands on /notifications.
const SAFE_LINK = /^\/(?!\/)[^\s\\]+$/

export interface PushInput {
  userId: string
  type: string
  title: string
  content: string
  link?: string | null
  groupKey?: string | null
}

/**
 * Deliver one logical notification to a member's opted-in browsers.
 * Never throws. Returns how many endpoints accepted it (for tests).
 */
export async function deliverPush(input: PushInput): Promise<number> {
  try {
    const category = pushCategory(input)
    if (!category || !ensureVapid()) return 0
    const subs = await prisma.pushSubscription.findMany({
      where: { userId: input.userId },
      orderBy: { updatedAt: "desc" },
      take: MAX_SUBS_PER_USER,
      select: { id: true, endpoint: true, p256dh: true, auth: true, failureCount: true },
    })
    if (subs.length === 0) return 0

    // Title + the same short text already shown in-app — nothing more.
    // `tag` collapses repeats of one logical notification on the device.
    const payload = JSON.stringify({
      title: input.title.slice(0, 120),
      body: input.content.slice(0, 240),
      url: input.link && SAFE_LINK.test(input.link) ? input.link : "/notifications",
      tag: input.groupKey ?? `${input.type}:${input.link ?? ""}`,
      category,
    })

    let delivered = 0
    await Promise.all(
      subs.map(async (s) => {
        try {
          await transport(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
            { TTL: 24 * 60 * 60, urgency: category === "weekly-digest" ? "normal" : "high" }
          )
          delivered++
          await prisma.pushSubscription.update({
            where: { id: s.id },
            data: { lastSuccessAt: new Date(), failureCount: 0 },
          }).catch(() => {})
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode ?? 0
          if (GONE.has(status) || s.failureCount + 1 >= MAX_FAILURES) {
            await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {})
            await recordPushEvent({ type: "SUBSCRIPTION_REMOVED", userId: input.userId, category: GONE.has(status) ? "expired" : "failing" })
          } else {
            await prisma.pushSubscription.update({
              where: { id: s.id },
              data: { failureCount: { increment: 1 } },
            }).catch(() => {})
          }
        }
      })
    )
    await recordPushEvent({ type: delivered > 0 ? "SENT" : "FAILED", userId: input.userId, category })
    return delivered
  } catch (e) {
    console.error("[web-push] delivery failed:", input.type, e)
    return 0
  }
}

/** Batch form for notifyMany — one lookup for every recipient, then the
 *  same per-recipient delivery. Only allowlisted inputs reach here. */
export async function deliverPushMany(inputs: PushInput[]): Promise<void> {
  const eligible = inputs.filter((i) => pushCategory(i))
  if (eligible.length === 0 || !pushConfigured()) return
  const withSubs = new Set(
    (await prisma.pushSubscription.findMany({
      where: { userId: { in: [...new Set(eligible.map((i) => i.userId))] } },
      select: { userId: true },
      distinct: ["userId"],
    }).catch(() => [])).map((r) => r.userId)
  )
  await Promise.all(eligible.filter((i) => withSubs.has(i.userId)).map((i) => deliverPush(i)))
}

// Outside a Next request scope (scripts/tests) after() throws — fall back
// to a tracked promise so callers can still settle deterministically.
const pending = shared.pending

export function schedulePush(fn: () => Promise<unknown>): void {
  try {
    after(() => fn().catch(() => {}))
  } catch {
    const p = fn().catch(() => {}).finally(() => pending.delete(p))
    pending.add(p)
  }
}

/** Await deliveries scheduled outside a request (tests/scripts only). */
export async function settlePendingPush(): Promise<void> {
  while (pending.size) await Promise.all([...pending])
}

export const PUSH_EVENT_TYPES = [
  "PROMPT_SHOWN",
  "PERMISSION_GRANTED",
  "PERMISSION_DENIED",
  "SUBSCRIPTION_REMOVED",
  "SENT",
  "FAILED",
  "CLICKED",
] as const
export type PushEventType = (typeof PUSH_EVENT_TYPES)[number]

// Once-per-member lifecycle steps — keyed so retries/reloads never inflate them.
const ONCE_PER_MEMBER = new Set<PushEventType>(["PROMPT_SHOWN", "PERMISSION_GRANTED", "PERMISSION_DENIED"])

export async function recordPushEvent(e: { type: PushEventType; userId: string | null; category?: string | null }): Promise<void> {
  try {
    const key = e.userId && ONCE_PER_MEMBER.has(e.type) ? `${e.type}:${e.userId}` : null
    if (key) {
      await prisma.pushEvent.upsert({
        where: { key },
        create: { type: e.type, userId: e.userId, category: e.category ?? null, key },
        update: {},
      })
    } else {
      await prisma.pushEvent.create({ data: { type: e.type, userId: e.userId, category: e.category ?? null } })
    }
  } catch {
    // telemetry is best-effort
  }
}
