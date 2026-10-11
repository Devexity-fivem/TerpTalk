import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { unauthorized, getClientIp, logSecurityEvent, getSecurityUser, isBannedRow, forbidden, blockExistsBetween } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { checkMaintenance } from "@/lib/maintenance"
import { notify } from "@/lib/notify"
import { TERPBOT_USERNAME } from "@/lib/terpbot-constants"
import { canViewDiary } from "@/lib/diary-visibility"
import { eventSource } from "@/lib/event-sources"
import { recordProductEvent } from "@/lib/product-events"

// POST — toggle follow on a user: { userId }  (or diary: { diaryId })
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()

    const securityUser = await getSecurityUser(session.user.id)
    if (isBannedRow(securityUser)) return forbidden()

    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

    const body = await request.json().catch(() => ({}))
    const { userId, diaryId } = body
    // Attribution surface — allowlist-validated; never a URL or free text.
    const source = eventSource(body.source) ?? "unknown"

    if ((!userId && !diaryId) || (userId && diaryId)) {
      return NextResponse.json({ error: "Provide userId or diaryId" }, { status: 400 })
    }

    const rl = await rateLimit(`follow:${session.user.id}`, 60, 10 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: session.user.id,
        ip: getClientIp(request),
        metadata: { endpoint: "follows" },
      })
      return NextResponse.json({ error: "Slow down." }, { status: 429 })
    }

    if (isBannedRow(securityUser)) return forbidden("Your account is suspended")

    // ---- User follow ----
    if (userId) {
      if (userId === session.user.id) {
        return NextResponse.json({ error: "Cannot follow yourself" }, { status: 400 })
      }

      const targetUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { banned: true, profile: { select: { username: true } } },
      })
      if (!targetUser || targetUser.banned || targetUser.profile?.username === TERPBOT_USERNAME) {
        return NextResponse.json({ error: "User not found" }, { status: 404 })
      }

      if (await blockExistsBetween(session.user.id, userId)) return forbidden()

      const existing = await prisma.follow.findUnique({
        where: { followerId_followingId: { followerId: session.user.id, followingId: userId } },
      })
      if (existing) {
        await prisma.follow.delete({ where: { id: existing.id } })
        return NextResponse.json({ following: false })
      }
      try {
        await prisma.follow.create({
          data: { followerId: session.user.id, followingId: userId },
        })
      } catch (e) {
        // Double-click race: the parallel request already created it.
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e
      }
      // Product events are best-effort and never block the response.
      // FIRST_FOLLOW's keyed upsert makes "exactly once per member"
      // durable even if the count check races a parallel follow.
      const [followCount, diaryFollowCount] = await Promise.all([
        prisma.follow.count({ where: { followerId: session.user.id } }),
        prisma.diaryFollow.count({ where: { userId: session.user.id } }),
      ])
      await recordProductEvent({
        type: "FOLLOW_CREATED", userId: session.user.id, source,
        objectType: "User", objectId: userId,
      })
      if (followCount === 1 && diaryFollowCount === 0) {
        await recordProductEvent({
          type: "FIRST_FOLLOW", userId: session.user.id, source,
          objectType: "User", objectId: userId, key: `ff:${session.user.id}`,
        })
      }
      const actorProfile = await prisma.profile.findUnique({
        where: { userId: session.user.id },
        select: { username: true },
      })
      const actorName = actorProfile?.username ?? session.user.name ?? "Someone"
      await notify({
        userId,
        type: "FOLLOW",
        title: "New follower",
        content: `@${actorName} started following you`,
        link: actorProfile?.username ? `/u/${actorProfile.username}` : null,
        actorId: session.user.id,
        groupKey: `FOLLOW:${session.user.id}:${userId}`,
        dedupeMs: 24 * 60 * 60 * 1000,
      })
      return NextResponse.json({ following: true })
    }

    // ---- Diary follow ----
    const diary = await prisma.growDiary.findUnique({
      where: { id: diaryId, deleted: false },
      select: { authorId: true, visibility: true },
    })
    if (!diary || !canViewDiary(diary, session.user.id)) {
      return NextResponse.json({ error: "Diary not found" }, { status: 404 })
    }
    if (await blockExistsBetween(session.user.id, diary.authorId)) return forbidden()

    const existing = await prisma.diaryFollow.findUnique({
      where: { userId_diaryId: { userId: session.user.id, diaryId } },
    })
    if (existing) {
      await prisma.diaryFollow.delete({ where: { id: existing.id } })
      return NextResponse.json({ following: false })
    }
    try {
      await prisma.diaryFollow.create({ data: { userId: session.user.id, diaryId } })
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e
    }
    const [followCount, diaryFollowCount] = await Promise.all([
      prisma.follow.count({ where: { followerId: session.user.id } }),
      prisma.diaryFollow.count({ where: { userId: session.user.id } }),
    ])
    await recordProductEvent({
      type: "FOLLOW_CREATED", userId: session.user.id, source,
      objectType: "Diary", objectId: diaryId,
    })
    if (followCount === 0 && diaryFollowCount === 1) {
      await recordProductEvent({
        type: "FIRST_FOLLOW", userId: session.user.id, source,
        objectType: "Diary", objectId: diaryId, key: `ff:${session.user.id}`,
      })
    }
    return NextResponse.json({ following: true })
  } catch (error) {
    console.error("Follow error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
