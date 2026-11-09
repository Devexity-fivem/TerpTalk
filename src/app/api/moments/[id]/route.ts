import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, forbidden } from "@/lib/security"
import { checkMaintenance } from "@/lib/maintenance"
import { revalidateTag } from "next/cache"
import { deleteImages } from "@/lib/blob"
import { invalidateNotificationsForLink } from "@/lib/notify"
import { enqueueXpReversal, drainXpOne } from "@/lib/progression-outbox"
import { lockInteractionKeys, contentLockKey } from "@/lib/interaction-lifecycle"
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
    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance
    const { id } = await params
    const m = await prisma.moment.findUnique({ where: { id }, select: { id: true, authorId: true, deleted: true, repostOfId: true } })
    if (!m || m.deleted) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (m.authorId !== session.user.id) return forbidden()

    // Durable reversal intents — committed in the SAME transaction as the
    // delete so a crash can't strand progression on removed content.
    const reversalIds: string[] = []
    const urls = await prisma.$transaction(async (tx) => {
      // Locks BEFORE mutating: the moment content key serializes against
      // reactions/comments/reposts on this moment; the repost key (when
      // this row is itself a repost) serializes the remaining-live count
      // and KEY intent against the repost lifecycle.
      await lockInteractionKeys(tx, [
        contentLockKey("moment", id),
        ...(m.repostOfId ? [`repost:${m.authorId}:moment:${m.repostOfId}`] : []),
      ])
      await tx.moment.updateMany({ where: { id, deleted: false }, data: { deleted: true } })
      const imgs = await tx.momentImage.findMany({ where: { momentId: id }, select: { url: true } })
      await tx.momentImage.deleteMany({ where: { momentId: id } })
      // SOURCE sweeps every award attributed to this moment: MOMENT_POSTED,
      // plus the standing others earned from reactions, comments, and
      // reposts/quotes of it.
      reversalIds.push(await enqueueXpReversal(tx, {
        kind: "SOURCE", sourceType: "MOMENT", sourceId: id,
        reason: "Moment removed", requestedBy: session.user.id,
      }))
      // This row may itself be a repost/quote that GRANTED REPOST_RECEIVED
      // to the original author under a deterministic key. Reverse it only
      // when no other live repost by this member of the same target remains
      // (a quote and a pure repost share the key — deleting one of two
      // must not claw back the other's standing).
      if (m.repostOfId) {
        const remaining = await tx.moment.count({
          where: { authorId: m.authorId, repostOfId: m.repostOfId, deleted: false },
        })
        if (remaining === 0) {
          reversalIds.push(await enqueueXpReversal(tx, {
            kind: "KEY", eventKey: `repost:${m.authorId}:moment:${m.repostOfId}`,
            reason: "Repost removed", requestedBy: session.user.id,
          }))
        }
      }
      return imgs.map((i) => i.url)
    })
    for (const rid of reversalIds) await drainXpOne(rid).catch(() => false)
    await invalidateNotificationsForLink(momentPath(id))
    deleteImages(urls).catch(() => {})
    // Moments are a search type — a deleted one must stop matching.
    revalidateTag("search", { expire: 0 })
    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error("Moment delete error:", error)
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 })
  }
}
