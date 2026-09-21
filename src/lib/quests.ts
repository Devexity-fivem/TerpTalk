import { prisma } from "@/lib/prisma"
import { awardReputation, reverseReputationByKey } from "@/lib/reputation"
import { reverseKeyDurable } from "@/lib/reputation-outbox"
import { getReputationTier } from "@/lib/reputation-config"
import { notify } from "@/lib/notify"

// Daily quests — a small deterministic rotation, not generated content.
// Three quests per member per UTC day, picked by hashing (dayKey, userId,
// slug) so every member sees a different-but-fair mix with no tables and
// no world-boss rush. Missed quests simply expire — no streaks, no guilt.
//
// Same design contract as weekly challenges (lib/challenges.ts):
//   - Progress is recomputed server-side from the ledger and live rows, so
//     deleted/reversed activity un-earns progress automatically.
//   - Payouts are keyed/idempotent: quest:<day>:<slug>:<userId>.
//   - Every quest requires distinct threads/days/members or a peer action —
//     there is no "post N replies" quest anywhere.
//   - Total daily income (~30 rep) stays far under the velocity flag.

export interface QuestDef {
  slug: string
  title: string
  description: string
  icon: string
  reward: number
  target: number
}

export const DAILY_QUESTS: QuestDef[] = [
  {
    slug: "lend-a-hand",
    title: "Lend a Hand",
    description: "Reply in a thread you didn't start.",
    icon: "🤝",
    reward: 8,
    target: 1,
  },
  {
    slug: "tend-the-garden",
    title: "Tend the Garden",
    description: "Post a grow diary update.",
    icon: "🌱",
    reward: 5,
    target: 1,
  },
  {
    slug: "spread-the-love",
    title: "Spread the Love",
    description: "Like posts or diaries from 3 different growers.",
    icon: "💚",
    reward: 5,
    target: 3,
  },
  {
    slug: "judges-eye",
    title: "Judge's Eye",
    description: "Vote in a community contest.",
    icon: "🗳️",
    reward: 5,
    target: 1,
  },
  {
    slug: "show-your-grow",
    title: "Show Your Grow",
    description: "Share a strain or grow photo.",
    icon: "📸",
    reward: 8,
    target: 1,
  },
  {
    slug: "welcome-wagon",
    title: "Welcome Wagon",
    description: "Reply in a thread started by a new member (under 14 days).",
    icon: "👋",
    reward: 10,
    target: 1,
  },
  {
    slug: "ask-the-garden",
    title: "Ask the Garden",
    description: "Start a discussion thread.",
    icon: "❓",
    reward: 8,
    target: 1,
  },
  {
    slug: "deep-dive",
    title: "Deep Dive",
    description: "Write a reply of 200+ characters.",
    icon: "🔬",
    reward: 10,
    target: 1,
  },
  {
    slug: "green-thumb",
    title: "Green Thumb",
    description: "Receive likes from 3 different growers today.",
    icon: "👍",
    reward: 10,
    target: 3,
  },
  {
    slug: "check-the-setup",
    title: "Check the Setup",
    description: "Create a grow setup showcase.",
    icon: "💡",
    reward: 8,
    target: 1,
  },
]

// Base 2/day — quests are seasoning, not the main progression loop.
// Higher tiers unlock extra slots (TierPerks.questSlots) — a real income
// perk, since each slot is a fresh rep opportunity every day.
export const DAILY_QUEST_COUNT = 2
export const PERFECT_DAY_BONUS = 5

// UTC day key — e.g. "2026-04-20". Quests reset each day.
export function currentDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

function hash32(input: string): number {
  let h = 5381
  for (let i = 0; i < input.length; i++) {
    h = ((h * 33) ^ input.charCodeAt(i)) >>> 0
  }
  return h
}

// Deterministic daily selection: sort the pool by hash(dayKey + userId +
// slug) and take the first N. Stable for the day, different per member,
// impossible to influence client-side.
export function dailyQuestsFor(userId: string, dayKey = currentDayKey(), count = DAILY_QUEST_COUNT): QuestDef[] {
  return [...DAILY_QUESTS]
    .sort((a, b) => hash32(`${dayKey}:${userId}:${a.slug}`) - hash32(`${dayKey}:${userId}:${b.slug}`))
    .slice(0, count)
}

export interface QuestProgress extends QuestDef {
  progress: number
  done: boolean
  paid: boolean
}

// One quest's progress inside a bounded [since, until) window. Extracted
// from getQuestProgress so the daily reconcile sweep can re-measure a past
// day exactly — an open-ended `>= since` would count activity that arrived
// after the day closed.
async function countQuestProgress(userId: string, slug: string, since: Date, until: Date): Promise<number> {
  switch (slug) {
    case "lend-a-hand":
      // Reply in a thread you didn't start — self-replies don't count.
      return prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(DISTINCT p."threadId") AS n
        FROM "ReputationEvent" e
        JOIN "Post" p ON p."id" = e."sourceId"
        JOIN "Thread" t ON t."id" = p."threadId"
        WHERE e."userId" = ${userId} AND e."type" = 'POST_CREATED'
          AND e."reversedAt" IS NULL AND e."createdAt" >= ${since} AND e."createdAt" < ${until}
          AND p."deleted" = false AND t."deleted" = false
          AND t."authorId" <> ${userId}`.then((r) => Number(r[0]?.n ?? 0))
    case "tend-the-garden":
      return prisma.reputationEvent.count({
        where: { userId, type: "DIARY_UPDATE", reversedAt: null, createdAt: { gte: since, lt: until } },
      })
    case "spread-the-love":
      // Likes GIVEN to distinct authors — prosocial, trivial payout.
      return prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(DISTINCT COALESCE(p."authorId", d."authorId")) AS n
        FROM "Reaction" r
        LEFT JOIN "Post" p ON p."id" = r."postId"
        LEFT JOIN "GrowDiary" d ON d."id" = r."diaryId"
        WHERE r."userId" = ${userId} AND r."type" = 'LIKE'
          AND r."createdAt" >= ${since} AND r."createdAt" < ${until}
          AND COALESCE(p."authorId", d."authorId") IS NOT NULL
          AND COALESCE(p."authorId", d."authorId") <> ${userId}`.then((r) => Number(r[0]?.n ?? 0))
    case "judges-eye":
      return prisma.$queryRaw<{ n: bigint }[]>`
        SELECT (
          (SELECT COUNT(*) FROM "ContestVote" WHERE "userId" = ${userId} AND "createdAt" >= ${since} AND "createdAt" < ${until}) +
          (SELECT COUNT(*) FROM "DiaryContestVote" WHERE "userId" = ${userId} AND "createdAt" >= ${since} AND "createdAt" < ${until})
        )::bigint AS n`.then((r) => Number(r[0]?.n ?? 0))
    case "show-your-grow":
      return prisma.reputationEvent.count({
        where: { userId, type: "STRAIN_PHOTO", reversedAt: null, createdAt: { gte: since, lt: until } },
      })
    case "welcome-wagon":
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
          AND tu."createdAt" >= ${new Date(since.getTime() - 14 * 86400000)}`.then((r) => Number(r[0]?.n ?? 0))
    case "ask-the-garden":
      return prisma.reputationEvent.count({
        where: { userId, type: "THREAD_CREATED", reversedAt: null, createdAt: { gte: since, lt: until } },
      })
    case "deep-dive":
      return prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n
        FROM "ReputationEvent" e
        JOIN "Post" p ON p."id" = e."sourceId"
        WHERE e."userId" = ${userId} AND e."type" = 'POST_CREATED'
          AND e."reversedAt" IS NULL AND e."createdAt" >= ${since} AND e."createdAt" < ${until}
          AND p."deleted" = false AND LENGTH(p."content") >= 200`.then((r) => Number(r[0]?.n ?? 0))
    case "green-thumb":
      // Likes RECEIVED from distinct members — peer-validated.
      return prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(DISTINCT e."actorId") AS n
        FROM "ReputationEvent" e
        WHERE e."userId" = ${userId} AND e."type" = 'LIKE_RECEIVED'
          AND e."reversedAt" IS NULL AND e."createdAt" >= ${since} AND e."createdAt" < ${until}
          AND e."actorId" IS NOT NULL`.then((r) => Number(r[0]?.n ?? 0))
    case "check-the-setup":
      return prisma.reputationEvent.count({
        where: { userId, type: "SETUP_CREATED", reversedAt: null, createdAt: { gte: since, lt: until } },
      })
    default:
      return 0
  }
}

// Live progress for a member's quests today. Only the selected quests are
// measured — one query per quest, matching the challenge evaluator's cost.
export async function getQuestProgress(userId: string, now = new Date()): Promise<QuestProgress[]> {
  const dayKey = currentDayKey(now)
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const until = new Date(since.getTime() + 86400000)
  // Extra quest slots are a tier perk — one indexed profile read.
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { reputation: true },
  })
  const questSlots = getReputationTier(profile?.reputation ?? 0).perks.questSlots ?? DAILY_QUEST_COUNT
  const selected = dailyQuestsFor(userId, dayKey, questSlots)

  const counts = await Promise.all(
    selected.map((q) => countQuestProgress(userId, q.slug, since, until))
  )

  const paidEvents = await prisma.reputationEvent.findMany({
    where: { userId, type: "QUEST_DAILY", key: { startsWith: `quest:${dayKey}:` }, reversedAt: null },
    select: { key: true },
  })
  const paid = new Set(paidEvents.map((e) => e.key))

  return selected.map((q, i) => {
    const progress = Math.min(counts[i] ?? 0, q.target)
    return { ...q, progress, done: progress >= q.target, paid: paid.has(`quest:${dayKey}:${q.slug}:${userId}`) }
  })
}

// Evaluate + pay any completed-but-unpaid daily quests, plus the once-a-day
// perfect-day bonus when all three are done. Called from the throttled path
// in /api/ping alongside evaluateChallenges. Returns newly paid titles.
export async function evaluateQuests(userId: string): Promise<string[]> {
  const dayKey = currentDayKey()
  const progress = await getQuestProgress(userId)
  const paidTitles: string[] = []

  for (const q of progress) {
    if (q.paid && !q.done) {
      // Sticky-payout fix: a paid quest whose qualifying content was deleted
      // un-earns the payout. Non-final — re-qualifying reinstates the key.
      // Durable: the intent row survives a failed drain so a member who
      // stops pinging can't keep the points indefinitely.
      await reverseKeyDurable(
        `quest:${dayKey}:${q.slug}:${userId}`,
        "Quest progress no longer met",
        userId
      ).catch(() => null)
      continue
    }
    if (!q.done || q.paid) continue
    const res = await awardReputation(userId, "QUEST_DAILY", q.reward, `Daily quest: ${q.title}`, {
      key: `quest:${dayKey}:${q.slug}:${userId}`,
    }).catch(() => null)
    if (res?.awarded) paidTitles.push(q.title)
  }

  // Perfect-day bonus — every selected quest currently done. `done` alone
  // (not done||paid) so a quest reversed in this same pass can't still
  // qualify the day; when everything is done-and-paid the keyed award is
  // simply a no-op.
  let perfectPaid = false
  if (progress.length > 0 && progress.every((q) => q.done)) {
    const res = await awardReputation(userId, "QUEST_DAILY", PERFECT_DAY_BONUS, "Perfect day in the garden", {
      key: `quest-day:${dayKey}:${userId}`,
    }).catch(() => null)
    perfectPaid = !!res?.awarded
  } else {
    // A lost quest un-earns the day's perfect bonus as well.
    await reverseKeyDurable(
      `quest-day:${dayKey}:${userId}`,
      "Perfect day no longer met",
      userId
    ).catch(() => null)
  }

  if (paidTitles.length > 0 || perfectPaid) {
    const total =
      progress.filter((q) => paidTitles.includes(q.title)).reduce((s, q) => s + q.reward, 0) +
      (perfectPaid ? PERFECT_DAY_BONUS : 0)
    await notify({
      userId,
      type: "REPUTATION",
      title: perfectPaid && paidTitles.length === 0
        ? "Perfect day"
        : paidTitles.length === 1
          ? "Quest complete"
          : `${paidTitles.length} quests complete`,
      content:
        (paidTitles.length === 1
          ? `You finished "${paidTitles[0]}" — +${total} reputation.`
          : paidTitles.length > 1
            ? `You finished: ${paidTitles.join(", ")} — +${total - (perfectPaid ? PERFECT_DAY_BONUS : 0)} reputation.`
            : "") +
        (perfectPaid ? ` All today's quests done — +${PERFECT_DAY_BONUS} bonus.` : ""),
      link: "/progress",
      metadata: { kind: "quest", titles: paidTitles, perfect: perfectPaid, reward: total },
    }).catch(() => null)
  }

  return paidTitles
}

// ── Payout reconciliation ────────────────────────────────────────────────
// Quest/challenge payouts are keyed rows; a member could pay a quest, delete
// the qualifying content, and keep the rep. evaluateQuests revalidates only
// while the member keeps pinging — this sweep (daily cron) re-measures every
// recent payout against a bounded day window and non-finally reverses any
// whose eligibility no longer holds. Re-qualification reinstates via the
// same key, so legitimate members are unaffected.
export async function reconcileQuestPayouts(days = 7): Promise<{ checked: number; reversed: number }> {
  const events = await prisma.reputationEvent.findMany({
    where: {
      type: "QUEST_DAILY",
      reversedAt: null,
      reversalOfId: null,
      createdAt: { gte: new Date(Date.now() - days * 86400000) },
      // `quest-day:` does NOT match a `quest:` prefix — scan both.
      OR: [{ key: { startsWith: "quest:" } }, { key: { startsWith: "quest-day:" } }],
    },
    select: { key: true, userId: true },
    orderBy: { createdAt: "asc" },
    take: 5000,
  })

  // Group payout keys by (userId, dayKey) — one recompute per member-day.
  const groups = new Map<string, { userId: string; dayKey: string; slugs: Set<string>; perfect: boolean }>()
  for (const e of events) {
    if (!e.key) continue
    if (e.key.startsWith("quest-day:")) {
      const dayKey = e.key.split(":")[1]
      const gk = `${e.userId}|${dayKey}`
      const g = groups.get(gk) ?? { userId: e.userId, dayKey, slugs: new Set(), perfect: false }
      g.perfect = true
      groups.set(gk, g)
    } else {
      const parts = e.key.split(":")
      const dayKey = parts[1]
      const slug = parts[2]
      const gk = `${e.userId}|${dayKey}`
      const g = groups.get(gk) ?? { userId: e.userId, dayKey, slugs: new Set(), perfect: false }
      g.slugs.add(slug)
      groups.set(gk, g)
    }
  }

  let checked = 0
  let reversed = 0
  for (const g of groups.values()) {
    const since = new Date(`${g.dayKey}T00:00:00.000Z`)
    if (isNaN(since.getTime())) continue
    const until = new Date(since.getTime() + 86400000)

    // Recompute done-ness for the union of paid slugs and the slugs that
    // were selected that day (needed to judge the perfect-day key).
    const profile = await prisma.profile.findUnique({
      where: { userId: g.userId },
      select: { reputation: true },
    })
    const questSlots = getReputationTier(profile?.reputation ?? 0).perks.questSlots ?? DAILY_QUEST_COUNT
    const slugsToCheck = new Set([...g.slugs, ...dailyQuestsFor(g.userId, g.dayKey, questSlots).map((q) => q.slug)])
    const counts = new Map<string, number>()
    for (const slug of slugsToCheck) {
      counts.set(slug, await countQuestProgress(g.userId, slug, since, until))
    }
    const isDone = (slug: string) => {
      const def = DAILY_QUESTS.find((q) => q.slug === slug)
      return def ? (counts.get(slug) ?? 0) >= def.target : false
    }

    for (const slug of g.slugs) {
      checked++
      if (!isDone(slug)) {
        const res = await reverseReputationByKey(
          `quest:${g.dayKey}:${slug}:${g.userId}`,
          "Quest progress no longer met",
          g.userId
        ).catch(() => null)
        if (res?.reversed) reversed++
      }
    }
    if (g.perfect) {
      checked++
      // Perfect day stands only if every checked slug still qualifies —
      // includes selected-but-unpaid slugs whose payout may have been
      // reversed in an earlier sweep.
      if ([...slugsToCheck].some((slug) => !isDone(slug))) {
        const res = await reverseReputationByKey(
          `quest-day:${g.dayKey}:${g.userId}`,
          "Perfect day no longer met",
          g.userId
        ).catch(() => null)
        if (res?.reversed) reversed++
      }
    }
  }
  return { checked, reversed }
}
