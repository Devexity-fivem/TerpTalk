import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { forbidden } from "@/lib/security"
import { requireStaff } from "@/lib/require-staff"
import { rateLimit } from "@/lib/rate-limit"

// GET ?username= — staff lookup of a member's moderation-relevant profile
export async function GET(request: Request) {
  const staff = await requireStaff()
  if (!staff) return forbidden()

  const rl = await rateLimit(`mod-user:${staff.id}`, 60, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const { searchParams } = new URL(request.url)
  const username = (searchParams.get("username") || "").trim().slice(0, 30)
  if (!username) {
    return NextResponse.json({ error: "username required" }, { status: 400 })
  }

  const profile = await prisma.profile.findFirst({
    where: { username: { equals: username, mode: "insensitive" } },
    select: {
      username: true,
      reputation: true,
      user: {
        select: {
          id: true,
          role: true,
          banned: true,
          bannedReason: true,
          createdAt: true,
          lastSeenAt: true,
          _count: {
            select: { posts: true, threadCreator: true, chatMessages: true },
          },
        },
      },
    },
  })
  if (!profile) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  const [openReports, recentActions, recentRep] = await Promise.all([
    prisma.report.count({
      where: { reportedId: profile.user.id, status: { in: ["PENDING", "REVIEWING"] } },
    }),
    prisma.moderationAction.findMany({
      where: { targetUserId: profile.user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { moderator: { select: { profile: { select: { username: true } } } } },
    }),
    prisma.reputationEvent.findMany({
      where: { userId: profile.user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, type: true, amount: true, reason: true, reversedAt: true, createdAt: true },
    }),
  ])

  return NextResponse.json({
    user: {
      id: profile.user.id,
      username: profile.username,
      role: profile.user.role,
      banned: profile.user.banned,
      bannedReason: profile.user.bannedReason,
      joined: profile.user.createdAt,
      lastSeen: profile.user.lastSeenAt,
      reputation: profile.reputation,
      stats: profile.user._count,
      openReports,
    },
    history: recentActions.map((a) => ({
      id: a.id,
      type: a.type,
      reason: a.reason,
      moderator: a.moderator.profile?.username ?? "unknown",
      createdAt: a.createdAt,
    })),
    reputation: recentRep,
  })
}
