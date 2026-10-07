import { prisma } from "@/lib/prisma"
import { unstable_cache } from "next/cache"
import { publicUserSelect, activeAuthor } from "@/lib/security"
import { getSiteStats } from "@/lib/community-stats"
import { getSession } from "@/lib/session"
import { Leaf, MessageSquare, TrendingUp, Calendar, UserPlus, Sprout, Award } from "@/lib/icons"
import { LiveRefresh } from "@/components/live-refresh"
import Link from "next/link"
import RoleBadge from "@/components/role-badge"
import ProfileCard from "@/components/ui/profile-card"
import PageHeader from "@/components/ui/page-header"
import FeedList from "@/components/feed-list"
import type { FeedAppearance } from "@/components/feed-list"
import { FEED_KINDS, feedDiaryWhere, getFeedPage, resolveFeedScope } from "@/lib/feed"
import type { FeedKind, FeedMode } from "@/lib/feed"
import { diaryPath } from "@/lib/slugs"

export const dynamic = "force-dynamic"

// Feed-specific global aggregates — distinct predicates from home-stats,
// cached under the same invalidation tags as other forum surfaces.
const getFeedStats = unstable_cache(
  async () => {
    const [threadCount, popularCategories] = await Promise.all([
      prisma.thread.count({ where: { deleted: false, category: { hidden: false }, author: activeAuthor() } }),
      prisma.category.findMany({
        where: { hidden: false },
        take: 4,
        orderBy: { threads: { _count: "desc" } },
        select: { slug: true, name: true },
      }),
    ])
    return { threadCount, popularCategories }
  },
  ["feed-stats"],
  { revalidate: 60, tags: ["forum"] }
)

export const metadata = {
  title: "Community Feed",
  description: "Latest grow diary updates, discussions and new diaries from the TerpTalk community.",
  // Member-personalized surface (Following / For You) — not a search destination.
  robots: { index: false, follow: false },
}

const TABS = ["latest", "following", "for-you", "discussions", "grows", "harvests"] as const
type FeedTab = (typeof TABS)[number]

// Each tab is a (mode, kinds, appearance) selection over the canonical
// feed — one stream implementation, filtered per surface.
const TAB_FEED: Record<FeedTab, { mode: FeedMode; kinds: readonly FeedKind[]; appearance: FeedAppearance }> = {
  latest: { mode: "latest", kinds: FEED_KINDS, appearance: "mixed" },
  following: { mode: "following", kinds: FEED_KINDS, appearance: "mixed" },
  "for-you": { mode: "for-you", kinds: FEED_KINDS, appearance: "mixed" },
  discussions: { mode: "latest", kinds: ["thread"], appearance: "threads" },
  grows: { mode: "latest", kinds: ["update"], appearance: "updates" },
  harvests: { mode: "latest", kinds: ["harvest"], appearance: "harvests" },
}

// First-reply nudge eligibility: zero posts and an account under 30 days old.
async function isEligibleForFirstReplyNudge(userId: string) {
  const [posts, recent] = await Promise.all([
    prisma.post.count({ where: { authorId: userId, deleted: false } }),
    prisma.user.count({
      where: { id: userId, createdAt: { gt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
    }),
  ])
  return posts === 0 && recent > 0
}

export default async function FeedPage({ searchParams }: { searchParams: Promise<{ tab?: string; cursor?: string }> }) {
  const { tab, cursor } = await searchParams
  const session = await getSession()
  const activeTab: FeedTab = TABS.includes((tab || "") as FeedTab) ? (tab as FeedTab) : "latest"
  const conf = TAB_FEED[activeTab]

  const scope = await resolveFeedScope(session?.user?.id, conf.mode)
  const coldStart = scope.coldStart

  const wantNudge =
    session?.user?.id != null && session.user.onboardingCompletedAt != null && !coldStart

  const harvestScope = { ...feedDiaryWhere(scope), harvested: true, harvestedAt: { not: null } }
  const [page, hasHarvests, trendingDiaries, siteStats, feedStats, showFirstReplyNudge] = await Promise.all([
    getFeedPage({ scope, kinds: conf.kinds, cursor }),
    prisma.growDiary.findFirst({ where: harvestScope, select: { id: true } }).then((r) => !!r),
    prisma.growDiary.findMany({
      where: feedDiaryWhere(scope),
      take: 5,
      orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
      include: {
        author: { select: publicUserSelect },
        _count: { select: { updates: true, followers: true } },
      },
    }),
    getSiteStats(),
    getFeedStats(),
    wantNudge ? isEligibleForFirstReplyNudge(session!.user!.id) : Promise.resolve(false),
  ])

  const { items, nextCursor } = page
  const memberCount = siteStats.members
  const diaryCount = siteStats.diaries
  const { threadCount, popularCategories } = feedStats

  // Unread indicators on feed thread cards — same followed-thread rule as
  // the forum lists, kept out of any cached payload.
  const unreadThreadIds: string[] = []
  if (session?.user?.id) {
    const threadIds = items.filter((i) => i.kind === "thread").map((i) => i.id)
    if (threadIds.length > 0) {
      const follows = await prisma.threadFollow.findMany({
        where: { userId: session.user.id, threadId: { in: threadIds } },
        select: { threadId: true, lastSeenAt: true, thread: { select: { lastActivityAt: true } } },
      })
      for (const f of follows) {
        if (f.thread.lastActivityAt > (f.lastSeenAt ?? new Date(0))) unreadThreadIds.push(f.threadId)
      }
    }
  }

  const feedEmpty = items.length === 0

  const tabCls = (t: string) =>
    `px-4 py-2 text-sm font-medium transition-colors ${activeTab === t ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground"}`

  const streamTitle =
    conf.appearance === "mixed"
      ? activeTab === "for-you" ? "Top Picks for You" : activeTab === "following" ? "From Your Follows" : "Community Feed"
      : conf.appearance === "threads" ? "Discussions"
      : conf.appearance === "updates" ? "Grow Updates"
      : "Recent Harvests"
  const StreamIcon =
    conf.appearance === "mixed" ? TrendingUp
      : conf.appearance === "threads" ? MessageSquare
      : conf.appearance === "updates" ? Sprout
      : Award

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <LiveRefresh endpoint="/api/forum/updates" />
        <LiveRefresh endpoint="/api/diaries/updates" />
        {/* Header */}
        <PageHeader
          context={<span className="tt-eyebrow">What&apos;s new</span>}
          title="Your Feed"
          description="Stay updated with the latest activity from across the community"
        />

        {/* Onboarding resume banner */}
        {session?.user?.id && !session.user.onboardingCompletedAt && (
          <div className="mb-6 bg-primary/10 border border-primary/30 rounded-lg p-4 flex flex-wrap items-center gap-3">
            <Leaf className="w-5 h-5 text-primary shrink-0" />
            <p className="text-sm flex-1 min-w-50">
              Finish setting up your account — pick your interests and growers to follow.
            </p>
            <Link
              href="/welcome"
              className="min-h-11 inline-flex items-center px-4 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90"
            >
              Finish setup
            </Link>
          </div>
        )}

        {/* Feed Tabs */}
        <div className="flex gap-2 mb-6 border-b border-border overflow-x-auto scrollbar-none">
          <Link href="/feed" className={tabCls("latest")}>Latest</Link>
          <Link href="/feed?tab=following" className={tabCls("following")}>Following</Link>
          <Link href="/feed?tab=for-you" className={tabCls("for-you")}>For You</Link>
          <Link href="/feed?tab=discussions" className={tabCls("discussions")}>Discussions</Link>
          <Link href="/feed?tab=grows" className={tabCls("grows")}>Grows</Link>
          {hasHarvests && (
            <Link href="/feed?tab=harvests" className={tabCls("harvests")}>Harvests</Link>
          )}
        </div>

        {/* Cold-start note — content below is global, not personalized */}
        {coldStart && items.length > 0 && (
          <div className="mb-6 text-sm text-muted-foreground flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-primary shrink-0" />
            <span>
              Your feed is getting started — showing community highlights.{" "}
              <Link href="/forum" className="text-primary hover:underline">Follow growers and topics</Link>{" "}
              to personalize it.
            </span>
          </div>
        )}

        {/* First-action nudge — shown only to members who have never replied.
            Disappears permanently after their first post. */}
        {showFirstReplyNudge && (
          <div className="mb-6 bg-card/80 border border-border/70 rounded-2xl p-4 flex flex-wrap items-center gap-3">
            <MessageSquare className="w-5 h-5 text-primary shrink-0" />
            <p className="text-sm flex-1 min-w-50">
              See something interesting? Join the conversation — your first reply helps other growers.
            </p>
            <Link
              href="/forum"
              className="min-h-11 inline-flex items-center px-4 rounded-lg bg-secondary text-sm font-semibold hover:bg-secondary/80"
            >
              Browse discussions
            </Link>
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Main Feed */}
          <div className="min-w-0 lg:col-span-2 space-y-6">
            {!feedEmpty && (
              <div className="tt-spotlight bg-card/80 rounded-2xl border border-border/70">
                <div className="p-4 border-b border-border flex items-center gap-2">
                  <StreamIcon className={`w-5 h-5 ${conf.appearance === "harvests" ? "text-success" : "text-primary"}`} />
                  <h2 className="font-display font-semibold">{streamTitle}</h2>
                </div>
                <FeedList
                  mode={conf.mode}
                  kinds={conf.kinds}
                  initialItems={items}
                  initialCursor={nextCursor}
                  initialUnreadThreadIds={unreadThreadIds}
                  appearance={conf.appearance}
                  viewerId={session?.user?.id}
                />
              </div>
            )}

            {/* Empty State — mode-aware */}
            {feedEmpty && (
              <div className="tt-spotlight bg-card/80 rounded-2xl border border-border/70 p-12 text-center">
                {!session?.user?.id && (activeTab === "following" || activeTab === "for-you") ? (
                  <>
                    <UserPlus className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                    <h3 className="font-display text-lg font-semibold mb-2">Sign in to build your feed</h3>
                    <p className="text-muted-foreground mb-4">
                      Follow growers, diaries and topics — their activity shows up here.
                    </p>
                    <Link href="/auth/signin" className="tt-cta text-primary-foreground px-6 py-2 rounded-full font-semibold transition-all inline-block">
                      Sign in
                    </Link>
                  </>
                ) : activeTab === "following" || activeTab === "for-you" ? (
                  <>
                    <UserPlus className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                    <h3 className="font-display text-lg font-semibold mb-2">Nothing from your follows yet</h3>
                    <p className="text-muted-foreground mb-4">
                      Follow growers on their profiles or follow diaries you like — their activity shows up here.
                    </p>
                    <Link href="/diaries" className="bg-primary text-primary-foreground px-6 py-2 rounded-full hover:bg-primary/90 transition-colors inline-block">
                      Browse Diaries
                    </Link>
                  </>
                ) : activeTab === "discussions" ? (
                  <>
                    <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="font-display text-lg font-semibold mb-2">No discussions yet</h3>
                    <p className="text-muted-foreground mb-4">Be the first grower to start a conversation.</p>
                    <Link href="/forum/new" className="bg-primary text-primary-foreground px-6 py-2 rounded-full hover:bg-primary/90 transition-colors inline-block">
                      Start Discussion
                    </Link>
                  </>
                ) : activeTab === "grows" ? (
                  <>
                    <Sprout className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="font-display text-lg font-semibold mb-2">No grow updates yet</h3>
                    <p className="text-muted-foreground mb-4">Be the first to share your grow journey.</p>
                    <Link href="/diaries/new" className="bg-primary text-primary-foreground px-6 py-2 rounded-full hover:bg-primary/90 transition-colors inline-block">
                      Start a Diary
                    </Link>
                  </>
                ) : activeTab === "harvests" ? (
                  <>
                    <Award className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="font-display text-lg font-semibold mb-2">No harvests yet</h3>
                    <p className="text-muted-foreground mb-4">Completed grows and their results will appear here.</p>
                    <Link href="/diaries" className="bg-primary text-primary-foreground px-6 py-2 rounded-full hover:bg-primary/90 transition-colors inline-block">
                      Browse Diaries
                    </Link>
                  </>
                ) : (
                <>
                <Calendar className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                <h3 className="font-display text-lg font-semibold mb-2">No recent activity</h3>
                <p className="text-muted-foreground mb-4">
                  Be the first to share your grow journey or start a discussion!
                </p>
                <div className="flex gap-4 justify-center">
                  <Link
                    href="/diaries/new"
                    className="bg-primary text-primary-foreground px-6 py-2 rounded-full hover:bg-primary/90 transition-colors"
                  >
                    Start Diary
                  </Link>
                  <Link
                    href="/forum/new"
                    className="border border-border px-6 py-2 rounded-lg hover:bg-secondary transition-colors"
                  >
                    Start Discussion
                  </Link>
                </div>
                </>
                )}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="min-w-0 space-y-6">
            {/* Trending Diaries */}
            <div className="tt-spotlight bg-card/80 rounded-2xl border border-border/70">
              <div className="p-4 border-b border-border flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-primary" />
                <h2 className="font-display font-semibold">Trending Diaries</h2>
              </div>
              <div className="divide-y divide-border">
                {trendingDiaries.map((diary) => (
                  <Link
                    key={diary.id}
                    href={diaryPath(diary)}
                    className="block p-4 hover:bg-secondary/50 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="shrink-0 w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                        <Leaf className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-sm mb-1 wrap-break-word">{diary.title}</h3>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <ProfileCard
                              username={diary.author.profile?.username}
                              name={diary.author.profile?.username || diary.author.name}
                              avatarUrl={diary.author.image}
                              xp={diary.author.profile?.xp}
                              publicMilestoneOptOut={diary.author.profile?.publicMilestoneOptOut}
                              size="sm"
                              linked={false}
                            />
                            <RoleBadge role={diary.author.role} />
                          </span>
                          <span>•</span>
                          <span>{diary._count.updates} updates</span>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {/* Quick Stats */}
            <div className="tt-spotlight bg-card/80 rounded-2xl border border-border/70 p-6">
              <h3 className="font-display font-semibold mb-4">Community Stats</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Members</span>
                  <span className="font-semibold">{memberCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Active Diaries</span>
                  <span className="font-semibold">{diaryCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Forum Threads</span>
                  <span className="font-semibold">{threadCount}</span>
                </div>
              </div>
            </div>

            {/* Popular Categories */}
            <div className="tt-spotlight bg-card/80 rounded-2xl border border-border/70 p-6">
              <h3 className="font-display font-semibold mb-4">Popular Categories</h3>
              <div className="space-y-2">
                {popularCategories.map((c) => (
                  <Link key={c.slug} href={`/forum/category/${c.slug}`} className="block text-sm text-muted-foreground hover:text-foreground">
                    {c.name}
                  </Link>
                ))}
                <Link href="/leaderboard" className="block text-sm text-primary hover:underline mt-2">
                  🏆 Top growers leaderboard →
                </Link>
                <Link href="/forum" className="block text-sm text-primary hover:underline mt-2">
                  View all categories →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
