import { prisma } from "@/lib/prisma"
import { awardProgression } from "@/lib/progression"
import { notify } from "@/lib/notify"

// Garden streaks — consecutive UTC days with a daily check-in.
//
// The streak is DERIVED from the ledger, not stored: every check-in writes
// one keyed DAILY_LOGIN marker row per UTC day, so a distinct-day scan is
// the whole state. Reversed check-ins stop counting automatically, and a
// missed day just ends the run — no punishment, no decay, no schema.
//
// V2 (design §10.4 / D6): check-ins pay 0 XP permanently. Milestone
// crossings write a once-ever STREAK_MILESTONE marker row (keyed
// streak:<days>:<uid>) — an auditable anchor the utility-reward grants
// (achievement steps, temp quest slots, cosmetics) attach to — plus a
// notification. No currency moves.
//
// Check-in days are read from BOTH ledgers (UNION): legacy DAILY_LOGIN
// ReputationEvent rows were frozen at the V2 cutover, so members keep the
// streak they had instead of restarting at zero.

export const STREAK_MILESTONE_DAYS = [3, 7, 14, 30, 60, 100, 365] as const

// Current consecutive-day streak ending today or yesterday. A member who
// hasn't checked in today yet still shows their live streak until UTC
// midnight passes without one.
export async function getCheckinStreak(userId: string, now = new Date()): Promise<number> {
  const rows = await prisma.$queryRaw<{ day: Date }[]>`
    SELECT DISTINCT day FROM (
      SELECT ("createdAt" AT TIME ZONE 'UTC')::date AS day
      FROM "ReputationEvent"
      WHERE "userId" = ${userId} AND "type" = 'DAILY_LOGIN' AND "reversedAt" IS NULL
      UNION
      SELECT ("createdAt" AT TIME ZONE 'UTC')::date
      FROM "ProgressionEvent"
      WHERE "userId" = ${userId} AND "type" = 'DAILY_LOGIN' AND "reversedAt" IS NULL
    ) d
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

// Next milestone the streak hasn't reached — for "X days to the next
// marker" copy.
export function nextStreakMilestone(streak: number): { days: number } | null {
  const days = STREAK_MILESTONE_DAYS.find((d) => streak < d)
  return days === undefined ? null : { days }
}

// Mark any streak milestones the current streak has newly crossed. Called
// from /api/ping's deferred block on the same cadence as quests — right
// after today's check-in marker lands. Returns the milestone lengths that
// were newly recorded this call (for tests).
export async function evaluateStreaks(userId: string): Promise<number[]> {
  const streak = await getCheckinStreak(userId)
  if (streak === 0) return []

  const paid: number[] = []
  for (const days of STREAK_MILESTONE_DAYS) {
    if (streak < days) break
    const res = await awardProgression(
      userId,
      "STREAK_MILESTONE",
      `${days}-day check-in streak`,
      { key: `streak:${days}:${userId}`, xp: 0, mastery: null, marker: true }
    ).catch(() => null)
    if (res?.awarded) paid.push(days)
  }
  if (paid.length === 0) return []

  const top = paid[paid.length - 1]
  await notify({
    userId,
    type: "REPUTATION",
    title: `${top}-day streak`,
    content: `Your garden streak hit ${top} days. Keep showing up — streak milestones unlock utility, not XP.`,
    link: "/progress",
    metadata: { kind: "streak", days: top },
  }).catch(() => null)
  return paid
}
