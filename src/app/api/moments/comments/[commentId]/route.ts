import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, forbidden } from "@/lib/security"
import { commentLinkWhere } from "@/lib/notify"

type Ctx = { params: Promise<{ commentId: string }> }

// DELETE — remove your own comment, or a comment on your own post (the
// post author curates their thread). Soft-delete for moderation/audit;
// COMMENT + MENTION notifications share the `#comment-<id>` link.
export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()
    const { commentId } = await params
    const c = await prisma.momentComment.findUnique({
      where: { id: commentId },
      select: { id: true, authorId: true, deleted: true, moment: { select: { authorId: true } } },
    })
    if (!c || c.deleted) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (c.authorId !== session.user.id && c.moment.authorId !== session.user.id) return forbidden()

    await prisma.$transaction(async (tx) => {
      await tx.momentComment.updateMany({ where: { id: commentId, deleted: false }, data: { deleted: true } })
      await tx.notification.deleteMany({ where: commentLinkWhere(commentId) })
    })
    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error("Moment comment delete error:", error)
    return NextResponse.json({ error: "Failed to delete comment" }, { status: 500 })
  }
}
