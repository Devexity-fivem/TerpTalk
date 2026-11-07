import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, forbidden, getClientIp, logSecurityEvent } from "@/lib/security"
import { checkMaintenance } from "@/lib/maintenance"
import { rateLimit } from "@/lib/rate-limit"
import { commentLinkWhere } from "@/lib/notify"
import { enqueueXpReversal, drainXpOne } from "@/lib/progression-outbox"

type Ctx = { params: Promise<{ commentId: string }> }

// DELETE — remove your own comment, or a comment on your own post (the
// post author curates their thread). Soft-delete for moderation/audit;
// COMMENT + MENTION notifications share the `#comment-<id>` link.
export async function DELETE(request: Request, { params }: Ctx) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()

    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

    // Per-author bound before the comment lookup — a limited caller gets
    // 429 regardless of commentId existence, so the bucket adds no oracle.
    // Same shape as comment creation (moment-comment: 30/10min).
    const rl = await rateLimit(`moment-comment-del:${session.user.id}`, 30, 10 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", { userId: session.user.id, ip: getClientIp(request), metadata: { endpoint: "moments/comments delete" } })
      return NextResponse.json({ error: "Slow down." }, { status: 429 })
    }

    const { commentId } = await params
    const c = await prisma.momentComment.findUnique({
      where: { id: commentId },
      select: { id: true, authorId: true, deleted: true, momentId: true, moment: { select: { authorId: true } } },
    })
    if (!c || c.deleted) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (c.authorId !== session.user.id && c.moment.authorId !== session.user.id) return forbidden()

    // Durable reversal intent — committed in the same transaction as the
    // delete. COMMENT_RECEIVED is keyed per (commenter, moment), not per
    // comment: claw it back only when the commenter's LAST live comment on
    // this moment is going away. Self-comments never paid, so the key
    // can't exist for them.
    let reversalId: string | null = null
    await prisma.$transaction(async (tx) => {
      await tx.momentComment.updateMany({ where: { id: commentId, deleted: false }, data: { deleted: true } })
      await tx.notification.deleteMany({ where: commentLinkWhere(commentId) })
      if (c.authorId !== c.moment.authorId) {
        const remaining = await tx.momentComment.count({
          where: { momentId: c.momentId, authorId: c.authorId, deleted: false },
        })
        if (remaining === 0) {
          reversalId = await enqueueXpReversal(tx, {
            kind: "KEY", eventKey: `comment:${c.authorId}:moment:${c.momentId}`,
            reason: "Comment removed", requestedBy: session.user.id,
          })
        }
      }
    })
    if (reversalId) await drainXpOne(reversalId).catch(() => false)
    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error("Moment comment delete error:", error)
    return NextResponse.json({ error: "Failed to delete comment" }, { status: 500 })
  }
}
