import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { activeAuthor, blockExistsBetween, blockedUserIds, isActiveAuthorRow, notBlockedAuthor, publicUserSelect } from "@/lib/security"
import { mediaProxyUrl } from "@/lib/media"
import { diaryPath, strainPath } from "@/lib/slugs"
import { hashtagSlug, momentPath, type MomentKind, type MomentVisibility } from "@/lib/moment-shared"

// ─── Social Moments ────────────────────────────────────────────────
// Canonical module for the native social post (Moment). Every surface —
// feed, profile wall + media grid, hashtag pages, stories, the detail page,
// the media proxy and the APIs — reads moments through the predicates and
// the DTO here, so visibility has exactly one definition:
//
//   - deleted moments and inactive (banned/suspended) authors: nobody
//   - blocks (either direction): hidden from discovery and detail
//   - PUBLIC: everyone (guests included)
//   - FOLLOWERS: the author + members who follow the author
//   - STORY: as above, and only until expiresAt (then: author only)
//   - repost/quote: only of PUBLIC posts; a pure repost disappears with its
//     original, a quote keeps its own text and shows "unavailable"
//
// Raw rows never leave this module — consumers get MomentDTO, which carries
// proxied media URLs and drops grow context the viewer may not see.

export {
  MOMENT_KINDS, MOMENT_VISIBILITIES, MOMENT_CONTENT_MAX, STORY_CAPTION_MAX, MOMENT_COMMENT_MAX,
  MOMENT_MAX_TAGS, STORY_TTL_MS, HASHTAG_RE, momentPath, hashtagPath, parseHashtags, hashtagSlug,
} from "@/lib/moment-shared"
export type { MomentKind, MomentVisibility } from "@/lib/moment-shared"

// ── Hashtags ──────────────────────────────────────────────────────

/** Resolve hashtag names to Tag ids — the same Tag table forum threads
 *  use, so a topic has one tag across threads and moments. A concurrent
 *  first use of a new tag loses the unique race and reads the winner. */
export async function resolveHashtagIds(names: string[]): Promise<string[]> {
  const ids: string[] = []
  for (const name of names) {
    const slug = hashtagSlug(name)
    if (slug.length < 2) continue
    let tag: { id: string } | null
    try {
      tag = await prisma.tag.upsert({ where: { slug }, update: {}, create: { name, slug }, select: { id: true } })
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e
      tag = await prisma.tag.findUnique({ where: { slug }, select: { id: true } })
    }
    if (tag && !ids.includes(tag.id)) ids.push(tag.id)
  }
  return ids
}

/** Mention audience for a followers-only moment: the mentioned members
 *  who actually follow the author (anyone else would get a dead link). */
export function followersAudience(authorId: string) {
  return async (userIds: string[]) => {
    const rows = await prisma.follow.findMany({
      where: { followingId: authorId, followerId: { in: userIds } },
      select: { followerId: true },
    })
    return new Set(rows.map((r) => r.followerId))
  }
}

// ── Visibility predicates ─────────────────────────────────────────

// Schema naming: `User.following` are Follow rows where this user is the
// followed party (i.e. this author's followers) — same as lib/feed.ts.
const followedBy = (viewerId: string) => ({ following: { some: { followerId: viewerId } } })

/** Audience fragment: who may see a moment, given the viewer. */
function audienceWhere(viewerId: string | null): Prisma.MomentWhereInput {
  return viewerId
    ? { OR: [{ visibility: "PUBLIC" }, { authorId: viewerId }, { visibility: "FOLLOWERS", author: followedBy(viewerId) }] }
    : { visibility: "PUBLIC" }
}

/** A repost target the viewer may see: live PUBLIC post by an active,
 *  non-blocked author. */
function repostTargetWhere(blockedIds: string[]): Prisma.MomentWhereInput {
  return {
    kind: "POST",
    deleted: false,
    visibility: "PUBLIC",
    author: activeAuthor(),
    ...notBlockedAuthor(blockedIds),
  }
}

/**
 * Canonical list predicate. Combine with the caller's own scoping via
 * AND — this fragment owns `deleted`, `author`, `authorId` (blocks) and an
 * AND list, so never spread a second `authorId`/`author` over it.
 */
export function momentVisibleWhere(opts: {
  viewerId: string | null
  blockedIds: string[]
  kind?: MomentKind
}): Prisma.MomentWhereInput {
  const { viewerId, blockedIds } = opts
  const kind = opts.kind ?? "POST"
  return {
    kind,
    deleted: false,
    author: activeAuthor(),
    ...notBlockedAuthor(blockedIds),
    AND: [
      audienceWhere(viewerId),
      // Pure reposts vanish with their original; quotes always stand.
      { OR: [{ repostOfId: null }, { content: { not: "" } }, { repostOf: repostTargetWhere(blockedIds) }] },
      ...(kind === "STORY"
        ? [{ OR: [{ expiresAt: { gt: new Date() } }, ...(viewerId ? [{ authorId: viewerId }] : [])] }]
        : []),
    ],
  }
}

/** Row-level gate for one moment (detail page, comments, reactions,
 *  media). Uniform false for every failure — no existence oracle. */
export async function canViewMoment(
  m: {
    authorId: string
    kind: string
    visibility: string
    deleted: boolean
    expiresAt: Date | null
    author: { banned: boolean; suspendedUntil: Date | null }
  },
  viewerId: string | null | undefined,
  opts: { checkBlocks?: boolean } = {}
): Promise<boolean> {
  if (m.deleted || !isActiveAuthorRow(m.author)) return false
  const isAuthor = !!viewerId && viewerId === m.authorId
  if (m.kind === "STORY" && !isAuthor && (!m.expiresAt || m.expiresAt.getTime() <= Date.now())) return false
  if (viewerId && !isAuthor && opts.checkBlocks !== false && (await blockExistsBetween(viewerId, m.authorId))) return false
  if (m.visibility === "PUBLIC" || isAuthor) return true
  if (!viewerId) return false
  const f = await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId: viewerId, followingId: m.authorId } },
    select: { id: true },
  })
  return !!f
}

const momentGateSelect = {
  id: true, authorId: true, kind: true, visibility: true, deleted: true, expiresAt: true,
  repostOfId: true, content: true,
  author: { select: { banned: true, suspendedUntil: true } },
} as const

export type MomentGateRow = Prisma.MomentGetPayload<{ select: typeof momentGateSelect }>

/**
 * Interaction target for a moment id. A pure repost is a pointer, not
 * content: reactions and comments resolve to the original post (the card
 * does the same), and when the original is gone the repost is too.
 * Returns the gate row for the effective target, or null.
 */
export async function momentInteractionTarget(id: string): Promise<MomentGateRow | null> {
  const m = await prisma.moment.findUnique({ where: { id }, select: momentGateSelect })
  if (!m) return null
  if (m.repostOfId && m.content.trim() === "") {
    return prisma.moment.findUnique({ where: { id: m.repostOfId }, select: momentGateSelect })
  }
  return m
}

// ── Card payload + DTO ────────────────────────────────────────────

const momentImageSelect = { id: true, order: true } as const

const momentBaseSelect = {
  id: true,
  kind: true,
  content: true,
  visibility: true,
  authorId: true,
  repostOfId: true,
  expiresAt: true,
  deleted: true,
  createdAt: true,
  author: { select: { ...publicUserSelect, banned: true, suspendedUntil: true } },
  images: { select: momentImageSelect, orderBy: [{ order: "asc" as const }, { id: "asc" as const }] },
  diary: { select: { id: true, slug: true, title: true, stage: true, visibility: true, deleted: true, authorId: true } },
  strain: { select: { id: true, slug: true, name: true } },
  tags: { select: { tag: { select: { name: true, slug: true } } } },
} satisfies Prisma.MomentSelect

/** Base fields + engagement counts + this viewer's like/repost state. The
 *  viewer relations always run with a where (an impossible id for guests)
 *  so the payload type is static. */
function momentStateSelect(viewerId: string | null) {
  const vid = viewerId ?? "__guest__"
  return {
    ...momentBaseSelect,
    reactions: { where: { userId: vid }, select: { type: true }, take: 1 },
    reposts: { where: { authorId: vid, content: "", deleted: false }, select: { id: true }, take: 1 },
    _count: {
      select: {
        reactions: true,
        comments: { where: { deleted: false, author: activeAuthor() } },
        reposts: { where: { deleted: false } },
      },
    },
  } satisfies Prisma.MomentSelect
}

/** Card select for a viewer — the row plus (for reposts/quotes) the
 *  original with its own counts, so actions on a repost hit the original. */
export function momentCardSelect(viewerId: string | null) {
  return {
    ...momentStateSelect(viewerId),
    repostOf: { select: momentStateSelect(viewerId) },
  } satisfies Prisma.MomentSelect
}

export type MomentCardRow = Prisma.MomentGetPayload<{ select: ReturnType<typeof momentCardSelect> }>
type MomentStateRow = Prisma.MomentGetPayload<{ select: ReturnType<typeof momentStateSelect> }>

type PublicAuthor = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>

export interface MomentCore {
  id: string
  kind: MomentKind
  content: string
  visibility: MomentVisibility
  createdAt: Date | string
  expiresAt: Date | string | null
  href: string
  author: PublicAuthor
  images: { id: string; url: string }[]
  grow: { title: string; href: string; stage: string } | null
  strain: { name: string; href: string } | null
  tags: string[]
  counts: { likes: number; comments: number; reposts: number }
  liked: boolean
  reposted: boolean
}

export interface MomentDTO extends MomentCore {
  /** Pure repost (no own text) — the card renders the original. */
  isRepost: boolean
  repostOf: MomentCore | null
  /** Quote/repost whose original is no longer visible to this viewer. */
  repostUnavailable: boolean
}

function toCore(row: MomentStateRow, viewerId: string | null): MomentCore {
  const { banned: _b, suspendedUntil: _s, ...author } = row.author
  void _b
  void _s
  // Grow context only while the grow is viewable by this viewer: PUBLIC,
  // or the viewer's own. UNLISTED/PRIVATE titles never leak via a tag.
  const d = row.diary
  const grow = d && !d.deleted && (d.visibility === "PUBLIC" || d.authorId === viewerId)
    ? { title: d.title, href: diaryPath(d), stage: d.stage }
    : null
  return {
    id: row.id,
    kind: row.kind as MomentKind,
    content: row.content,
    visibility: row.visibility as MomentVisibility,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    href: momentPath(row.id),
    author,
    images: row.images.map((i) => ({ id: i.id, url: mediaProxyUrl("moment", i.id) })),
    grow,
    strain: row.strain ? { name: row.strain.name, href: strainPath(row.strain) } : null,
    tags: row.tags.map((t) => t.tag.name),
    counts: { likes: row._count.reactions, comments: row._count.comments, reposts: row._count.reposts },
    liked: row.reactions.length > 0,
    reposted: row.reposts.length > 0,
  }
}

/** Serialize a card row for one viewer. `blockedIds` must be the viewer's
 *  mutual block list (the row itself was already scope-filtered). */
export function toMomentDTO(row: MomentCardRow, viewerId: string | null, blockedIds: string[]): MomentDTO {
  const core = toCore(row, viewerId)
  const isRepost = !!row.repostOfId && row.content.trim() === ""
  const o = row.repostOf
  const originalVisible = !!o
    && !o.deleted
    && o.kind === "POST"
    && o.visibility === "PUBLIC"
    && isActiveAuthorRow(o.author)
    && !blockedIds.includes(o.authorId)
  return {
    ...core,
    isRepost,
    repostOf: originalVisible ? toCore(o!, viewerId) : null,
    repostUnavailable: !!row.repostOfId && !originalVisible,
  }
}

/** Load one moment as a DTO for a viewer, or null if not viewable. */
export async function getMomentForViewer(id: string, viewerId: string | null): Promise<MomentDTO | null> {
  const row = await prisma.moment.findUnique({ where: { id }, select: momentCardSelect(viewerId) })
  if (!row || !(await canViewMoment(row, viewerId))) return null
  const blockedIds = await blockedUserIds(viewerId)
  return toMomentDTO(row, viewerId, blockedIds)
}

// ── Stories ───────────────────────────────────────────────────────

export interface StoryRailEntry {
  author: PublicAuthor
  count: number
  latestAt: Date | string
  previewUrl: string | null
}

const STORY_RAIL_AUTHORS = 20

/**
 * Story rail: authors with active stories the viewer may see. Members see
 * their own + followed growers; guests see recent PUBLIC stories. Newest
 * author first, the viewer's own rail entry always leads.
 */
export async function getStoryRail(viewerId: string | null): Promise<StoryRailEntry[]> {
  const blockedIds = await blockedUserIds(viewerId)
  const base = momentVisibleWhere({ viewerId, blockedIds, kind: "STORY" })
  const where: Prisma.MomentWhereInput = viewerId
    ? { AND: [base, { expiresAt: { gt: new Date() } }, { OR: [{ authorId: viewerId }, { author: followedBy(viewerId) }] }] }
    : { AND: [base, { expiresAt: { gt: new Date() } }] }
  const rows = await prisma.moment.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 200,
    select: {
      id: true,
      createdAt: true,
      authorId: true,
      author: { select: publicUserSelect },
      images: { select: { id: true }, orderBy: [{ order: "asc" }, { id: "asc" }], take: 1 },
    },
  })
  const byAuthor = new Map<string, StoryRailEntry>()
  for (const r of rows) {
    const e = byAuthor.get(r.authorId)
    if (e) {
      e.count++
      continue
    }
    if (byAuthor.size >= STORY_RAIL_AUTHORS) continue
    byAuthor.set(r.authorId, {
      author: r.author,
      count: 1,
      latestAt: r.createdAt,
      previewUrl: r.images[0] ? mediaProxyUrl("moment", r.images[0].id) : null,
    })
  }
  const entries = [...byAuthor.values()]
  if (viewerId) entries.sort((a, b) => Number(b.author.id === viewerId) - Number(a.author.id === viewerId))
  return entries
}

/** An author's active stories visible to the viewer, oldest first (the
 *  viewer reads them in posting order). Expired stories are excluded for
 *  everyone, the author included — the rail is "last 24h". */
export async function getAuthorStories(authorId: string, viewerId: string | null): Promise<MomentDTO[]> {
  const blockedIds = await blockedUserIds(viewerId)
  if (viewerId && viewerId !== authorId && blockedIds.includes(authorId)) return []
  const rows = await prisma.moment.findMany({
    where: { AND: [momentVisibleWhere({ viewerId, blockedIds, kind: "STORY" }), { authorId, expiresAt: { gt: new Date() } }] },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 50,
    select: momentCardSelect(viewerId),
  })
  return rows.map((r) => toMomentDTO(r, viewerId, blockedIds))
}

// ── Trending hashtags ─────────────────────────────────────────────

/** Most-used hashtags on PUBLIC posts by active authors in the window. */
export async function getTrendingHashtags(opts: { days?: number; limit?: number } = {}) {
  const since = new Date(Date.now() - (opts.days ?? 7) * 24 * 60 * 60 * 1000)
  const groups = await prisma.momentTag.groupBy({
    by: ["tagId"],
    where: { moment: { kind: "POST", deleted: false, visibility: "PUBLIC", createdAt: { gte: since }, author: activeAuthor() } },
    _count: { _all: true },
    orderBy: [{ _count: { tagId: "desc" } }, { tagId: "asc" }],
    take: opts.limit ?? 8,
  })
  if (groups.length === 0) return []
  const tags = await prisma.tag.findMany({ where: { id: { in: groups.map((g) => g.tagId) } }, select: { id: true, name: true, slug: true } })
  const byId = new Map(tags.map((t) => [t.id, t]))
  return groups
    .map((g) => {
      const t = byId.get(g.tagId)
      return t ? { name: t.name, slug: t.slug, count: g._count._all } : null
    })
    .filter((t): t is { name: string; slug: string; count: number } => !!t)
}
