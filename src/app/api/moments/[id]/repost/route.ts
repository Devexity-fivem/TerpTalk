import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma, lockUserRow } from "@/lib/prisma"
import { unauthorized, forbidden, getSecurityUser, isBannedRow, getClientIp, logSecurityEvent } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { checkMaintenance } from "@/lib/maintenance"
import { notify } from "@/lib/notify"
import { canViewMoment, momentPath } from "@/lib/moments"
import { awardProgression } from "@/lib/progression"
import { enqueueXpReversal, drainXpOne } from "@/lib/progression-outbox"
import { lockInteractionKey } from "@/lib/interaction-state"

type Ctx = { params: Promise<{ id: string }> }

// POST — toggle a pure repost of a PUBLIC post. One live pure repost per
// member per post: the existence check + create run under the member's row
// lock, so a double-click can't produce two. Reposting your own post is
// allowed (a "bump"), but never notifies.
export async function POST(request: Request, { params }: Ctx) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()
    const userId = session.user.id
    if (isBannedRow(await getSecurityUser(userId))) return forbidden("Your account is suspended")
    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

    const rl = await rateLimit(`moment-repost:${userId}`, 60, 10 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", { userId, ip: getClientIp(request), metadata: { endpoint: "moments/repost" } })
      return NextResponse.json({ error: "Slow down." }, { status: 429 })
    }

    const { id } = await params
    const target = await prisma.moment.findUnique({
      where: { id },
      select: {
        id: true, authorId: true, kind: true, visibility: true, deleted: true, expiresAt: true, repostOfId: true, content: true,
        author: { select: { banned: true, suspendedUntil: true } },
      },
    })
    // Only original PUBLIC posts are repostable — a repost of a repost
    // would chain visibility through rows the original author no longer
    // controls.
    const isPureRepost = !!target?.repostOfId && target.content.trim() === ""
    if (!target || target.kind !== "POST" || target.visibility !== "PUBLIC" || isPureRepost || !(await canViewMoment(target, userId))) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 })
    }

    // Durable reversal intent for the toggle-off path — committed inside
    // the same transaction as the delete.
    let reversalId: string | null = null
    const repostKey = `repost:${userId}:moment:${id}`
    const result = await prisma.$transaction(async (tx) => {
      // Shared per-key lock — serializes this toggle against comment/
      // follow/react transitions and the outbox reconcile for repostKey.
      await lockInteractionKey(tx, repostKey)
      await lockUserRow(tx, userId)
      const existing = await tx.moment.findFirst({
        where: { authorId: userId, repostOfId: id, content: "", deleted: false, kind: "POST" },
        select: { id: true },
      })
      if (existing) {
        await tx.moment.update({ where: { id: existing.id }, data: { deleted: true } })
        // REPOST_RECEIVED is keyed per (reposter, target) and shared with
        // quote reposts — claw it back only when this was the member's
        // last live repost of the target. Self-reposts never paid, so the
        // key can't exist for them; the check is skipped to keep the
        // outbox clean.
        if (target.authorId !== userId) {
          const remaining = await tx.moment.count({
            where: { authorId: userId, repostOfId: id, deleted: false },
          })
          if (remaining === 0) {
            reversalId = await enqueueXpReversal(tx, {
              kind: "KEY", eventKey: repostKey,
              reason: "Repost removed", requestedBy: userId,
            })
          }
        }
        return { reposted: false as const }
      }
      await tx.moment.create({ data: { kind: "POST", content: "", visibility: "PUBLIC", authorId: userId, repostOfId: id } })
      // V3: pure repost — standing to the original author, committed
      // atomically with the repost row under the key lock.
      if (target.authorId !== userId) {
        await awardProgression(target.authorId, "REPOST_RECEIVED", "Someone reposted your post", {
          actorId: userId,
          key: repostKey,
          sourceType: "MOMENT", sourceId: id,
          db: tx,
        })
      }
      return { reposted: true as const }
    })
    if (reversalId) await drainXpOne(reversalId).catch(() => false)
    const count = await prisma.moment.count({ where: { repostOfId: id, deleted: false } })

    if (result.reposted && target.authorId !== userId) {
      await notify({
        userId: target.authorId,
        type: "REACTION",
        title: "Your post was reposted",
        content: `@${session.user.name || "Someone"} reposted your post`,
        link: momentPath(id),
        actorId: userId,
        groupKey: `moment-repost:${id}`,
        dedupeMs: 24 * 60 * 60 * 1000,
      })
    }
    return NextResponse.json({ reposted: result.reposted, reposts: count })
  } catch (error) {
    console.error("Repost error:", error)
    return NextResponse.json({ error: "Failed to repost" }, { status: 500 })
  }
}
