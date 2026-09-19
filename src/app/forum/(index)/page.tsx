import { prisma } from "@/lib/prisma"
import { publicUserSelect, activeAuthor, blockedUserIds } from "@/lib/security"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { unstable_cache } from "next/cache"
import { MessageSquare, Users, Clock, TrendingUp } from "lucide-react"
import Link from "next/link"
import RoleBadge from "@/components/role-badge"
import TierChip from "@/components/tier-chip"
import { ForumLiveRefresh } from "@/components/forum-live-refresh"
import FollowedThreads from "@/components/followed-threads"
import Tooltip from "@/components/ui/tooltip"

// Dynamic: the client polls for new threads and calls router.refresh(),
// so this page must not serve stale ISR when refreshed.
export const dynamic = "force-dynamic"

export const metadata = {
  title: "Grower Discussions",
  description: "Cannabis growing forum — techniques, equipment, genetics, troubleshooting and more with the TerpTalk community.",
}

const getForumData = unstable_cache(
  async () => {
    const categories = await prisma.category.findMany({
      where: { hidden: false },
      orderBy: { order: "asc" },
      include: {
        threads: {
          where: { deleted: false, author: activeAuthor() },
          take: 1,
          orderBy: { createdAt: "desc" },
        },
        _count: {
          select: { threads: { where: { deleted: false, author: activeAuthor() } } },
        },
      },
    })

    const recentThreads = await prisma.thread.findMany({
      where: { deleted: false, category: { hidden: false }, author: activeAuthor() },
      take: 5,
      orderBy: { createdAt: "desc" },
      include: {
        author: { select: publicUserSelect },
        category: true,
        _count: {
          select: { posts: true },
        },
      },
    })

    const [threadCount, postCount, memberCount, trendingThreads] = await Promise.all([
      prisma.thread.count({ where: { deleted: false, category: { hidden: false }, author: activeAuthor() } }),
      prisma.post.count({ where: { deleted: false, thread: { category: { hidden: false } }, author: activeAuthor() } }),
      prisma.user.count({ where: activeAuthor() }),
      prisma.thread.findMany({
        where: { deleted: false, views: { gt: 0 }, category: { hidden: false }, author: activeAuthor() },
        take: 5,
        orderBy: { views: "desc" },
        select: { slug: true, title: true, views: true, authorId: true },
      }),
    ])

    return { categories, recentThreads, threadCount, postCount, memberCount, trendingThreads }
  },
  ["forum-data"],
  { revalidate: 60, tags: ["forum"] }
)

export default async function ForumPage() {
  const [cached, session] =
    await Promise.all([getForumData(), getServerSession(authOptions)])
  const { threadCount, postCount, memberCount } = cached
  // The cached payload is global — hide content from authors the viewer
  // has blocked (or been blocked by) after the cache read.
  const blockedIds = await blockedUserIds(session?.user?.id)
  const notBlocked = (authorId: string) => !blockedIds.includes(authorId)
  const recentThreads = cached.recentThreads.filter((t) => notBlocked(t.authorId))
  const trendingThreads = cached.trendingThreads.filter((t) => notBlocked(t.authorId))
  const categories = blockedIds.length
    ? cached.categories.map((c) => ({ ...c, threads: c.threads.filter((t) => notBlocked(t.authorId)) }))
    : cached.categories

  // Per-viewer unread state lives outside the cached forum query.
  const unreadThreadIds = new Set<string>()
  if (session?.user?.id && recentThreads.length > 0) {
    const follows = await prisma.threadFollow.findMany({
      where: { userId: session.user.id, threadId: { in: recentThreads.map((t) => t.id) } },
      select: { threadId: true, lastSeenAt: true, thread: { select: { lastActivityAt: true } } },
    })
    for (const f of follows) {
      if (f.thread.lastActivityAt > (f.lastSeenAt ?? new Date(0))) unreadThreadIds.add(f.threadId)
    }
  }

  // "Discussions You Follow" — per-viewer, one indexed query, never cached.
  // Deleted threads and hidden categories are excluded; unread-first sort
  // happens in JS (cross-table column comparison isn't expressible in
  // Prisma). Fetch 20 so unread threads slightly older than the 10th
  // most-recent still surface.
  const followedItems = session?.user?.id
    ? (
        await prisma.threadFollow.findMany({
          where: {
            userId: session.user.id,
            thread: { deleted: false, category: { hidden: false } },
          },
          orderBy: { thread: { lastActivityAt: "desc" } },
          take: 20,
          select: {
            threadId: true,
            lastSeenAt: true,
            thread: {
              select: {
                slug: true,
                title: true,
                lastActivityAt: true,
                authorId: true,
                category: { select: { name: true } },
              },
            },
          },
        })
      )
        .filter((f) => notBlocked(f.thread.authorId))
        .map((f) => ({
          threadId: f.threadId,
          slug: f.thread.slug,
          title: f.thread.title,
          category: f.thread.category.name,
          lastActivityAt: f.thread.lastActivityAt.toISOString(),
          unread: f.thread.lastActivityAt > (f.lastSeenAt ?? new Date(0)),
        }))
        .sort((a, b) => Number(b.unread) - Number(a.unread))
        .slice(0, 10)
    : []

  return (
    <div className="min-h-screen bg-background">
      <ForumLiveRefresh latestThreadId={recentThreads[0]?.id ?? null} />
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-1">Discussions</h1>
          <p className="text-sm text-muted-foreground">Join discussions, share knowledge, and connect with fellow growers</p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Main Forum Categories */}
          <div className="min-w-0 lg:col-span-2 space-y-6">
            {/* Categories */}
            <div className="bg-card rounded-lg border border-border">
              <div className="p-4 border-b border-border">
                <h2 className="text-lg font-semibold">Categories</h2>
              </div>
              <div className="divide-y divide-border">
                {categories.map((category) => (
                  <Link
                    key={category.id}
                    href={`/forum/category/${category.slug}`}
                    className="block p-4 hover:bg-secondary/50 transition-colors"
                  >
                    <div className="flex items-start gap-4">
                      <div className="bg-primary/10 p-3 rounded-lg shrink-0">
                        <MessageSquare className="w-6 h-6 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold mb-1 break-words">{category.name}</h3>
                        <p className="text-sm text-muted-foreground mb-2 break-words">{category.description}</p>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <MessageSquare className="w-4 h-4" />
                            {category._count.threads} threads
                          </span>
                          {category.threads[0] && (
                            <span className="flex items-center gap-1">
                              <Clock className="w-4 h-4" />
                              Latest: {new Date(category.threads[0].createdAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {/* Recent Threads */}
            <div className="bg-card rounded-lg border border-border">
              <div className="p-4 border-b border-border">
                <h2 className="text-lg font-semibold">Recent Discussions</h2>
              </div>
              <div className="divide-y divide-border">
                {recentThreads.map((thread) => (
                  <Link
                    key={thread.id}
                    href={`/forum/thread/${thread.slug}`}
                    className="block p-4 hover:bg-secondary/50 transition-colors"
                  >
                    <div className="flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold mb-1 flex items-center gap-2">
                          {unreadThreadIds.has(thread.id) && (
                            <Tooltip content="New activity" className="shrink-0">
                              <span className="h-2 w-2 rounded-full bg-primary" role="img" aria-label="Unread" />
                            </Tooltip>
                          )}
                          <span className="min-w-0 break-words">{thread.title}</span>
                        </h3>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                          <span className="flex min-w-0 items-center gap-1">
                            <Users className="w-4 h-4 shrink-0" />
                            <span className="truncate">{thread.author.profile?.username || thread.author.name}</span>
                            <RoleBadge role={thread.author.role} />
                        <TierChip reputation={thread.author.profile?.reputation ?? 0} publicMilestoneOptOut={thread.author.profile?.publicMilestoneOptOut} />
                          </span>
                          <span className="flex items-center gap-1">
                            <MessageSquare className="w-4 h-4" />
                            {thread.replyCount} repl{thread.replyCount === 1 ? "y" : "ies"}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-4 h-4" />
                            {new Date(thread.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground px-2 py-1 bg-secondary rounded">
                        {thread.category.name}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="min-w-0 space-y-6">
            {/* Followed discussions — personalized, so it outranks stats */}
            <FollowedThreads items={followedItems} />

            {/* Forum Stats */}
            <div className="bg-card rounded-lg border border-border p-4">
              <h3 className="text-base font-semibold mb-3">Forum Statistics</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Threads</span>
                  <span className="font-semibold">{threadCount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Posts</span>
                  <span className="font-semibold">{postCount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Members</span>
                  <span className="font-semibold">{memberCount.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Trending Topics */}
            <div className="bg-card rounded-lg border border-border p-4">
              <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                Trending Topics
              </h3>
              {trendingThreads.length === 0 ? (
                <p className="text-sm text-muted-foreground">No trending topics yet.</p>
              ) : (
                <div className="space-y-2">
                  {trendingThreads.map((t) => (
                    <Link key={t.slug} href={`/forum/thread/${t.slug}`} className="block text-sm text-muted-foreground hover:text-foreground">
                      {t.title} <span className="text-xs">({t.views} views)</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Quick Actions */}
            <div className="bg-card rounded-lg border border-border p-4">
              <h3 className="text-base font-semibold mb-3">Quick Actions</h3>
              <div className="space-y-2">
                <Link
                  href="/forum/new"
                  className="block w-full text-center bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors"
                >
                  Create New Thread
                </Link>
                <Link
                  href="/search"
                  className="block w-full text-center border border-border px-4 py-2 rounded-lg hover:bg-secondary transition-colors"
                >
                  Search Forum
                </Link>
                <Link
                  href="/forum/tags"
                  className="block w-full text-center border border-border px-4 py-2 rounded-lg hover:bg-secondary transition-colors"
                >
                  Browse Tags
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}