import { prisma } from "@/lib/prisma"
import { awardReputation, reverseReputationByKey } from "@/lib/reputation"
import { reverseKeyDurable } from "@/lib/reputation-outbox"
import { notify } from "@/lib/notify"

// Weekly challenges — a fixed roster, not generated. Progress is recomputed
// server-side from existing rows (the reputation ledger and contest votes),
// so deleted/reversed activity automatically stops counting and there is no
// separate progress table to keep in sync.
//
// Design rules:
//   - Rewards are keyed/idempotent: challenge:<week>:<slug>:<userId>.
//   - Total payout ~90 rep/week — below the velocity-flag threshold.
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
  {
    slug: "help-a-newcomer",
    title: "Help a Newcomer",
    description: "Reply in 2 threads started by members under 30 days old.",
    icon: "👋",
    reward: 15,
    target: 2,
  },
  {
    slug: "close-the-loop",
    title: "Close the Loop",
    description: "Mark an accepted answer on a thread you started.",
    icon: "🔁",
    reward: 10,
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

// Inverse of currentWeekKey — reconstruct a past week's Monday 00:00 UTC
// from its "YYYY-Www" key. Jan 4 is always in ISO week 1.
export function weekStartForKey(week: string): Date | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(week)
  if (!m) return null
  const year = Number(m[1])
  const w = Number(m[2])
  if (w < 1 || w > 53) return null
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const dow = jan4.getUTCDay() || 7
  const week1Monday = new Date(jan4.getTime() - (dow - 1) * 86400000)
  return new Date(week1Monday.getTime() + (w - 1) * 7 * 86400000)
}

export interface ChallengeProgress extends ChallengeDef {
  progress: number
  done: boolean
  paid: boolean
}

// One challenge's progress inside a bounded [since, until) week window —
// extracted so the weekly reconcile sweep can re-measure a past week
// exactly. `until` bounds author-age checks to the window being measured.
async function countChallengeProgress(userId: string, slug: string, since: Date, until: Date): Promise<number> {
  switch (slug) {
    case "show-up":
      return prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(DISTINCT ("createdAt" AT TIME ZONE 'UTC')::date) AS n
        FROM "ReputationEvent"
        WHERE "userId" = ${userId} AND "type" = 'DAILY_LOGIN'
          AND "reversedAt" IS NULL AND "createdAt" >= ${since} AND "createdAt" < ${until}`.then((r) => Number(r[0]?.n ?? 0))
    case "join-the-talk":
      // "Reply in N different threads" — sourceId is the post id, so count
      // distinct threadIds via a join. Replies in one thread can't stack,
      // and replies in your OWN threads don't count — self-bumping isn't
      // joining the talk.
      return prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(DISTINCT p."threadId") AS n
        FROM "ReputationEvent" e
        JOIN "Post" p ON p."id" = e."sourceId"
        JOIN "Thread" t ON t."id" = p."threadId"
        WHERE e."userId" = ${userId} AND e."type" = 'POST_CREATED'
          AND e."reversedAt" IS NULL AND e."createdAt" >= ${since} AND e."createdAt" < ${until}
          AND p."deleted" = false AND t."deleted" = false
          AND t."authorId" <> ${userId}`.then((r) => Number(r[0]?.n ?? 0))
    case "tend-the-diary":
      return prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(DISTINCT ("createdAt" AT TIME ZONE 'UTC')::date) AS n
        FROM "ReputationEvent"
        WHERE "userId" = ${userId} AND "type" = 'DIARY_UPDATE'
          AND "reversedAt" IS NULL AND "createdAt" >= ${since} AND "createdAt" < ${until}`.then((r) => Number(r[0]?.n ?? 0))
    case "judge-the-buds":
      return prisma.$queryRaw<{ n: bigint }[]>`
        SELECT (
          (SELECT COUNT(*) FROM "ContestVote" WHERE "userId" = ${userId} AND "createdAt" >= ${since} AND "createdAt" < ${until}) +
          (SELECT COUNT(*) FROM "DiaryContestVote" WHERE "userId" = ${userId} AND "createdAt" >= ${since} AND "createdAt" < ${until})
        )::bigint AS n`.then((r) => Number(r[0]?.n ?? 0))
    case "share-the-answer":
      return prisma.reputationEvent.count({
        where: { userId, type: "HELPFUL_ANSWER", reversedAt: null, createdAt: { gte: since, lt: until } },
      })
    case "help-a-newcomer":
      // Replies in threads started by members under 30 days old (measured
      // at the window's end so a past-week recompute stays honest).
      return prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(DISTINCT p."threadId") AS n
        FROM "ReputationEvent" e
        JOIN "Post" p ON p."id" = e."sourceId"
        JOIN "Thread" t ON t."id" = p."threadId"
        JOIN "User" tu ON tu."id" = t."authorId"
        WHERE e."userId" = ${userId} AND e."type" = 'POST_CREATED'
          AND e."reversedAt" IS NULL AND e."createdAt" >= ${since} AND e."createdAt" < ${until}
          AND p."deleted" = false AND t."deleted" = false
          AND t."authorId" <> ${userId}
          AND tu."createdAt" >= ${new Date(until.getTime() - 30 * 86400000)}`.then((r) => Number(r[0]?.n ?? 0))
    case "close-the-loop":
      // Threads the member marked an accepted answer on this week —
      // rewards closing the loop, which previously only paid the answerer.
      return prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n
        FROM "ReputationEvent" e
        WHERE e."userId" = ${userId} AND e."type" = 'ACCEPT_MARKED'
          AND e."reversedAt" IS NULL AND e."createdAt" >= ${since} AND e."createdAt" < ${until}`.then((r) => Number(r[0]?.n ?? 0))
    default:
      return 0
  }
}

// Live progress for a member this week. Ledger events only count while
// unreversed — a deleted post un-earns its progress automatically.
export async function getChallengeProgress(userId: string, now = new Date()): Promise<ChallengeProgress[]> {
  const since = weekStart(now)
  const until = new Date(since.getTime() + 7 * 86400000)
  const week = currentWeekKey(now)

  const countsArr = await Promise.all(
    WEEKLY_CHALLENGES.map((c) => countChallengeProgress(userId, c.slug, since, until))
  )
  // Only unreversed payouts count as paid — a staff reversal should make
  // the challenge unpaid again (re-award reinstates via the same key).
  const paidEvents = await prisma.reputationEvent.findMany({
    where: { userId, type: "CHALLENGE_WEEKLY", key: { startsWith: `challenge:${week}:` }, reversedAt: null },
    select: { key: true },
  })
  const paid = new Set(paidEvents.map((e) => e.key))
  const counts: Record<string, number> = Object.fromEntries(
    WEEKLY_CHALLENGES.map((c, i) => [c.slug, countsArr[i] ?? 0])
  )

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
    if (c.paid && !c.done) {
      // Sticky-payout fix: a paid challenge whose qualifying content was
      // deleted un-earns the payout. Non-final — re-qualifying reinstates.
      // Durable intent — survives a failed drain.
      await reverseKeyDurable(
        `challenge:${week}:${c.slug}:${userId}`,
        "Challenge progress no longer met",
        userId
      ).catch(() => null)
      continue
    }
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
      metadata: { kind: "challenge", titles: paidTitles, reward: total },
    }).catch(() => null)
  }

  return paidTitles
}

// ── Payout reconciliation ────────────────────────────────────────────────
// Weekly twin of reconcileQuestPayouts — re-measures every recent
// challenge payout inside its closed week window and non-finally reverses
// payouts whose qualifying activity was deleted or reversed after the fact.
export async function reconcileChallengePayouts(weeks = 3): Promise<{ checked: number; reversed: number }> {
  const events = await prisma.reputationEvent.findMany({
    where: {
      type: "CHALLENGE_WEEKLY",
      reversedAt: null,
      reversalOfId: null,
      key: { startsWith: "challenge:" },
      createdAt: { gte: new Date(Date.now() - weeks * 7 * 86400000) },
    },
    select: { key: true, userId: true },
    orderBy: { createdAt: "asc" },
    take: 5000,
  })

  // Group by (userId, week): challenge:<week>:<slug>:<userId>
  const groups = new Map<string, { userId: string; week: string; slugs: Set<string> }>()
  for (const e of events) {
    if (!e.key) continue
    const parts = e.key.split(":")
    const week = parts[1]
    const slug = parts[2]
    const gk = `${e.userId}|${week}`
    const g = groups.get(gk) ?? { userId: e.userId, week, slugs: new Set() }
    g.slugs.add(slug)
    groups.set(gk, g)
  }

  let checked = 0
  let reversed = 0
  for (const g of groups.values()) {
    const since = weekStartForKey(g.week)
    if (!since) continue
    const until = new Date(since.getTime() + 7 * 86400000)
    for (const slug of g.slugs) {
      checked++
      const def = WEEKLY_CHALLENGES.find((c) => c.slug === slug)
      if (!def) continue
      const count = await countChallengeProgress(g.userId, slug, since, until)
      if (count < def.target) {
        const res = await reverseReputationByKey(
          `challenge:${g.week}:${slug}:${g.userId}`,
          "Challenge progress no longer met",
          g.userId
        ).catch(() => null)
        if (res?.reversed) reversed++
      }
    }
  }
  return { checked, reversed }
}
