import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { isAdmin, forbidden } from "@/lib/security"

// GET — admin beta dashboard stats (ADMINISTRATOR only)
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!isAdmin(session.user.role)) {
    return forbidden()
  }

  const [
    users,
    bannedUsers,
    threads,
    posts,
    openReports,
    totalReports,
    moderationActions,
    invites,
    usedInvites,
    securityEvents24h,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { banned: true } }),
    prisma.thread.count({ where: { deleted: false } }),
    prisma.post.count({ where: { deleted: false } }),
    prisma.report.count({ where: { status: { in: ["PENDING", "REVIEWING"] } } }),
    prisma.report.count(),
    prisma.moderationAction.count(),
    prisma.betaInvite.count(),
    prisma.betaInvite.count({ where: { usedById: { not: null } } }),
    prisma.securityEvent.count({
      where: { createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    }),
  ])

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const activeUsers = await prisma.user.count({
    where: {
      OR: [
        { posts: { some: { createdAt: { gt: weekAgo } } } },
        { threadCreator: { some: { createdAt: { gt: weekAgo } } } },
        { chatMessages: { some: { createdAt: { gt: weekAgo } } } },
      ],
    },
  })

  return NextResponse.json({
    stats: {
      users,
      activeUsers,
      bannedUsers,
      threads,
      posts,
      openReports,
      totalReports,
      moderationActions,
      invites,
      usedInvites,
      securityEvents24h,
    },
  })
}
