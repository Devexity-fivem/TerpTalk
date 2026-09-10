import { prisma } from "@/lib/prisma"
import { publicUserSelect } from "@/lib/security"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import Link from "next/link"
import { MessageSquare, TrendingUp, Clock, Users, Flame } from "lucide-react"
import RoleBadge from "@/components/role-badge"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Discover",
  description: "Latest, trending, and followed discussions on TerpTalk.",
}

function threadScore(t: { views: number; replyCount: number; createdAt: Date }) {
  const hours = (Date.now() - new Date(t.createdAt).getTime()) / 36e5
  return (t.views + t.replyCount * 5) / Math.pow(hours + 2, 1.5)
}

async function getDiscoverData(tab: string, userId?: string) {
  const include = {
    author: { select: publicUserSelect },
    category: true,
    _count: { select: { posts: { where: { deleted: false } } } },
  } as const

  if (tab === "following" && userId) {
    const follows = await prisma.follow.findMany({
      where: { followerId: userId },
      select: { followingId: true },
    })
    const followingIds = follows.map((f) => f.followingId)
    const threads = await prisma.thread.findMany({
      where: { deleted: false, authorId: { in: followingIds } },
      take: 50,
      orderBy: { createdAt: "desc" },
      include,
    })
    return { threads }
  }

  if (tab === "trending") {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const candidates = await prisma.thread.findMany({
      where: { deleted: false, createdAt: { gte: oneWeekAgo } },
      take: 200,
      include,
    })
    const scored = candidates
      .map((t) => ({ ...t, score: threadScore(t) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
    return { threads: scored }
  }

  // default latest
  const threads = await prisma.thread.findMany({
    where: { deleted: false },
    take: 50,
    orderBy: { createdAt: "desc" },
    include,
  })
  return { threads }
}

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  const activeTab = ["latest", "trending", "following"].includes(tab || "") ? (tab as string) : "latest"
  const session = await getServerSession(authOptions)
  const { threads } = await getDiscoverData(activeTab, session?.user?.id)

  const tabCls = (t: string) =>
    `px-4 py-2 text-sm font-medium transition-colors ${
      activeTab === t ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground"
    }`

  const icon = activeTab === "trending" ? <Flame className="w-5 h-5 text-primary" /> : <MessageSquare className="w-5 h-5 text-primary" />
  const heading = activeTab === "trending" ? "Trending Discussions" : activeTab === "following" ? "Your Following" : "Latest Discussions"

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Discover</h1>
          <p className="text-muted-foreground">Find the best and latest grower conversations.</p>
        </div>

        <div className="flex gap-4 mb-6 border-b border-border">
          <Link href="/discover?tab=latest" className={tabCls("latest")}>Latest</Link>
          <Link href="/discover?tab=trending" className={tabCls("trending")}><TrendingUp className="w-4 h-4 inline mr-1" /> Trending</Link>
          <Link href="/discover?tab=following" className={tabCls("following")}><Users className="w-4 h-4 inline mr-1" /> Following</Link>
        </div>

        <div className="bg-card rounded-lg border border-border">
          <div className="p-4 border-b border-border flex items-center gap-2">
            {icon}
            <h2 className="font-semibold">{heading}</h2>
          </div>
          <div className="divide-y divide-border">
            {threads.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                {activeTab === "following" ? (
                  <p>You are not following anyone yet. Follow growers to see their threads here.</p>
                ) : (
                  <p>No discussions found.</p>
                )}
              </div>
            ) : (
              threads.map((thread) => (
                <Link
                  key={thread.id}
                  href={`/forum/thread/${thread.slug}`}
                  className="block p-4 hover:bg-secondary/50 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                      <Users className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold mb-1 break-words">{thread.title}</h3>
                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          {thread.author.profile?.username || thread.author.name}
                          <RoleBadge role={thread.author.role} />
                        </span>
                        <span>•</span>
                        <span>{thread.category.name}</span>
                        <span>•</span>
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(thread.createdAt).toLocaleDateString()}</span>
                        <span>•</span>
                        <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" /> {thread.views} views</span>
                        <span>•</span>
                        <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" /> {thread._count.posts} repl{thread._count.posts === 1 ? "y" : "ies"}</span>
                      </div>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
