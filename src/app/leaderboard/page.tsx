import { prisma } from "@/lib/prisma"
import { rankableProfile, REPUTATION_ORDER } from "@/lib/security"
import { unstable_cache } from "next/cache"
import { Trophy, Medal, Award, Sprout, Leaf, CheckCircle2 } from "lucide-react"
import Link from "next/link"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import RoleBadge from "@/components/role-badge"
import EmptyState from "@/components/ui/empty-state"
import { getReputationTier } from "@/lib/reputation"
import { Avatar } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

export const revalidate = 300 // public content, edge-cached

export const metadata = {
  title: "Leaderboard",
  description: "Top contributors in the TerpTalk cannabis growing community.",
}

type Tab = "rep" | "helpful" | "diaries" | "badges"

const TABS: { key: Tab; label: string; icon: typeof Trophy; blurb: string; metricLabel: string }[] = [
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
  const tab: Tab = (["rep", "helpful", "diaries", "badges"] as Tab[]).includes(rawTab as Tab)
    ? (rawTab as Tab)
    : "rep"

  const session = await getServerSession(authOptions)
  const viewerId = session?.user?.id

  const [rows, viewerProfile] = await Promise.all([
    tab === "helpful"
      ? getTopByHelpful()
      : tab === "diaries"
        ? getTopByDiaries()
        : tab === "badges"
          ? getTopByBadges()
          : getTopByRep(),
    viewerId
      ? prisma.profile.findUnique({ where: { userId: viewerId }, select: PROFILE_SELECT })
      : Promise.resolve(null),
  ])

  // Viewer's own metric for the active tab — one count per non-rep tab,
  // only computed when the member isn't already on the board.
  const viewerOnBoard = viewerProfile ? rows.some((r) => r.profile.user.id === viewerProfile.user.id) : false
  let viewerMetric = viewerProfile?.reputation ?? 0
  let viewerRank: number | null = null
  if (viewerProfile && !viewerOnBoard) {
    if (tab === "rep") {
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
        <div className="flex gap-2 mb-2 overflow-x-auto pb-1" role="tablist" aria-label="Leaderboard categories">
          {TABS.map((t) => (
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
          ))}
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
                  <div className="font-semibold truncate flex items-center">
                    {p.username || p.user.name}
                    <RoleBadge role={p.user.role} />
                    <span className={`ml-2 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full ${getReputationTier(p.reputation).bg} ${getReputationTier(p.reputation).color}`}>
                      {getReputationTier(p.reputation).icon} {getReputationTier(p.reputation).name}
                    </span>
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
                  <div className="font-semibold truncate flex items-center">
                    {viewerProfile.username || viewerProfile.user.name}
                    <span className="ml-2 text-[10px] uppercase tracking-wider text-primary font-medium">You</span>
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
