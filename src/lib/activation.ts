import { prisma } from "@/lib/prisma"
import { TERPBOT_USERNAME } from "@/lib/terpbot-constants"
import { socialLoopReport, type SocialLoopReport } from "@/lib/product-events"

// ─── Canonical activation model ─────────────────────────────────────
// Every milestone is DERIVED from durable product state — no duplicate
// "first X" event ledger. The only explicitly instrumented signals are
// push lifecycle steps (PushEvent), which no product row can answer.
//
//   signup            User.createdAt
//   onboarding        User.onboardingCompletedAt
//   first grow        earliest live GrowDiary
//   first structured  earliest live GrowDiary with strainId/mediumType/lightType
//   first question    earliest live Thread in a help/question category
//   first reply       earliest live Post on SOMEONE ELSE'S thread (an OP's
//                     own opening Post row is not a reply) or live
//                     MomentComment on someone else's Moment
//   first follow      earliest Follow (member) or DiaryFollow (grow) the
//                     member created — ThreadFollow is auto-created, excluded
//   first contribution earliest of grow / diary update / thread / reply /
//                     authored Moment. Pure reposts (repostOfId set, empty
//                     content) are amplification, not contributions — same
//                     rule as reactions; quote posts count.
//   first return      earliest DAILY_LOGIN check-in marker ≥ 24h after
//                     signup. The marker is written by /api/ping only for an
//                     authenticated, foregrounded page (navigation mount /
//                     visibility) — never by cron, Pusher, or prefetch — once
//                     per UTC day, idempotently keyed.
//   second action     earliest contribution strictly after first return
//   first harvest     earliest GrowDiary.harvestedAt
//   push enabled      a live PushSubscription or a PERMISSION_GRANTED event
//   first response    earliest live OTHER-author reply to the member's own
//                     content — Post on their Thread (which also carries
//                     anchored diary-update comments: they live on the
//                     grower's canonical discussion thread), MomentComment
//                     on their Moment, SetupComment on their GrowSetup.
//                     Soft-deleted responses and deleted targets don't
//                     qualify; the owner's own posts never count. A diary
//                     with no canonical thread is not response-capable —
//                     comments can only exist as Posts on that thread.
//   response-capable  member authored ≥1 live Thread, Moment (any kind —
//                     even a pure repost can receive comments), or
//                     GrowSetup. This is the response-rate denominator —
//                     members who published nothing no one can reply to
//                     are not divided by.
//
// Chat is intentionally NOT a milestone: ChatMessage rows hard-delete after
// three days, so it is not durable evidence.
//
// Privacy: the output is timestamps + aggregate counts. No content, no
// titles, no endpoints. Private diaries count only toward their OWNER's
// milestone existence and never surface individually; reports aggregate.

const DAY = 86400000
const QUESTION_RE = /question|help|problem|doctor/i
/** Hard cap on the cohort size per computation — bounded scans only. */
export const ACTIVATION_COHORT_CAP = 2000

export interface MemberMilestones {
  signup: Date
  onboarding: Date | null
  firstGrow: Date | null
  firstStructuredGrow: Date | null
  firstQuestion: Date | null
  firstReply: Date | null
  firstFollow: Date | null
  firstContribution: Date | null
  firstContributionKind: "grow" | "update" | "question" | "thread" | "reply" | "moment" | null
  firstReturn: Date | null
  secondAction: Date | null
  firstHarvest: Date | null
  pushEnabled: boolean
  firstResponseReceived: Date | null
  responseCapable: boolean
}

type MinRow = { uid: string; ts: Date | null }

const minOf = (...ds: (Date | null | undefined)[]): Date | null =>
  ds.reduce<Date | null>((m, d) => (d && (!m || d < m) ? d : m), null)

/** Derive milestones for an explicit set of members (≤ cohort cap). */
export async function activationMilestonesFor(userIds: string[]): Promise<Map<string, MemberMilestones>> {
  const ids = [...new Set(userIds)].slice(0, ACTIVATION_COHORT_CAP)
  const out = new Map<string, MemberMilestones>()
  if (!ids.length) return out

  const questionCatIds = (await prisma.category.findMany({ select: { id: true, slug: true, name: true } }))
    .filter((c) => QUESTION_RE.test(`${c.slug} ${c.name}`))
    .map((c) => c.id)

  const [users, grows, structured, updates, questions, threads, replies, momentPosts, momentReplies, follows, diaryFollows, returns, harvests, pushSubs, pushGrants, threadResponses, momentResponses, setupResponses, capableRows] =
    await Promise.all([
      prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, createdAt: true, onboardingCompletedAt: true } }),
      prisma.growDiary.groupBy({ by: ["authorId"], where: { authorId: { in: ids }, deleted: false }, _min: { createdAt: true } }),
      prisma.growDiary.groupBy({
        by: ["authorId"],
        where: { authorId: { in: ids }, deleted: false, OR: [{ strainId: { not: null } }, { mediumType: { not: null } }, { lightType: { not: null } }] },
        _min: { createdAt: true },
      }),
      prisma.diaryUpdate.groupBy({ by: ["authorId"], where: { authorId: { in: ids } }, _min: { createdAt: true } }),
      questionCatIds.length
        ? prisma.thread.groupBy({ by: ["authorId"], where: { authorId: { in: ids }, deleted: false, categoryId: { in: questionCatIds } }, _min: { createdAt: true } })
        : Promise.resolve([] as { authorId: string; _min: { createdAt: Date | null } }[]),
      prisma.thread.groupBy({ by: ["authorId"], where: { authorId: { in: ids }, deleted: false }, _min: { createdAt: true } }),
      prisma.$queryRaw<MinRow[]>`
        SELECT p."authorId" AS uid, MIN(p."createdAt") AS ts
        FROM "Post" p JOIN "Thread" t ON t."id" = p."threadId"
        WHERE p."authorId" = ANY(${ids}) AND p."deleted" = false AND t."authorId" <> p."authorId"
        GROUP BY p."authorId"`,
      // Authored Moments only — pure reposts (repostOfId + empty content)
      // are amplification, not a contribution; live rows like every
      // milestone above.
      prisma.moment.groupBy({ by: ["authorId"], where: { authorId: { in: ids }, deleted: false, OR: [{ repostOfId: null }, { content: { not: "" } }] }, _min: { createdAt: true } }),
      // Moment comments count as replies — same rule as Post: only a
      // comment on SOMEONE ELSE'S moment qualifies.
      prisma.$queryRaw<MinRow[]>`
        SELECT c."authorId" AS uid, MIN(c."createdAt") AS ts
        FROM "MomentComment" c JOIN "Moment" m ON m."id" = c."momentId"
        WHERE c."authorId" = ANY(${ids}) AND c."deleted" = false AND m."authorId" <> c."authorId"
        GROUP BY c."authorId"`,
      prisma.follow.groupBy({ by: ["followerId"], where: { followerId: { in: ids } }, _min: { createdAt: true } }),
      prisma.diaryFollow.groupBy({ by: ["userId"], where: { userId: { in: ids } }, _min: { createdAt: true } }),
      prisma.$queryRaw<MinRow[]>`
        SELECT pe."userId" AS uid, MIN(pe."createdAt") AS ts
        FROM "ProgressionEvent" pe JOIN "User" u ON u."id" = pe."userId"
        WHERE pe."userId" = ANY(${ids}) AND pe."type" = 'DAILY_LOGIN'
          AND pe."createdAt" >= u."createdAt" + interval '24 hours'
        GROUP BY pe."userId"`,
      prisma.growDiary.groupBy({ by: ["authorId"], where: { authorId: { in: ids }, deleted: false, harvestedAt: { not: null } }, _min: { harvestedAt: true } }),
      prisma.pushSubscription.findMany({ where: { userId: { in: ids } }, select: { userId: true }, distinct: ["userId"] }),
      prisma.pushEvent.findMany({ where: { type: "PERMISSION_GRANTED", userId: { in: ids } }, select: { userId: true } }),
      // ── Responses ON cohort members' content ──────────────────────
      // Inverted ownership of the first-reply predicate: the response
      // author must differ from the target owner, both rows live.
      // Thread replies cover anchored DiaryUpdate comments and diary /
      // setup discussion threads — all are Posts on the owner's
      // canonical thread. Moment comments on expired stories still
      // count: the response was genuinely received while the story was
      // live; expiry limits future interaction, not past receipt.
      prisma.$queryRaw<MinRow[]>`
        SELECT t."authorId" AS uid, MIN(p."createdAt") AS ts
        FROM "Post" p JOIN "Thread" t ON t."id" = p."threadId"
        WHERE t."authorId" = ANY(${ids}) AND p."authorId" <> t."authorId"
          AND p."deleted" = false AND t."deleted" = false
        GROUP BY t."authorId"`,
      prisma.$queryRaw<MinRow[]>`
        SELECT m."authorId" AS uid, MIN(c."createdAt") AS ts
        FROM "MomentComment" c JOIN "Moment" m ON m."id" = c."momentId"
        WHERE m."authorId" = ANY(${ids}) AND c."authorId" <> m."authorId"
          AND c."deleted" = false AND m."deleted" = false
        GROUP BY m."authorId"`,
      prisma.$queryRaw<MinRow[]>`
        SELECT s."authorId" AS uid, MIN(c."createdAt") AS ts
        FROM "SetupComment" c JOIN "GrowSetup" s ON s."id" = c."setupId"
        WHERE s."authorId" = ANY(${ids}) AND c."authorId" <> s."authorId"
          AND c."deleted" = false AND s."deleted" = false
        GROUP BY s."authorId"`,
      // Response opportunity: ≥1 live response-capable target authored
      // by the member. A GrowDiary is not listed — it can only hold
      // responses through its canonical thread, whose Thread row is
      // already member-authored. The Moment arm is POST-only: STORY
      // rows can't receive comments (the comment route 404s non-POST
      // kinds) and pure reposts retarget comments to the original —
      // neither is a response surface. Quote posts keep authored
      // content → still eligible.
      prisma.$queryRaw<{ uid: string }[]>`
        SELECT "authorId" AS uid FROM "Thread" WHERE "authorId" = ANY(${ids}) AND "deleted" = false
        UNION SELECT "authorId" FROM "Moment" WHERE "authorId" = ANY(${ids}) AND "deleted" = false
          AND "kind" = 'POST' AND ("repostOfId" IS NULL OR BTRIM("content") <> '')
        UNION SELECT "authorId" FROM "GrowSetup" WHERE "authorId" = ANY(${ids}) AND "deleted" = false`,
    ])

  const byAuthor = (rows: { authorId: string; _min: { createdAt: Date | null } }[]) =>
    new Map(rows.map((r) => [r.authorId, r._min.createdAt]))
  const growM = byAuthor(grows)
  const structM = byAuthor(structured)
  const updM = byAuthor(updates)
  const qM = byAuthor(questions)
  const tM = byAuthor(threads)
  const replyM = new Map(replies.map((r) => [r.uid, r.ts ? new Date(r.ts) : null]))
  // Moment comments fold into the reply milestone — same "replied to
  // someone" semantics, earliest across both surfaces.
  for (const r of momentReplies) {
    const ts = r.ts ? new Date(r.ts) : null
    if (!ts) continue
    const cur = replyM.get(r.uid)
    if (!cur || ts < cur) replyM.set(r.uid, ts)
  }
  const momentM = byAuthor(momentPosts)
  const followM = new Map(follows.map((r) => [r.followerId, r._min.createdAt]))
  const dFollowM = new Map(diaryFollows.map((r) => [r.userId, r._min.createdAt]))
  const retM = new Map(returns.map((r) => [r.uid, r.ts ? new Date(r.ts) : null]))
  const harvM = new Map(harvests.map((r) => [r.authorId, r._min.harvestedAt]))
  const pushSet = new Set([...pushSubs.map((s) => s.userId), ...pushGrants.map((g) => g.userId).filter((u): u is string => !!u)])
  // Earliest response across the three surfaces — a member counts once
  // no matter how many surfaces answered them.
  const respM = new Map<string, Date>()
  for (const rows of [threadResponses, momentResponses, setupResponses]) {
    for (const r of rows) {
      if (!r.ts) continue
      const ts = new Date(r.ts)
      const cur = respM.get(r.uid)
      if (!cur || ts < cur) respM.set(r.uid, ts)
    }
  }
  const capableSet = new Set(capableRows.map((r) => r.uid))

  // Second meaningful action: first contribution strictly after the first
  // return — one bounded query over the cohort's returners only.
  const returners = [...retM.entries()].filter(([, d]) => d).map(([uid, d]) => ({ uid, d: d! }))
  const secondM = new Map<string, Date>()
  if (returners.length) {
    const rIds = returners.map((r) => r.uid)
    const rows = await prisma.$queryRaw<MinRow[]>`
      WITH r AS (
        SELECT pe."userId" AS uid, MIN(pe."createdAt") AS ret
        FROM "ProgressionEvent" pe JOIN "User" u ON u."id" = pe."userId"
        WHERE pe."userId" = ANY(${rIds}) AND pe."type" = 'DAILY_LOGIN'
          AND pe."createdAt" >= u."createdAt" + interval '24 hours'
        GROUP BY pe."userId"
      ), c AS (
        SELECT "authorId" AS uid, "createdAt" AS ts FROM "GrowDiary" WHERE "authorId" = ANY(${rIds}) AND "deleted" = false
        UNION ALL SELECT "authorId", "createdAt" FROM "DiaryUpdate" WHERE "authorId" = ANY(${rIds})
        UNION ALL SELECT "authorId", "createdAt" FROM "Thread" WHERE "authorId" = ANY(${rIds}) AND "deleted" = false
        UNION ALL SELECT p."authorId", p."createdAt" FROM "Post" p JOIN "Thread" t ON t."id" = p."threadId"
          WHERE p."authorId" = ANY(${rIds}) AND p."deleted" = false AND t."authorId" <> p."authorId"
        UNION ALL SELECT "authorId", "createdAt" FROM "Moment" WHERE "authorId" = ANY(${rIds}) AND "deleted" = false AND ("repostOfId" IS NULL OR "content" <> '')
        UNION ALL SELECT c."authorId", c."createdAt" FROM "MomentComment" c JOIN "Moment" m ON m."id" = c."momentId"
          WHERE c."authorId" = ANY(${rIds}) AND c."deleted" = false AND m."authorId" <> c."authorId"
      )
      SELECT r.uid, MIN(c.ts) AS ts FROM r JOIN c ON c.uid = r.uid AND c.ts > r.ret GROUP BY r.uid`
    for (const row of rows) if (row.ts) secondM.set(row.uid, new Date(row.ts))
  }

  for (const u of users) {
    const grow = growM.get(u.id) ?? null
    const upd = updM.get(u.id) ?? null
    const q = qM.get(u.id) ?? null
    const t = tM.get(u.id) ?? null
    const reply = replyM.get(u.id) ?? null
    const moment = momentM.get(u.id) ?? null
    const first = minOf(grow, upd, t, reply, moment)
    // Kind of the earliest contribution — ties resolve in this fixed order.
    const kinds: [MemberMilestones["firstContributionKind"], Date | null][] = [
      ["grow", grow], ["update", upd], ["question", q], ["thread", t && (!q || t < q) ? t : null], ["moment", moment], ["reply", reply],
    ]
    const kind = first ? kinds.find(([, d]) => d && d.getTime() === first.getTime())?.[0] ?? null : null
    out.set(u.id, {
      signup: u.createdAt,
      onboarding: u.onboardingCompletedAt,
      firstGrow: grow,
      firstStructuredGrow: structM.get(u.id) ?? null,
      firstQuestion: q,
      firstReply: reply,
      firstFollow: minOf(followM.get(u.id), dFollowM.get(u.id)),
      firstContribution: first,
      firstContributionKind: kind,
      firstReturn: retM.get(u.id) ?? null,
      secondAction: secondM.get(u.id) ?? null,
      firstHarvest: harvM.get(u.id) ?? null,
      pushEnabled: pushSet.has(u.id),
      firstResponseReceived: respM.get(u.id) ?? null,
      responseCapable: capableSet.has(u.id),
    })
  }
  return out
}

export interface ActivationReport {
  windowDays: number
  cohort: number
  truncated: boolean
  steps: { key: string; label: string; count: number; pctOfSignups: number }[]
  conversions: { from: string; to: string; numerator: number; denominator: number; pct: number | null }[]
  /** Return rate grouped by the kind of the first contribution —
   *  association only, never a causal claim. */
  returnByFirstAction: { kind: string; members: number; returned: number; pct: number | null }[]
  /** Return rate for push-enabled vs not — association only. */
  returnByPush: { pushEnabled: boolean; members: number; returned: number; pct: number | null }[]
  push: { promptShown: number; granted: number; denied: number; sent: number; failed: number; clicked: number; removed: number }
  /** Response loop among the signup cohort: `eligible` members published
   *  ≥1 live response-capable item (Thread, Moment, or GrowSetup);
   *  `received` got ≥1 live other-author reply on it. Denominator is NOT
   *  signups — members who never published anything reply-able are
   *  excluded rather than diluting the rate. */
  response: { eligible: number; received: number; pct: number | null }
  /** Event-windowed social-loop metrics from the ProductEvent sink —
   *  distinct from the signup cohort above: these answer WHICH surface
   *  members followed/interacted from, which state cannot derive. */
  social: SocialLoopReport
  generatedAt: string
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null)

/** Aggregate funnel for members who signed up in the last `windowDays`.
 *  Banned accounts and the bot are excluded. Bounded to the cohort cap. */
export async function activationReport(windowDays = 30): Promise<ActivationReport> {
  const since = new Date(Date.now() - windowDays * DAY)
  const cohortUsers = await prisma.user.findMany({
    where: { createdAt: { gt: since }, banned: false, profile: { username: { not: TERPBOT_USERNAME } } },
    orderBy: { createdAt: "desc" },
    take: ACTIVATION_COHORT_CAP + 1,
    select: { id: true },
  })
  const truncated = cohortUsers.length > ACTIVATION_COHORT_CAP
  const m = [...(await activationMilestonesFor(cohortUsers.slice(0, ACTIVATION_COHORT_CAP).map((u) => u.id))).values()]
  const n = m.length
  const count = (f: (x: MemberMilestones) => boolean) => m.filter(f).length

  const stepDefs: [string, string, (x: MemberMilestones) => boolean][] = [
    ["signup", "Signed up", () => true],
    ["onboarding", "Completed onboarding", (x) => !!x.onboarding],
    ["firstGrow", "Started a grow", (x) => !!x.firstGrow],
    ["firstStructuredGrow", "Started a structured grow", (x) => !!x.firstStructuredGrow],
    ["firstContribution", "First contribution", (x) => !!x.firstContribution],
    ["firstQuestion", "Asked a question", (x) => !!x.firstQuestion],
    ["firstReply", "Replied to someone", (x) => !!x.firstReply],
    ["firstResponseReceived", "Received a response", (x) => !!x.firstResponseReceived],
    ["firstFollow", "Followed a grower or grow", (x) => !!x.firstFollow],
    ["firstReturn", "Came back (≥24h)", (x) => !!x.firstReturn],
    ["secondAction", "Contributed after returning", (x) => !!x.secondAction],
    ["firstHarvest", "Recorded a harvest", (x) => !!x.firstHarvest],
    ["pushEnabled", "Enabled push", (x) => x.pushEnabled],
  ]
  const steps = stepDefs.map(([key, label, f]) => {
    const c = count(f)
    return { key, label, count: c, pctOfSignups: pct(c, n) ?? 0 }
  })

  const conv = (from: string, to: string, a: (x: MemberMilestones) => boolean, b: (x: MemberMilestones) => boolean) => {
    const den = count(a)
    const num = count((x) => a(x) && b(x))
    return { from, to, numerator: num, denominator: den, pct: pct(num, den) }
  }
  const conversions = [
    conv("signup", "onboarding", () => true, (x) => !!x.onboarding),
    conv("onboarding", "firstGrow", (x) => !!x.onboarding, (x) => !!x.firstGrow),
    conv("firstGrow", "firstContributionBeyondGrow", (x) => !!x.firstGrow, (x) => !!(x.firstQuestion || x.firstReply)),
    conv("firstContribution", "firstReturn", (x) => !!x.firstContribution, (x) => !!x.firstReturn),
    conv("firstReturn", "secondAction", (x) => !!x.firstReturn, (x) => !!x.secondAction),
    conv("firstGrow", "firstHarvest", (x) => !!x.firstGrow, (x) => !!x.firstHarvest),
    // Response rate uses the opportunity denominator, not signups.
    conv("responseCapable", "firstResponseReceived", (x) => x.responseCapable, (x) => !!x.firstResponseReceived),
  ]

  const kinds = ["grow", "update", "question", "thread", "moment", "reply"]
  const returnByFirstAction = [
    ...kinds.map((k) => {
      const g = m.filter((x) => x.firstContributionKind === k)
      const r = g.filter((x) => x.firstReturn).length
      return { kind: k, members: g.length, returned: r, pct: pct(r, g.length) }
    }),
    (() => {
      const g = m.filter((x) => !x.firstContribution)
      const r = g.filter((x) => x.firstReturn).length
      return { kind: "none", members: g.length, returned: r, pct: pct(r, g.length) }
    })(),
  ]
  const returnByPush = [true, false].map((p) => {
    const g = m.filter((x) => x.pushEnabled === p)
    const r = g.filter((x) => x.firstReturn).length
    return { pushEnabled: p, members: g.length, returned: r, pct: pct(r, g.length) }
  })

  const [pushCounts, social] = await Promise.all([
    prisma.pushEvent.groupBy({
      by: ["type"],
      where: { createdAt: { gt: since } },
      _count: { _all: true },
    }),
    socialLoopReport(windowDays),
  ])
  const pc = (t: string) => pushCounts.find((r) => r.type === t)?._count._all ?? 0

  return {
    windowDays,
    cohort: n,
    truncated,
    steps,
    conversions,
    returnByFirstAction,
    returnByPush,
    push: {
      promptShown: pc("PROMPT_SHOWN"),
      granted: pc("PERMISSION_GRANTED"),
      denied: pc("PERMISSION_DENIED"),
      sent: pc("SENT"),
      failed: pc("FAILED"),
      clicked: pc("CLICKED"),
      removed: pc("SUBSCRIPTION_REMOVED"),
    },
    response: (() => {
      const eligible = count((x) => x.responseCapable)
      const received = count((x) => !!x.firstResponseReceived)
      return { eligible, received, pct: pct(received, eligible) }
    })(),
    social,
    generatedAt: new Date().toISOString(),
  }
}
