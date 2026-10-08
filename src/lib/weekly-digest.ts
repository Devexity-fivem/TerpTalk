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
import { resolveFeedScope, getFeedPage } from "@/lib/feed"
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
// Followed-grower activity (Phase 8): bounded in every dimension — at
// most this many followed growers considered per member, at most this
// many feed candidates fetched, at most this many items per grower, and
// at most this many rendered lines.
const FOLLOWED_GROWER_CAP = 500
const FOLLOWED_FEED_CANDIDATES = 30
const FOLLOWED_PER_GROWER_CAP = 2
const FOLLOWED_ITEMS_CAP = 6

/**
 * The digest's followed-grower section — canonical "following" feed
 * items restricted to authors the member USER-follows. Diary-follow
 * items (incl. UNLISTED link-holder updates) are intentionally excluded:
 * the "Activity you follow" section already covers them, and an unlisted
 * grow must never surface here as grower-follow evidence.
 */
async function followedGrowerActivity(
  userId: string,
  weekStart: Date,
  coveredDiaryIds: Set<string>,
  coveredThreadHrefs: Set<string>
): Promise<{ total: number; authors: Set<string>; items: FollowedActivityItem[] }> {
  const empty = { total: 0, authors: new Set<string>(), items: [] as FollowedActivityItem[] }
  const [follows, scope] = await Promise.all([
    prisma.follow.findMany({
      where: { followerId: userId },
      select: { followingId: true },
      take: FOLLOWED_GROWER_CAP,
    }),
    resolveFeedScope(userId, "following"),
  ])
  const followedIds = new Set(follows.map((f) => f.followingId))
  followedIds.delete(userId) // a digest never features the viewer themself
  if (!followedIds.size) return empty

  const [feed, newDiaries] = await Promise.all([
    getFeedPage({ scope, limit: FOLLOWED_FEED_CANDIDATES }),
    // New diaries are not a Feed kind — digest-local source using the
    // same semantics: PUBLIC, active author, user-followed, not blocked.
    prisma.growDiary.findMany({
      where: {
        deleted: false,
        visibility: "PUBLIC",
        createdAt: { gte: weekStart },
        // A grow harvested this same week surfaces as the harvest item —
        // "started a new grow" would double-count the same content.
        harvested: false,
        authorId: { in: [...followedIds], notIn: scope.blockedIds },
        author: activeAuthor(),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: FOLLOWED_FEED_CANDIDATES,
      select: {
        id: true, slug: true, title: true, createdAt: true, authorId: true,
        author: { select: { id: true, name: true, profile: { select: { username: true } } } },
      },
    }),
  ])

  type Cand = {
    sortAt: Date; id: string; authorId: string
    item: FollowedActivityItem & { authorId: string }
  }
  const authorOf = (a: { id: string; name: string | null; profile: { username: string | null } | null }) => ({
    href: `/u/${a.profile?.username ?? a.id}`,
    name: a.profile?.username ?? a.name ?? "a grower",
  })
  const cands: Cand[] = []
  for (const it of feed.items) {
    if (it.sortAt < weekStart) continue
    const author = it.data.author
    if (!author || !followedIds.has(author.id)) continue
    if (it.kind === "thread") {
      if (coveredThreadHrefs.has(it.href)) continue
      cands.push({
        sortAt: it.sortAt, id: it.id, authorId: author.id,
        item: { kind: "thread", href: it.href, authorId: author.id, author: authorOf(author), verb: "started the thread", title: it.data.title },
      })
    } else if (it.kind === "update") {
      if (coveredDiaryIds.has(it.data.diaryId)) continue
      cands.push({
        sortAt: it.sortAt, id: it.id, authorId: author.id,
        item: {
          kind: "update", href: it.href, authorId: author.id, author: authorOf(author),
          verb: "posted a new update", title: it.data.title, context: it.data.diary.title,
        },
      })
    } else {
      if (coveredDiaryIds.has(it.data.id)) continue
      cands.push({
        sortAt: it.sortAt, id: it.id, authorId: author.id,
        item: { kind: "harvest", href: it.href, authorId: author.id, author: authorOf(author), verb: "harvested", title: it.data.title },
      })
    }
  }
  for (const d of newDiaries) {
    if (coveredDiaryIds.has(d.id)) continue
    cands.push({
      sortAt: d.createdAt, id: d.id, authorId: d.authorId,
      item: {
        kind: "diary", href: diaryPath(d), authorId: d.authorId,
        author: authorOf(d.author),
        verb: "started a new grow", title: d.title,
      },
    })
  }

  // Canonical feed order: sortAt DESC, id DESC — chronological catch-up,
  // no popularity or engagement weighting.
  cands.sort((a, b) => b.sortAt.getTime() - a.sortAt.getTime() || (b.id < a.id ? -1 : 1))
  const perAuthor = new Map<string, number>()
  const selected: FollowedActivityItem[] = []
  const authors = new Set<string>()
  for (const c of cands) {
    const n = perAuthor.get(c.authorId) ?? 0
    if (n >= FOLLOWED_PER_GROWER_CAP) continue
    perAuthor.set(c.authorId, n + 1)
    authors.add(c.authorId)
    selected.push(c.item)
  }
  return { total: selected.length, authors, items: selected.slice(0, FOLLOWED_ITEMS_CAP) }
}

export interface FollowedActivityItem {
  kind: "update" | "thread" | "harvest" | "diary"
  href: string
  author: { href: string; name: string }
  verb: string
  title: string
  /** Optional secondary label (e.g. the diary an update belongs to). */
  context?: string
}

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

  // Followed-grower activity (Phase 8): how many growers each member
  // user-follows produced public activity this week. Two batched queries
  // — one follow graph slice, four groupBy counts — instead of a feed
  // query per member. Blocks need no check: creating a block deletes the
  // follow pair, so a Follow row implies not-blocked.
  const followPairs = await prisma.follow.findMany({
    where: { followerId: { in: ids } },
    select: { followerId: true, followingId: true },
    take: FOLLOWED_GROWER_CAP * DIGEST_MEMBER_CAP,
  })
  const followedByUser = new Map<string, string[]>()
  const allFollowedIds = new Set<string>()
  for (const p of followPairs) {
    let arr = followedByUser.get(p.followerId)
    if (!arr) followedByUser.set(p.followerId, (arr = []))
    if (arr.length >= FOLLOWED_GROWER_CAP) continue
    arr.push(p.followingId)
    allFollowedIds.add(p.followingId)
  }
  const followedAuthorIds = [...allFollowedIds]
  const authorActivity = new Map<string, number>()
  if (followedAuthorIds.length) {
    const addCounts = (rows: { authorId: string | null }[]) => {
      for (const r of rows) {
        if (r.authorId) authorActivity.set(r.authorId, (authorActivity.get(r.authorId) ?? 0) + 1)
      }
    }
    const base = { author: activeAuthor() }
    const [upd, thr, harv, newDi] = await Promise.all([
      prisma.diaryUpdate.groupBy({
        by: ["authorId"],
        where: { authorId: { in: followedAuthorIds }, createdAt: { gte: weekStart }, diary: { deleted: false, visibility: "PUBLIC" }, ...base },
        _count: { _all: true },
      }),
      prisma.thread.groupBy({
        by: ["authorId"],
        where: { authorId: { in: followedAuthorIds }, createdAt: { gte: weekStart }, deleted: false, category: { hidden: false }, ...base },
        _count: { _all: true },
      }),
      prisma.growDiary.groupBy({
        by: ["authorId"],
        where: { authorId: { in: followedAuthorIds }, harvestedAt: { gte: weekStart }, deleted: false, visibility: "PUBLIC", harvested: true, ...base },
        _count: { _all: true },
      }),
      prisma.growDiary.groupBy({
        by: ["authorId"],
        where: { authorId: { in: followedAuthorIds }, createdAt: { gte: weekStart }, deleted: false, visibility: "PUBLIC", ...base },
        _count: { _all: true },
      }),
    ])
    for (const rows of [upd, thr, harv, newDi]) addCounts(rows)
  }
  const activeGrowersFor = (uid: string) =>
    (followedByUser.get(uid) ?? []).reduce((n, a) => n + ((authorActivity.get(a) ?? 0) > 0 ? 1 : 0), 0)

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

    const activeFollowedGrowers = activeGrowersFor(m.id)
    if (activeFollowedGrowers)
      parts.push(`${activeFollowedGrowers} grower${activeFollowedGrowers === 1 ? "" : "s"} you follow posted this week`)

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
  /** This week's activity from growers the member USER-follows —
   *  distinct from diary/thread follows (see followedGrowerActivity). */
  followedActivity: { total: number; items: FollowedActivityItem[] }
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
      // Wider than the 3-item display slice: the full set doubles as the
      // dedupe source for the followed-grower section.
      take: 40,
      select: { thread: { select: { slug: true, title: true } } },
    }),
    prisma.diaryFollow.findMany({
      where: { userId, diary: { deleted: false, visibility: { in: ["PUBLIC", "UNLISTED"] } } },
      select: { diary: { select: { id: true, slug: true, title: true } } },
    }),
  ])

  const diaryIds = diaryFollows.map((f) => f.diary.id)
  const coveredDiaryIds = new Set(diaryIds)
  const coveredThreadHrefs = new Set(threadFollows.map((f) => `/forum/thread/${f.thread.slug}`))
  const [diaryUpdateRows, help, growMatches, quests, streakRes, highlight, threadTotal, followed] = await Promise.all([
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
    followedGrowerActivity(userId, weekStart, coveredDiaryIds, coveredThreadHrefs),
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
    followed.total > 0 ||
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
    followedActivity: { total: followed.total, items: followed.items },
    questions: help,
    growMatches,
    openQuests,
    streak: streakRes.streak,
    highlight,
    hasValue,
  }
}
