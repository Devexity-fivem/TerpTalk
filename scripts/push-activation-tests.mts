// Activation & Retention — Web Push subscription boundary (HTTP) and the
// derived activation model (real lib against real rows). Delivery
// semantics (notify → optional push, cleanup, dedupe) live in
// notification-2-tests.mts; the staff report gate lives in ops-tests.mts.
// Temp users/rows fully cleaned up.
import "./db-guard.mjs"
import { makeHarness } from "./lib/http-harness.mjs"
import { enableMaintenanceForTest } from "./lib/maintenance-mode.mjs"
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

    // ── Moment milestones — same contribution semantics as the funnel ──
    // mPoster: authored moment is first contribution (kind=moment); a
    // MomentComment on SOMEONE ELSE'S moment is both firstReply and the
    // post-return secondAction.
    const mPoster = await createUser("mp")
    const mCommenter = await createUser("mc") // moment-comment only
    const mReposter = await createUser("mr")  // pure repost only
    const mDeleted = await createUser("md")   // only contribution deleted
    users.push(mPoster, mCommenter, mReposter, mDeleted)
    const mSignup = new Date(Date.now() - 72 * HOUR)
    await prisma.user.update({ where: { id: mPoster.id }, data: { createdAt: mSignup } })
    const otherMoment = await prisma.moment.create({
      data: { authorId: other.id, kind: "POST", content: `__pa om ${TS}`, createdAt: new Date(mSignup.getTime() + 1 * HOUR) },
    })
    const posterMoment = await prisma.moment.create({
      data: { authorId: mPoster.id, kind: "POST", content: `__pa pm ${TS}`, createdAt: new Date(mSignup.getTime() + 10 * HOUR) },
    })
    await prisma.progressionEvent.create({
      data: { userId: mPoster.id, type: "DAILY_LOGIN", reason: "Daily check-in", key: `__pa-daily-${TS}-mp`, createdAt: new Date(mSignup.getTime() + 30 * HOUR) },
    })
    const posterComment = await prisma.momentComment.create({
      data: { momentId: otherMoment.id, authorId: mPoster.id, content: `__pa pc ${TS}`, createdAt: new Date(mSignup.getTime() + 31 * HOUR) },
    })
    // Comment-only member — folds into reply semantics.
    const commenterComment = await prisma.momentComment.create({
      data: { momentId: otherMoment.id, authorId: mCommenter.id, content: `__pa cc ${TS}` },
    })
    // Pure repost: repostOfId + empty content — amplification, not contribution.
    await prisma.moment.create({ data: { authorId: mReposter.id, kind: "POST", content: "", repostOfId: otherMoment.id } })
    // Quote post DOES count (repostOfId + authored content) — mCommenter's
    // earliest authored moment is later than their comment, so no interference.
    // Deleted-only member: live-row convention means no milestone.
    await prisma.moment.create({ data: { authorId: mDeleted.id, kind: "POST", content: `__pa dm ${TS}`, deleted: true } })

    const mm = (await activationMilestonesFor([mPoster.id, mCommenter.id, mReposter.id, mDeleted.id]))
    const pm = mm.get(mPoster.id)!
    pm.firstContribution?.getTime() === posterMoment.createdAt.getTime() && pm.firstContributionKind === "moment"
      ? pass("milestone: authored moment = first contribution, kind=moment")
      : fail("moment first contribution", { c: pm.firstContribution, k: pm.firstContributionKind })
    pm.firstReply?.getTime() === posterComment.createdAt.getTime()
      ? pass("milestone: moment comment on another's post = firstReply")
      : fail("moment comment reply", pm.firstReply)
    pm.secondAction?.getTime() === posterComment.createdAt.getTime()
      ? pass("milestone: moment comment after return = secondAction")
      : fail("moment secondAction", pm.secondAction)
    const cm = mm.get(mCommenter.id)!
    cm.firstReply?.getTime() === commenterComment.createdAt.getTime() &&
      cm.firstContribution?.getTime() === commenterComment.createdAt.getTime() && cm.firstContributionKind === "reply"
      ? pass("milestone: moment-comment-only member contributes (kind=reply)")
      : fail("comment-only", { c: cm.firstContribution, k: cm.firstContributionKind })
    const rm = mm.get(mReposter.id)!
    rm.firstContribution === null && rm.firstContributionKind === null && rm.firstReply === null
      ? pass("pure repost is not a contribution")
      : fail("pure repost", { c: rm.firstContribution, k: rm.firstContributionKind })
    const dm = mm.get(mDeleted.id)!
    dm.firstContribution === null && dm.firstContributionKind === null
      ? pass("deleted-only moment leaves no milestone (live rows)")
      : fail("deleted moment", { c: dm.firstContribution, k: dm.firstContributionKind })
    // Own-moment comment is not a reply — same own-OP rule as Post.
    await prisma.momentComment.create({ data: { momentId: posterMoment.id, authorId: mPoster.id, content: `__pa self ${TS}`, createdAt: new Date(mSignup.getTime() + 8 * HOUR) } })
    const pm2 = (await activationMilestonesFor([mPoster.id])).get(mPoster.id)!
    pm2.firstReply?.getTime() === posterComment.createdAt.getTime()
      ? pass("comment on own moment is not a reply")
      : fail("own-moment comment", pm2.firstReply)
    // Report surface: "moment" appears as a first-contribution kind row.
    const rep7 = await activationReport(7)
    ;(rep7.returnByFirstAction.find((r) => r.kind === "moment")?.members ?? 0) >= 1
      ? pass("activation report exposes the moment contribution kind")
      : fail("report moment kind", rep7.returnByFirstAction)

    // ── Response-received milestone — other-author replies on live targets ──
    // rThread: thread reply qualifies; a LATER second surface's response must
    // not rewrite the milestone or the first contribution. rMoment /
    // rSetup / rAnchor: moment comment, setup comment, and anchored
    // diary-update comment (a Post on the grower's canonical thread) each
    // qualify. rSelf: self-authored replies never count. rDel: response on a
    // now-deleted target doesn't count. rNone and mCommenter: no
    // response-capable content → not in the opportunity denominator.
    const rThread = await createUser("rt")
    const rMoment = await createUser("rm")
    const rSetup = await createUser("rs")
    const rAnchor = await createUser("ra")
    const rSelf = await createUser("rf")
    const rDel = await createUser("rd")
    const rNone = await createUser("rn")
    const rStory = await createUser("ry")   // STORY only — can't receive comments
    const rQuote = await createUser("rq")   // quote post — own text, still a surface
    const rMix = await createUser("rx")     // story + pure repost
    const rMixOk = await createUser("rz")   // story + eligible POST
    const rWs = await createUser("rw")      // whitespace-content repost
    users.push(rThread, rMoment, rSetup, rAnchor, rSelf, rDel, rNone, rStory, rQuote, rMix, rMixOk, rWs)
    const rSignup = new Date(Date.now() - 48 * HOUR)
    for (const u of [rThread, rMoment, rSetup, rAnchor, rSelf, rDel, rNone, rStory, rQuote, rMix, rMixOk, rWs]) {
      await prisma.user.update({ where: { id: u.id }, data: { createdAt: rSignup } })
    }
    const rat = (h: number) => new Date(rSignup.getTime() + h * HOUR)

    // rThread: thread at +1, other's reply at +3; a second surface (moment
    // at +5, other's comment at +6) stays later — earliest response wins.
    const rtThread = await prisma.thread.create({
      data: { title: `__pa rt ${TS}`, slug: `__pa-rt-${TS}`, content: "t", categoryId: qCat.id, authorId: rThread.id, createdAt: rat(1) },
    })
    created.threads.push(rtThread.id)
    await prisma.post.create({ data: { content: "op", threadId: rtThread.id, authorId: rThread.id, createdAt: rat(1) } })
    const rtReply = await prisma.post.create({
      data: { content: "response", threadId: rtThread.id, authorId: other.id, createdAt: rat(3) },
    })
    const rtMoment = await prisma.moment.create({
      data: { authorId: rThread.id, kind: "POST", content: `__pa rtm ${TS}`, createdAt: rat(5) },
    })
    await prisma.momentComment.create({
      data: { momentId: rtMoment.id, authorId: other.id, content: `__pa rtc ${TS}`, createdAt: rat(6) },
    })

    // rMoment: other's comment at +2 on their moment.
    const rmMoment = await prisma.moment.create({
      data: { authorId: rMoment.id, kind: "POST", content: `__pa rmm ${TS}`, createdAt: rat(1) },
    })
    const rmComment = await prisma.momentComment.create({
      data: { momentId: rmMoment.id, authorId: other.id, content: `__pa rmc ${TS}`, createdAt: rat(2) },
    })

    // rSetup: other's SetupComment at +2 on their showcase.
    const rsSetup = await prisma.growSetup.create({
      data: { title: `__pa rs ${TS}`, description: "setup fixture", authorId: rSetup.id, createdAt: rat(1) },
    })
    const rsComment = await prisma.setupComment.create({
      data: { setupId: rsSetup.id, authorId: other.id, content: `__pa rsc ${TS}`, createdAt: rat(2) },
    })

    // rAnchor: anchored diary-update comment = a Post by another author on
    // the grower's canonical discussion thread (same row shape production
    // writes). Diary + lazy thread authored by the grower.
    const raDiary = await prisma.growDiary.create({
      data: {
        title: `__pa ra grow ${TS}`, description: "d", growType: "INDOOR", startDate: rat(0),
        authorId: rAnchor.id, visibility: "PUBLIC", createdAt: rat(1),
      },
    })
    const raThread = await prisma.thread.create({
      data: { title: `__pa ra t ${TS}`, slug: `__pa-ra-${TS}`, content: "d", categoryId: qCat.id, authorId: rAnchor.id, createdAt: rat(1) },
    })
    created.threads.push(raThread.id)
    await prisma.growDiary.update({ where: { id: raDiary.id }, data: { threadId: raThread.id } })
    const raUpdate = await prisma.diaryUpdate.create({
      data: { title: "u", content: "u", stage: "VEGETATIVE", diaryId: raDiary.id, authorId: rAnchor.id, createdAt: rat(2) },
    })
    const raComment = await prisma.post.create({
      data: { content: "nice node spacing", threadId: raThread.id, diaryUpdateId: raUpdate.id, authorId: other.id, createdAt: rat(3) },
    })

    // rSelf: thread with only the owner's own posts — never a response.
    const rfThread = await prisma.thread.create({
      data: { title: `__pa rf ${TS}`, slug: `__pa-rf-${TS}`, content: "t", categoryId: qCat.id, authorId: rSelf.id, createdAt: rat(1) },
    })
    created.threads.push(rfThread.id)
    await prisma.post.create({ data: { content: "op", threadId: rfThread.id, authorId: rSelf.id, createdAt: rat(1) } })
    await prisma.post.create({ data: { content: "bump", threadId: rfThread.id, authorId: rSelf.id, createdAt: rat(4) } })

    // rDel: a real response arrived, then the target was deleted — live-row
    // semantics remove the milestone.
    const rdMoment = await prisma.moment.create({
      data: { authorId: rDel.id, kind: "POST", content: `__pa rdm ${TS}`, createdAt: rat(1) },
    })
    await prisma.momentComment.create({
      data: { momentId: rdMoment.id, authorId: other.id, content: `__pa rdc ${TS}`, createdAt: rat(2) },
    })
    await prisma.moment.update({ where: { id: rdMoment.id }, data: { deleted: true } })

    // Soft-deleted response variant: rNone's thread gets a reply that is
    // then soft-deleted — the target survives but the response doesn't.
    const rnThread = await prisma.thread.create({
      data: { title: `__pa rn ${TS}`, slug: `__pa-rn-${TS}`, content: "t", categoryId: qCat.id, authorId: rNone.id, createdAt: rat(1) },
    })
    created.threads.push(rnThread.id)
    await prisma.post.create({
      data: { content: "gone", threadId: rnThread.id, authorId: other.id, createdAt: rat(2), deleted: true },
    })

    // Opportunity-eligibility variants (Batch U): STORY rows can't receive
    // comments and pure reposts retarget comments to the original — neither
    // is a response surface. Quote posts keep authored content → eligible.
    await prisma.moment.create({ data: { authorId: rStory.id, kind: "STORY", content: `__pa ry ${TS}`, expiresAt: rat(72), createdAt: rat(1) } })
    await prisma.moment.create({ data: { authorId: rQuote.id, kind: "POST", content: `__pa rq ${TS}`, repostOfId: rmMoment.id, createdAt: rat(1) } })
    await prisma.moment.create({ data: { authorId: rMix.id, kind: "STORY", content: `__pa rxs ${TS}`, expiresAt: rat(72), createdAt: rat(1) } })
    await prisma.moment.create({ data: { authorId: rMix.id, kind: "POST", content: "", repostOfId: rmMoment.id, createdAt: rat(2) } })
    await prisma.moment.create({ data: { authorId: rMixOk.id, kind: "STORY", content: `__pa rzs ${TS}`, expiresAt: rat(72), createdAt: rat(1) } })
    await prisma.moment.create({ data: { authorId: rMixOk.id, kind: "POST", content: `__pa rzp ${TS}`, createdAt: rat(2) } })
    // Production trims content at create, but the predicate must be robust
    // to whitespace-only content on a repost row.
    await prisma.moment.create({ data: { authorId: rWs.id, kind: "POST", content: "   ", repostOfId: rmMoment.id, createdAt: rat(1) } })

    const rmm = await activationMilestonesFor([rThread.id, rMoment.id, rSetup.id, rAnchor.id, rSelf.id, rDel.id, rNone.id, mCommenter.id, mReposter.id, mDeleted.id, rStory.id, rQuote.id, rMix.id, rMixOk.id, rWs.id])
    const rt = rmm.get(rThread.id)!
    rt.firstResponseReceived?.getTime() === rtReply.createdAt.getTime() && rt.responseCapable === true
      ? pass("response: thread reply counts, earliest wins")
      : fail("thread response", rt.firstResponseReceived)
    rt.firstContribution?.getTime() === rat(1).getTime() && rt.firstContributionKind === "question"
      ? pass("response: later-surface response doesn't rewrite first contribution")
      : fail("first contribution stability", { c: rt.firstContribution, k: rt.firstContributionKind })
    rmm.get(rMoment.id)!.firstResponseReceived?.getTime() === rmComment.createdAt.getTime()
      ? pass("response: moment comment counts")
      : fail("moment response", rmm.get(rMoment.id)!.firstResponseReceived)
    rmm.get(rSetup.id)!.firstResponseReceived?.getTime() === rsComment.createdAt.getTime()
      ? pass("response: setup comment counts")
      : fail("setup response", rmm.get(rSetup.id)!.firstResponseReceived)
    rmm.get(rAnchor.id)!.firstResponseReceived?.getTime() === raComment.createdAt.getTime()
      ? pass("response: anchored diary-update comment counts")
      : fail("anchored response", rmm.get(rAnchor.id)!.firstResponseReceived)
    {
      const self = rmm.get(rSelf.id)!
      self.firstResponseReceived === null && self.responseCapable === true
        ? pass("response: self-authored posts never count, member still eligible")
        : fail("self response", { r: self.firstResponseReceived, e: self.responseCapable })
    }
    {
      const del = rmm.get(rDel.id)!
      del.firstResponseReceived === null && del.responseCapable === false
        ? pass("response: deleted target removes the milestone and the opportunity")
        : fail("deleted target", { r: del.firstResponseReceived, e: del.responseCapable })
    }
    {
      const none = rmm.get(rNone.id)!
      none.firstResponseReceived === null && none.responseCapable === true
        ? pass("response: soft-deleted reply doesn't count; live thread still eligible")
        : fail("soft-deleted response", { r: none.firstResponseReceived, e: none.responseCapable })
      rmm.get(mCommenter.id)!.responseCapable === false
        ? pass("response: comment-only member has no opportunity (not in denominator)")
        : fail("comment-only opportunity", rmm.get(mCommenter.id)!.responseCapable)
    }
    {
      const story = rmm.get(rStory.id)!
      story.responseCapable === false && story.firstResponseReceived === null
        ? pass("response: STORY-only member has no response opportunity")
        : fail("story opportunity", { c: story.responseCapable, r: story.firstResponseReceived })
      rmm.get(mReposter.id)!.responseCapable === false
        ? pass("response: pure-repost-only member has no response opportunity")
        : fail("repost opportunity", rmm.get(mReposter.id)!.responseCapable)
      rmm.get(rQuote.id)!.responseCapable === true
        ? pass("response: quote post qualifies as response-capable")
        : fail("quote opportunity", rmm.get(rQuote.id)!.responseCapable)
      rmm.get(rMix.id)!.responseCapable === false
        ? pass("response: story + pure repost still no opportunity")
        : fail("mixed ineligible", rmm.get(rMix.id)!.responseCapable)
      rmm.get(rMixOk.id)!.responseCapable === true
        ? pass("response: story + eligible post keeps the opportunity")
        : fail("mixed eligible", rmm.get(rMixOk.id)!.responseCapable)
      rmm.get(rWs.id)!.responseCapable === false
        ? pass("response: whitespace-only repost content is not eligible")
        : fail("whitespace repost", rmm.get(rWs.id)!.responseCapable)
      rmm.get(mDeleted.id)!.responseCapable === false
        ? pass("response: deleted-only moment has no opportunity")
        : fail("deleted-only opportunity", rmm.get(mDeleted.id)!.responseCapable)
    }

    // Report response section: eligible ⊆ cohort, received ⊆ eligible, and
    // the milestone step + conversion row are exposed. Capable fixtures:
    // rt, rm, rs, ra, rf, rn + mp, rq, rz (rd, ry, rx, rw, mr, md are not);
    // four received (rt, rm, rs, ra).
    const repR = await activationReport(30)
    const resp = repR.response
    const recvStep = repR.steps.find((s) => s.key === "firstResponseReceived")
    const respConv = repR.conversions.find((c) => c.from === "responseCapable" && c.to === "firstResponseReceived")
    resp.eligible >= 7 && resp.received >= 4 && resp.received <= resp.eligible && resp.pct !== null
      ? pass("report: response opportunity/received/rate present and consistent")
      : fail("report response", resp)
    recvStep !== undefined && recvStep.count === resp.received
      ? pass("report: response milestone in the ladder matches the rate numerator")
      : fail("response step", recvStep)
    respConv !== undefined && respConv.denominator === resp.eligible && respConv.numerator === resp.received
      ? pass("report: response conversion uses the opportunity denominator")
      : fail("response conversion", respConv)

    // ── Report privacy: aggregates only ───────────────────────────
    const report = await activationReport(7)
    const json = JSON.stringify(report)
    !json.includes(grower.id) && !json.includes(grower.username) && !json.includes(privateTitle) && !json.includes("push.example.test")
      ? pass("report carries no ids, usernames, private titles, or endpoints")
      : fail("report privacy")
    report.cohort >= 1 && report.steps.find((s) => s.key === "firstReturn")!.count >= 1
      ? pass("report counts the controlled journey")
      : fail("report counts", report.steps)

    // ── Maintenance freeze — unsubscribe is a stop-delivery control ──
    {
      await prisma.pushSubscription.create({
        data: { userId: b.id, endpoint: sub("mx").endpoint, p256dh: sub("mx").keys.p256dh, auth: sub("mx").keys.auth },
      })
      const restore = await enableMaintenanceForTest()
      try {
        const p = await call("/api/push/subscribe", { method: "POST", body: sub("mxsub"), cookie: bCookie })
        p.status === 200 || p.status === 201
          ? pass("maintenance: subscribe POST still accepted")
          : fail("maintenance subscribe", { s: p.status, d: p.data })
        const r = await call("/api/push/subscribe", { method: "DELETE", body: { endpoint: sub("mx").endpoint }, cookie: bCookie })
        r.status === 200 && (r.data?.removed as number | undefined) === 1 &&
          (await prisma.pushSubscription.count({ where: { endpoint: sub("mx").endpoint } })) === 0
          ? pass("maintenance: unsubscribe still removes the subscription")
          : fail("maintenance unsubscribe", { s: r.status, d: r.data })
      } finally {
        await restore()
      }
      await prisma.pushSubscription.deleteMany({ where: { endpoint: sub("mxsub").endpoint } }).catch(() => {})
    }
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
