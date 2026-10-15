// Question board — server-only feed/discovery module connecting members
// to real questions that still need a useful answer.
//
// Two lanes, both canonical:
//   MATCHED — signed-in members get helpWantedForUser() matches first:
//             the same public-evidence scoring (strain grown, setup match,
//             technique, topic participation) that drives TerpBot
//             recruitment and the member-home card. Explainable, never
//             opaque, and impossible for guests.
//   OPEN    — general "still seeking an answer" pool: question-category
//             threads with no accepted answer. replyCount distinguishes
//             "unanswered" (0 replies — awaiting first reply) from
//             "unsolved" (replies exist, none accepted) — the UI labels
//             them separately; they are never conflated.
//
// Privacy/scope: question categories only, non-deleted, non-locked,
// active authors, never the viewer's own questions, block-filtered in
// both directions. Bounded: one capped pool query, display TAKE items.
// Matched rows are excluded from the open list so a question never shows
// twice on one page; callers pass `excludeSlugs` to drop questions an
// adjacent module (e.g. the catch-up card) already presents.
import { prisma } from "@/lib/prisma"
import { activeAuthor, blockedUserIds, publicUserSelect } from "@/lib/security"
import {
  helpWantedForUser,
  helpWantedReasonText,
  questionCategoryIds,
  type HelpWantedItem,
} from "@/lib/answer-match"

export type OpenQuestionStatus = "unanswered" | "unsolved"

export interface OpenQuestionItem {
  slug: string
  title: string
  category: string
  authorName: string
  replyCount: number
  createdAt: Date
  status: OpenQuestionStatus
}

export interface QuestionBoardData {
  /** Viewer-matched questions (signed-in only), reason text attached. */
  matched: (HelpWantedItem & { reasonText: string })[]
  /** Total matches beyond the displayed slice — for a "+N more" line. */
  matchedTotal: number
  /** General open pool, matched/excluded slugs already removed. */
  open: OpenQuestionItem[]
}

const POOL_TAKE = 12
const MATCHED_TAKE = 3
// Unanswered-first ordering means unsolved rows only show when slots
// remain — 6 keeps that reachable without turning the card into a list.
const OPEN_TAKE = 6

export async function questionBoardForViewer(
  viewerId: string | null,
  opts: { /** Slugs an adjacent module already shows — removed from both lanes. */ excludeSlugs?: string[] } = {}
): Promise<QuestionBoardData> {
  const empty: QuestionBoardData = { matched: [], matchedTotal: 0, open: [] }
  const cats = await questionCategoryIds()
  if (!cats.length) return empty

  const [blocked, helpWanted] = await Promise.all([
    blockedUserIds(viewerId),
    viewerId
      ? helpWantedForUser(viewerId).catch(() => ({ total: 0, items: [] as HelpWantedItem[] }))
      : Promise.resolve({ total: 0, items: [] as HelpWantedItem[] }),
  ])

  const excluded = new Set([...(opts.excludeSlugs ?? []), ...helpWanted.items.map((i) => i.slug)])
  const matched = helpWanted.items
    .filter((i) => !(opts.excludeSlugs ?? []).includes(i.slug))
    .slice(0, MATCHED_TAKE)
    .map((i) => ({ ...i, reasonText: helpWantedReasonText(i) }))

  const pool = await prisma.thread.findMany({
    where: {
      deleted: false,
      locked: false,
      // "Seeking an answer" = the asker has not marked one — replies may
      // exist; the status field keeps that distinction honest.
      acceptedAnswerId: null,
      categoryId: { in: cats.map((c) => c.id) },
      author: activeAuthor(),
      ...(viewerId ? { authorId: { not: viewerId, ...(blocked.length ? { notIn: blocked } : {}) } } : {}),
    },
    // Unanswered first, then newest — deterministic, explainable.
    orderBy: [{ replyCount: "asc" }, { createdAt: "desc" }, { id: "asc" }],
    take: POOL_TAKE,
    select: {
      slug: true,
      title: true,
      replyCount: true,
      createdAt: true,
      category: { select: { name: true } },
      author: { select: publicUserSelect },
    },
  })

  const open: OpenQuestionItem[] = []
  for (const t of pool) {
    if (open.length >= OPEN_TAKE) break
    if (excluded.has(t.slug)) continue
    open.push({
      slug: t.slug,
      title: t.title,
      category: t.category.name,
      authorName: t.author.profile?.username ?? t.author.name ?? "member",
      replyCount: t.replyCount,
      createdAt: t.createdAt,
      status: t.replyCount === 0 ? "unanswered" : "unsolved",
    })
  }

  return { matched, matchedTotal: helpWanted.total, open }
}

export function questionBoardHasContent(d: QuestionBoardData | null | undefined): boolean {
  return !!d && (d.matched.length > 0 || d.open.length > 0)
}
