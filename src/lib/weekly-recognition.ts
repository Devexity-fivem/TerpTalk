/**
 * Weekly recognition — windowed boards any member can win.
 *
 * Ranking metric is net reputation earned inside the ISO week (the ledger
 * already nets out reversals, so deleted content can't hold a spot). The
 * window resets weekly so all-time totals never gate the board — a new
 * member's good week can beat an old account's quiet one.
 *
 * "Grower of the Week" resolves once per week through the TerpBot cron —
 * same pattern as contest winners — and pays a keyed WEEKLY_AWARD plus the
 * badge, both idempotent per (week, winner).
 */
import { prisma } from "@/lib/prisma"
import { rankableProfile } from "@/lib/security"
import { awardReputation, grantBadge } from "@/lib/reputation"
import { getBooleanSetting, SITE_SETTINGS } from "@/lib/settings"

// [start, end) UTC range for an ISO week key "YYYY-Www".
export function weekRange(key: string): { start: Date; end: Date } | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(key)
  if (!m) return null
  const year = Number(m[1])
  const week = Number(m[2])
  if (week < 1 || week > 53) return null
  // Jan 4 is always in ISO week 1; that week's Monday anchors the count.
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const dow = jan4.getUTCDay() || 7
  const week1Monday = new Date(jan4.getTime() - (dow - 1) * 86400000)
  const start = new Date(week1Monday.getTime() + (week - 1) * 7 * 86400000)
  return { start, end: new Date(start.getTime() + 7 * 86400000) }
}

const WEEKLY_SELECT = {
  username: true,
  avatarUrl: true,
  reputation: true,
  publicMilestoneOptOut: true,
  user: {
    select: {
      id: true,
      name: true,
      role: true,
      createdAt: true,
      _count: {
        select: { threadCreator: true, posts: true, diaryCreator: true, following: true },
      },
    },
  },
} as const

export interface WeeklyRow {
  userId: string
  earned: number
  profile: {
    username: string
    avatarUrl: string | null
    reputation: number
    publicMilestoneOptOut: boolean
    user: {
      id: string
      name: string | null
      role: string
      createdAt: Date
      _count: { threadCreator: number; posts: number; diaryCreator: number; following: number }
    }
  }
}

// Types that measure standing, not activity — excluded so a reversal
// cleanup or a staff adjustment can't swing the board.
const EXCLUDED_TYPES = ["REVERSAL", "REINSTATE", "STAFF_ADJUSTMENT", "MILESTONE", "LEGACY_MIGRATION"]

async function weeklyEarned(
  start: Date,
  end: Date,
  extraUserWhere: Record<string, unknown> = {},
  take = 25
): Promise<WeeklyRow[]> {
  const groups = await prisma.reputationEvent.groupBy({
    by: ["userId"],
    where: {
      createdAt: { gte: start, lt: end },
      type: { notIn: EXCLUDED_TYPES },
      user: extraUserWhere,
    },
    _sum: { amount: true },
    orderBy: { _sum: { amount: "desc" } },
    take: take * 4, // over-fetch: visibility filter can drop rows
  })
  const groupsFiltered = groups.filter((g) => (g._sum.amount ?? 0) > 0)
  if (groupsFiltered.length === 0) return []

  const profiles = await prisma.profile.findMany({
    where: { ...rankableProfile(), user: { id: { in: groupsFiltered.map((g) => g.userId) } } },
    select: WEEKLY_SELECT,
  })
  const byUser = new Map(profiles.map((p) => [p.user.id, p]))
  const rows: WeeklyRow[] = []
  for (const g of groupsFiltered) {
    const profile = byUser.get(g.userId)
    if (profile) rows.push({ userId: g.userId, earned: g._sum.amount ?? 0, profile })
    if (rows.length >= take) break
  }
  return rows
}

/** Everyone's board — net rep earned this ISO week. */
export function weeklyBoard(start: Date, end: Date) {
  return weeklyEarned(start, end)
}

/**
 * Best New Growers — same weekly window, restricted to accounts under 30
 * days old at query time so established members can't crowd it out.
 */
export function weeklyNewGrowers(start: Date, end: Date, now = new Date()) {
  return weeklyEarned(start, end, { createdAt: { gte: new Date(now.getTime() - 30 * 86400000) } }, 10)
}

export const GROWER_OF_THE_WEEK_REP = 50

/**
 * Resolve last week's winner: top weekly earner among rankable members.
 * Badge + keyed rep are idempotent — safe to run repeatedly. Returns the
 * winner's username for the TerpBot announcement (null when opted out of
 * public status).
 */
export async function resolveWeeklyRecognition(week: string): Promise<{ username: string | null; userId: string } | null> {
  if (!(await getBooleanSetting(SITE_SETTINGS.WEEKLY_RECOGNITION_ENABLED, true))) return null
  const range = weekRange(week)
  if (!range) return null

  const board = await weeklyEarned(range.start, range.end, {}, 1)
  const winner = board[0]
  if (!winner) return null

  await grantBadge(winner.userId, "Grower of the Week", {
    content: `You earned the most reputation in ${week} — Grower of the Week.`,
    link: "/leaderboard?tab=week",
    announce: true,
  }).catch(() => false)

  await awardReputation(
    winner.userId,
    "WEEKLY_AWARD",
    GROWER_OF_THE_WEEK_REP,
    `Grower of the Week — ${week}`,
    { key: `weekly:gotw:${week}:${winner.userId}`, sourceType: "WEEK", sourceId: week }
  ).catch(() => {})

  return {
    userId: winner.userId,
    username: winner.profile.publicMilestoneOptOut
      ? null
      : winner.profile.username ?? winner.profile.user.name,
  }
}
