// Activation & Retention — Web Push subscription boundary (HTTP) and the
// derived activation model (real lib against real rows). Delivery
// semantics (notify → optional push, cleanup, dedupe) live in
// notification-2-tests.mts; the staff report gate lives in ops-tests.mts.
// Temp users/rows fully cleaned up.
import "./db-guard.mjs"
import { makeHarness } from "./lib/http-harness.mjs"
import { activationMilestonesFor, activationReport } from "@/lib/activation"

const harnessOpts = {
  username: (tag: string, ts: string) => `__pa_${tag}_${ts}`,
  name: (tag: string, ts: string) => `__pa_${tag}_${ts}`,
  summary: "fraction",
}
const { prisma, ts: TS, pass, fail, createUser, login: rawLogin, finish } = makeHarness(
  harnessOpts as { name: (tag: string, ts: string) => string; summary: string },
)
const login = (u: string, p: string) => rawLogin(u, p) as Promise<{ cookie: string }>
const BASE = process.env.BASE_URL || "http://localhost:3000"
const HOUR = 3600_000

type Res = { status: number; data: Record<string, unknown> | null }
async function call(path: string, opts: { method?: string; body?: unknown; cookie?: string } = {}): Promise<Res> {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? "GET",
    headers: { "Content-Type": "application/json", ...(opts.cookie ? { cookie: opts.cookie } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  return { status: res.status, data: await res.json().catch(() => null) }
}
const sub = (s: string, keys = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" }) => ({
  endpoint: `https://push.example.test/${TS}/${s}`,
  keys,
})

const main = async () => {
  const a = await createUser("a")
  const b = await createUser("b")
  const grower = await createUser("g")
  const other = await createUser("o")
  const idle = await createUser("i")
  const users = [a, b, grower, other, idle]
  const created: { threads: string[]; cats: string[] } = { threads: [], cats: [] }

  try {
    await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "login" } } })
    const { cookie: aCookie } = await login(a.username, a.password)
    const { cookie: bCookie } = await login(b.username, b.password)

    // ── Subscription boundary ─────────────────────────────────────
    let r = await call("/api/push/subscribe")
    r.status === 401 ? pass("anon GET subscribe → 401") : fail("anon GET", r.status)
    r = await call("/api/push/subscribe", { method: "POST", body: sub("anon") })
    r.status === 401 ? pass("anon POST subscribe → 401") : fail("anon POST", r.status)
    r = await call("/api/push/subscribe", { method: "DELETE", body: {} })
    r.status === 401 ? pass("anon DELETE subscribe → 401") : fail("anon DELETE", r.status)
    r = await call("/api/push/event", { method: "POST", body: { type: "PROMPT_SHOWN" } })
    r.status === 401 ? pass("anon push event → 401") : fail("anon event", r.status)

    r = await call("/api/push/subscribe", { cookie: aCookie })
    const status = r.data as { configured?: boolean; subscriptions?: number; publicKey?: string } | null
    r.status === 200 && status?.configured === true && status.subscriptions === 0 && typeof status.publicKey === "string"
      && !JSON.stringify(r.data).includes("endpoint")
      ? pass("member GET → configured, 0 subs, no endpoints exposed")
      : fail("member GET", r)

    for (const [label, body] of [
      ["http endpoint", { endpoint: "http://push.example.test/x", keys: sub("x").keys }],
      ["missing keys", { endpoint: sub("x").endpoint }],
      ["non-base64 key", { endpoint: sub("x").endpoint, keys: { p256dh: "bad key!", auth: "a" } }],
      ["not a url", { endpoint: "nope", keys: sub("x").keys }],
    ] as const) {
      r = await call("/api/push/subscribe", { method: "POST", body, cookie: aCookie })
      r.status === 400 ? pass(`invalid subscription rejected (${label})`) : fail(`invalid ${label}`, r.status)
    }

    r = await call("/api/push/subscribe", { method: "POST", body: sub("one"), cookie: aCookie })
    const row = await prisma.pushSubscription.findUnique({ where: { endpoint: sub("one").endpoint } })
    r.status === 201 && row?.userId === a.id && row.p256dh === sub("one").keys.p256dh
      ? pass("subscribe stores endpoint/p256dh/auth for the caller")
      : fail("subscribe create", { s: r.status, row })
    const cols = row ? Object.keys(row).sort().join(",") : ""
    cols === "auth,createdAt,endpoint,failureCount,id,lastSuccessAt,p256dh,updatedAt,userId"
      ? pass("subscription row holds no browser/device fingerprint fields")
      : fail("subscription columns", cols)

    await call("/api/push/subscribe", { method: "POST", body: sub("one"), cookie: aCookie })
    ;(await prisma.pushSubscription.count({ where: { endpoint: sub("one").endpoint } })) === 1
      ? pass("duplicate subscribe is idempotent (one row)")
      : fail("duplicate subscribe")

    const newKeys = { p256dh: "BOtherKeyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", auth: "newAuthKeyAAAAAAAAAAAA" }
    await call("/api/push/subscribe", { method: "POST", body: sub("one", newKeys), cookie: aCookie })
    const updated = await prisma.pushSubscription.findUnique({ where: { endpoint: sub("one").endpoint } })
    updated?.p256dh === newKeys.p256dh && updated.auth === newKeys.auth
      ? pass("re-subscribe updates keys in place")
      : fail("subscribe update", updated)

    // Same browser endpoint, different account → ownership moves; the
    // previous account can no longer push to this browser.
    await call("/api/push/subscribe", { method: "POST", body: sub("one"), cookie: bCookie })
    const moved = await prisma.pushSubscription.findUnique({ where: { endpoint: sub("one").endpoint } })
    moved?.userId === b.id && (await prisma.pushSubscription.count({ where: { userId: a.id } })) === 0
      ? pass("endpoint re-registered by another member moves ownership")
      : fail("ownership move", moved)

    r = await call("/api/push/subscribe", { method: "DELETE", body: { endpoint: sub("one").endpoint }, cookie: aCookie })
    r.data?.removed === 0 && (await prisma.pushSubscription.count({ where: { endpoint: sub("one").endpoint } })) === 1
      ? pass("member cannot remove another member's subscription")
      : fail("foreign delete", r)
    r = await call("/api/push/subscribe", { method: "DELETE", body: { endpoint: sub("one").endpoint }, cookie: bCookie })
    r.data?.removed === 1 ? pass("owner removes own subscription") : fail("owner delete", r)

    for (let i = 0; i < 12; i++) await call("/api/push/subscribe", { method: "POST", body: sub(`cap${i}`), cookie: aCookie })
    ;(await prisma.pushSubscription.count({ where: { userId: a.id } })) === 10
      ? pass("per-member subscriptions capped at 10 (newest kept)")
      : fail("cap", await prisma.pushSubscription.count({ where: { userId: a.id } }))
    r = await call("/api/push/subscribe", { method: "DELETE", body: {}, cookie: aCookie })
    r.data?.removed === 10 ? pass("turn-off removes every subscription the member owns") : fail("delete all", r)

    // ── Lifecycle telemetry ───────────────────────────────────────
    await call("/api/push/event", { method: "POST", body: { type: "PROMPT_SHOWN" }, cookie: aCookie })
    await call("/api/push/event", { method: "POST", body: { type: "PROMPT_SHOWN" }, cookie: aCookie })
    ;(await prisma.pushEvent.count({ where: { userId: a.id, type: "PROMPT_SHOWN" } })) === 1
      ? pass("PROMPT_SHOWN is once per member")
      : fail("prompt dedupe")
    ;(await prisma.pushEvent.count({ where: { userId: a.id, type: "PERMISSION_GRANTED" } })) === 1
      ? pass("PERMISSION_GRANTED recorded once despite 12 subscribes")
      : fail("granted once")
    r = await call("/api/push/event", { method: "POST", body: { type: "SENT" }, cookie: aCookie })
    r.status === 400 ? pass("server-only event types rejected from clients") : fail("client SENT", r.status)
    await call("/api/push/event", { method: "POST", body: { type: "CLICKED", category: "<script>" }, cookie: aCookie })
    const click = await prisma.pushEvent.findFirst({ where: { userId: a.id, type: "CLICKED" } })
    click && click.category === null ? pass("unknown click category stored as null") : fail("click category", click)
    await call("/api/push/event", { method: "POST", body: { type: "CLICKED", category: "weekly-digest" }, cookie: aCookie })
    ;(await prisma.pushEvent.count({ where: { userId: a.id, type: "CLICKED", category: "weekly-digest" } })) === 1
      ? pass("click recorded with allowlisted category")
      : fail("click allowlisted")

    // ── Return definition via the real /api/ping path ─────────────
    // A fresh member's same-day ping writes the check-in marker but is
    // NOT a return (< 24h after signup).
    const { cookie: idleCookie } = await login(idle.username, idle.password)
    await fetch(`${BASE}/api/ping`, { method: "POST", headers: { cookie: idleCookie } })
    const marker = await prisma.progressionEvent.count({ where: { userId: idle.id, type: "DAILY_LOGIN" } })
    const idleM = (await activationMilestonesFor([idle.id])).get(idle.id)
    marker === 1 && idleM?.firstReturn === null
      ? pass("same-day ping writes the check-in marker but is not a return")
      : fail("same-day ping", { marker, ret: idleM?.firstReturn })

    // ── Derived milestones on a controlled grower journey ─────────
    const signup = new Date(Date.now() - 72 * HOUR)
    await prisma.user.update({ where: { id: grower.id }, data: { createdAt: signup, onboardingCompletedAt: new Date(signup.getTime() + HOUR) } })
    await prisma.user.update({ where: { id: other.id }, data: { createdAt: new Date(signup.getTime() - HOUR) } })
    const qCat = (await prisma.category.findMany({ where: { hidden: false }, select: { id: true, slug: true, name: true } }))
      .find((c) => /question|help|problem|doctor/i.test(`${c.slug} ${c.name}`))
    if (!qCat) throw new Error("no question-like category seeded")
    const privateTitle = `__pa secret grow ${TS}`
    const diary = await prisma.growDiary.create({
      data: {
        title: privateTitle, description: "private fixture", growType: "INDOOR", startDate: signup,
        authorId: grower.id, visibility: "PRIVATE", mediumType: "COCO",
        createdAt: new Date(signup.getTime() + 2 * HOUR),
        harvested: true, harvestedAt: new Date(signup.getTime() + 60 * HOUR),
      },
    })
    const q = await prisma.thread.create({
      data: { title: `__pa q ${TS}`, slug: `__pa-q-${TS}`, content: "q", categoryId: qCat.id, authorId: grower.id, createdAt: new Date(signup.getTime() + 3 * HOUR) },
    })
    // OP row on own thread — must NOT count as a reply.
    await prisma.post.create({ data: { content: "q", threadId: q.id, authorId: grower.id, createdAt: new Date(signup.getTime() + 3 * HOUR) } })
    const otherT = await prisma.thread.create({
      data: { title: `__pa o ${TS}`, slug: `__pa-o-${TS}`, content: "o", categoryId: qCat.id, authorId: other.id },
    })
    created.threads.push(q.id, otherT.id)
    await prisma.post.create({ data: { content: "reply", threadId: otherT.id, authorId: grower.id, createdAt: new Date(signup.getTime() + 4 * HOUR) } })
    await prisma.follow.create({ data: { followerId: grower.id, followingId: other.id, createdAt: new Date(signup.getTime() + 5 * HOUR) } })
    // Check-ins: +6h (same day as signup — not a return), +30h (return).
    for (const h of [6, 30]) {
      await prisma.progressionEvent.create({
        data: { userId: grower.id, type: "DAILY_LOGIN", reason: "Daily check-in", key: `__pa-daily-${TS}-${h}`, createdAt: new Date(signup.getTime() + h * HOUR) },
      })
    }
    await prisma.diaryUpdate.create({
      data: { title: "after return", content: "u", stage: "VEGETATIVE", diaryId: diary.id, authorId: grower.id, createdAt: new Date(signup.getTime() + 31 * HOUR) },
    })
    await prisma.pushSubscription.create({ data: { userId: grower.id, endpoint: sub("grower").endpoint, p256dh: "BPk3", auth: "a1" } })

    const m = (await activationMilestonesFor([grower.id, grower.id])).get(grower.id)!
    const at = (h: number) => signup.getTime() + h * HOUR
    m.onboarding?.getTime() === at(1) ? pass("milestone: onboarding") : fail("onboarding", m.onboarding)
    m.firstGrow?.getTime() === at(2) ? pass("milestone: first grow (private diary counts for its owner)") : fail("firstGrow", m.firstGrow)
    m.firstStructuredGrow?.getTime() === at(2) ? pass("milestone: first structured grow") : fail("structured", m.firstStructuredGrow)
    m.firstQuestion?.getTime() === at(3) ? pass("milestone: first question (help category)") : fail("question", m.firstQuestion)
    m.firstReply?.getTime() === at(4) ? pass("milestone: first reply excludes own OP row") : fail("reply", m.firstReply)
    m.firstFollow?.getTime() === at(5) ? pass("milestone: first follow") : fail("follow", m.firstFollow)
    m.firstContribution?.getTime() === at(2) && m.firstContributionKind === "grow"
      ? pass("milestone: first contribution = earliest, kind=grow")
      : fail("first contribution", { c: m.firstContribution, k: m.firstContributionKind })
    m.firstReturn?.getTime() === at(30) ? pass("return = first check-in ≥24h after signup (+6h ignored)") : fail("return", m.firstReturn)
    m.secondAction?.getTime() === at(31) ? pass("second meaningful action = first contribution after return") : fail("second", m.secondAction)
    m.firstHarvest?.getTime() === at(60) ? pass("milestone: first harvest") : fail("harvest", m.firstHarvest)
    m.pushEnabled ? pass("milestone: push enabled") : fail("push enabled")

    const again = (await activationMilestonesFor([grower.id])).get(grower.id)!
    JSON.stringify(again) === JSON.stringify(m) ? pass("milestones deterministic across runs") : fail("determinism")

    // Deleted grow leaves the milestone (durable state = live rows).
    await prisma.growDiary.update({ where: { id: diary.id }, data: { deleted: true } })
    const afterDel = (await activationMilestonesFor([grower.id])).get(grower.id)!
    afterDel.firstGrow === null && afterDel.firstContributionKind === "question"
      ? pass("deleted grow no longer counts as a milestone")
      : fail("deleted grow", { g: afterDel.firstGrow, k: afterDel.firstContributionKind })
    await prisma.growDiary.update({ where: { id: diary.id }, data: { deleted: false } })

    // ── Report privacy: aggregates only ───────────────────────────
    const report = await activationReport(7)
    const json = JSON.stringify(report)
    !json.includes(grower.id) && !json.includes(grower.username) && !json.includes(privateTitle) && !json.includes("push.example.test")
      ? pass("report carries no ids, usernames, private titles, or endpoints")
      : fail("report privacy")
    report.cohort >= 1 && report.steps.find((s) => s.key === "firstReturn")!.count >= 1
      ? pass("report counts the controlled journey")
      : fail("report counts", report.steps)
  } finally {
    for (const t of created.threads) await prisma.thread.delete({ where: { id: t } }).catch(() => {})
    await prisma.pushEvent.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } }).catch(() => {})
    for (const u of users) await prisma.user.delete({ where: { id: u.id } }).catch(() => {})
    await prisma.rateLimit.deleteMany({ where: { key: { in: users.flatMap((u) => [`push-sub:${u.id}`, `push-event:${u.id}`]) } } }).catch(() => {})
  }
  finish()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
