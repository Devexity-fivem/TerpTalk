// TerpBot event-driven assistance pipeline — server-only.
//
// REAL EVENT → eligibility → dedupe claim → notify → recorded BotEvent.
//
// Hard rules encoded here (see terpbot.ts for the full permission contract):
// - Every assist is claim-first: the keyed BotEvent row must be inserted
//   BEFORE the notification is sent, so retries, `after()` re-runs, and
//   concurrent serverless invocations collapse to one delivery.
// - Assists are private BOT_ASSIST notifications authored by the TerpBot
//   account — never chat posts, never fabricated content, always a real
//   triggering event.
// - Sparse by design: per-user daily cap + a 7-day "recently assisted"
//   cushion checked before claiming so a suppressed send doesn't burn the
//   once-ever claim.
// - Never assists: the bot itself, banned/suspended recipients (notify()
//   drops them), or anyone who turned off "TerpBot tips" (notifyOnBotAssist).
// - Nothing here observes DirectMessage, Report, ModerationAction,
//   SecurityEvent, or any staff-only table — those events never produce
//   bot output.
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { notify, postDeepLink } from "@/lib/notify"
import { rateLimit } from "@/lib/rate-limit"
import { claimBotEvent, releaseBotEvent } from "@/lib/terpbot-events"
import { getBotUserId, sanitizeEcho } from "@/lib/terpbot"
import { activeAuthor } from "@/lib/security"
import { diaryPath } from "@/lib/slugs"

// At most this many assist notifications per user per day, and never more
// than one assist of ANY kind in a rolling 7-day cushion window.
const ASSIST_USER_DAILY_CAP = 3
const ASSIST_CUSHION_MS = 7 * 24 * 60 * 60 * 1000

const ASSIST_GROUP_PREFIX = "bot-assist"

/**
 * The single pipeline every event-driven assist flows through.
 *
 * Returns "sent" when a notification was created, or "skipped" when
 * eligibility (banned/suspended/pref-off), cooldown, cap, or dedupe
 * refused — policy refusals are checked before the claim so they never
 * consume a once-ever key. A delivery failure AFTER the claim releases
 * it, keeping the evidence epoch retryable.
 */
export async function botAssist(opts: {
  /** Once-ever dedupe key, e.g. `assist:first-diary:<userId>` */
  key: string
  /** Assist kind recorded on BotEvent.command, e.g. "first-diary" */
  kind: string
  userId: string
  title: string
  content: string
  link?: string
  /** Skip the 7-day cross-kind cushion (default: cushion applies) */
  noCushion?: boolean
  /** structured payload carried on Notification.metadata — canonical
   *  ids/labels only, never raw user text */
  metadata?: Prisma.InputJsonValue
}): Promise<"sent" | "skipped"> {
  // Track whether THIS call claimed the key — a catch-path release is
  // only safe then (releasing unconditionally could delete a prior
  // legitimate claim and cause a duplicate send next run).
  let claimedHere = false
  try {
    const botId = await getBotUserId()
    if (opts.userId === botId) return "skipped"

    // Recipient must exist, be active, and not have opted out — all
    // checked before we burn a claim so a policy refusal never consumes
    // a once-ever key or a daily-cap slot.
    const recipient = await prisma.user.findUnique({
      where: { id: opts.userId },
      select: {
        banned: true,
        suspendedUntil: true,
        profile: { select: { notifyOnBotAssist: true } },
      },
    })
    if (
      !recipient ||
      recipient.banned ||
      (recipient.suspendedUntil && recipient.suspendedUntil > new Date()) ||
      recipient.profile?.notifyOnBotAssist === false
    ) {
      return "skipped"
    }

    // Cross-kind cushion: if ANY assist landed recently, stay quiet. Checked
    // before the claim AND before the daily counter so a cushioned event
    // doesn't burn either budget.
    if (!opts.noCushion) {
      const recent = await prisma.notification.findFirst({
        where: {
          userId: opts.userId,
          type: "BOT_ASSIST",
          groupKey: { startsWith: ASSIST_GROUP_PREFIX },
          createdAt: { gte: new Date(Date.now() - ASSIST_CUSHION_MS) },
        },
        select: { id: true },
      })
      if (recent) return "skipped"
    }

    // Dead-key fast path: scans replay claimed keys every run (a
    // dormant thread matches for weeks, a monthly stale key is dead all
    // month). Exit BEFORE the daily counter so replayed keys can't
    // drain the 3/day cap and starve fresh assists. claimBotEvent's
    // unique constraint is still the atomic backstop for the race.
    const dead = await prisma.botEvent.findUnique({
      where: { key: opts.key },
      select: { key: true },
    })
    if (dead) return "skipped"

    const cap = await rateLimit(
      `terpbot:assist:user:${opts.userId}`,
      ASSIST_USER_DAILY_CAP,
      24 * 60 * 60 * 1000
    )
    if (!cap.allowed) return "skipped"

    const claimed = await claimBotEvent({
      type: "ASSIST",
      key: opts.key,
      userId: opts.userId,
      command: opts.kind,
    })
    if (!claimed) return "skipped" // already handled — once ever
    claimedHere = true

    const n = await notify({
      userId: opts.userId,
      type: "BOT_ASSIST",
      title: opts.title,
      content: opts.content,
      link: opts.link ?? null,
      actorId: botId,
      groupKey: `${ASSIST_GROUP_PREFIX}:${opts.kind}:${opts.userId}`,
      ...(opts.metadata ? { metadata: opts.metadata } : {}),
    })
    if (!n) {
      // Delivery failed after the claim — release it so the evidence
      // epoch stays retryable instead of being permanently burned by a
      // transient failure or an edge-case recipient drop.
      await releaseBotEvent(opts.key).catch(() => {})
      return "skipped"
    }
    return "sent"
  } catch (e) {
    console.error("[terpbot] assist failed:", opts.key, e)
    if (claimedHere) await releaseBotEvent(opts.key).catch(() => {})
    return "skipped"
  }
}

// ── Event handlers ────────────────────────────────────────────────────────
// One function per triggering event. Copy is factual and points at real
// product surfaces — TerpBot never fabricates an answer or opinion.

/** Registration → durable welcome in the inbox (chat welcome prunes in 3d). */
export async function assistWelcome(userId: string) {
  return botAssist({
    key: `assist:welcome:${userId}`,
    kind: "welcome",
    userId,
    title: "Welcome to TerpTalk",
    content:
      "I'm TerpBot — the community assistant. Finish setup on /welcome, browse the grow guides at /guides, or say hi in /chat. Type /help in chat to see what I can do.",
    link: "/welcome",
    noCushion: true, // day-one welcome should not lose to a same-day assist
  })
}

/** First grow diary created → what to do next. Once ever per user. */
export async function assistFirstDiary(userId: string, diaryId: string) {
  // Only fires when this is genuinely the member's first live diary.
  const count = await prisma.growDiary.count({
    where: { authorId: userId, deleted: false },
  })
  if (count !== 1) return "skipped"
  const diary = await prisma.growDiary.findUnique({
    where: { id: diaryId },
    select: { id: true, slug: true },
  })
  return botAssist({
    key: `assist:first-diary:${userId}`,
    kind: "first-diary",
    userId,
    title: "Your first diary is live",
    content:
      "Weekly updates with photos and numbers (pH, EC, temp/RH) earn +3 rep each and make troubleshooting way easier. Grow guides: /guides",
    link: diary ? diaryPath(diary) : "/diaries",
  })
}

/**
 * Moderator marked an accepted answer in someone else's thread → tell the OP.
 * Uses the real ACCEPTED_ANSWER type (factual event, not a tip) and a
 * once-ever claim so unaccept/re-accept cycles can't re-ping the OP.
 */
export async function notifyOpAcceptedAnswer(opts: {
  opUserId: string
  threadSlug: string
  threadTitle: string
  postId: string
}) {
  const botId = await getBotUserId()
  if (opts.opUserId === botId) return
  const claimed = await claimBotEvent({
    type: "ASSIST",
    key: `assist:accept-op:${opts.postId}`,
    userId: opts.opUserId,
    command: "accept-op",
  })
  if (!claimed) return
  await notify({
    userId: opts.opUserId,
    type: "ACCEPTED_ANSWER",
    title: "Accepted answer on your thread",
    content: `A reply in "${sanitizeEcho(opts.threadTitle, 60)}" was marked as the accepted answer.`,
    link: postDeepLink(opts.threadSlug, opts.postId),
    actorId: botId,
  })
}

/** Daily cron scan — dormant threads get one private nudge to the OP. */
export async function scanDormantThreads(opts: {
  /** Test seam: restrict the scan to these author ids. Omit in production. */
  authorIds?: string[]
} = {}): Promise<{ dormant: number; unresolved: number }> {
  const now = Date.now()
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000)
  const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000)
  const authorScope = opts.authorIds ? { authorId: { in: opts.authorIds } } : {}

  // Never reply-bait in public: dormant assists are private notifications.
  // Eligibility is re-validated at scan time — deleted/locked/hidden threads
  // and inactive authors are silently excluded.
  const unanswered = await prisma.thread.findMany({
    where: {
      deleted: false,
      locked: false,
      replyCount: 0,
      createdAt: { gte: monthAgo, lt: weekAgo },
      category: { hidden: false },
      author: activeAuthor(),
      ...authorScope,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 50,
    select: { id: true, slug: true, title: true, authorId: true },
  })

  // Replies exist but nothing was ever accepted and the thread went quiet —
  // remind the OP that marking an answer exists. Same once-ever semantics.
  const unresolved = await prisma.thread.findMany({
    where: {
      deleted: false,
      locked: false,
      replyCount: { gt: 0 },
      acceptedAnswerId: null,
      lastActivityAt: { lt: weekAgo },
      createdAt: { lt: weekAgo },
      category: { hidden: false },
      author: activeAuthor(),
      ...authorScope,
    },
    orderBy: [{ lastActivityAt: "asc" }, { id: "asc" }],
    take: 50,
    select: { id: true, slug: true, title: true, authorId: true, replyCount: true },
  })

  let dormantSent = 0
  for (const t of unanswered) {
    const r = await botAssist({
      key: `assist:dormant:${t.id}`,
      kind: "dormant",
      userId: t.authorId,
      title: "No replies yet on your thread",
      content: `"${sanitizeEcho(t.title, 60)}" has been quiet for a week. Adding specifics — medium, lighting, pH/EC readings, photos — usually gets answers. The problem wizard can help you describe it: /help`,
      link: `/forum/thread/${t.slug}`,
    })
    if (r === "sent") dormantSent++
  }

  let unresolvedSent = 0
  for (const t of unresolved) {
    const r = await botAssist({
      key: `assist:unresolved:${t.id}`,
      kind: "unresolved",
      userId: t.authorId,
      title: "Did any reply solve it?",
      content: `"${sanitizeEcho(t.title, 60)}" has ${t.replyCount} ${t.replyCount === 1 ? "reply" : "replies"} but no accepted answer. Marking one pays the helper +30 rep and helps future growers.`,
      link: `/forum/thread/${t.slug}`,
    })
    if (r === "sent") unresolvedSent++
  }

  return { dormant: dormantSent, unresolved: unresolvedSent }
}

/**
 * Daily cron scan — active diaries with no update in 5+ days get one
 * private nudge per calendar month (claim key carries YYYY-MM so a diary
 * can only ever receive one stale reminder per month, and the 7-day
 * cross-kind cushion still applies on top).
 *
 * Bounded: 100 candidate diaries (oldest-touched first), one grouped query
 * for latest-update dates, at most 20 sends per run.
 */
export async function scanStaleDiaries(opts: {
  /** Test seam: restrict the scan to these author ids. Omit in production. */
  authorIds?: string[]
} = {}): Promise<{ scanned: number; sent: number }> {
  const staleBefore = new Date(Date.now() - 5 * 86400000)
  const diaries = await prisma.growDiary.findMany({
    where: {
      deleted: false,
      harvested: false,
      updatedAt: { lt: staleBefore },
      author: activeAuthor(),
      ...(opts.authorIds ? { authorId: { in: opts.authorIds } } : {}),
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: 100,
    select: { id: true, slug: true, title: true, authorId: true, startDate: true, createdAt: true },
  })
  if (!diaries.length) return { scanned: 0, sent: 0 }

  // Latest update per candidate diary — one grouped query, not N+1.
  const latestRows = await prisma.diaryUpdate.groupBy({
    by: ["diaryId"],
    where: { diaryId: { in: diaries.map((d) => d.id) } },
    _max: { createdAt: true },
  })
  const latestMap = new Map(latestRows.map((r) => [r.diaryId, r._max.createdAt]))

  const monthKey = new Date().toISOString().slice(0, 7)
  let sent = 0
  for (const d of diaries) {
    if (sent >= 20) break
    const last = latestMap.get(d.id) ?? d.createdAt
    // A diary whose latest update is fresh stays quiet even if the diary
    // row itself hasn't been edited in 5 days.
    if (!last || last >= staleBefore) continue
    const days = Math.floor((Date.now() - last.getTime()) / 86400000)
    const r = await botAssist({
      key: `assist:diary-stale:${d.id}:${monthKey}`,
      kind: "diary-stale",
      userId: d.authorId,
      title: "Your grow is waiting for an update",
      content: `"${sanitizeEcho(d.title, 60)}" hasn't been updated in ${days} days. A weekly update keeps your streak alive and gets better advice — photos + pH/EC readings help most.`,
      link: diaryPath(d),
    })
    if (r === "sent") sent++
  }
  return { scanned: diaries.length, sent }
}
