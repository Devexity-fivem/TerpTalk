import { prisma } from "@/lib/prisma"
import { getSession } from "@/lib/session"
import { buildMetadata, snippet } from "@/lib/seo"
import { publicUserSelect, activeAuthor, blockedUserIds } from "@/lib/security"
import {
  getMomentForViewer,
  momentVisibleWhere,
  momentCardSelect,
  toMomentDTO,
  type MomentDTO,
} from "@/lib/moments"
import { eventSource } from "@/lib/event-sources"
import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Leaf, MessageSquare, Users } from "@/lib/icons"
import SectionCard from "@/components/ui/section-card"
import MomentCard from "@/components/moment-card"
import MomentComments from "@/components/moment-comments"
import EventBeacon from "@/components/event-beacon"
import { Avatar } from "@/components/ui/avatar"
import RoleBadge from "@/components/role-badge"
import TimeAgo from "@/components/ui/time-ago"
import GrowerFollowButton from "@/components/grower-follow-button"

export const dynamic = "force-dynamic"

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const m = await prisma.moment.findFirst({
    where: { id, deleted: false, visibility: "PUBLIC", kind: "POST" },
    select: { content: true, author: { select: { profile: { select: { username: true } } } } },
  })
  if (!m) return buildMetadata({ title: "Post not found", robots: { index: false } })
  return buildMetadata({
    title: `@${m.author.profile?.username ?? "member"} on TerpTalk`,
    description: snippet(m.content || "Photo post"),
    pathname: `/m/${id}`,
  })
}

/** Compact "more from this grower" row — real post data only; pure reposts
 *  are pointers, not content, so they're filtered out before render. */
function MorePostRow({ m }: { m: MomentDTO }) {
  const text = m.content ? snippet(m.content, 180) : m.images.length > 0 ? "Photo post" : "Post"
  return (
    <li>
      <Link
        href={m.href}
        className="group flex items-start gap-3 rounded-xl p-2 -mx-2 transition-colors hover:bg-secondary/50"
      >
        <span className="w-14 h-14 rounded-lg bg-secondary overflow-hidden shrink-0 flex items-center justify-center">
          {m.images[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={m.images[0].url} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
          ) : (
            <MessageSquare className="w-5 h-5 text-muted-foreground/60" aria-hidden="true" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm leading-snug line-clamp-2 wrap-break-word group-hover:text-primary transition-colors">
            {text}
          </span>
          <span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <TimeAgo value={m.createdAt} />
            {m.visibility === "FOLLOWERS" && (
              <span className="inline-flex items-center gap-0.5" title="Followers only">
                <Users className="w-3 h-3" /> <span className="sr-only">Followers only</span>
              </span>
            )}
            {m.counts.comments > 0 && <span>· {m.counts.comments} comment{m.counts.comments === 1 ? "" : "s"}</span>}
          </span>
        </span>
      </Link>
    </li>
  )
}

export default async function MomentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ via?: string }> }) {
  const { id } = await params
  const session = await getSession()
  const viewerId = session?.user?.id ?? null
  // Inbound attribution surface (`?via=`) — allowlist-validated; anything
  // else records as an unattributed view.
  const via = eventSource((await searchParams).via)

  const moment = await getMomentForViewer(id, viewerId)
  if (!moment || moment.kind !== "POST") notFound()

  // Comments belong to the effective target — a pure repost serves the
  // original's thread; a repost whose original is gone has no thread.
  const commentTargetId = moment.isRepost ? moment.repostOf?.id ?? null : moment.id

  // The author the page is really about: a pure repost's card renders the
  // original's byline, so context follows the displayed author; when the
  // original is gone the reposter is the only identity left.
  const author = moment.isRepost ? moment.repostOf?.author ?? moment.author : moment.author
  const authorId = author.id
  const authorName = author.profile?.username || author.name || "member"
  const authorSlug = author.profile?.username || author.name
  const authorHref = authorSlug ? `/u/${authorSlug}` : null

  const blockedIds = await blockedUserIds(viewerId)
  const blocked = new Set(blockedIds)

  // One round-trip for the whole page: the comment thread (unchanged
  // contract) plus the rail's real signals — follower/post counts, the
  // viewer's follow state, and the author's other visible posts through
  // the canonical moment predicate (blocks, audience, repost rules all
  // apply exactly as they do on the feed).
  const authorScope = momentVisibleWhere({ viewerId, blockedIds, kind: "POST" })
  const [rows, followerCount, postCount, followRow, moreRows] = await Promise.all([
    commentTargetId
      ? prisma.momentComment.findMany({
          where: { momentId: commentTargetId, deleted: false, author: activeAuthor() },
          orderBy: { createdAt: "desc" },
          take: 50,
          select: { id: true, content: true, createdAt: true, authorId: true, author: { select: publicUserSelect } },
        })
      : Promise.resolve([]),
    prisma.follow.count({ where: { followingId: authorId } }),
    prisma.moment.count({ where: { AND: [authorScope, { authorId }] } }),
    viewerId && viewerId !== authorId
      ? prisma.follow.findUnique({
          where: { followerId_followingId: { followerId: viewerId, followingId: authorId } },
          select: { id: true },
        })
      : Promise.resolve(null),
    prisma.moment.findMany({
      where: { AND: [authorScope, { authorId }, { id: { not: moment.id } }] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 6,
      select: momentCardSelect(viewerId),
    }),
  ])
  // Latest 50 comments, rendered oldest → newest (same convention as the
  // setups page — notification anchors target recent comments).
  const comments = rows.filter((c) => !blocked.has(c.authorId)).reverse()
  const viewerFollows = !!followRow
  const morePosts = moreRows
    .map((r) => toMomentDTO(r, viewerId, blockedIds))
    .filter((m) => !m.isRepost)
    .slice(0, 4)

  return (
    <div className="min-h-screen bg-background">
      {/* Followed-content signal — server re-verifies the follow and the
          moment's visibility; guests and non-followers record nothing. */}
      <EventBeacon type="FOLLOWED_CONTENT_VIEWED" source={via} objectType="Moment" objectId={moment.id} />
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-8">
        <Link
          href="/feed"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to feed
        </Link>

        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-6">
          {/* ── Main column: the post, then its conversation ── */}
          <div className="min-w-0">
            <div className="tt-edge-card tt-spotlight bg-card/80 rounded-2xl border border-border/70 mb-6 overflow-hidden">
              <MomentCard moment={moment} variant="detail" />
            </div>

            {commentTargetId && (
              <SectionCard spotlight
                title={
                  <span className="flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-primary" /> Comments ({moment.isRepost ? moment.repostOf!.counts.comments : moment.counts.comments})
                  </span>
                }
              >
                <MomentComments momentId={commentTargetId} momentAuthorId={moment.isRepost ? moment.repostOf!.author.id : moment.author.id} initialComments={comments} />
              </SectionCard>
            )}
          </div>

          {/* ── Context rail (lg+): who posted this, and what else
              they've shared that this viewer may see. Every number and
              row is a real query — the rail simply doesn't render a
              section when there's nothing honest to show. ── */}
          <aside className="hidden lg:block" aria-label={`About @${authorName}`}>
            <div className="sticky top-20 space-y-4">
              <div className="tt-edge-card tt-spotlight bg-card/80 rounded-2xl border border-border/70 p-4">
                <div className="flex items-start gap-3">
                  {authorHref ? (
                    <Link href={authorHref} className="shrink-0 rounded-full ring-2 ring-primary/20 transition-shadow hover:ring-primary/50">
                      <Avatar src={author.image} size="lg" alt={authorName} />
                    </Link>
                  ) : (
                    <Avatar src={author.image} size="lg" alt={authorName} className="shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    {authorHref ? (
                      <Link
                        href={authorHref}
                        className="font-display block text-base font-semibold leading-tight wrap-break-word transition-colors hover:text-primary"
                      >
                        {authorName}
                      </Link>
                    ) : (
                      <span className="font-display block text-base font-semibold leading-tight wrap-break-word">
                        {authorName}
                      </span>
                    )}
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      {author.profile?.username && <span>@{author.profile.username}</span>}
                      <RoleBadge role={author.role} />
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="font-semibold tabular-nums text-foreground">{followerCount}</span> followers
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Leaf className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="font-semibold tabular-nums text-foreground">{postCount}</span> post{postCount === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="mt-3.5 flex items-center gap-2">
                  <GrowerFollowButton
                    key={authorId}
                    userId={authorId}
                    username={author.profile?.username ?? null}
                    initialFollowing={viewerFollows}
                    source={via ?? undefined}
                  />
                  {authorHref && (
                    <Link
                      href={authorHref}
                      className="rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    >
                      View profile
                    </Link>
                  )}
                </div>
              </div>

              {morePosts.length > 0 && (
                <SectionCard
                  spotlight
                  title={<>More from <span className="text-primary">@{author.profile?.username ?? authorName}</span></>}
                >
                  <ul className="-mx-2 space-y-1">
                    {morePosts.map((m) => (
                      <MorePostRow key={m.id} m={m} />
                    ))}
                  </ul>
                </SectionCard>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
