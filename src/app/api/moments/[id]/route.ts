import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, forbidden } from "@/lib/security"
import { deleteImages } from "@/lib/blob"
import { invalidateNotificationsForLink } from "@/lib/notify"
import { getMomentForViewer, momentPath } from "@/lib/moments"

type Ctx = { params: Promise<{ id: string }> }

// GET — one moment for the current viewer; uniform 404 when not viewable.
export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params
  const session = await getServerSession(authOptions)
  const moment = await getMomentForViewer(id, session?.user?.id ?? null)
  if (!moment) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ moment }, { headers: { "Cache-Control": "private, no-store" } })
}

// DELETE — the author removes their own moment. Soft-delete keeps the row
// for moderation/audit; photos are deleted outright (rows + blobs) since
// deleted member media must not outlive the post. Pure reposts disappear
// through the canonical predicate; notifications pointing at the moment
// (comments, mentions, quotes) are swept.
export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()
    const { id } = await params
    const m = await prisma.moment.findUnique({ where: { id }, select: { id: true, authorId: true, deleted: true } })
    if (!m || m.deleted) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (m.authorId !== session.user.id) return forbidden()

    const urls = await prisma.$transaction(async (tx) => {
      await tx.moment.updateMany({ where: { id, deleted: false }, data: { deleted: true } })
      const imgs = await tx.momentImage.findMany({ where: { momentId: id }, select: { url: true } })
      await tx.momentImage.deleteMany({ where: { momentId: id } })
      return imgs.map((i) => i.url)
    })
    await invalidateNotificationsForLink(momentPath(id))
    deleteImages(urls).catch(() => {})
    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error("Moment delete error:", error)
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 })
  }
}
