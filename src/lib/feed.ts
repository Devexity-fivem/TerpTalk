import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { activeAuthor, blockedUserIds, notBlockedAuthor, publicUserSelect } from "@/lib/security"
import { publicDiaryWhere } from "@/lib/diary-visibility"
import { mediaProxyUrl } from "@/lib/media"
import { diaryPath } from "@/lib/slugs"
import { updateAnchor } from "@/lib/update-social"

// ─── Feed Core ─────────────────────────────────────────────────────
// Canonical activity feed for TerpTalk. One module owns candidate
// retrieval, privacy/block scoping, follow scoping, ordering, cursor
// construction and the final mixed-item assembly. `/feed` renders it;
// `/api/feed` continues it; Phase 3 surfaces (profile activity, Discover)
// should consume this module rather than re-implementing feed queries.
//
// There is intentionally no feed table, no SocialPost model and no
// materialization: items are views over the existing domain rows
// (DiaryUpdate, Thread, harvested GrowDiary).
//
// Ordering: keyset-paginated by (sortAt DESC, id DESC) where sortAt is
// the item's activity timestamp (update/thread createdAt, diary
// harvestedAt). A cursor encodes the LAST item's (ts, id); every source
// applies the same boundary, so the union across pages is exactly the
// filtered stream — deterministic, no duplicates, no gaps when new
// activity arrives above the cursor.
//
// Ranking: `latest`/`following` are chronological. `for-you` applies the
// pre-existing deterministic score (recency + engagement, follow-scoped)
// to rank items WITHIN each page; page membership is always the keyset
// window — the score never leaks a row the scoping rules hid, and never
// drops a row permanently. Auditable, no ML, no tracking.

export const FEED_MODES = ["latest", "following", "for-you"] as const
export type FeedMode = (typeof FEED_MODES)[number]

export const FEED_KINDS = ["update", "thread", "harvest"] as const
export type FeedKind = (typeof FEED_KINDS)[number]

export const FEED_PAGE_SIZE = 12
export const FEED_PAGE_MAX = 30

// ── Item payloads ─────────────────────────────────────────────────

const feedUpdateInclude = {
  diary: {
    include: {
      author: { select: publicUserSelect },
      _count: { select: { followers: true, updates: true } },
    },
  },
  author: { select: publicUserSelect },
  images: { take: 1 },
  // Interaction counts ride the row query (SQL COUNT subselects).
  _count: { select: { reactions: true, comments: { where: { deleted: false, author: activeAuthor() } } } },
} satisfies Prisma.DiaryUpdateInclude

const feedThreadInclude = {
  author: { select: publicUserSelect },
  category: true,
  _count: { select: { posts: { where: { deleted: false } } } },
} satisfies Prisma.ThreadInclude

const feedHarvestInclude = {
  author: { select: publicUserSelect },
  updates: { take: 1, orderBy: { createdAt: "desc" as const }, include: { images: { take: 1, orderBy: { order: "asc" as const } } } },
  _count: { select: { updates: true, followers: true } },
} satisfies Prisma.GrowDiaryInclude

export type FeedUpdateRow = Prisma.DiaryUpdateGetPayload<{ include: typeof feedUpdateInclude }>
export type FeedThreadRow = Prisma.ThreadGetPayload<{ include: typeof feedThreadInclude }>
export type FeedHarvestRow = Prisma.GrowDiaryGetPayload<{ include: typeof feedHarvestInclude }>

export type FeedItem =
  | { kind: "update"; id: string; href: string; sortAt: Date; data: FeedUpdateRow }
  | { kind: "thread"; id: string; href: string; sortAt: Date; data: FeedThreadRow }
  | { kind: "harvest"; id: string; href: string; sortAt: Date; data: FeedHarvestRow }

export interface FeedPage {
  items: FeedItem[]
  nextCursor: string | null
  coldStart: boolean
  personalized: boolean
}

// ── Cursor ────────────────────────────────────────────────────────
// Format: `f1.<base64url("<ms>:<id>")>` — versioned, opaque to clients,
// carries only the public row id and timestamp already visible on the
// item. Anything malformed decodes to null → caller treats it as page 1.

const CURSOR_PREFIX = "f1."
const CURSOR_INNER = /^(\d{1,16}):([A-Za-z0-9_-]{1,64})$/
const CURSOR_MAX_LEN = 160

export function encodeFeedCursor(sortAt: Date, id: string): string {
  return CURSOR_PREFIX + Buffer.from(`${sortAt.getTime()}:${id}`).toString("base64url")
}

export function decodeFeedCursor(raw: string | null | undefined): { ts: number; id: string } | null {
  if (typeof raw !== "string" || !raw.startsWith(CURSOR_PREFIX) || raw.length > CURSOR_MAX_LEN) return null
  const inner = Buffer.from(raw.slice(CURSOR_PREFIX.length), "base64url").toString("utf8")
  const m = CURSOR_INNER.exec(inner)
  if (!m) return null
  const ts = Number(m[1])
  return Number.isSafeInteger(ts) ? { ts, id: m[2] } : null
}

/** Keyset predicate for a `(tsCol DESC, id DESC)` stream below the cursor.
 *  Returned as an AND fragment — the scope wheres can carry their own OR
 *  (follow scoping), which a naive spread would overwrite. */
function keysetAfter(col: "createdAt" | "harvestedAt", cur: { ts: number; id: string }) {
  const ts = new Date(cur.ts)
  return { AND: [{ OR: [{ [col]: { lt: ts } }, { [col]: ts, id: { lt: cur.id } }] }] }
}

// ── Scope ─────────────────────────────────────────────────────────
// `personalRequested`: a following/for-you stream was asked for.
// `personalized`: the viewer is signed in AND requested personal — only
// then do follow-graph scoping and the cold-start fallback apply.
// Follows are pushed into the WHERE clauses as relation predicates
// (EXISTS subqueries) — the full follow list is never materialized into
// an application-side array, so follow-graph size does not bound memory.

export interface FeedScope {
  mode: FeedMode
  viewerId: string | null
  personalRequested: boolean
  personalized: boolean
  coldStart: boolean
  blockedIds: string[]
}

export async function resolveFeedScope(viewerId: string | null | undefined, mode: FeedMode): Promise<FeedScope> {
  const uid = viewerId ?? null
  const personalRequested = mode !== "latest"
  const personalized = personalRequested && !!uid
  const blockedIds = await blockedUserIds(uid)

  let coldStart = false
  if (personalized) {
    // Existence checks (findFirst → LIMIT 1) instead of loading the
    // follow lists — cold start only needs "any follows at all".
    const [anyFollow, anyDiaryFollow, anyCategoryFollow] = await Promise.all([
      prisma.follow.findFirst({ where: { followerId: uid! }, select: { id: true } }),
      prisma.diaryFollow.findFirst({ where: { userId: uid! }, select: { id: true } }),
      mode === "for-you"
        ? prisma.categoryFollow.findFirst({ where: { userId: uid! }, select: { id: true } })
        : Promise.resolve(null),
    ])
    coldStart = !anyFollow && !anyDiaryFollow && (mode === "following" || !anyCategoryFollow)
  }
  return { mode, viewerId: uid, personalRequested, personalized, coldStart, blockedIds }
}

// "viewer follows this author" as a relation predicate. Schema naming is
// counterintuitive: `User.following` are the Follow rows naming this user
// as the followed party (i.e. this author's followers).
const followedBy = (viewerId: string) => ({ following: { some: { followerId: viewerId } } })

export function feedUpdateWhere(scope: FeedScope): Prisma.DiaryUpdateWhereInput {
  const noBlocked = notBlockedAuthor(scope.blockedIds)
  if (scope.personalized && !scope.coldStart) {
    const uid = scope.viewerId!
    return {
      diary: { deleted: false, author: activeAuthor() },
      ...noBlocked,
      OR: [
        // PUBLIC updates from followed growers.
        { author: followedBy(uid), diary: { visibility: "PUBLIC" } },
        // PUBLIC|UNLISTED updates from diaries the viewer explicitly
        // followed — link-holders already, same rule as before.
        { diary: { followers: { some: { userId: uid } }, visibility: { in: ["PUBLIC", "UNLISTED"] } } },
      ],
    }
  }
  return { diary: { deleted: false, author: activeAuthor(), ...publicDiaryWhere }, ...noBlocked }
}

export function feedThreadWhere(scope: FeedScope): Prisma.ThreadWhereInput {
  const base = { deleted: false, category: { hidden: false }, author: activeAuthor() }
  if (scope.personalized && !scope.coldStart) {
    const uid = scope.viewerId!
    if (scope.mode === "for-you") {
      return {
        ...base,
        ...notBlockedAuthor(scope.blockedIds),
        OR: [{ author: followedBy(uid) }, { category: { followers: { some: { userId: uid } } } }],
      }
    }
    return { ...base, author: { ...activeAuthor(), ...followedBy(uid) }, ...notBlockedAuthor(scope.blockedIds) }
  }
  return { ...base, ...notBlockedAuthor(scope.blockedIds) }
}

export function feedDiaryWhere(scope: FeedScope): Prisma.GrowDiaryWhereInput {
  if (scope.personalized && !scope.coldStart) {
    const uid = scope.viewerId!
    return {
      deleted: false,
      author: activeAuthor(),
      ...notBlockedAuthor(scope.blockedIds),
      OR: [
        { ...publicDiaryWhere, author: followedBy(uid) },
        { followers: { some: { userId: uid } }, visibility: { in: ["PUBLIC", "UNLISTED"] } },
      ],
    }
  }
  return { deleted: false, author: activeAuthor(), ...publicDiaryWhere, ...notBlockedAuthor(scope.blockedIds) }
}

// ── Scoring (for-you only; the pre-existing deterministic formula) ───

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function scoreItem(item: FeedItem, now: number): number {
  const recency = Math.max(0, 1 - (now - item.sortAt.getTime()) / WEEK_MS)
  if (item.kind === "thread") {
    const engagement = Math.min(1, (item.data.replyCount + item.data.views) / 100)
    return recency * 0.6 + engagement * 0.4
  }
  if (item.kind === "harvest") {
    const engagement = Math.min(1, (item.data._count?.followers ?? 0) / 20)
    return recency * 0.7 + engagement * 0.3
  }
  const engagement = Math.min(1, ((item.data.diary._count?.followers ?? 0) + (item.data.diary._count?.updates ?? 0)) / 20)
  return recency * 0.6 + engagement * 0.4
}

// ── Page assembly ─────────────────────────────────────────────────

const byKeyDesc = (a: FeedItem, b: FeedItem) =>
  b.sortAt.getTime() - a.sortAt.getTime() || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0)

export async function getFeedPage(opts: {
  scope: FeedScope
  kinds?: readonly FeedKind[]
  cursor?: string | null
  limit?: number
}): Promise<FeedPage> {
  const { scope } = opts
  const limit = Math.min(FEED_PAGE_MAX, Math.max(1, Math.floor(opts.limit ?? FEED_PAGE_SIZE) || FEED_PAGE_SIZE))
  const kinds = (opts.kinds?.length ? opts.kinds : FEED_KINDS).filter((k): k is FeedKind => (FEED_KINDS as readonly string[]).includes(k))

  const empty: FeedPage = { items: [], nextCursor: null, coldStart: scope.coldStart, personalized: scope.personalized }
  // Guests (or a signed-out request) get nothing from personal tabs.
  if (scope.personalRequested && !scope.personalized) return empty
  if (kinds.length === 0) return empty

  const cur = decodeFeedCursor(opts.cursor)
  const take = limit + 1 // +1 row per source → exact hasMore without a count query
  const want = (k: FeedKind) => kinds.includes(k)

  const [updates, threads, harvests] = await Promise.all([
    want("update")
      ? prisma.diaryUpdate.findMany({
          where: { ...feedUpdateWhere(scope), ...(cur ? keysetAfter("createdAt", cur) : {}) },
          take,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          include: feedUpdateInclude,
        })
      : Promise.resolve([] as FeedUpdateRow[]),
    want("thread")
      ? prisma.thread.findMany({
          where: { ...feedThreadWhere(scope), ...(cur ? keysetAfter("createdAt", cur) : {}) },
          take,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          include: feedThreadInclude,
        })
      : Promise.resolve([] as FeedThreadRow[]),
    want("harvest")
      ? prisma.growDiary.findMany({
          where: {
            ...feedDiaryWhere(scope),
            harvested: true,
            harvestedAt: { not: null },
            ...(cur ? keysetAfter("harvestedAt", cur) : {}),
          },
          take,
          orderBy: [{ harvestedAt: "desc" }, { id: "desc" }],
          include: feedHarvestInclude,
        })
      : Promise.resolve([] as FeedHarvestRow[]),
  ])

  const candidates: FeedItem[] = []
  for (const u of updates) {
    // Restricted-class media serialize as the authorization endpoint,
    // never the raw blob URL — applied here so every consumer is safe.
    for (const img of u.images) img.url = mediaProxyUrl("diary", img.id)
    candidates.push({ kind: "update", id: u.id, href: updateAnchor(diaryPath(u.diary), u.id), sortAt: u.createdAt, data: u })
  }
  for (const t of threads) {
    candidates.push({ kind: "thread", id: t.id, href: `/forum/thread/${t.slug}`, sortAt: t.createdAt, data: t })
  }
  for (const h of harvests) {
    for (const img of h.updates[0]?.images ?? []) img.url = mediaProxyUrl("diary", img.id)
    candidates.push({ kind: "harvest", id: h.id, href: diaryPath(h), sortAt: h.harvestedAt!, data: h })
  }

  candidates.sort(byKeyDesc)
  const taken = candidates.slice(0, limit)
  const hasMore = candidates.length > limit

  if (scope.mode === "for-you" && taken.length > 1) {
    // Deterministic re-rank within the page only — membership is the
    // keyset window, so nothing hidden leaks and nothing is skipped.
    const now = Date.now()
    taken
      .map((item) => ({ item, score: scoreItem(item, now) }))
      .sort((a, b) => b.score - a.score || byKeyDesc(a.item, b.item))
      .forEach((x, i) => { taken[i] = x.item })
  }

  const last = taken[taken.length - 1]
  return {
    items: taken,
    nextCursor: hasMore && last ? encodeFeedCursor(last.sortAt, last.id) : null,
    coldStart: scope.coldStart,
    personalized: scope.personalized,
  }
}
