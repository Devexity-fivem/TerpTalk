import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/require-staff"
import { prisma } from "@/lib/prisma"
import { forbidden } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { REFERRAL_MIN_AGE_HOURS, REFERRAL_MIN_REP } from "@/lib/reputation-config"

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

  // ── Referral diagnostic ─────────────────────────────────────────
  // Mirrors reconcileReferralPayouts eligibility exactly so the dashboard
  // can distinguish: new referral vs paid (keyed) vs legacy (unkeyed) vs
  // reversed vs eligible-but-unpaid. Same constants, same active-event test.
  const referralCutoff = new Date(now.getTime() - REFERRAL_MIN_AGE_HOURS * 60 * 60 * 1000)
  const [referredProfiles, referralEvents, eligibleCandidates] = await Promise.all([
    prisma.profile.count({ where: { referredById: { not: null } } }),
    prisma.reputationEvent.findMany({
      where: { type: "REFERRAL" },
      select: { key: true, userId: true, amount: true, reversedAt: true, createdAt: true },
    }),
    prisma.profile.findMany({
      where: {
        referredById: { not: null },
        reputation: { gte: REFERRAL_MIN_REP },
        user: { createdAt: { lte: referralCutoff } },
      },
      select: {
        userId: true, username: true, reputation: true, referredById: true,
        user: { select: { createdAt: true } },
      },
      take: 50,
    }),
  ])
  // Same gates as payReferralBonus: keyed payout, legacy unkeyed payout
  // (unkeyed REFERRAL on the referrer stamped at referee signup time), and
  // self-referrals all count as settled.
  const referrerIds = [...new Set(eligibleCandidates.map((c) => c.referredById).filter((x): x is string => !!x))]
  const referrers = referrerIds.length
    ? await prisma.profile.findMany({ where: { id: { in: referrerIds } }, select: { id: true, userId: true } })
    : []
  const refUserByProfileId = new Map(referrers.map((r) => [r.id, r.userId]))
  const paidKeys = new Set(
    referralEvents.filter((e) => e.key && !e.reversedAt).map((e) => e.key)
  )
  const legacyEvents = referralEvents.filter((e) => !e.key && !e.reversedAt)
  const eligibleUnpaid = eligibleCandidates.filter((c) => {
    if (paidKeys.has(`referral:${c.userId}`)) return false
    const referrerUserId = c.referredById ? refUserByProfileId.get(c.referredById) : undefined
    if (!referrerUserId || referrerUserId === c.userId) return false
    const t = c.user.createdAt.getTime()
    return !legacyEvents.some(
      (e) => e.userId === referrerUserId && e.createdAt.getTime() >= t - 60_000 && e.createdAt.getTime() <= t + 600_000
    )
  })

  // ── Cron health ─────────────────────────────────────────────────
  // runCronTask claims land as Setting rows keyed "<task>:<UTC-date>".
  // Check today + yesterday: done = value "1", pending = stale/failed claims.
  const dayKeys = [0, 1].map((d) => new Date(now.getTime() - d * 86400000).toISOString().slice(0, 10))
  const cronRows = await prisma.setting.findMany({
    where: { OR: dayKeys.map((d) => ({ key: { endsWith: `:${d}` } })) },
    select: { key: true, value: true },
  })
  const cronToday = cronRows.filter((r) => r.key.endsWith(`:${dayKeys[0]}`))

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
      referrals: {
        referredProfiles,
        paidKeyed: referralEvents.filter((e) => e.key && !e.reversedAt).length,
        legacyUnkeyed: referralEvents.filter((e) => !e.key && !e.reversedAt).length,
        reversed: referralEvents.filter((e) => e.reversedAt).length,
        eligibleUnpaid: eligibleUnpaid.map((c) => ({ username: c.username, reputation: c.reputation })),
      },
      cron: {
        date: dayKeys[0],
        tasksDone: cronToday.filter((r) => r.value === "1").length,
        tasksPending: cronToday.filter((r) => r.value !== "1").map((r) => r.key),
        lastRunDate: cronRows.length ? cronRows.map((r) => r.key.split(":").pop()!).sort().pop()! : null,
      },
    },
  })
}
