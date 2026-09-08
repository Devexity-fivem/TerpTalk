import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, getClientIp, logSecurityEvent, isBanned, forbidden } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

// POST — toggle follow on a user: { userId }  (or diary: { diaryId })
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()

    const body = await request.json().catch(() => ({}))
    const { userId, diaryId } = body

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

    if (await isBanned(session.user.id)) return forbidden("Your account is suspended")

    // ---- User follow ----
    if (userId) {
      if (userId === session.user.id) {
        return NextResponse.json({ error: "Cannot follow yourself" }, { status: 400 })
      }
      const blocked = await prisma.block.findFirst({
        where: {
          OR: [
            { blockerId: session.user.id, blockedId: userId },
            { blockerId: userId, blockedId: session.user.id },
          ],
        },
      })
      if (blocked) return forbidden()

      const existing = await prisma.follow.findUnique({
        where: { followerId_followingId: { followerId: session.user.id, followingId: userId } },
      })
      if (existing) {
        await prisma.follow.delete({ where: { id: existing.id } })
        return NextResponse.json({ following: false })
      }
      await prisma.follow.create({
        data: { followerId: session.user.id, followingId: userId },
      })
      await prisma.notification.create({
        data: {
          userId,
          type: "FOLLOW",
          title: "New follower",
          content: "Someone started following you",
          link: `/u/${session.user.name}`,
        },
      }).catch(() => {})
      return NextResponse.json({ following: true })
    }

    // ---- Diary follow ----
    const existing = await prisma.diaryFollow.findUnique({
      where: { userId_diaryId: { userId: session.user.id, diaryId } },
    })
    if (existing) {
      await prisma.diaryFollow.delete({ where: { id: existing.id } })
      return NextResponse.json({ following: false })
    }
    await prisma.diaryFollow.create({ data: { userId: session.user.id, diaryId } })
    return NextResponse.json({ following: true })
  } catch (error) {
    console.error("Follow error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
