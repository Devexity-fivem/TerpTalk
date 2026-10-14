import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import {
  unauthorized, forbidden, publicUserSelect, activeAuthor, notBlockedAuthor, blockedUserIds,
  getSecurityUser, isBannedRow, enforceLinkTrust, getClientIp, logSecurityEvent,
} from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { checkMaintenance } from "@/lib/maintenance"
import { notify, notifyMany } from "@/lib/notify"
import { notifyMentions } from "@/lib/mentions"
import { decodeFeedCursor, encodeFeedCursor } from "@/lib/feed"
import { MOMENT_COMMENT_MAX, canViewMoment, followersAudience, momentInteractionTarget, momentPath } from "@/lib/moments"
import { eventSource } from "@/lib/event-sources"
import { recordProductEvent } from "@/lib/product-events"

type Ctx = { params: Promise<{ id: string }> }

const PAGE = 30

// GET — comments on a viewable moment, oldest first, keyset-paged with
// the feed's opaque cursor format. Inactive and blocked authors drop out.
export async function GET(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const session = await getServerSession(authOptions)
  const viewerId = session?.user?.id ?? null
  const m = await momentInteractionTarget(id)
  if (!m || !(await canViewMoment(m, viewerId))) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const cur = decodeFeedCursor(request.nextUrl.searchParams.get("cursor"))
  const blockedIds = await blockedUserIds(viewerId)
  const rows = await prisma.momentComment.findMany({
    where: {
      momentId: m.id,
      deleted: false,
      author: activeAuthor(),
      ...notBlockedAuthor(blockedIds),
      ...(cur ? { OR: [{ createdAt: { gt: new Date(cur.ts) } }, { createdAt: new Date(cur.ts), id: { gt: cur.id } }] } : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: PAGE + 1,
    select: { id: true, content: true, createdAt: true, authorId: true, author: { select: publicUserSelect } },
  })
  const items = rows.slice(0, PAGE)
  const last = items[items.length - 1]
  return NextResponse.json(
    { comments: items, nextCursor: rows.length > PAGE && last ? encodeFeedCursor(last.createdAt, last.id) : null },
    { headers: { "Cache-Control": "private, no-store" } },
  )
}

// POST — comment on a viewable POST moment: { content }.
export async function POST(request: Request, { params }: Ctx) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()
    const userId = session.user.id
    if (isBannedRow(await getSecurityUser(userId))) return forbidden("Your account is suspended")
    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

    const { id } = await params
    const { content, source } = await request.json().catch(() => ({}))
    if (typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "Write a comment" }, { status: 400 })
    }
    if (content.length > MOMENT_COMMENT_MAX) {
      return NextResponse.json({ error: "Comment too long" }, { status: 400 })
    }

    const rl = await rateLimit(`moment-comment:${userId}`, 30, 10 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", { userId, ip: getClientIp(request), metadata: { endpoint: "moments/comments" } })
      return NextResponse.json({ error: "Slow down." }, { status: 429 })
    }

    const m = await momentInteractionTarget(id)
    if (!m || m.kind !== "POST" || !(await canViewMoment(m, userId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const linkBlock = await enforceLinkTrust(content, userId, request, "moments/comments")
    if (linkBlock) return linkBlock

    const comment = await prisma.momentComment.create({
      data: { momentId: m.id, authorId: userId, content: content.trim() },
      select: { id: true, content: true, createdAt: true, authorId: true, author: { select: publicUserSelect } },
    })

    // Product event: one per persisted comment — references the resolved
    // moment id (the original for repost URLs), never the text.
    await recordProductEvent({
      type: "INTERACTION_POSTED",
      userId,
      source: eventSource(source),
      objectType: "Moment",
      objectId: m.id,
    })

    const actor = session.user.name || "Someone"
    const link = `${momentPath(m.id)}#comment-${comment.id}`
    const audience = m.visibility === "FOLLOWERS" ? followersAudience(m.authorId) : null

    if (m.authorId !== userId) {
      await notify({
        userId: m.authorId,
        type: "COMMENT",
        title: "New comment on your post",
        content: `@${actor} commented on your post`,
        link,
        actorId: userId,
        groupKey: `moment-comment-owner:${m.id}:${userId}`,
        dedupeMs: 60 * 60 * 1000,
      })
    }
    await notifyMentions(content, userId, actor, link, "a comment", [m.authorId], audience ?? undefined)

    // Earlier commenters hear that the conversation continued — the owner
    // already got the COMMENT above; restricted posts only reach members
    // who can still open them.
    const prior = await prisma.momentComment.findMany({
      where: { momentId: m.id, deleted: false, id: { not: comment.id }, authorId: { notIn: [userId, m.authorId] } },
      select: { authorId: true },
      distinct: ["authorId"],
      take: 200,
    })
    let participants = prior.map((p) => p.authorId)
    if (audience && participants.length) {
      const allowed = await audience(participants)
      participants = participants.filter((p) => allowed.has(p))
    }
    if (participants.length) {
      await notifyMany(participants.map((uid) => ({
        userId: uid,
        type: "COMMENT" as const,
        title: "New comment on a post you commented on",
        content: `@${actor} also commented`,
        link,
        actorId: userId,
        groupKey: `moment-comment:${m.id}:${userId}`,
        dedupeMs: 60 * 60 * 1000,
      })))
    }

    return NextResponse.json({ comment }, { status: 201 })
  } catch (error) {
    console.error("Moment comment error:", error)
    return NextResponse.json({ error: "Failed to comment" }, { status: 500 })
  }
}
