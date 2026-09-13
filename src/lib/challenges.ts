import { prisma } from "@/lib/prisma"
import { awardReputation } from "@/lib/reputation"
import { notify } from "@/lib/notify"

// Weekly challenges — a fixed roster, not generated. Progress is recomputed
// server-side from existing rows (the reputation ledger and contest votes),
// so deleted/reversed activity automatically stops counting and there is no
// separate progress table to keep in sync.
//
// Design rules:
//   - Rewards are keyed/idempotent: challenge:<week>:<slug>:<userId>.
//   - Total payout ~65 rep/week — below the velocity-flag threshold.
//   - Nothing here rewards raw volume that can be spammed: replies must be
//     in different threads, diary updates on different days, and the biggest
//     reward needs a peer-accepted answer.

export interface ChallengeDef {
  slug: string
  title: string
  description: string
  icon: string
  reward: number
  target: number
}

export const WEEKLY_CHALLENGES: ChallengeDef[] = [
  {
    slug: "show-up",
    title: "Show Up",
    description: "Check in on 4 different days this week.",
    icon: "☀️",
    reward: 10,
    target: 4,
  },
  {
    slug: "join-the-talk",
    title: "Join the Talk",
    description: "Reply in 3 different threads.",
    icon: "💬",
    reward: 10,
    target: 3,
  },
  {
    slug: "tend-the-diary",
    title: "Tend the Diary",
    description: "Post grow diary updates on 2 different days.",
    icon: "🌱",
    reward: 15,
    target: 2,
  },
  {
    slug: "judge-the-buds",
    title: "Judge the Buds",
    description: "Vote in a community contest.",
    icon: "🗳️",
    reward: 10,
    target: 1,
  },
  {
    slug: "share-the-answer",
    title: "Share the Answer",
    description: "Have one of your replies marked as the accepted answer.",
    icon: "✅",
    reward: 20,
    target: 1,
  },
]

// ISO week key (UTC) — e.g. "2026-W41". Challenges reset each week.
export function currentWeekKey(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const day = d.getUTCDay() || 7 // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - day) // Thursday of this week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`
}

// UTC start of the current ISO week (Monday 00:00).
export function weekStart(now = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() - (day - 1))
  return d
}

export interface ChallengeProgress extends ChallengeDef {
  progress: number
  done: boolean
  paid: boolean
}

// Live progress for a member this week. Ledger events only count while
// unreversed — a deleted post un-earns its progress automatically.
export async function getChallengeProgress(userId: string, now = new Date()): Promise<ChallengeProgress[]> {
  const since = weekStart(now)
  const week = currentWeekKey(now)

  const [loginDays, replyThreads, diaryDays, contestVotes, answerCount, paidEvents] = await Promise.all([
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(DISTINCT ("createdAt" AT TIME ZONE 'UTC')::date) AS n
      FROM "ReputationEvent"
      WHERE "userId" = ${userId} AND "type" = 'DAILY_LOGIN'
        AND "reversedAt" IS NULL AND "createdAt" >= ${since}`,
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(DISTINCT "sourceId") AS n
      FROM "ReputationEvent"
      WHERE "userId" = ${userId} AND "type" = 'POST_CREATED'
        AND "reversedAt" IS NULL AND "createdAt" >= ${since}`,
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(DISTINCT ("createdAt" AT TIME ZONE 'UTC')::date) AS n
      FROM "ReputationEvent"
      WHERE "userId" = ${userId} AND "type" = 'DIARY_UPDATE'
        AND "reversedAt" IS NULL AND "createdAt" >= ${since}`,
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT (
        (SELECT COUNT(*) FROM "ContestVote" WHERE "userId" = ${userId} AND "createdAt" >= ${since}) +
        (SELECT COUNT(*) FROM "DiaryContestVote" WHERE "userId" = ${userId} AND "createdAt" >= ${since})
      )::bigint AS n`,
    prisma.reputationEvent.count({
      where: { userId, type: "HELPFUL_ANSWER", reversedAt: null, createdAt: { gte: since } },
    }),
    prisma.reputationEvent.findMany({
      where: { userId, type: "CHALLENGE_WEEKLY", key: { startsWith: `challenge:${week}:` } },
      select: { key: true },
    }),
  ])

  const paid = new Set(paidEvents.map((e) => e.key))
  const counts: Record<string, number> = {
    "show-up": Number(loginDays[0]?.n ?? 0),
    "join-the-talk": Number(replyThreads[0]?.n ?? 0),
    "tend-the-diary": Number(diaryDays[0]?.n ?? 0),
    "judge-the-buds": Number(contestVotes[0]?.n ?? 0),
    "share-the-answer": answerCount,
  }

  return WEEKLY_CHALLENGES.map((c) => {
    const progress = Math.min(counts[c.slug] ?? 0, c.target)
    return { ...c, progress, done: progress >= c.target, paid: paid.has(`challenge:${week}:${c.slug}:${userId}`) }
  })
}

// Evaluate + pay any completed-but-unpaid challenges. Called from the
// throttled path in /api/ping (at most once per ~15 min per user) so this
// never runs on every request. Returns the newly paid challenges.
export async function evaluateChallenges(userId: string): Promise<string[]> {
  const week = currentWeekKey()
  const progress = await getChallengeProgress(userId)
  const paidTitles: string[] = []

  for (const c of progress) {
    if (!c.done || c.paid) continue
    const res = await awardReputation(userId, "CHALLENGE_WEEKLY", c.reward, `Weekly challenge: ${c.title}`, {
      key: `challenge:${week}:${c.slug}:${userId}`,
    }).catch(() => null)
    if (res?.awarded) paidTitles.push(c.title)
  }

  if (paidTitles.length > 0) {
    const total = progress.filter((c) => paidTitles.includes(c.title)).reduce((s, c) => s + c.reward, 0)
    await notify({
      userId,
      type: "REPUTATION",
      title: paidTitles.length === 1 ? "Challenge complete" : `${paidTitles.length} challenges complete`,
      content:
        paidTitles.length === 1
          ? `You finished "${paidTitles[0]}" — +${total} reputation.`
          : `You finished: ${paidTitles.join(", ")} — +${total} reputation.`,
      link: "/reputation",
    }).catch(() => null)
  }

  return paidTitles
}
