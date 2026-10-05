// Weekly in-app digest — the scheduled return trigger. TerpTalk has no
// email by design; this is the proactive counterpart to the pull-only
// /mydigest command, delivered through the same BOT_ASSIST notification
// + notifyOnBotAssist preference + claim-first BotEvent pipeline as every
// other assist (see terpbot-assist.ts).
//
// Cadence: one BotEvent claim per (member, ISO week) — the cron task is
// keyed `terpbot:weekly-digest:<weekKey>` so the whole job is claimed
// once per week; a mid-run failure releases the task claim and retries
// next day, while per-member claims keep retries idempotent.
//
// Minimum value: a digest is only sent when the member has at least one
// PERSONAL signal (unreads, followed activity, answerable questions,
// quests in progress, streak, stale grow). The shared community
// highlight never sends a digest by itself.
import { prisma } from "@/lib/prisma"
import { botAssist, loadAssistPrelude } from "@/lib/terpbot-assist"
import { helpWantedForUser } from "@/lib/answer-match"
import { growMatchesForUser, type GrowMatchesResult } from "@/lib/grow-matches"
import { getQuestProgress } from "@/lib/quests"
import { getGrowStreak } from "@/lib/grow-streak"
import { currentWeekKey } from "@/lib/week"
import { sanitizeEcho } from "@/lib/terpbot"
import { activeAuthor } from "@/lib/security"
import { diaryPath } from "@/lib/slugs"
import type { HelpWantedItem } from "@/lib/answer-match"

const DAY = 86400000
// One scheduled run never processes more than this many members — the
// weekly key means stragglers simply appear in a retry run.
const DIGEST_MEMBER_CAP = 100
// A digest goes only to members who finished setup, are past the
// first-days exploration window, and haven't visited in 48h+ — daily
// users already see everything live on member home.
const MIN_ACCOUNT_AGE_MS = 3 * DAY
const DORMANT_MS = 2 * DAY

export interface WeeklyDigestResult {
  weekKey: string
  eligible: number
  sent: number
  skipped: number
}

// Shared once-per-run community highlight — the same deterministic
// "hot thread this week" rule the /hot command uses.
async function weeklyHighlight(): Promise<{ slug: string; title: string } | null> {
  const since = new Date(Date.now() - 7 * DAY)
  const t = await prisma.thread.findFirst({
    where: { deleted: false, createdAt: { gte: since }, category: { hidden: false }, author: activeAuthor() },
    orderBy: [{ replyCount: "desc" }, { views: "desc" }, { id: "desc" }],
    select: { slug: true, title: true },
  })
  return t ? { slug: t.slug, title: sanitizeEcho(t.title, 80) } : null
}

export async function runWeeklyDigest(
  opts: { userIds?: string[]; weekKey?: string; now?: Date } = {}
): Promise<WeeklyDigestResult> {
  const now = opts.now ?? new Date()
  const weekKey = opts.weekKey ?? currentWeekKey(now)
  const weekStart = new Date(now.getTime() - 7 * DAY)

  // Eligible members: active, onboarded, past day-3, dormant 48h+,
  // bot-assist notifications enabled.
  const members = await prisma.user.findMany({
    where: {
      AND: [
        activeAuthor(),
        { OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(now.getTime() - DORMANT_MS) } }] },
      ],
      onboardingCompletedAt: { not: null },
      createdAt: { lte: new Date(now.getTime() - MIN_ACCOUNT_AGE_MS) },
      profile: { notifyOnBotAssist: true },
      ...(opts.userIds ? { id: { in: opts.userIds } } : {}),
    },
    orderBy: [{ lastSeenAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
    take: DIGEST_MEMBER_CAP,
    select: {
      id: true,
      profile: { select: { xp: true } },
      // Cheap pre-filter for the answer-match probe — a member with no
      // public diary and no posts can't match any evidence signals.
      _count: {
        select: {
          diaryCreator: { where: { deleted: false, visibility: "PUBLIC" } },
          posts: { where: { deleted: false } },
        },
      },
    },
  })
  if (!members.length) return { weekKey, eligible: 0, sent: 0, skipped: 0 }

  const ids = members.map((m) => m.id)

  // Batched personal signals — two groupBy queries instead of N.
  const [unreadRows, threadActivityRows] = await Promise.all([
    prisma.notification.groupBy({
      by: ["userId"],
      where: { userId: { in: ids }, read: false },
      _count: { _all: true },
    }),
    // Followed threads with activity this week — public categories only.
    prisma.threadFollow.groupBy({
      by: ["userId"],
      where: {
        userId: { in: ids },
        thread: { deleted: false, category: { hidden: false }, lastActivityAt: { gte: weekStart } },
      },
      _count: { _all: true },
    }),
  ])
  const unreadBy = new Map(unreadRows.map((r) => [r.userId, r._count._all]))
  const threadActBy = new Map(threadActivityRows.map((r) => [r.userId, r._count._all]))

  // Followed-diary updates this week. Feed semantics: a member who
  // follows an UNLISTED diary holds the link, so those updates count;
  // PRIVATE diaries never do.
  const diaryFollows = await prisma.diaryFollow.findMany({
    where: { userId: { in: ids }, diary: { deleted: false, visibility: { in: ["PUBLIC", "UNLISTED"] } } },
    select: { userId: true, diaryId: true },
  })
  const followsByUser = new Map<string, string[]>()
  for (const f of diaryFollows) {
    const arr = followsByUser.get(f.userId) ?? []
    arr.push(f.diaryId)
    followsByUser.set(f.userId, arr)
  }
  const diaryIds = [...new Set(diaryFollows.map((f) => f.diaryId))]
  const diaryUpdateRows = diaryIds.length
    ? await prisma.diaryUpdate.groupBy({
        by: ["diaryId"],
        where: { diaryId: { in: diaryIds }, createdAt: { gte: weekStart } },
        _count: { _all: true },
      })
    : []
  const updatesByDiary = new Map(diaryUpdateRows.map((r) => [r.diaryId, r._count._all]))

  const highlight = await weeklyHighlight()
  const pre = await loadAssistPrelude(
    ids,
    members.map((m) => `assist:weekly-digest:${m.id}:${weekKey}`)
  )

  let sent = 0
  let skipped = 0
  for (const m of members) {
    const parts: string[] = []

    const unread = unreadBy.get(m.id) ?? 0
    if (unread) parts.push(`${unread} unread notification${unread === 1 ? "" : "s"}`)

    const followedThreads = threadActBy.get(m.id) ?? 0
    if (followedThreads) parts.push(`${followedThreads} followed thread${followedThreads === 1 ? "" : "s"} had new activity`)

    const followedDiaryUpdates = (followsByUser.get(m.id) ?? []).reduce(
      (n, dId) => n + (updatesByDiary.get(dId) ?? 0),
      0
    )
    if (followedDiaryUpdates)
      parts.push(`${followedDiaryUpdates} update${followedDiaryUpdates === 1 ? "" : "s"} on grows you follow`)

    // Answerable questions — reuse Initiative #1's matcher verbatim.
    // Only probed for members with some public evidence to match against.
    const hasEvidence = m._count.diaryCreator > 0 || m._count.posts > 0
    if (hasEvidence) {
      const help = await helpWantedForUser(m.id)
      if (help.total) parts.push(`${help.total} question${help.total === 1 ? "" : "s"} you could help answer`)
    }

    // Grows like yours — the canonical matcher (lib/grow-matches). The
    // reference grow must be public, so the public-diary count is a
    // sufficient pre-filter.
    if (m._count.diaryCreator > 0) {
      const gm = await growMatchesForUser(m.id)
      if (gm.matches.length)
        parts.push(`${gm.matches.length} grow${gm.matches.length === 1 ? "" : "s"} like yours to learn from`)
    }

    // Progression signals only surface for members who've engaged it —
    // "3 quests left" means nothing to someone who never earned XP.
    if ((m.profile?.xp ?? 0) > 0) {
      const quests = await getQuestProgress(m.id, now)
      const questLeft = quests.filter((q) => !q.done && !q.paid)
      if (questLeft.length)
        parts.push(`${questLeft.length} quest${questLeft.length === 1 ? "" : "s"} open (+${questLeft.reduce((n, q) => n + q.reward, 0)} XP)`)
      const streak = await getGrowStreak(m.id)
      if (streak.streak > 1) parts.push(`${streak.streak}-day update streak going`)
    }

    if (!parts.length) {
      skipped++
      continue
    }
    if (highlight) parts.push(`Trending this week: "${highlight.title}"`)

    const res = await botAssist({
      key: `assist:weekly-digest:${m.id}:${weekKey}`,
      kind: "weekly-digest",
      userId: m.id,
      title: "Your TerpTalk week",
      content: parts.join("\n"),
      // Canonical digest destination — /mydigest renders the same
      // signals as structured sections with real links.
      link: "/mydigest",
      pre,
    })
    if (res === "sent") sent++
    else skipped++
  }

  return { weekKey, eligible: members.length, sent, skipped }
}

// ── Member-facing weekly digest view (/mydigest) ─────────────────────
// Structured counterpart of the notification summary: the same signals
// the cron aggregates, returned with real items/links so the page can
// render sections instead of a flat count list. Only ever called for the
// session's own userId — every query is owner-scoped or public-scope.
export interface WeeklyDigestView {
  weekKey: string
  unreadCount: number
  followedThreads: { total: number; items: { slug: string; title: string }[] }
  followedGrows: { total: number; items: { href: string; title: string; updates: number }[] }
  questions: { total: number; items: HelpWantedItem[] }
  growMatches: GrowMatchesResult
  openQuests: { title: string; reward: number }[]
  streak: number
  highlight: { slug: string; title: string } | null
  /** Same minimum-value rule as the cron: ≥1 personal signal. */
  hasValue: boolean
}

export async function weeklyDigestForUser(userId: string, now = new Date()): Promise<WeeklyDigestView> {
  const weekStart = new Date(now.getTime() - 7 * DAY)

  const [unreadCount, threadFollows, diaryFollows] = await Promise.all([
    prisma.notification.count({ where: { userId, read: false } }),
    prisma.threadFollow.findMany({
      where: {
        userId,
        thread: { deleted: false, category: { hidden: false }, lastActivityAt: { gte: weekStart } },
      },
      orderBy: { thread: { lastActivityAt: "desc" } },
      take: 4,
      select: { thread: { select: { slug: true, title: true } } },
    }),
    prisma.diaryFollow.findMany({
      where: { userId, diary: { deleted: false, visibility: { in: ["PUBLIC", "UNLISTED"] } } },
      select: { diary: { select: { id: true, slug: true, title: true } } },
    }),
  ])

  const diaryIds = diaryFollows.map((f) => f.diary.id)
  const [diaryUpdateRows, help, growMatches, quests, streakRes, highlight, threadTotal] = await Promise.all([
    diaryIds.length
      ? prisma.diaryUpdate.groupBy({
          by: ["diaryId"],
          where: { diaryId: { in: diaryIds }, createdAt: { gte: weekStart } },
          _count: { _all: true },
        })
      : Promise.resolve([] as { diaryId: string; _count: { _all: number } }[]),
    helpWantedForUser(userId),
    growMatchesForUser(userId),
    getQuestProgress(userId, now),
    getGrowStreak(userId),
    weeklyHighlight(),
    prisma.threadFollow.count({
      where: {
        userId,
        thread: { deleted: false, category: { hidden: false }, lastActivityAt: { gte: weekStart } },
      },
    }),
  ])

  const updatesByDiary = new Map(diaryUpdateRows.map((r) => [r.diaryId, r._count._all]))
  const growItems = diaryFollows
    .map((f) => ({
      href: diaryPath(f.diary),
      title: f.diary.title,
      updates: updatesByDiary.get(f.diary.id) ?? 0,
    }))
    .filter((g) => g.updates > 0)
    .sort((a, b) => b.updates - a.updates)
  const followedDiaryUpdates = growItems.reduce((n, g) => n + g.updates, 0)
  const openQuests = quests.filter((q) => !q.done && !q.paid).map((q) => ({ title: q.title, reward: q.reward }))

  const hasValue =
    unreadCount > 0 ||
    threadTotal > 0 ||
    followedDiaryUpdates > 0 ||
    help.total > 0 ||
    growMatches.matches.length > 0 ||
    openQuests.length > 0 ||
    streakRes.streak > 1

  return {
    weekKey: currentWeekKey(now),
    unreadCount,
    followedThreads: {
      total: threadTotal,
      items: threadFollows.slice(0, 3).map((f) => ({ slug: f.thread.slug, title: f.thread.title })),
    },
    followedGrows: { total: followedDiaryUpdates, items: growItems.slice(0, 3) },
    questions: help,
    growMatches,
    openQuests,
    streak: streakRes.streak,
    highlight,
    hasValue,
  }
}
