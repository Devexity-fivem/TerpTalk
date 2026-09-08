import { prisma } from "@/lib/prisma"
import { publicUserSelect } from "@/lib/security"
import { MessageSquare, Users, Clock, TrendingUp } from "lucide-react"
import Link from "next/link"

export const dynamic = "force-dynamic"

async function getForumData() {
  const categories = await prisma.category.findMany({
    where: { hidden: false },
    orderBy: { order: "asc" },
    include: {
      threads: {
        where: { deleted: false },
        take: 1,
        orderBy: { createdAt: "desc" },
      },
      _count: {
        select: { threads: { where: { deleted: false } } },
      },
    },
  })

  const recentThreads = await prisma.thread.findMany({
    where: { deleted: false },
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

  return { categories, recentThreads }
}

export default async function ForumPage() {
  const { categories, recentThreads } = await getForumData()

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">TerpTalk Discussions</h1>
          <p className="text-muted-foreground">Join discussions, share knowledge, and connect with fellow growers</p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Main Forum Categories */}
          <div className="lg:col-span-2 space-y-6">
            {/* Categories */}
            <div className="bg-card rounded-lg border border-border">
              <div className="p-6 border-b border-border">
                <h2 className="text-xl font-semibold">Categories</h2>
              </div>
              <div className="divide-y divide-border">
                {categories.map((category) => (
                  <Link
                    key={category.id}
                    href={`/forum/category/${category.slug}`}
                    className="block p-6 hover:bg-secondary/50 transition-colors"
                  >
                    <div className="flex items-start gap-4">
                      <div className="bg-primary/10 p-3 rounded-lg">
                        <MessageSquare className="w-6 h-6 text-primary" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold mb-1">{category.name}</h3>
                        <p className="text-sm text-muted-foreground mb-2">{category.description}</p>
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
              <div className="p-6 border-b border-border">
                <h2 className="text-xl font-semibold">Recent Discussions</h2>
              </div>
              <div className="divide-y divide-border">
                {recentThreads.map((thread) => (
                  <Link
                    key={thread.id}
                    href={`/forum/thread/${thread.slug}`}
                    className="block p-4 hover:bg-secondary/50 transition-colors"
                  >
                    <div className="flex items-start gap-4">
                      <div className="flex-1">
                        <h3 className="font-semibold mb-1">{thread.title}</h3>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Users className="w-4 h-4" />
                            {thread.author.profile?.username || thread.author.name}
                          </span>
                          <span className="flex items-center gap-1">
                            <MessageSquare className="w-4 h-4" />
                            {thread._count.posts} replies
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
          <div className="space-y-6">
            {/* Forum Stats */}
            <div className="bg-card rounded-lg border border-border p-6">
              <h3 className="font-semibold mb-4">Forum Statistics</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Threads</span>
                  <span className="font-semibold">0</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Posts</span>
                  <span className="font-semibold">0</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Members</span>
                  <span className="font-semibold">0</span>
                </div>
              </div>
            </div>

            {/* Trending Topics */}
            <div className="bg-card rounded-lg border border-border p-6">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                Trending Topics
              </h3>
              <div className="space-y-2">
                <Link href="#" className="block text-sm text-muted-foreground hover:text-foreground">
                  LED vs HPS lighting
                </Link>
                <Link href="#" className="block text-sm text-muted-foreground hover:text-foreground">
                  Organic nutrients guide
                </Link>
                <Link href="#" className="block text-sm text-muted-foreground hover:text-foreground">
                  Low stress training techniques
                </Link>
                <Link href="#" className="block text-sm text-muted-foreground hover:text-foreground">
                  pH and EC management
                </Link>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="bg-card rounded-lg border border-border p-6">
              <h3 className="font-semibold mb-4">Quick Actions</h3>
              <div className="space-y-2">
                <Link
                  href="/forum/new"
                  className="block w-full text-center bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors"
                >
                  Create New Thread
                </Link>
                <Link
                  href="/forum/search"
                  className="block w-full text-center border border-border px-4 py-2 rounded-lg hover:bg-secondary transition-colors"
                >
                  Search Forum
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}