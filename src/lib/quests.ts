import { prisma } from "@/lib/prisma"
import { awardProgression, reverseProgressionByKey, hasUnlocks } from "@/lib/progression"
import { reverseXpKeyDurable } from "@/lib/progression-outbox"
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
//   - Total daily income (~30 XP) stays far under the velocity flag.

export interface QuestDef {
  slug: string
  title: string
  description: string
  icon: string
  reward: number
  target: number
  mastery?: "CULTIVATION" | "RECORDS" | "KNOWLEDGE" | "EXPERIMENTATION" | "COMMUNITY"
}

export const DAILY_QUESTS: QuestDef[] = [
  {
    slug: "lend-a-hand",
    title: "Lend a Hand",
    description: "Reply in a thread you didn't start.",
    icon: "🤝",
    reward: 8,
    target: 1,
    mastery: "COMMUNITY",
  },
  {
    slug: "tend-the-garden",
    title: "Tend the Garden",
    description: "Post a grow diary update.",
    icon: "🌱",
    reward: 5,
    target: 1,
    mastery: "CULTIVATION",
  },
  {
    slug: "spread-the-love",
    title: "Spread the Love",
    description: "Like posts or diaries from 3 different growers.",
    icon: "💚",
    reward: 5,
    target: 3,
    mastery: "COMMUNITY",
  },
  {
    slug: "judges-eye",
    title: "Judge's Eye",
    description: "Vote in a community contest.",
    icon: "🗳️",
    reward: 5,
    target: 1,
    mastery: "COMMUNITY",
  },
  {
    slug: "show-your-grow",
    title: "Show Your Grow",
    description: "Share a strain or grow photo.",
    icon: "📸",
    reward: 8,
    target: 1,
    mastery: "RECORDS",
  },
  {
    slug: "welcome-wagon",
    title: "Welcome Wagon",
    description: "Reply in a thread started by a new member (under 14 days).",
    icon: "👋",
    reward: 10,
    target: 1,
    mastery: "COMMUNITY",
  },
  {
    slug: "ask-the-garden",
    title: "Ask the Garden",
    description: "Start a discussion thread.",
    icon: "❓",
    reward: 8,
    target: 1,
    mastery: "COMMUNITY",
  },
  {
    slug: "deep-dive",
    title: "Deep Dive",
    description: "Write a reply of 200+ characters.",
    icon: "🔬",
    reward: 10,
    target: 1,
    mastery: "KNOWLEDGE",
  },
  {
    slug: "green-thumb",
    title: "Green Thumb",
    description: "Receive likes from 3 different growers today.",
    icon: "👍",
    reward: 10,
    target: 3,
    mastery: "COMMUNITY",
  },
  {
    slug: "check-the-setup",
    title: "Check the Setup",
    description: "Create a grow setup showcase.",
    icon: "💡",
    reward: 8,
    target: 1,
    mastery: "RECORDS",
  },
  {
    slug: "answer-the-call",
    title: "Answer the Call",
    description: "Give the first reply to an unanswered grow question.",
    icon: "🗣️",
    reward: 10,
    target: 1,
    mastery: "KNOWLEDGE",
  },
]

// Base 3/day — quests are seasoning, not the main progression loop.
// Extra slots are rank unlocks (quest-slot-4 at Rooted, quest-slot-5 at
// Cultivator), each a fresh income opportunity every day.
export const DAILY_QUEST_COUNT = 3
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
// after the day closed. V2: progress is measured on live rows and the
// ProgressionEvent ledger — the legacy ReputationEvent feed is frozen.
async function countQuestProgress(userId: string, slug: string, since: Date, until: Date): Promise<number> {
  switch (slug) {
    case "lend-a-hand":
      // Reply in a thread you didn't start — self-replies don't count.
      return prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(DISTINCT p."threadId") AS n
        FROM "Post" p
        JOIN "Thread" t ON t."id" = p."threadId"
        WHERE p."authorId" = ${userId}
          AND p."createdAt" >= ${since} AND p."createdAt" < ${until}
          AND p."deleted" = false AND t."deleted" = false
          AND t."authorId" <> ${userId}`.then((r) => Number(r[0]?.n ?? 0))
    case "tend-the-garden":
      // Live updates in a non-deleted diary — the UPDATE_DAY family of
      // events is band-gated, so a quality update counts even when the
      // award itself was soft-capped.
      return prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n
        FROM "DiaryUpdate" u
        JOIN "GrowDiary" d ON d."id" = u."diaryId"
        WHERE u."authorId" = ${userId}
          AND u."createdAt" >= ${since} AND u."createdAt" < ${until}
          AND d."deleted" = false`.then((r) => Number(r[0]?.n ?? 0))
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
      return prisma.strainPhoto.count({
        where: { userId, createdAt: { gte: since, lt: until } },
      })
    case "welcome-wagon":
      return prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(DISTINCT p."threadId") AS n
        FROM "Post" p
        JOIN "Thread" t ON t."id" = p."threadId"
        JOIN "User" tu ON tu."id" = t."authorId"
        WHERE p."authorId" = ${userId}
          AND p."createdAt" >= ${since} AND p."createdAt" < ${until}
          AND p."deleted" = false AND t."deleted" = false
          AND t."authorId" <> ${userId}
          AND tu."createdAt" >= ${new Date(since.getTime() - 14 * 86400000)}`.then((r) => Number(r[0]?.n ?? 0))
    case "ask-the-garden":
      return prisma.thread.count({
        where: { authorId: userId, deleted: false, createdAt: { gte: since, lt: until } },
      })
    case "deep-dive":
      return prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n
        FROM "Post" p
        JOIN "Thread" t ON t."id" = p."threadId"
        WHERE p."authorId" = ${userId}
          AND p."createdAt" >= ${since} AND p."createdAt" < ${until}
          AND p."deleted" = false AND t."deleted" = false
          AND LENGTH(p."content") >= 200`.then((r) => Number(r[0]?.n ?? 0))
    case "green-thumb":
      // Likes RECEIVED from distinct members — peer-validated. Reactions
      // no longer write ledger events under V2, so count live Reaction
      // rows on the member's own content.
      return prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(DISTINCT r."userId") AS n
        FROM "Reaction" r
        LEFT JOIN "Post" p ON p."id" = r."postId"
        LEFT JOIN "GrowDiary" d ON d."id" = r."diaryId"
        WHERE r."type" = 'LIKE'
          AND r."createdAt" >= ${since} AND r."createdAt" < ${until}
          AND r."userId" <> ${userId}
          AND COALESCE(p."authorId", d."authorId") = ${userId}`.then((r) => Number(r[0]?.n ?? 0))
    case "check-the-setup":
      return prisma.growSetup.count({
        where: { authorId: userId, deleted: false, createdAt: { gte: since, lt: until } },
      })
    case "answer-the-call":
      // First live reply in a question-category thread — the answer-
      // recruitment contribution. Self-answers never count; the post
      // must still be the thread's earliest live reply (deleted answers
      // un-earn the quest like every other live-row measure). The
      // category regex is the QUESTION_RE convention from /questions.
      return prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(DISTINCT p."threadId") AS n
        FROM "Post" p
        JOIN "Thread" t ON t."id" = p."threadId"
        JOIN "Category" c ON c."id" = t."categoryId"
        WHERE p."authorId" = ${userId}
          AND p."createdAt" >= ${since} AND p."createdAt" < ${until}
          AND p."deleted" = false AND t."deleted" = false AND c."hidden" = false
          AND t."authorId" <> ${userId}
          AND (c."slug" ~* 'question|help|problem|doctor' OR c."name" ~* 'question|help|problem|doctor')
          AND p."createdAt" = (
            SELECT MIN(p2."createdAt") FROM "Post" p2
            WHERE p2."threadId" = p."threadId" AND p2."deleted" = false
              AND p2."authorId" <> t."authorId"
          )`.then((r) => Number(r[0]?.n ?? 0))
    default:
      return 0
  }
}

// Live progress for a member's quests today. Only the selected quests are
// measured — one query per quest, matching the challenge evaluator's cost.
// Extra quest slots are unlocks, not tier perks — design §10.1
// (3 base → 4 at Rooted → 5 at Cultivator).
async function questSlotsFor(userId: string): Promise<number> {
  const [slot4, slot5] = await hasUnlocks(userId, ["quest-slot-4", "quest-slot-5"])
  return DAILY_QUEST_COUNT + (slot4 ? 1 : 0) + (slot5 ? 1 : 0)
}

export async function getQuestProgress(userId: string, now = new Date()): Promise<QuestProgress[]> {
  const dayKey = currentDayKey(now)
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const until = new Date(since.getTime() + 86400000)
  const selected = dailyQuestsFor(userId, dayKey, await questSlotsFor(userId))

  const counts = await Promise.all(
    selected.map((q) => countQuestProgress(userId, q.slug, since, until))
  )

  const paidEvents = await prisma.progressionEvent.findMany({
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
      await reverseXpKeyDurable(
        `quest:${dayKey}:${q.slug}:${userId}`,
        "Quest progress no longer met",
        userId
      ).catch(() => null)
      continue
    }
    if (!q.done || q.paid) continue
    const res = await awardProgression(userId, "QUEST_DAILY", `Daily quest: ${q.title}`, {
      key: `quest:${dayKey}:${q.slug}:${userId}`,
      xp: q.reward,
      mastery: q.mastery ?? null,
    }).catch(() => null)
    if (res?.awarded) paidTitles.push(q.title)
  }

  // Perfect-day bonus — every selected quest currently done. `done` alone
  // (not done||paid) so a quest reversed in this same pass can't still
  // qualify the day; when everything is done-and-paid the keyed award is
  // simply a no-op.
  let perfectPaid = false
  if (progress.length > 0 && progress.every((q) => q.done)) {
    const res = await awardProgression(userId, "QUEST_DAILY", "Perfect day in the garden", {
      key: `quest-day:${dayKey}:${userId}`,
      xp: PERFECT_DAY_BONUS,
      mastery: null,
    }).catch(() => null)
    perfectPaid = !!res?.awarded
  } else {
    // A lost quest un-earns the day's perfect bonus as well.
    await reverseXpKeyDurable(
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
            ? `You finished: ${paidTitles.join(", ")} — +${total - (perfectPaid ? PERFECT_DAY_BONUS : 0)} XP.`
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
  const events = await prisma.progressionEvent.findMany({
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
    const questSlots = await questSlotsFor(g.userId)
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
        const res = await reverseProgressionByKey(
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
        const res = await reverseProgressionByKey(
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
