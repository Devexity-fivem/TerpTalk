import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/require-staff"
import { prisma } from "@/lib/prisma"
import { forbidden } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

const ALLOWED_RANGES = new Set(["today", "7", "30", "all"])

// GET — admin dashboard stats with time-range support (ADMINISTRATOR only)
// ?range=today | 7 | 30 | all
export async function GET(request: Request) {
  const admin = await requireAdmin()
  if (!admin) {
    return forbidden()
  }

  const rl = await rateLimit(`admin-stats:${admin.id}`, 10, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const { searchParams } = new URL(request.url)
  const range = searchParams.get("range") || "7"
  if (!ALLOWED_RANGES.has(range)) {
    return NextResponse.json({ error: "Invalid range" }, { status: 400 })
  }
  const now = new Date()
  let since = new Date(0)

  if (range === "today") {
    since = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  } else if (range === "7") {
    since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  } else if (range === "30") {
    since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  }

  const [
    users,
    newUsers,
    bannedUsers,
    activeUsers,
    threads,
    newThreads,
    posts,
    newPosts,
    diaryUpdates,
    setups,
    newSetups,
    images,
    openReports,
    reviewingReports,
    escalatedReports,
    resolvedReports,
    dismissedReports,
    moderationActions,
    newModerationActions,
    securityEvents24h,
    newSecurityEvents,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gt: since } } }),
    prisma.user.count({ where: { banned: true } }),
    prisma.user.count({
      where: {
        OR: [
          { posts: { some: { createdAt: { gt: since } } } },
          { threadCreator: { some: { createdAt: { gt: since } } } },
          { chatMessages: { some: { createdAt: { gt: since } } } },
        ],
      },
    }),
    prisma.thread.count({ where: { deleted: false } }),
    prisma.thread.count({ where: { deleted: false, createdAt: { gt: since } } }),
    prisma.post.count({ where: { deleted: false } }),
    prisma.post.count({ where: { deleted: false, createdAt: { gt: since } } }),
    prisma.diaryUpdate.count({ where: { createdAt: { gt: since } } }),
    prisma.growSetup.count({ where: { deleted: false } }),
    prisma.growSetup.count({ where: { deleted: false, createdAt: { gt: since } } }),
    Promise.all([
      prisma.postImage.count({ where: { createdAt: { gt: since } } }),
      prisma.diaryImage.count({ where: { createdAt: { gt: since } } }),
      prisma.setupImage.count({ where: { createdAt: { gt: since } } }),
      prisma.strainPhoto.count({ where: { createdAt: { gt: since } } }),
      prisma.contestEntry.count({ where: { createdAt: { gt: since } } }),
    ]).then((counts) => counts.reduce((a, b) => a + b, 0)),
    prisma.report.count({ where: { status: "PENDING" } }),
    prisma.report.count({ where: { status: "REVIEWING" } }),
    prisma.report.count({ where: { status: "ESCALATED" } }),
    prisma.report.count({ where: { status: "RESOLVED" } }),
    prisma.report.count({ where: { status: "DISMISSED" } }),
    prisma.moderationAction.count(),
    prisma.moderationAction.count({ where: { createdAt: { gt: since } } }),
    prisma.securityEvent.count({
      where: { createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    }),
    prisma.securityEvent.count({ where: { createdAt: { gt: since } } }),
  ])

  return NextResponse.json({
    range,
    stats: {
      users,
      newUsers,
      activeUsers,
      bannedUsers,
      pendingBans: bannedUsers,
      threads,
      newThreads,
      posts,
      newPosts,
      diaryUpdates,
      setups,
      newSetups,
      images,
      openReports,
      reviewingReports,
      escalatedReports,
      resolvedReports,
      dismissedReports,
      moderationActions,
      newModerationActions,
      securityEvents24h,
      newSecurityEvents,
    },
  })
}
