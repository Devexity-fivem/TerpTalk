import { prisma } from "@/lib/prisma"
import { rankableProfile, REPUTATION_ORDER } from "@/lib/security"
import { unstable_cache } from "next/cache"
import { Trophy, Medal, Award, Sprout, Leaf, CheckCircle2 } from "lucide-react"
import Link from "next/link"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import RoleBadge from "@/components/role-badge"
import TierChip from "@/components/tier-chip"
import EmptyState from "@/components/ui/empty-state"
import { weeklyBoard, weeklyNewGrowers, weekRange, WEEKLY_BOARD_TYPES } from "@/lib/weekly-recognition"
import { currentWeekKey } from "@/lib/week"
import { Avatar } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import Tooltip from "@/components/ui/tooltip"

export const revalidate = 300 // public content, edge-cached

export const metadata = {
  title: "Leaderboard",
  description: "Top contributors in the TerpTalk cannabis growing community.",
}

type Tab = "rep" | "week" | "helpful" | "diaries" | "badges"

const TABS: { key: Tab; label: string; icon: typeof Trophy; blurb: string; metricLabel: string; tip?: string }[] = [
  {
    key: "week",
    label: "This Week",
    icon: Sprout,
    blurb: "Reputation earned this week — resets Monday. Anyone can win it.",
    metricLabel: "rep this week",
    tip: "Rep earned this week — resets Monday",
  },
  {
    key: "rep",
    label: "Reputation",
    icon: Trophy,
    blurb: "All-time reputation — the full ledger of meaningful contributions.",
    metricLabel: "rep",
  },
  {
    key: "helpful",
    label: "Helpful",
    icon: CheckCircle2,
    blurb: "Accepted answers — members whose replies solved a real problem.",
    metricLabel: "solutions",
    tip: "Ranked by accepted answers",
  },
  {
    key: "diaries",
    label: "Grow Diaries",
    icon: Leaf,
    blurb: "Documented grows — the members keeping the best journals.",
    metricLabel: "diaries",
  },
  {
    key: "badges",
    label: "Badges",
    icon: Medal,
    blurb: "Achievement count — the most decorated members.",
    metricLabel: "badges",
  },
]

const PROFILE_SELECT = {
  username: true,
  avatarUrl: true,
  reputation: true,
  publicMilestoneOptOut: true,
  user: {
    select: {
      id: true,
      name: true,
      role: true,
      createdAt: true,
      _count: {
        // "following" counts this user's followers (schema relation
        // names are inverted — see api/users/[username]).
        select: { threadCreator: true, posts: true, diaryCreator: true, following: true },
      },
    },
  },
} as const

type LeaderboardProfile = {
  username: string
  avatarUrl: string | null
  reputation: number
  publicMilestoneOptOut: boolean
  user: {
    id: string
    name: string | null
    role: string
    createdAt: Date
    _count: { threadCreator: number; posts: number; diaryCreator: number; following: number }
  }
}

interface BoardRow {
  profile: LeaderboardProfile
  metric: number
}

// The rep tab orders straight off Profile.reputation; the others groupBy
// the source table (Prisma can't order by a filtered relation count), then
// join profiles through the same rankable/visibility filter.
const getTopByRep = unstable_cache(
  async (): Promise<BoardRow[]> => {
    const profiles = await prisma.profile.findMany({
      where: rankableProfile(),
      orderBy: REPUTATION_ORDER,
      take: 25,
      select: PROFILE_SELECT,
    })
    return profiles.map((profile) => ({ profile, metric: profile.reputation }))
  },
  ["leaderboard-rep"],
  { revalidate: 300, tags: ["leaderboard"] }
)

async function topByCount(groups: { id: string; n: number }[]): Promise<BoardRow[]> {
  if (groups.length === 0) return []
  const profiles = await prisma.profile.findMany({
    where: { ...rankableProfile(), user: { id: { in: groups.map((g) => g.id) } } },
    select: PROFILE_SELECT,
  })
  const byUser = new Map(profiles.map((p) => [p.user.id, p]))
  const rows: BoardRow[] = []
  for (const g of groups) {
    const profile = byUser.get(g.id)
    if (profile) rows.push({ profile, metric: g.n })
  }
  return rows
}

const getTopByHelpful = unstable_cache(
  async (): Promise<BoardRow[]> => {
    const groups = await prisma.post.groupBy({
      by: ["authorId"],
      // A reply counts as a "solution" while it's the thread's accepted
      // answer — deleted or un-accepted posts drop off automatically.
      where: { deleted: false, acceptedAnswerFor: { isNot: null } },
      _count: true,
      orderBy: { _count: { authorId: "desc" } },
      take: 25,
    })
    return topByCount(groups.map((g) => ({ id: g.authorId, n: g._count })))
  },
  ["leaderboard-helpful"],
  { revalidate: 300, tags: ["leaderboard"] }
)

const getTopByDiaries = unstable_cache(
  async (): Promise<BoardRow[]> => {
    const groups = await prisma.growDiary.groupBy({
      by: ["authorId"],
      where: { deleted: false },
      _count: true,
      orderBy: { _count: { authorId: "desc" } },
      take: 25,
    })
    return topByCount(groups.map((g) => ({ id: g.authorId, n: g._count })))
  },
  ["leaderboard-diaries"],
  { revalidate: 300, tags: ["leaderboard"] }
)

// Weekly boards re-key their cache by ISO week so last week's results stay
// cacheable while this week's move live.
const getWeeklyBoard = unstable_cache(
  async (week: string): Promise<{ rows: BoardRow[]; newRows: BoardRow[] }> => {
    const range = weekRange(week)
    if (!range) return { rows: [], newRows: [] }
    const [board, fresh] = await Promise.all([
      weeklyBoard(range.start, range.end),
      weeklyNewGrowers(range.start, range.end),
    ])
    return {
      rows: board.map((r) => ({ profile: r.profile as LeaderboardProfile, metric: r.earned })),
      newRows: fresh.map((r) => ({ profile: r.profile as LeaderboardProfile, metric: r.earned })),
    }
  },
  ["leaderboard-week"],
  { revalidate: 300, tags: ["leaderboard"] }
)

const getTopByBadges = unstable_cache(
  async (): Promise<BoardRow[]> => {
    const groups = await prisma.userBadge.groupBy({
      by: ["userId"],
      _count: true,
      orderBy: { _count: { userId: "desc" } },
      take: 25,
    })
    return topByCount(groups.map((g) => ({ id: g.userId, n: g._count })))
  },
  ["leaderboard-badges"],
  { revalidate: 300, tags: ["leaderboard"] }
)

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab: rawTab } = await searchParams
  const tab: Tab = (["rep", "week", "helpful", "diaries", "badges"] as Tab[]).includes(rawTab as Tab)
    ? (rawTab as Tab)
    : "rep"

  const session = await getServerSession(authOptions)
  const viewerId = session?.user?.id
  const week = currentWeekKey()

  const [weekly, viewerProfile] = await Promise.all([
    tab === "week" ? getWeeklyBoard(week) : Promise.resolve(null),
    viewerId
      ? prisma.profile.findUnique({ where: { userId: viewerId }, select: PROFILE_SELECT })
      : Promise.resolve(null),
  ])
  const rows: BoardRow[] =
    weekly?.rows ??
    (await (tab === "helpful"
      ? getTopByHelpful()
      : tab === "diaries"
        ? getTopByDiaries()
        : tab === "badges"
          ? getTopByBadges()
          : getTopByRep()))

  // Viewer's own metric for the active tab — one count per non-rep tab,
  // only computed when the member isn't already on the board.
  const viewerOnBoard = viewerProfile ? rows.some((r) => r.profile.user.id === viewerProfile.user.id) : false
  let viewerMetric = viewerProfile?.reputation ?? 0
  let viewerRank: number | null = null
  if (viewerProfile && !viewerOnBoard) {
    if (tab === "week") {
      const range = weekRange(week)
      if (range) {
        const agg = await prisma.reputationEvent.aggregate({
          where: {
            userId: viewerProfile.user.id,
            createdAt: { gte: range.start, lt: range.end },
            type: { in: WEEKLY_BOARD_TYPES },
          },
          _sum: { amount: true },
        })
        viewerMetric = Math.max(0, agg._sum.amount ?? 0)
      }
    } else if (tab === "rep") {
      viewerRank =
        (await prisma.profile.count({
          where: { ...rankableProfile(), reputation: { gt: viewerProfile.reputation } },
        })) + 1
      viewerMetric = viewerProfile.reputation
    } else if (tab === "helpful") {
      viewerMetric = await prisma.post.count({
        where: { authorId: viewerProfile.user.id, deleted: false, acceptedAnswerFor: { isNot: null } },
      })
    } else if (tab === "diaries") {
      viewerMetric = await prisma.growDiary.count({
        where: { authorId: viewerProfile.user.id, deleted: false },
      })
    } else {
      viewerMetric = await prisma.userBadge.count({ where: { userId: viewerProfile.user.id } })
    }
  }

  const medal = (i: number) =>
    i === 0 ? <Trophy className="w-5 h-5 text-amber-400" /> :
    i === 1 ? <Medal className="w-5 h-5 text-gray-300" /> :
    i === 2 ? <Medal className="w-5 h-5 text-amber-700" /> :
    <span className="w-5 text-center text-sm text-muted-foreground">{i + 1}</span>

  const activeTab = TABS.find((t) => t.key === tab)!

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-6 text-center">
          <Award className="w-12 h-12 text-primary mx-auto mb-3" />
          <h1 className="text-3xl font-bold mb-2">Top Growers</h1>
          <p className="text-muted-foreground">
            Earn reputation by posting, journaling, adding strains, and helping the community.
          </p>
        </div>

        {/* Category tabs */}
        {/* sm:overflow-x-visible keeps pill tooltips from clipping; small screens still scroll */}
        <div className="flex gap-2 mb-2 overflow-x-auto sm:overflow-x-visible pb-1" role="tablist" aria-label="Leaderboard categories">
          {TABS.map((t) => {
            const pill = (
              <Link
                key={t.key}
                href={t.key === "rep" ? "/leaderboard" : `/leaderboard?tab=${t.key}`}
                role="tab"
                aria-selected={tab === t.key}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap transition-colors",
                  tab === t.key
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                <t.icon className="w-3.5 h-3.5" aria-hidden="true" />
                {t.label}
              </Link>
            )
            return t.tip ? (
              <Tooltip key={t.key} content={t.tip} side="bottom">
                {pill}
              </Tooltip>
            ) : (
              pill
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground mb-4 px-1">{activeTab.blurb}</p>

        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="divide-y divide-border">
            {rows.length === 0 && (
              <EmptyState
                icon={Trophy}
                title="No members on the board yet"
                description="Reputation is earned by posting, journaling, and helping other growers."
              />
            )}
            {rows.map(({ profile: p, metric }, i) => (
              <Link
                key={p.user.id}
                href={`/u/${p.username || p.user.name}`}
                className={cn(
                  "flex items-center gap-4 p-4 hover:bg-secondary/50 transition-colors",
                  viewerProfile?.user.id === p.user.id && "bg-primary/5"
                )}
              >
                <div className="w-8 flex justify-center shrink-0">{medal(i)}</div>
                <Avatar
                  src={p.avatarUrl}
                  alt=""
                  size="md"
                  className="w-10 h-10 bg-primary/10"
                  fallback={
                    <span className="text-primary font-bold">
                      {(p.username || p.user.name || "?")[0].toUpperCase()}
                    </span>
                  }
                />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold flex items-center gap-1.5">
                    <span className="truncate">{p.username || p.user.name}</span>
                    <RoleBadge role={p.user.role} />
                    <TierChip reputation={p.reputation} publicMilestoneOptOut={p.publicMilestoneOptOut} className="hidden sm:inline-flex" />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {p.user._count.threadCreator} threads · {p.user._count.posts} posts · {p.user._count.diaryCreator} diaries · {p.user._count.following} followers
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-bold text-primary">{metric.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">{activeTab.metricLabel}</div>
                </div>
              </Link>
            ))}
          </div>

          {/* Your rank — pinned below the board when you're not on it */}
          {viewerProfile && !viewerOnBoard && (
            <div className="border-t-2 border-primary/30 bg-primary/5">
              <Link
                href={`/u/${viewerProfile.username || viewerProfile.user.name}`}
                className="flex items-center gap-4 p-4 hover:bg-secondary/50 transition-colors"
              >
                <div className="w-8 flex justify-center shrink-0">
                  <span className="w-5 text-center text-sm font-semibold text-primary">
                    {viewerRank ?? "—"}
                  </span>
                </div>
                <Avatar
                  src={viewerProfile.avatarUrl}
                  alt=""
                  size="md"
                  className="w-10 h-10 bg-primary/10"
                  fallback={
                    <span className="text-primary font-bold">
                      {(viewerProfile.username || viewerProfile.user.name || "?")[0].toUpperCase()}
                    </span>
                  }
                />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold flex items-center gap-1.5">
                    <span className="truncate">{viewerProfile.username || viewerProfile.user.name}</span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wider text-primary font-medium">You</span>
                  </div>
                  <div className="text-xs text-muted-foreground">Your current position</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-bold text-primary">{viewerMetric.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">{activeTab.metricLabel}</div>
                </div>
              </Link>
            </div>
          )}
        </div>

        {/* Best New Growers — same week, accounts under 30 days */}
        {tab === "week" && weekly && weekly.newRows.length > 0 && (
          <div className="mt-6 bg-card rounded-xl border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Sprout className="w-4 h-4 text-primary" /> Best New Growers
              </h2>
              <p className="text-xs text-muted-foreground">Members under 30 days old, ranked by rep earned this week.</p>
            </div>
            <div className="divide-y divide-border">
              {weekly.newRows.map(({ profile: p, metric }, i) => (
                <Link
                  key={p.user.id}
                  href={`/u/${p.username || p.user.name}`}
                  className="flex items-center gap-3 p-3 hover:bg-secondary/50 transition-colors"
                >
                  <span className="w-5 text-center text-xs text-muted-foreground shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium flex items-center gap-1.5">
                      <span className="truncate">{p.username || p.user.name}</span>
                      <TierChip reputation={p.reputation} publicMilestoneOptOut={p.publicMilestoneOptOut} className="hidden sm:inline-flex" />
                    </span>
                  </div>
                  <span className="text-sm font-semibold text-primary shrink-0">{metric.toLocaleString()}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        <p className="text-center text-sm text-muted-foreground mt-6">
          <Link href="/progress" className="text-primary hover:underline inline-flex items-center gap-1">
            <Sprout className="w-3.5 h-3.5" aria-hidden="true" /> Track your own progress
          </Link>
          {" · "}
          <Link href="/about" className="text-primary hover:underline">About</Link>
          {" · "}
          <Link href="/leaderboard/yields" className="text-primary hover:underline">Strain yields</Link>
        </p>
      </div>
    </div>
  )
}
