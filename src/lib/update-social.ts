import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { activeAuthor, notBlockedAuthor, publicUserSelect } from "@/lib/security"
import { publicDiaryWhere } from "@/lib/diary-visibility"

// ─── Social Grow Updates ───────────────────────────────────────────
// A DiaryUpdate is a first-class social target: Reactions point at it via
// Reaction.diaryUpdateId; comments are ordinary Posts in the grow's
// canonical discussion thread, anchored via Post.diaryUpdateId.
//
// Visibility contract: an interaction is never broader than the content it
// belongs to. Discussion threads are public forum content, so comments can
// only be created on PUBLIC grows — and an anchored comment renders only
// while its grow is still PUBLIC, not deleted, and authored by an active
// member. Flipping a grow to UNLISTED/PRIVATE (or deleting it) hides every
// anchored comment everywhere this fragment is applied; flipping back
// restores them. Unanchored posts are unaffected.

/** Inline comments shown under each update; the rest live in the discussion. */
export const UPDATE_INLINE_COMMENTS = 3

/** Grow-level gate an anchored comment inherits. */
export const anchoredDiaryWhere = {
  deleted: false,
  ...publicDiaryWhere,
  author: activeAuthor(),
}

/**
 * Post-level fragment: unanchored posts pass; anchored posts pass only
 * while their grow is publicly viewable. Combine with the caller's own
 * deleted/author/block filters (AND semantics via spread).
 */
export function anchoredPostVisibleWhere(): Prisma.PostWhereInput {
  return {
    OR: [{ diaryUpdateId: null }, { diaryUpdate: { diary: anchoredDiaryWhere } }],
  }
}

/** Fragment link for an update card — the diary page renders id="update-<id>". */
export function updateAnchor(diaryHref: string, updateId: string, postId?: string): string {
  // `?post=<id>` keeps postLinkWhere()-based cleanup working when the
  // comment is deleted; the fragment scrolls to the update.
  return `${diaryHref}${postId ? `?post=${postId}` : ""}#update-${updateId}`
}

export interface UpdateCommentRow {
  id: string
  content: string
  createdAt: Date
  edited: boolean
  author: Prisma.UserGetPayload<{ select: typeof publicUserSelect }>
  reactions: { userId: string; type: string }[]
}

export interface UpdateSocial {
  reactionCounts: Record<string, number>
  myReaction: string | null
  commentCount: number
  /** newest UPDATE_INLINE_COMMENTS, returned oldest-first for reading order */
  comments: UpdateCommentRow[]
}

/**
 * Batch-load social state for a page of updates in a constant number of
 * queries (no per-update round trips): reaction counts are grouped in SQL,
 * the viewer's own reactions are one IN query, comment counts are grouped,
 * and the per-update inline comment window is a single ROW_NUMBER() pass.
 * Comments are only loaded when the caller says the grow is commentable
 * (PUBLIC) — non-public grows render reactions only.
 */
export async function loadUpdateSocial(
  updateIds: string[],
  opts: { viewerId?: string | null; blockedIds?: string[]; withComments: boolean }
): Promise<Map<string, UpdateSocial>> {
  const out = new Map<string, UpdateSocial>()
  for (const id of updateIds) out.set(id, { reactionCounts: {}, myReaction: null, commentCount: 0, comments: [] })
  if (updateIds.length === 0) return out
  const blockedIds = opts.blockedIds ?? []

  const commentWhere: Prisma.PostWhereInput = {
    diaryUpdateId: { in: updateIds },
    deleted: false,
    author: activeAuthor(),
    ...notBlockedAuthor(blockedIds),
  }

  const [reactionGroups, mine, commentGroups, windowIds] = await Promise.all([
    prisma.reaction.groupBy({
      by: ["diaryUpdateId", "type"],
      where: { diaryUpdateId: { in: updateIds } },
      _count: { _all: true },
    }),
    opts.viewerId
      ? prisma.reaction.findMany({
          where: { userId: opts.viewerId, diaryUpdateId: { in: updateIds } },
          select: { diaryUpdateId: true, type: true },
        })
      : Promise.resolve([] as { diaryUpdateId: string | null; type: string }[]),
    opts.withComments
      ? prisma.post.groupBy({ by: ["diaryUpdateId"], where: commentWhere, _count: { _all: true } })
      : Promise.resolve([] as { diaryUpdateId: string | null; _count: { _all: number } }[]),
    opts.withComments
      ? prisma.$queryRaw<{ id: string }[]>`
          SELECT id FROM (
            SELECT p.id, ROW_NUMBER() OVER (
              PARTITION BY p."diaryUpdateId" ORDER BY p."createdAt" DESC, p.id DESC
            ) AS rn
            FROM "Post" p
            JOIN "User" u ON u.id = p."authorId"
            WHERE p."diaryUpdateId" = ANY(${updateIds}::text[])
              AND p.deleted = false
              AND u.banned = false
              AND (u."suspendedUntil" IS NULL OR u."suspendedUntil" < now())
              AND NOT (p."authorId" = ANY(${blockedIds}::text[]))
          ) w
          WHERE w.rn <= ${UPDATE_INLINE_COMMENTS}`
      : Promise.resolve([] as { id: string }[]),
  ])

  for (const g of reactionGroups) {
    const s = g.diaryUpdateId ? out.get(g.diaryUpdateId) : undefined
    if (s) s.reactionCounts[g.type] = g._count._all
  }
  for (const r of mine) {
    const s = r.diaryUpdateId ? out.get(r.diaryUpdateId) : undefined
    if (s) s.myReaction = r.type
  }
  for (const g of commentGroups) {
    const s = g.diaryUpdateId ? out.get(g.diaryUpdateId) : undefined
    if (s) s.commentCount = g._count._all
  }

  if (windowIds.length > 0) {
    const rows = await prisma.post.findMany({
      where: { id: { in: windowIds.map((r) => r.id) }, ...commentWhere },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        content: true,
        createdAt: true,
        edited: true,
        diaryUpdateId: true,
        author: { select: publicUserSelect },
        reactions: { select: { userId: true, type: true } },
      },
    })
    for (const { diaryUpdateId, ...row } of rows) {
      const s = diaryUpdateId ? out.get(diaryUpdateId) : undefined
      if (s) s.comments.push(row)
    }
  }
  return out
}
