import { prisma } from "@/lib/prisma"
import { publicUserSelect, isModerator } from "@/lib/security"
import { unstable_cache } from "next/cache"
import { notFound } from "next/navigation"
import { MessageSquare, Users, Clock, Pin, Lock } from "lucide-react"
import Link from "next/link"
import { buildMetadata } from "@/lib/seo"
import { Breadcrumbs } from "@/components/breadcrumbs"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import CategoryFollowButton from "@/components/category-follow-button"

export const dynamic = "force-dynamic"

const THREADS_PER_PAGE = 30

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const category = await prisma.category.findUnique({
    where: { slug },
    select: { name: true, description: true, hidden: true },
  })
  if (!category || category.hidden) return buildMetadata({ title: "Category not found", robots: { index: false } })
  return buildMetadata({
    title: `${category.name} — Cannabis Growing Forum`,
    description: `Discussions about ${category.name} on TerpTalk. ${category.description || ""}`.trim(),
    keywords: [category.name, "cannabis growing", "cannabis forum"],
    pathname: `/forum/category/${slug}`,
  })
}

const getCategoryData = unstable_cache(
  async (slug: string, page: number, unanswered = false) => {
    const where = { deleted: false, ...(unanswered ? { replyCount: 0 } : {}) }
    const category = await prisma.category.findUnique({
      where: { slug },
      include: {
        threads: {
          where,
          include: {
            author: { select: publicUserSelect },
            _count: {
              select: { posts: { where: { deleted: false } } },
            },
          },
          orderBy: [
            { pinned: "desc" },
            { createdAt: "desc" },
          ],
          skip: (page - 1) * THREADS_PER_PAGE,
          take: THREADS_PER_PAGE,
        },
        _count: { select: { threads: { where } } },
      },
    })

    if (!category) {
      notFound()
    }

    return category
  },
  ["forum-category"],
  { revalidate: 60, tags: ["forum"] }
)

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ page?: string; filter?: string }>
}) {
  const { slug } = await params
  const { page: pageParam, filter: filterParam } = await searchParams
  const page = Math.max(1, Math.min(10_000, parseInt(pageParam || "1") || 1))
  const unanswered = filterParam === "unanswered"
  const category = await getCategoryData(slug, page, unanswered)
  const session = await getServerSession(authOptions)
  // Hidden categories are unlisted, not public — 404 for non-moderators.
  if (category.hidden && !isModerator(session?.user?.role)) notFound()
  const isFollowing = session?.user?.id
    ? !!(await prisma.categoryFollow.findUnique({
        where: { userId_categoryId: { userId: session.user.id, categoryId: category.id } },
        select: { id: true },
      }))
    : false

  // Per-viewer unread state lives outside the cached category query.
  const unreadThreadIds = new Set<string>()
  if (session?.user?.id && category.threads.length > 0) {
    const follows = await prisma.threadFollow.findMany({
      where: { userId: session.user.id, threadId: { in: category.threads.map((t) => t.id) } },
      select: { threadId: true, lastSeenAt: true, thread: { select: { lastActivityAt: true } } },
    })
    for (const f of follows) {
      if (f.thread.lastActivityAt > (f.lastSeenAt ?? new Date(0))) unreadThreadIds.add(f.threadId)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <Breadcrumbs items={[
          { label: "Forum", href: "/forum" },
          { label: category.name },
        ]} />
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold mb-1">{category.name}</h1>
              <p className="text-sm text-muted-foreground">{category.description}</p>
            </div>
            <CategoryFollowButton categoryId={category.id} initiallyFollowing={isFollowing} />
          </div>
        </div>

        {/* Threads List */}
        <div className="bg-card rounded-lg border border-border">
          <div className="p-4 border-b border-border flex flex-wrap gap-2 items-center justify-between">
            <div className="flex gap-2">
              <Link
                href={`/forum/category/${category.slug}`}
                className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                  !unanswered ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-secondary/80"
                }`}
              >
                All
              </Link>
              <Link
                href={`/forum/category/${category.slug}?filter=unanswered`}
                className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                  unanswered ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-secondary/80"
                }`}
              >
                Unanswered
              </Link>
            </div>
            <Link
              href={`/forum/new?category=${category.slug}`}
              className="bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors text-sm"
            >
              New Discussion
            </Link>
          </div>

          {category.threads.length === 0 ? (
            <div className="p-8 text-center">
              <MessageSquare className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="text-base font-semibold mb-1">No discussions yet</h3>
              <p className="text-sm text-muted-foreground mb-3">Be the first to start a discussion in this category!</p>
              <Link
                href={`/forum/new?category=${category.slug}`}
                className="bg-primary text-primary-foreground px-6 py-2 rounded-lg hover:bg-primary/90 transition-colors"
              >
                Create First Discussion
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {category.threads.map((thread) => (
                <Link
                  key={thread.id}
                  href={`/forum/thread/${thread.slug}`}
                  className="block p-4 hover:bg-secondary/50 transition-colors"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {unreadThreadIds.has(thread.id) && (
                          <span className="h-2 w-2 rounded-full bg-primary shrink-0" role="img" aria-label="Unread" title="New activity" />
                        )}
                        {thread.pinned && <Pin className="w-4 h-4 text-primary" />}
                        {thread.locked && <Lock className="w-4 h-4 text-muted-foreground" />}
                        <h3 className="font-semibold">{thread.title}</h3>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Users className="w-4 h-4" />
                          {thread.author.profile?.username || thread.author.name}
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
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* Pagination — 30 threads per page */}
          {(() => {
            const totalPages = Math.ceil(category._count.threads / THREADS_PER_PAGE)
            if (totalPages <= 1) return null
            return (
              <div className="flex items-center justify-center gap-2 p-4 text-sm border-t border-border">
                {page > 1 && (
                  <Link href={`/forum/category/${category.slug}?page=${page - 1}`} className="px-3 py-1.5 rounded-md bg-secondary hover:bg-secondary/70">← Previous</Link>
                )}
                <span className="text-muted-foreground">Page {page} of {totalPages}</span>
                {page < totalPages && (
                  <Link href={`/forum/category/${category.slug}?page=${page + 1}`} className="px-3 py-1.5 rounded-md bg-secondary hover:bg-secondary/70">Next →</Link>
                )}
              </div>
            )
          })()}
        </div>
      </div>
    </div>
  )
}