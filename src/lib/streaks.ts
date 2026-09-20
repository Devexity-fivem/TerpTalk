import { prisma } from "@/lib/prisma"
import { awardReputation } from "@/lib/reputation"
import { notify } from "@/lib/notify"
import { STREAK_MILESTONES } from "@/lib/reputation-config"

// Garden streaks — consecutive UTC days with a daily check-in.
//
// The streak is DERIVED from the DAILY_LOGIN ledger, not stored: every
// check-in already writes one keyed ReputationEvent per UTC day, so a
// distinct-day scan is the whole state. Reversed check-ins stop counting
// automatically (reversedAt filter), and a missed day just ends the run —
// no punishment, no decay, no schema.
//
// Milestone bonuses are once-ever per member, keyed `streak:<days>:<uid>`:
// a broken streak that re-climbs doesn't repay old rungs, but reaching a
// new personal-best length does. Payouts (~1k rep lifetime total) are far
// under the velocity flag.

// Current consecutive-day streak ending today or yesterday. A member who
// hasn't checked in today yet still shows their live streak until UTC
// midnight passes without one.
export async function getCheckinStreak(userId: string, now = new Date()): Promise<number> {
  const rows = await prisma.$queryRaw<{ day: Date }[]>`
    SELECT DISTINCT ("createdAt" AT TIME ZONE 'UTC')::date AS day
    FROM "ReputationEvent"
    WHERE "userId" = ${userId}
      AND "type" = 'DAILY_LOGIN'
      AND "reversedAt" IS NULL
    ORDER BY day DESC
    LIMIT 400`
  const days = new Set(rows.map((r) => new Date(r.day).toISOString().slice(0, 10)))

  let cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  if (!days.has(cursor.toISOString().slice(0, 10))) {
    // No check-in today yet — the streak survives only through yesterday.
    cursor = new Date(cursor.getTime() - 86_400_000)
    if (!days.has(cursor.toISOString().slice(0, 10))) return 0
  }
  let streak = 0
  while (days.has(cursor.toISOString().slice(0, 10))) {
    streak++
    cursor = new Date(cursor.getTime() - 86_400_000)
  }
  return streak
}

// Next milestone the streak hasn't reached — for "X days to +Y rep" copy.
export function nextStreakMilestone(streak: number): { days: number; reward: number } | null {
  return STREAK_MILESTONES.find((m) => streak < m.days) ?? null
}

// Pay any streak milestones the current streak has newly crossed. Called
// from /api/ping's deferred block on the same cadence as quests — i.e.
// right after today's check-in award lands. Returns the milestone lengths
// that paid this call (for tests).
export async function evaluateStreaks(userId: string): Promise<number[]> {
  const streak = await getCheckinStreak(userId)
  if (streak === 0) return []

  const paid: number[] = []
  for (const m of STREAK_MILESTONES) {
    if (streak < m.days) break
    const res = await awardReputation(
      userId,
      "STREAK_BONUS",
      m.reward,
      `${m.days}-day check-in streak`,
      { key: `streak:${m.days}:${userId}` }
    ).catch(() => null)
    if (res?.awarded) paid.push(m.days)
  }
  if (paid.length === 0) return []

  const top = paid[paid.length - 1]
  const reward = STREAK_MILESTONES.filter((m) => paid.includes(m.days)).reduce((s, m) => s + m.reward, 0)
  await notify({
    userId,
    type: "REPUTATION",
    title: `${top}-day streak`,
    content: `Your garden streak hit ${top} days — +${reward} reputation. Keep showing up.`,
    link: "/progress",
    metadata: { kind: "streak", days: top, reward },
  }).catch(() => null)
  return paid
}
