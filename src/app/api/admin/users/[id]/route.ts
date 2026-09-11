import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/require-staff"
import { prisma } from "@/lib/prisma"
import { forbidden } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

const MAX_PAGE_SIZE = 100

// GET — detailed user data for admin user detail page
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin()
  if (!admin) return forbidden()

  const rl = await rateLimit(`admin-user-detail:${admin.id}`, 60, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const { id } = await params
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 })
  }

  const { searchParams } = new URL(request.url)
  const page = Math.max(1, Number(searchParams.get("page")) || 1)
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(searchParams.get("limit")) || 50))
  const skip = (page - 1) * limit

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      role: true,
      banned: true,
      bannedReason: true,
      suspendedUntil: true,
      createdAt: true,
      lastSeenAt: true,
      profile: {
        select: {
          username: true,
          bio: true,
          location: true,
          avatarUrl: true,
          reputation: true,
        },
      },
      _count: {
        select: {
          posts: true,
          threadCreator: true,
          diaryCreator: true,
          setupCreator: true,
          reports: true,
          chatMessages: true,
        },
      },
    },
  })

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  const [moderationHistory, reportsAgainst, reportsBy] = await Promise.all([
    prisma.moderationAction.findMany({
      where: { targetUserId: id },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip,
      include: { moderator: { select: { profile: { select: { username: true } } } } },
    }),
    prisma.report.count({ where: { reportedId: id } }),
    prisma.report.count({ where: { reporterId: id } }),
  ])

  return NextResponse.json({
    user: {
      ...user,
      moderationHistory: moderationHistory.map((a) => ({
        id: a.id,
        type: a.type,
        reason: a.reason,
        duration: a.duration,
        moderator: a.moderator.profile?.username ?? a.moderatorId,
        createdAt: a.createdAt,
      })),
      reportsAgainst,
      reportsBy,
    },
  })
}
