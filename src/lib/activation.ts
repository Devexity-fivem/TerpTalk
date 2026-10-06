import { prisma } from "@/lib/prisma"
import { TERPBOT_USERNAME } from "@/lib/terpbot-constants"

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
//                     own opening Post row is not a reply)
//   first follow      earliest Follow (member) or DiaryFollow (grow) the
//                     member created — ThreadFollow is auto-created, excluded
//   first contribution earliest of grow / diary update / thread / reply
//   first return      earliest DAILY_LOGIN check-in marker ≥ 24h after
//                     signup. The marker is written by /api/ping only for an
//                     authenticated, foregrounded page (navigation mount /
//                     visibility) — never by cron, Pusher, or prefetch — once
//                     per UTC day, idempotently keyed.
//   second action     earliest contribution strictly after first return
//   first harvest     earliest GrowDiary.harvestedAt
//   push enabled      a live PushSubscription or a PERMISSION_GRANTED event
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
  firstContributionKind: "grow" | "update" | "question" | "thread" | "reply" | null
  firstReturn: Date | null
  secondAction: Date | null
  firstHarvest: Date | null
  pushEnabled: boolean
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

  const [users, grows, structured, updates, questions, threads, replies, follows, diaryFollows, returns, harvests, pushSubs, pushGrants] =
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
    ])

  const byAuthor = (rows: { authorId: string; _min: { createdAt: Date | null } }[]) =>
    new Map(rows.map((r) => [r.authorId, r._min.createdAt]))
  const growM = byAuthor(grows)
  const structM = byAuthor(structured)
  const updM = byAuthor(updates)
  const qM = byAuthor(questions)
  const tM = byAuthor(threads)
  const replyM = new Map(replies.map((r) => [r.uid, r.ts ? new Date(r.ts) : null]))
  const followM = new Map(follows.map((r) => [r.followerId, r._min.createdAt]))
  const dFollowM = new Map(diaryFollows.map((r) => [r.userId, r._min.createdAt]))
  const retM = new Map(returns.map((r) => [r.uid, r.ts ? new Date(r.ts) : null]))
  const harvM = new Map(harvests.map((r) => [r.authorId, r._min.harvestedAt]))
  const pushSet = new Set([...pushSubs.map((s) => s.userId), ...pushGrants.map((g) => g.userId).filter((u): u is string => !!u)])

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
    const first = minOf(grow, upd, t, reply)
    // Kind of the earliest contribution — ties resolve in this fixed order.
    const kinds: [MemberMilestones["firstContributionKind"], Date | null][] = [
      ["grow", grow], ["update", upd], ["question", q], ["thread", t && (!q || t < q) ? t : null], ["reply", reply],
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
  ]

  const kinds = ["grow", "update", "question", "thread", "reply"]
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

  const pushCounts = await prisma.pushEvent.groupBy({
    by: ["type"],
    where: { createdAt: { gt: since } },
    _count: { _all: true },
  })
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
    generatedAt: new Date().toISOString(),
  }
}
