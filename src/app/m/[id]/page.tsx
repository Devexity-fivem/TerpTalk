import { prisma } from "@/lib/prisma"
import { getSession } from "@/lib/session"
import { buildMetadata, snippet } from "@/lib/seo"
import { publicUserSelect, activeAuthor, blockedUserIds } from "@/lib/security"
import { getMomentForViewer } from "@/lib/moments"
import { eventSource } from "@/lib/event-sources"
import { notFound } from "next/navigation"
import { MessageSquare } from "@/lib/icons"
import SectionCard from "@/components/ui/section-card"
import MomentCard from "@/components/moment-card"
import MomentComments from "@/components/moment-comments"
import EventBeacon from "@/components/event-beacon"

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

  // Latest 50 comments, rendered oldest → newest (same convention as the
  // setups page — notification anchors target recent comments).
  const blockedIds = await blockedUserIds(viewerId)
  const blocked = new Set(blockedIds)
  const rows = commentTargetId ? await prisma.momentComment.findMany({
    where: { momentId: commentTargetId, deleted: false, author: activeAuthor() },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, content: true, createdAt: true, authorId: true, author: { select: publicUserSelect } },
  }) : []
  const comments = rows.filter((c) => !blocked.has(c.authorId)).reverse()

  return (
    <div className="min-h-screen bg-background">
      {/* Followed-content signal — server re-verifies the follow and the
          moment's visibility; guests and non-followers record nothing. */}
      <EventBeacon type="FOLLOWED_CONTENT_VIEWED" source={via} objectType="Moment" objectId={moment.id} />
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="tt-spotlight bg-card/80 rounded-2xl border border-border/70 mb-6">
          <MomentCard moment={moment} variant="detail" />
        </div>

        {commentTargetId && (
          <SectionCard
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
    </div>
  )
}
