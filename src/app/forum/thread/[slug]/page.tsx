import { prisma } from "@/lib/prisma"
import { publicUserSelect, isModerator } from "@/lib/security"
import { notFound } from "next/navigation"
import { MessageSquare, Users, Clock, CheckCircle2, Eye } from "lucide-react"
import Link from "next/link"
import ReplyForm from "@/components/reply-form"
import PostActions from "@/components/post-actions"
import RoleBadge from "@/components/role-badge"
import ThreadModActions from "@/components/thread-mod-actions"
import ShareButtons from "@/components/share-buttons"
import BookmarkButton from "@/components/bookmark-button"
import PostContent from "@/components/post-content"
import ImageGallery from "@/components/image-gallery"
import Poll from "@/components/poll"
import { Avatar } from "@/components/ui/avatar"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { buildMetadata, snippet } from "@/lib/seo"
import { Breadcrumbs } from "@/components/breadcrumbs"
import { JsonLd } from "@/components/json-ld"
import { AcceptAnswerButton } from "@/components/accept-answer-button"
import ViewTracker from "@/components/view-tracker"
import ThreadFollowButton from "@/components/thread-follow-button"

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const thread = await prisma.thread.findUnique({
    where: { slug },
    select: { title: true, content: true, deleted: true, category: { select: { name: true, slug: true, hidden: true } } },
  })
  if (!thread || thread.deleted || thread.category.hidden) return buildMetadata({ title: "Thread not found", robots: { index: false } })
  return buildMetadata({
    title: thread.title,
    description: snippet(thread.content),
    keywords: [thread.category.name, "cannabis forum", "cannabis growing"],
    pathname: `/forum/thread/${slug}`,
    og: { type: "article" },
  })
}

const POSTS_PER_PAGE = 50

async function getThreadData(slug: string, page: number, canSeeHidden: boolean) {
  const thread = await prisma.thread.findUnique({
    where: { slug },
    include: {
      author: { select: publicUserSelect },
      category: true,
      tags: { include: { tag: true } },
      images: { orderBy: { order: "asc" } },
      poll: {
        include: {
          options: { orderBy: { order: "asc" }, include: { _count: { select: { votes: true } } } },
          _count: { select: { votes: true } },
        },
      },
      acceptedAnswer: {
        where: { deleted: false },
        include: {
          author: { select: publicUserSelect },
          reactions: { select: { userId: true, type: true } },
          images: { orderBy: { order: "asc" } },
        },
      },
      posts: {
        where: { deleted: false },
        include: {
          author: { select: publicUserSelect },
          reactions: { select: { userId: true, type: true } },
          images: { orderBy: { order: "asc" } },
        },
        orderBy: { createdAt: "asc" },
        skip: (page - 1) * POSTS_PER_PAGE,
        take: POSTS_PER_PAGE,
      },
      _count: { select: { posts: { where: { deleted: false } } } },
    },
  })

  // Hidden-category threads are unlisted, not public — mirror the mutation
  // routes and 404 them for non-moderators.
  if (!thread || thread.deleted || (thread.category?.hidden && !canSeeHidden)) {
    notFound()
  }

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
  const session = await getServerSession(authOptions)
  const currentUserId = session?.user?.id
  const thread = await getThreadData(slug, page, isModerator(session?.user?.role))
  const tagIds = thread.tags.map((tt) => tt.tagId)
  const relatedThreads = await prisma.thread.findMany({
    where: {
      deleted: false,
      id: { not: thread.id },
      OR: [
        { categoryId: thread.categoryId },
        ...(tagIds.length > 0 ? [{ tags: { some: { tagId: { in: tagIds } } } }] : []),
      ],
    },
    take: 5,
    orderBy: { createdAt: "desc" },
    include: {
      author: { select: publicUserSelect },
      category: { select: { name: true, slug: true } },
      _count: { select: { posts: { where: { deleted: false } } } },
    },
  })
  const saved = currentUserId
    ? !!(await prisma.bookmark.findUnique({
        where: { userId_threadId: { userId: session.user.id, threadId: thread.id } },
        select: { id: true },
      }))
    : false

  const following = currentUserId
    ? !!(await prisma.threadFollow.findUnique({
        where: { userId_threadId: { userId: currentUserId, threadId: thread.id } },
        select: { id: true },
      }))
    : false

  // Mark-seen: viewing a followed thread catches the viewer up. Only writes
  // when the thread has newer activity than the last view — monotonic and
  // idempotent.
  if (currentUserId && following) {
    await prisma.threadFollow.updateMany({
      where: { userId: currentUserId, threadId: thread.id, lastSeenAt: { lt: thread.lastActivityAt } },
      data: { lastSeenAt: thread.lastActivityAt },
    })
  }

  const canSetAnswer = !!currentUserId && (
    currentUserId === thread.authorId || isModerator(session?.user?.role)
  ) && !thread.locked

  const userVoteOptionId = thread.poll && currentUserId
    ? await prisma.pollVote.findFirst({
        where: { pollId: thread.poll.id, userId: currentUserId },
        select: { optionId: true },
      }).then((v) => v?.optionId ?? null)
    : null

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
    answerCount: thread.replyCount,
  }

  const visiblePosts = thread.acceptedAnswer
    ? thread.posts.filter((p) => p.id !== thread.acceptedAnswer!.id)
    : thread.posts

  const acceptedPost = thread.acceptedAnswer

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <JsonLd data={discussionSchema} />
        <ViewTracker threadId={thread.id} />
        <Breadcrumbs items={breadcrumbs} />
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
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
          <h1 className="text-2xl font-bold mb-2 break-words">{thread.title}</h1>
          {thread.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {thread.tags.map((tt) => (
                <Link
                  key={tt.tagId}
                  href={`/forum/tags/${tt.tag.slug}`}
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary hover:bg-primary/10 transition-colors"
                  style={tt.tag.color ? { backgroundColor: tt.tag.color } : undefined}
                >
                  #{tt.tag.name}
                </Link>
              ))}
            </div>
          )}
          <div className="flex items-center gap-x-3 gap-y-1 text-xs text-muted-foreground flex-wrap">
            <Link
              href={`/u/${thread.author.profile?.username || thread.author.name}`}
              className="flex items-center gap-1 hover:text-foreground"
            >
              <Users className="w-3.5 h-3.5" />
              {thread.author.profile?.username || thread.author.name}
            </Link>
            <RoleBadge role={thread.author.role} />
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {new Date(thread.createdAt).toLocaleDateString()}
            </span>
            <span className="flex items-center gap-1">
              <MessageSquare className="w-3.5 h-3.5" />
              {thread.replyCount} repl{thread.replyCount === 1 ? "y" : "ies"}
            </span>
            <span className="flex items-center gap-1">
              <Eye className="w-3.5 h-3.5" />
              {thread.views} views
            </span>
            <BookmarkButton threadId={thread.id} initiallySaved={saved} />
            <ThreadFollowButton threadId={thread.id} initiallyFollowing={following} />
            <ShareButtons path={`/forum/thread/${thread.slug}`} title={thread.title} />
          </div>
          {/* Photos attached when the thread was opened */}
          <ImageGallery images={thread.images} />
          {thread.poll && (
            <Poll
              poll={{
                id: thread.poll.id,
                question: thread.poll.question,
                options: thread.poll.options.map((o) => ({ id: o.id, text: o.text })),
              }}
              initialCounts={thread.poll.options.reduce((acc, o) => {
                acc[o.id] = o._count.votes
                return acc
              }, {} as Record<string, number>)}
              initialTotal={thread.poll._count.votes}
              userVoteOptionId={userVoteOptionId}
            />
          )}
        </div>

        {/* Accepted answer */}
        {acceptedPost && (
          <div className="bg-card rounded-lg border-2 border-green-500/50 p-4 mb-4 ring-1 ring-green-500/20">
            <div className="flex items-center gap-2 text-green-400 text-xs font-medium mb-3">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Accepted answer</span>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0">
                <Avatar
                  src={acceptedPost.author.image ?? undefined}
                  alt={acceptedPost.author.profile?.username || acceptedPost.author.name || undefined}
                  className="w-10 h-10"
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-2 gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/u/${acceptedPost.author.profile?.username || acceptedPost.author.name}`}
                      className="font-semibold hover:text-primary truncate text-sm"
                    >
                      {acceptedPost.author.profile?.username || acceptedPost.author.name}
                    </Link>
                    <RoleBadge role={acceptedPost.author.role} />
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {new Date(acceptedPost.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="max-w-none mb-3">
                  <PostContent content={acceptedPost.content} authorRole={acceptedPost.author.role} pagePath={`/forum/thread/${thread.slug}`} />
                  <ImageGallery images={acceptedPost.images} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <PostActions
                    postId={acceptedPost.id}
                    authorId={acceptedPost.author.id}
                    initialContent={acceptedPost.content}
                    currentUserId={currentUserId}
                    reactions={acceptedPost.reactions}
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
        <div className="space-y-4">
          {visiblePosts.map((post, index) => {
            const isOp = index === 0
            const eligibleForAnswer = !isOp && post.authorId !== thread.authorId
            return (
              <div
                key={post.id}
                className={`bg-card rounded-lg border border-border p-4 ${
                  isOp ? "ring-2 ring-primary/20" : ""
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0">
                    <Avatar
                      src={post.author.image ?? undefined}
                      alt={post.author.profile?.username || post.author.name || undefined}
                      className="w-10 h-10"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-2 gap-2">
                      <div className="min-w-0">
                        <Link
                          href={`/u/${post.author.profile?.username || post.author.name}`}
                          className="font-semibold hover:text-primary truncate text-sm"
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
                      <span className="text-xs text-muted-foreground shrink-0">
                        {new Date(post.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="max-w-none mb-3">
                      <PostContent content={post.content} authorRole={post.author.role} pagePath={`/forum/thread/${thread.slug}`} />
                      <ImageGallery images={post.images} />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <PostActions
                        postId={post.id}
                        authorId={post.author.id}
                        initialContent={post.content}
                        currentUserId={currentUserId}
                        reactions={post.reactions}
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
          <div className="mt-6 bg-card rounded-lg border border-border p-4">
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare className="w-3.5 h-3.5 text-primary" />
              <h2 className="text-base font-semibold">Related discussions</h2>
            </div>
            <ul className="space-y-2">
              {relatedThreads.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/forum/thread/${t.slug}`}
                    className="text-sm hover:text-primary hover:underline"
                  >
                    {t.title}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {t.category.name} • {t._count.posts} repl{t._count.posts === 1 ? "y" : "ies"}
                    </span>
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
