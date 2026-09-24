import { prisma } from "@/lib/prisma"

// Operator metrics for /ops — every query is a bounded count, groupBy, or a
// capped take. Nothing here scans a table unbounded, returns message bodies,
// or exposes private diary content. The page is staff-gated but the queries
// are written as if they could be shown publicly: usernames only on content
// that is already public, no IPs, no email fields (none exist anyway).

const DAY = 24 * 60 * 60 * 1000

export interface FunnelWindow {
  days: number
  signups: number
  onboardingCompleted: number
  activated: number
  firstDiary: number
  firstThread: number
  firstChatMessage: number
  returned24h: number
}

// "Activated" = the member produced at least one real contribution — a
// thread, reply, diary, diary update, setup, or chat message. That is the
// primary activation event: TerpTalk's value is growing knowledge +
// community, and a member who has never contributed has not experienced it.
const CONTRIBUTION_OR = [
  { threadCreator: { some: {} } },
  { posts: { some: {} } },
  { diaryCreator: { some: {} } },
  { diaryUpdates: { some: {} } },
  { setupCreator: { some: {} } },
  { chatMessages: { some: {} } },
] as const

async function funnel(sinceDays: number): Promise<FunnelWindow> {
  const since = new Date(Date.now() - sinceDays * DAY)
  const base = { createdAt: { gt: since }, banned: false }
  const [signups, onboardingCompleted, activated, firstDiary, firstThread, firstChatMessage, returned24h] =
    await Promise.all([
      prisma.user.count({ where: base }),
      prisma.user.count({ where: { ...base, onboardingCompletedAt: { not: null } } }),
      prisma.user.count({ where: { ...base, OR: [...CONTRIBUTION_OR] } }),
      prisma.user.count({ where: { ...base, diaryCreator: { some: {} } } }),
      prisma.user.count({ where: { ...base, threadCreator: { some: {} } } }),
      prisma.user.count({ where: { ...base, chatMessages: { some: {} } } }),
      // Returned = lastSeenAt (kept fresh by /api/ping) is at least a day
      // past signup. Column-to-column comparison needs raw SQL; the where
      // clause keeps it to the bounded sign-up window.
      prisma.$queryRaw<[{ n: bigint }]>`
        SELECT COUNT(*)::bigint AS n FROM "User"
        WHERE "createdAt" > ${since}
          AND "lastSeenAt" IS NOT NULL
          AND "lastSeenAt" > "createdAt" + interval '24 hours'
          AND "banned" = false
      `.then((r) => Number(r[0]?.n ?? 0)),
    ])
  return { days: sinceDays, signups, onboardingCompleted, activated, firstDiary, firstThread, firstChatMessage, returned24h }
}

export interface CommunityHealth {
  uniqueContributors7d: number
  newThreads7d: number
  newReplies7d: number
  diaryUpdates7d: number
  chatMessages7d: number
  newMembers7d: number
  returningMembers7d: number
  openReports: number
}

async function communityHealth(): Promise<CommunityHealth> {
  const since = new Date(Date.now() - 7 * DAY)
  const [contributorRows, newThreads7d, newReplies7d, diaryUpdates7d, chatMessages7d, newMembers7d, returningMembers7d, openReports] =
    await Promise.all([
      // Distinct authors across every contribution surface in the window.
      prisma.$queryRaw<[{ n: bigint }]>`
        SELECT COUNT(DISTINCT "authorId")::bigint AS n FROM (
          SELECT "authorId" AS "authorId" FROM "Thread" WHERE "createdAt" > ${since} AND "deleted" = false
          UNION ALL SELECT "authorId" FROM "Post" WHERE "createdAt" > ${since} AND "deleted" = false
          UNION ALL SELECT "authorId" FROM "GrowDiary" WHERE "createdAt" > ${since} AND "deleted" = false
          UNION ALL SELECT "authorId" FROM "DiaryUpdate" WHERE "createdAt" > ${since}
          UNION ALL SELECT "authorId" FROM "ChatMessage" WHERE "createdAt" > ${since} AND "deleted" = false
          UNION ALL SELECT "authorId" FROM "GrowSetup" WHERE "createdAt" > ${since} AND "deleted" = false
        ) c
      `.then((r) => Number(r[0]?.n ?? 0)),
      prisma.thread.count({ where: { deleted: false, createdAt: { gt: since } } }),
      prisma.post.count({ where: { deleted: false, createdAt: { gt: since } } }),
      prisma.diaryUpdate.count({ where: { createdAt: { gt: since } } }),
      prisma.chatMessage.count({ where: { deleted: false, createdAt: { gt: since } } }),
      prisma.user.count({ where: { createdAt: { gt: since } } }),
      // Members seen this week whose account is at least a day old —
      // "came back", not "was created".
      prisma.user.count({
        where: { lastSeenAt: { gt: since }, createdAt: { lt: new Date(Date.now() - DAY) }, banned: false },
      }),
      prisma.report.count({ where: { status: { in: ["PENDING", "REVIEWING", "ESCALATED"] } } }),
    ])
  return { uniqueContributors7d: contributorRows, newThreads7d, newReplies7d, diaryUpdates7d, chatMessages7d, newMembers7d, returningMembers7d, openReports }
}

export interface UnansweredThread {
  id: string
  title: string
  slug: string
  category: string
  author: string
  ageHours: number
  isQuestionCategory: boolean
}

// Unanswered = visible thread with zero replies. Oldest first — these are
// the conversations the community (and the operator) is not reaching.
async function unanswered(): Promise<UnansweredThread[]> {
  const rows = await prisma.thread.findMany({
    where: { deleted: false, replyCount: 0 },
    orderBy: { createdAt: "asc" },
    take: 25,
    select: {
      id: true, title: true, slug: true, createdAt: true,
      category: { select: { name: true, slug: true } },
      author: { select: { name: true, profile: { select: { username: true } } } },
    },
  })
  const now = Date.now()
  return rows.map((t) => ({
    id: t.id,
    title: t.title,
    slug: t.slug,
    category: t.category.name,
    author: t.author.profile?.username || t.author.name || "member",
    ageHours: Math.floor((now - t.createdAt.getTime()) / 3_600_000),
    isQuestionCategory: /question|help|problem|doctor/i.test(t.category.slug + " " + t.category.name),
  }))
}

export interface TrustSafety {
  reportsByStatus: Record<string, number>
  pendingFlags: number
  moderationActions7d: number
  bannedUsers: number
  suspendedNow: number
}

async function trustSafety(): Promise<TrustSafety> {
  const since = new Date(Date.now() - 7 * DAY)
  const [reportGroups, pendingFlags, moderationActions7d, bannedUsers, suspendedNow] = await Promise.all([
    prisma.report.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.abuseFlag.count({ where: { status: { in: ["PENDING", "REVIEWING", "ESCALATED"] } } }),
    prisma.moderationAction.count({ where: { createdAt: { gt: since } } }),
    prisma.user.count({ where: { banned: true } }),
    prisma.user.count({ where: { suspendedUntil: { gt: new Date() } } }),
  ])
  return {
    reportsByStatus: Object.fromEntries(reportGroups.map((g) => [g.status, g._count._all])),
    pendingFlags,
    moderationActions7d,
    bannedUsers,
    suspendedNow,
  }
}

export interface SecuritySummary {
  eventsByType7d: { type: string; count: number }[]
  rateLimitHits7d: { endpoint: string; count: number }[]
  rateLimitTotal7d: number
}

// SecurityEvent metadata is a JSON string — endpoint can't be grouped in
// SQL, so fetch the bounded window (cap 2000) and aggregate in JS. ipHash
// is never selected: aggregated route names only.
async function securitySummary(): Promise<SecuritySummary> {
  const since = new Date(Date.now() - 7 * DAY)
  const [byType, rlEvents] = await Promise.all([
    prisma.securityEvent.groupBy({
      by: ["type"],
      where: { createdAt: { gt: since } },
      _count: { _all: true },
    }),
    prisma.securityEvent.findMany({
      where: { type: "RATE_LIMIT_EXCEEDED", createdAt: { gt: since } },
      select: { metadata: true },
      take: 2000,
      orderBy: { createdAt: "desc" },
    }),
  ])
  const rlMap = new Map<string, number>()
  for (const e of rlEvents) {
    let endpoint = "unknown"
    try {
      const meta = e.metadata ? JSON.parse(e.metadata) : null
      if (meta && typeof meta.endpoint === "string") endpoint = meta.endpoint.slice(0, 80)
    } catch { /* malformed metadata — count under "unknown" */ }
    rlMap.set(endpoint, (rlMap.get(endpoint) ?? 0) + 1)
  }
  return {
    eventsByType7d: byType.map((g) => ({ type: g.type, count: g._count._all })).sort((a, b) => b.count - a.count),
    rateLimitHits7d: [...rlMap.entries()].map(([endpoint, count]) => ({ endpoint, count })).sort((a, b) => b.count - a.count),
    rateLimitTotal7d: rlEvents.length,
  }
}

export interface FeedbackSummary {
  byStatus: Record<string, number>
  newByType: { type: string; count: number }[]
  recentTitles: { id: string; type: string; title: string; createdAt: Date }[]
}

async function feedbackSummary(): Promise<FeedbackSummary> {
  const [byStatus, newByType, recentTitles] = await Promise.all([
    prisma.feedback.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.feedback.groupBy({ by: ["type"], where: { status: "NEW" }, _count: { _all: true } }),
    prisma.feedback.findMany({
      where: { status: { in: ["NEW", "REVIEWING"] } },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, type: true, title: true, createdAt: true },
    }),
  ])
  return {
    byStatus: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])),
    newByType: newByType.map((g) => ({ type: g.type, count: g._count._all })),
    recentTitles,
  }
}

export interface CronHealth {
  date: string
  tasksDone: number
  tasksPending: string[]
  lastRunDate: string | null
}

// Same source of truth as /api/admin/stats: runCronTask claims land as
// Setting rows keyed "<task>:<UTC-date>", value "1" when finished.
async function cronHealth(): Promise<CronHealth> {
  const now = Date.now()
  const dayKeys = [0, 1].map((d) => new Date(now - d * DAY).toISOString().slice(0, 10))
  const rows = await prisma.setting.findMany({
    where: { OR: dayKeys.map((d) => ({ key: { endsWith: `:${d}` } })) },
    select: { key: true, value: true },
  })
  const today = rows.filter((r) => r.key.endsWith(`:${dayKeys[0]}`))
  return {
    date: dayKeys[0],
    tasksDone: today.filter((r) => r.value === "1").length,
    tasksPending: today.filter((r) => r.value !== "1").map((r) => r.key.split(":")[0]),
    lastRunDate: rows.length ? rows.map((r) => r.key.split(":").pop()!).sort().pop()! : null,
  }
}

export interface OpsData {
  funnel7d: FunnelWindow
  funnel30d: FunnelWindow
  health: CommunityHealth
  unanswered: UnansweredThread[]
  trust: TrustSafety
  security: SecuritySummary
  feedback: FeedbackSummary
  cron: CronHealth
  generatedAt: Date
}

export async function getOpsData(): Promise<OpsData> {
  const [funnel7d, funnel30d, health, unansweredList, trust, security, feedback, cron] = await Promise.all([
    funnel(7),
    funnel(30),
    communityHealth(),
    unanswered(),
    trustSafety(),
    securitySummary(),
    feedbackSummary(),
    cronHealth(),
  ])
  return { funnel7d, funnel30d, health, unanswered: unansweredList, trust, security, feedback, cron, generatedAt: new Date() }
}
