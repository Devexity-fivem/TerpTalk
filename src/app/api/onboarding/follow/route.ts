import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, getClientIp, logSecurityEvent, isBanned, forbidden } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { checkMaintenance } from "@/lib/maintenance"
import { notifyMany } from "@/lib/notify"
import { TERPBOT_USERNAME } from "@/lib/terpbot"

const MAX_FOLLOWS = 10

// POST — batch-follow suggested growers during onboarding.
// { userIds: string[] } — every target is re-validated exactly like the
// single-follow endpoint: must exist, not banned, not suspended, no block
// in either direction, no self-follow. Idempotent via skipDuplicates.
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()

    if (await isBanned(session.user.id)) return forbidden()

    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

    const body = await request.json().catch(() => ({}))
    const { userIds } = body
    if (
      !Array.isArray(userIds) ||
      userIds.length === 0 ||
      userIds.length > MAX_FOLLOWS ||
      !userIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 64)
    ) {
      return NextResponse.json({ error: "Invalid user list" }, { status: 400 })
    }

    const rl = await rateLimit(`onboarding-follow:${session.user.id}`, 10, 10 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: session.user.id,
        ip: getClientIp(request),
        metadata: { endpoint: "onboarding/follow" },
      })
      return NextResponse.json({ error: "Slow down." }, { status: 429 })
    }

    const now = new Date()
    const targetIds = [...new Set(userIds)].filter((id) => id !== session.user.id)
    if (targetIds.length === 0) {
      return NextResponse.json({ ok: true, followed: 0 })
    }

    const [targets, blocks] = await Promise.all([
      prisma.user.findMany({
        where: {
          id: { in: targetIds },
          banned: false,
          OR: [{ suspendedUntil: null }, { suspendedUntil: { lt: now } }],
          profile: { isNot: { username: TERPBOT_USERNAME } },
        },
        select: { id: true },
      }),
      prisma.block.findMany({
        where: {
          OR: [
            { blockerId: session.user.id, blockedId: { in: targetIds } },
            { blockerId: { in: targetIds }, blockedId: session.user.id },
          ],
        },
        select: { blockerId: true, blockedId: true },
      }),
    ])

    const blocked = new Set(blocks.flatMap((b) => [b.blockerId, b.blockedId]))
    blocked.delete(session.user.id)
    const allowed = targets.filter((t) => !blocked.has(t.id)).map((t) => t.id)
    if (allowed.length === 0) {
      return NextResponse.json({ ok: true, followed: 0 })
    }

    const created = await prisma.follow.createMany({
      data: allowed.map((followingId) => ({ followerId: session.user.id, followingId })),
      skipDuplicates: true,
    })

    // Follow notifications — one per target, capped by MAX_FOLLOWS.
    const actorProfile = await prisma.profile.findUnique({
      where: { userId: session.user.id },
      select: { username: true },
    })
    const actorName = actorProfile?.username ?? session.user.name ?? "Someone"
    await notifyMany(
      allowed.map((userId) => ({
        userId,
        type: "FOLLOW",
        title: "New follower",
        content: `@${actorName} started following you`,
        link: actorProfile?.username ? `/u/${actorProfile.username}` : null,
        actorId: session.user.id,
        groupKey: `FOLLOW:${session.user.id}:${userId}`,
        dedupeMs: 24 * 60 * 60 * 1000,
      }))
    )

    return NextResponse.json({ ok: true, followed: created.count })
  } catch (error) {
    console.error("Onboarding follow error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
