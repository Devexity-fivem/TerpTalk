import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/require-staff"
import { prisma } from "@/lib/prisma"
import { forbidden } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { parsePageParams } from "@/lib/pagination"

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
  const { limit, skip } = parsePageParams(searchParams)

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
          xp: true,
          standing: true,
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

  const [moderationHistory, reportsAgainst, reportsBy, badges] = await Promise.all([
    prisma.moderationAction.findMany({
      where: { targetUserId: id },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip,
      include: { moderator: { select: { profile: { select: { username: true } } } } },
    }),
    prisma.report.count({ where: { reportedId: id } }),
    prisma.report.count({ where: { reporterId: id } }),
    prisma.userBadge.findMany({
      where: { userId: id },
      select: { badge: { select: { name: true } } },
    }),
  ])

  return NextResponse.json({
    user: {
      ...user,
      moderationHistory: moderationHistory.map((a) => ({
        id: a.id,
        type: a.type,
        reason: a.reason,
        duration: a.duration,
        moderator: a.moderator?.profile?.username ?? a.moderatorName ?? a.moderatorId ?? "unknown",
        createdAt: a.createdAt,
      })),
      reportsAgainst,
      reportsBy,
      badges: badges.map((b) => b.badge.name),
    },
  })
}
