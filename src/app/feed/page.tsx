import { prisma } from "@/lib/prisma"
import { publicUserSelect } from "@/lib/security"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { Leaf, MessageSquare, TrendingUp, Calendar, Users, UserPlus } from "lucide-react"
import Link from "next/link"
import RoleBadge from "@/components/role-badge"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Community Feed",
  description: "Latest grow diary updates, discussions and new diaries from the TerpTalk community.",
}

async function getFeedData(userId?: string, tab = "latest") {
  // Resolve follow sets when the Following / For You tabs are active
  const personal = tab === "following" || tab === "for-you"
  let followingIds: string[] = []
  let followedDiaryIds: string[] = []
  let followedCategoryIds: string[] = []
  if (userId && personal) {
    const [follows, diaryFollows, categoryFollows] = await Promise.all([
      prisma.follow.findMany({ where: { followerId: userId }, select: { followingId: true } }),
      prisma.diaryFollow.findMany({ where: { userId }, select: { diaryId: true } }),
      tab === "for-you"
        ? prisma.categoryFollow.findMany({ where: { userId }, select: { categoryId: true } })
        : Promise.resolve([] as { categoryId: string }[]),
    ])
    followingIds = follows.map((f) => f.followingId)
    followedDiaryIds = diaryFollows.map((f) => f.diaryId)
    followedCategoryIds = categoryFollows.map((f) => f.categoryId)
  }

  const updateWhere = personal
    ? { diary: { deleted: false }, OR: [{ authorId: { in: followingIds } }, { diaryId: { in: followedDiaryIds } }] }
    : { diary: { deleted: false } }
  const threadWhere = tab === "following"
    ? { deleted: false, authorId: { in: followingIds } }
    : tab === "for-you"
    ? { deleted: false, OR: [{ authorId: { in: followingIds } }, { categoryId: { in: followedCategoryIds } }] }
    : { deleted: false }
  const diaryWhere = personal
    ? { deleted: false, OR: [{ authorId: { in: followingIds } }, { followers: { some: { userId } } }] }
    : { deleted: false }

  // Get recent activity from various sources
  const recentDiaryUpdates = await prisma.diaryUpdate.findMany({
    where: updateWhere,
    take: 10,
    orderBy: { createdAt: "desc" },
    include: {
      diary: {
        include: {
          author: { select: publicUserSelect },
        },
      },
      author: { select: publicUserSelect },
      images: { take: 1 },
    },
  })

  const recentThreads = await prisma.thread.findMany({
    where: threadWhere,
    take: 10,
    orderBy: { createdAt: "desc" },
    include: {
      author: { select: publicUserSelect },
      category: true,
      _count: {
        select: { posts: { where: { deleted: false } } },
      },
    },
  })

  const trendingDiaries = await prisma.growDiary.findMany({
    where: diaryWhere,
    take: 5,
    orderBy: [
      { featured: "desc" },
      { createdAt: "desc" },
    ],
    include: {
      author: { select: publicUserSelect },
      _count: {
        select: { updates: true, followers: true },
      },
    },
  })

  const [memberCount, threadCount, diaryCount, popularCategories] = await Promise.all([
    prisma.user.count({ where: { banned: false } }),
    prisma.thread.count({ where: { deleted: false } }),
    prisma.growDiary.count({ where: { deleted: false } }),
    prisma.category.findMany({
      where: { hidden: false },
      take: 4,
      orderBy: { threads: { _count: "desc" } },
      select: { slug: true, name: true },
    }),
  ])

  return {
    recentDiaryUpdates,
    recentThreads,
    trendingDiaries,
    memberCount,
    threadCount,
    diaryCount,
    popularCategories,
  }
}

const TABS = ["latest", "following", "for-you"] as const

export default async function FeedPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams
  const session = await getServerSession(authOptions)
  const activeTab = TABS.includes((tab || "") as (typeof TABS)[number]) ? (tab as (typeof TABS)[number]) : "latest"
  const { recentDiaryUpdates, recentThreads, trendingDiaries, memberCount, threadCount, diaryCount, popularCategories } =
    await getFeedData(session?.user?.id, activeTab)

  const tabCls = (t: string) =>
    `px-4 py-2 text-sm font-medium transition-colors ${activeTab === t ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground"}`

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">TerpTalk Feed</h1>
          <p className="text-muted-foreground">Stay updated with the latest activity from across the community</p>
        </div>

        {/* Feed Tabs */}
        <div className="flex gap-4 mb-6 border-b border-border">
          <Link href="/feed" className={tabCls("latest")}>Latest</Link>
          <Link href="/feed?tab=following" className={tabCls("following")}>Following</Link>
          <Link href="/feed?tab=for-you" className={tabCls("for-you")}>For You</Link>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Main Feed */}
          <div className="lg:col-span-2 space-y-6">
            {/* Recent Diary Updates */}
            {recentDiaryUpdates.length > 0 && (
              <div className="bg-card rounded-lg border border-border">
                <div className="p-4 border-b border-border flex items-center gap-2">
                  <Leaf className="w-5 h-5 text-primary" />
                  <h2 className="font-semibold">Recent Grow Updates</h2>
                </div>
                <div className="divide-y divide-border">
                  {recentDiaryUpdates.map((update) => (
                    <Link
                      key={update.id}
                      href={`/diaries/${update.diary.id}`}
                      className="block p-4 hover:bg-secondary/50 transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                          <Users className="w-5 h-5 text-primary" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-sm">
                              {update.author.profile?.username || update.author.name}
                              <RoleBadge role={update.author.role} />
                            </span>
                            <span className="text-xs text-muted-foreground">
                              updated their diary
                            </span>
                          </div>
                          <h3 className="font-medium mb-1">{update.title}</h3>
                          <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                            {update.content}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Leaf className="w-3 h-3" />
                              {update.diary.title}
                            </span>
                            <span>•</span>
                            <span>{new Date(update.createdAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Recent Forum Threads */}
            {recentThreads.length > 0 && (
              <div className="bg-card rounded-lg border border-border">
                <div className="p-4 border-b border-border flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-primary" />
                  <h2 className="font-semibold">New Discussions</h2>
                </div>
                <div className="divide-y divide-border">
                  {recentThreads.map((thread) => (
                    <Link
                      key={thread.id}
                      href={`/forum/thread/${thread.slug}`}
                      className="block p-4 hover:bg-secondary/50 transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                          <Users className="w-5 h-5 text-primary" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-sm">
                              {thread.author.profile?.username || thread.author.name}
                              <RoleBadge role={thread.author.role} />
                            </span>
                            <span className="text-xs text-muted-foreground">
                              started a discussion
                            </span>
                          </div>
                          <h3 className="font-medium mb-1">{thread.title}</h3>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <MessageSquare className="w-3 h-3" />
                              {thread.category.name}
                            </span>
                            <span>•</span>
                            <span>{thread.replyCount} repl{thread.replyCount === 1 ? "y" : "ies"}</span>
                            <span>•</span>
                            <span>{new Date(thread.createdAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Empty State */}
            {recentDiaryUpdates.length === 0 && recentThreads.length === 0 && (
              <div className="bg-card rounded-lg border border-border p-12 text-center">
                {activeTab === "following" || activeTab === "for-you" ? (
                  <>
                    <UserPlus className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-semibold mb-2">Nothing from your follows yet</h3>
                    <p className="text-muted-foreground mb-4">
                      Follow growers on their profiles or follow diaries you like — their activity shows up here.
                    </p>
                    <Link href="/diaries" className="bg-primary text-primary-foreground px-6 py-2 rounded-lg hover:bg-primary/90 transition-colors inline-block">
                      Browse Diaries
                    </Link>
                  </>
                ) : (
                <>
                <Calendar className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No recent activity</h3>
                <p className="text-muted-foreground mb-4">
                  Be the first to share your grow journey or start a discussion!
                </p>
                <div className="flex gap-4 justify-center">
                  <Link
                    href="/diaries/new"
                    className="bg-primary text-primary-foreground px-6 py-2 rounded-lg hover:bg-primary/90 transition-colors"
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
          <div className="space-y-6">
            {/* Trending Diaries */}
            <div className="bg-card rounded-lg border border-border">
              <div className="p-4 border-b border-border flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-primary" />
                <h2 className="font-semibold">Trending Diaries</h2>
              </div>
              <div className="divide-y divide-border">
                {trendingDiaries.map((diary) => (
                  <Link
                    key={diary.id}
                    href={`/diaries/${diary.id}`}
                    className="block p-4 hover:bg-secondary/50 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                        <Leaf className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-medium text-sm mb-1">{diary.title}</h3>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            {diary.author.profile?.username || diary.author.name}
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
            <div className="bg-card rounded-lg border border-border p-6">
              <h3 className="font-semibold mb-4">Community Stats</h3>
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
            <div className="bg-card rounded-lg border border-border p-6">
              <h3 className="font-semibold mb-4">Popular Categories</h3>
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