import { prisma } from "@/lib/prisma"
import { publicUserSelect } from "@/lib/security"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import Link from "next/link"
import { MessageSquare, TrendingUp, Clock, Users, Flame, Eye } from "lucide-react"
import RoleBadge from "@/components/role-badge"
import { Avatar } from "@/components/ui/avatar"
import EmptyState from "@/components/empty-state"

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
  const select = {
    id: true,
    title: true,
    slug: true,
    content: true,
    views: true,
    replyCount: true,
    createdAt: true,
    author: { select: publicUserSelect },
    category: { select: { name: true, slug: true } },
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
      select,
    })
    return { threads }
  }

  if (tab === "trending") {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const candidates = await prisma.thread.findMany({
      where: { deleted: false, createdAt: { gte: oneWeekAgo } },
      take: 200,
      select,
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
    select,
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

        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center gap-2 mb-4">
            {icon}
            <h2 className="font-semibold">{heading}</h2>
          </div>
          {threads.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title={activeTab === "following" ? "No follows yet" : "No discussions found"}
              description={
                activeTab === "following"
                  ? "Follow growers to see their threads here."
                  : "Be the first to start a conversation."
              }
              action={{ href: "/forum/new", label: "Start a discussion" }}
            />
          ) : (
            <div className="grid sm:grid-cols-2 gap-4">
              {threads.map((thread) => (
                <Link
                  key={thread.id}
                  href={`/forum/thread/${thread.slug}`}
                  className="group flex flex-col p-5 bg-secondary/30 rounded-xl border border-border hover:border-primary/40 hover:bg-secondary/50 transition-all"
                >
                  <div className="flex items-start gap-3 mb-3">
                    <Avatar src={thread.author.image ?? undefined} size="sm" alt={thread.author.profile?.username ?? thread.author.name ?? undefined} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
                        <span className="font-medium text-foreground">{thread.author.profile?.username || thread.author.name}</span>
                        <RoleBadge role={thread.author.role} />
                        <span>•</span>
                        <span className="text-primary">{thread.category.name}</span>
                      </div>
                    </div>
                  </div>
                  <h3 className="font-semibold mb-2 break-words group-hover:text-primary transition-colors">{thread.title}</h3>
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-4 flex-1">{thread.content}</p>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mt-auto">
                    <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {new Date(thread.createdAt).toLocaleDateString()}</span>
                    <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" /> {thread.views}</span>
                    <span className="flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" /> {thread._count.posts}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
