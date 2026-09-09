import { prisma } from "@/lib/prisma"
import { publicUserSelect, isModerator } from "@/lib/security"
import { notFound } from "next/navigation"
import { MessageSquare, Users, Clock, CheckCircle2 } from "lucide-react"
import Link from "next/link"
import ReplyForm from "@/components/reply-form"
import PostActions from "@/components/post-actions"
import RoleBadge from "@/components/role-badge"
import ThreadModActions from "@/components/thread-mod-actions"
import ShareButtons from "@/components/share-buttons"
import BookmarkButton from "@/components/bookmark-button"
import PostContent from "@/components/post-content"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { buildMetadata, snippet } from "@/lib/seo"
import { Breadcrumbs } from "@/components/breadcrumbs"
import { JsonLd } from "@/components/json-ld"
import { AcceptAnswerButton } from "@/components/accept-answer-button"

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const thread = await prisma.thread.findUnique({
    where: { slug },
    select: { title: true, content: true, deleted: true, category: { select: { name: true, slug: true } } },
  })
  if (!thread || thread.deleted) return buildMetadata({ title: "Thread not found", robots: { index: false } })
  return buildMetadata({
    title: thread.title,
    description: snippet(thread.content),
    keywords: [thread.category.name, "cannabis forum", "cannabis growing"],
    pathname: `/forum/thread/${slug}`,
    og: { type: "article" },
  })
}

const POSTS_PER_PAGE = 50

async function getThreadData(slug: string, page: number) {
  const thread = await prisma.thread.findUnique({
    where: { slug },
    include: {
      author: { select: publicUserSelect },
      category: true,
      acceptedAnswer: {
        include: {
          author: { select: publicUserSelect },
          reactions: { select: { userId: true, type: true } },
        },
      },
      posts: {
        where: { deleted: false },
        include: {
          author: { select: publicUserSelect },
          reactions: { select: { userId: true, type: true } },
        },
        orderBy: { createdAt: "asc" },
        skip: (page - 1) * POSTS_PER_PAGE,
        take: POSTS_PER_PAGE,
      },
      _count: { select: { posts: { where: { deleted: false } } } },
    },
  })

  if (!thread || thread.deleted) {
    notFound()
  }

  // Increment view count
  await prisma.thread.update({
    where: { id: thread.id },
    data: { views: { increment: 1 } },
  })

  return thread
}

export default async function ThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const { slug } = await params
  const { page: pageParam } = await searchParams
  const page = Math.max(1, Math.min(10_000, parseInt(pageParam || "1") || 1))
  const thread = await getThreadData(slug, page)
  const relatedThreads = await prisma.thread.findMany({
    where: { deleted: false, categoryId: thread.categoryId, id: { not: thread.id } },
    take: 5,
    orderBy: { createdAt: "desc" },
    select: { id: true, slug: true, title: true, _count: { select: { posts: true } } },
  })
  const session = await getServerSession(authOptions)
  const saved = session?.user?.id
    ? !!(await prisma.bookmark.findUnique({
        where: { userId_threadId: { userId: session.user.id, threadId: thread.id } },
        select: { id: true },
      }))
    : false

  const currentUserId = session?.user?.id
  const canSetAnswer = !!currentUserId && (
    currentUserId === thread.authorId || isModerator(session?.user?.role)
  ) && !thread.locked

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://terp-talk.vercel.app"
  const canonical = `${baseUrl}/forum/thread/${thread.slug}`

  const breadcrumbs = [
    { label: "Forum", href: "/forum" },
    { label: thread.category.name, href: `/forum/category/${thread.category.slug}` },
    { label: thread.title },
  ]

  const discussionSchema = {
    "@context": "https://schema.org",
    "@type": "DiscussionForumPosting",
    headline: thread.title,
    description: snippet(thread.content),
    author: {
      "@type": "Person",
      name: thread.author.profile?.username || thread.author.name,
      url: `${baseUrl}/u/${thread.author.profile?.username || thread.author.name}`,
    },
    datePublished: thread.createdAt.toISOString(),
    url: canonical,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": canonical,
    },
    publisher: {
      "@type": "Organization",
      name: "TerpTalk",
      url: baseUrl,
    },
    answerCount: Math.max(0, thread.posts.length - 1),
  }

  const visiblePosts = thread.acceptedAnswer
    ? thread.posts.filter((p) => p.id !== thread.acceptedAnswer!.id)
    : thread.posts

  const acceptedPost = thread.acceptedAnswer

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <JsonLd data={discussionSchema} />
        <Breadcrumbs items={breadcrumbs} />
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-muted-foreground px-2 py-1 bg-secondary rounded">
              {thread.category.name}
            </span>
            {thread.pinned && (
              <span className="text-xs text-primary px-2 py-1 bg-primary/10 rounded">Pinned</span>
            )}
            {thread.locked && (
              <span className="text-xs text-muted-foreground px-2 py-1 bg-secondary rounded">Locked</span>
            )}
            <ThreadModActions threadId={thread.id} authorId={thread.authorId} pinned={thread.pinned} locked={thread.locked} />
          </div>
          <h1 className="text-3xl font-bold mb-2 break-words">{thread.title}</h1>
          <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
            <Link
              href={`/u/${thread.author.profile?.username || thread.author.name}`}
              className="flex items-center gap-1 hover:text-foreground"
            >
              <Users className="w-4 h-4" />
              {thread.author.profile?.username || thread.author.name}
            </Link>
            <RoleBadge role={thread.author.role} />
            <span className="flex items-center gap-1">
              <Clock className="w-4 h-4" />
              {new Date(thread.createdAt).toLocaleDateString()}
            </span>
            <span className="flex items-center gap-1">
              <MessageSquare className="w-4 h-4" />
              {Math.max(0, thread.posts.length - 1)} replies
            </span>
            <span className="flex items-center gap-1">
              <Users className="w-4 h-4" />
              {thread.views} views
            </span>
            <BookmarkButton threadId={thread.id} initiallySaved={saved} />
            <ShareButtons path={`/forum/thread/${thread.slug}`} title={thread.title} />
          </div>
        </div>

        {/* Accepted answer */}
        {acceptedPost && (
          <div className="bg-card rounded-lg border-2 border-green-500/50 p-6 mb-6 ring-1 ring-green-500/20">
            <div className="flex items-center gap-2 text-green-400 text-sm font-medium mb-4">
              <CheckCircle2 className="w-4 h-4" />
              <span>Accepted answer</span>
            </div>
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0">
                <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
                  <Users className="w-6 h-6 text-primary" />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-2 gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/u/${acceptedPost.author.profile?.username || acceptedPost.author.name}`}
                      className="font-semibold hover:text-primary truncate"
                    >
                      {acceptedPost.author.profile?.username || acceptedPost.author.name}
                    </Link>
                    <RoleBadge role={acceptedPost.author.role} />
                  </div>
                  <span className="text-sm text-muted-foreground shrink-0">
                    {new Date(acceptedPost.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="prose prose-invert max-w-none mb-4">
                  <PostContent content={acceptedPost.content} authorRole={acceptedPost.author.role} pagePath={`/forum/thread/${thread.slug}`} />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <PostActions
                    postId={acceptedPost.id}
                    authorId={acceptedPost.author.id}
                    initialContent={acceptedPost.content}
                    initialLikeCount={acceptedPost.reactions.filter((r) => r.type === "LIKE").length}
                  />
                  <AcceptAnswerButton
                    postId={acceptedPost.id}
                    threadId={thread.id}
                    isAnswer
                    canAccept={canSetAnswer}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Posts */}
        <div className="space-y-6">
          {visiblePosts.map((post, index) => {
            const likeCount = post.reactions.filter((r) => r.type === "LIKE").length
            const isOp = index === 0
            const eligibleForAnswer = !isOp && post.authorId !== thread.authorId
            return (
              <div
                key={post.id}
                className={`bg-card rounded-lg border border-border p-6 ${
                  isOp ? "ring-2 ring-primary/20" : ""
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
                      <Users className="w-6 h-6 text-primary" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-2 gap-2">
                      <div className="min-w-0">
                        <Link
                          href={`/u/${post.author.profile?.username || post.author.name}`}
                          className="font-semibold hover:text-primary truncate"
                        >
                          {post.author.profile?.username || post.author.name}
                        </Link>
                        <RoleBadge role={post.author.role} />
                        {isOp && (
                          <span className="ml-2 text-xs text-muted-foreground">(Original Poster)</span>
                        )}
                        {post.edited && (
                          <span className="ml-2 text-xs text-muted-foreground">(edited)</span>
                        )}
                      </div>
                      <span className="text-sm text-muted-foreground shrink-0">
                        {new Date(post.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="prose prose-invert max-w-none mb-4">
                      <PostContent content={post.content} authorRole={post.author.role} pagePath={`/forum/thread/${thread.slug}`} />
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <PostActions
                        postId={post.id}
                        authorId={post.author.id}
                        initialContent={post.content}
                        initialLikeCount={likeCount}
                      />
                      {eligibleForAnswer && (
                        <AcceptAnswerButton
                          postId={post.id}
                          threadId={thread.id}
                          isAnswer={false}
                          canAccept={canSetAnswer}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Pagination — threads are capped at 50 posts per page */}
        {(() => {
          const total = thread._count.posts
          const totalPages = Math.ceil(total / POSTS_PER_PAGE)
          if (totalPages <= 1) return null
          return (
            <div className="flex items-center justify-center gap-2 mt-6 mb-2 text-sm">
              {page > 1 && (
                <Link href={`/forum/thread/${thread.slug}?page=${page - 1}`} className="px-3 py-1.5 rounded-md bg-secondary hover:bg-secondary/70">← Earlier replies</Link>
              )}
              <span className="text-muted-foreground">Page {page} of {totalPages}</span>
              {page < totalPages && (
                <Link href={`/forum/thread/${thread.slug}?page=${page + 1}`} className="px-3 py-1.5 rounded-md bg-secondary hover:bg-secondary/70">Later replies →</Link>
              )}
            </div>
          )
        })()}

        {relatedThreads.length > 0 && (
          <div className="mt-8 bg-card rounded-lg border border-border p-6">
            <div className="flex items-center gap-2 mb-4">
              <MessageSquare className="w-4 h-4 text-primary" />
              <h2 className="font-semibold">Related discussions</h2>
            </div>
            <ul className="space-y-2">
              {relatedThreads.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/forum/thread/${t.slug}`}
                    className="text-sm hover:text-primary hover:underline"
                  >
                    {t.title}
                    <span className="ml-2 text-xs text-muted-foreground">({t._count.posts - 1} replies)</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Reply Form */}
        {!thread.locked && (
          <ReplyForm threadId={thread.id} />
        )}
        {thread.locked && (
          <div className="mt-6 p-4 bg-secondary/50 rounded-lg text-sm text-muted-foreground text-center">
            This thread is locked. No new replies can be posted.
          </div>
        )}
      </div>
    </div>
  )
}
