import { prisma } from "@/lib/prisma"
import { unstable_cache } from "next/cache"
import { toGrams, toOz } from "@/lib/yield"
import { activeAuthor, publicUserSelect } from "@/lib/security"
import { publicDiaryWhere } from "@/lib/diary-visibility"
import {
  escapeLike,
  strainFieldMatches,
  getStrainGrowStats,
  getStrainEvidence,
  computeStrainGrowStats,
  computeStrainEvidence,
  type StrainGrowStats,
  type StrainEvidenceSummary,
} from "@/lib/strain-stats"
import { DIFFICULTY_LABELS } from "@/lib/grow-fields"
import { QUESTION_CATEGORY_RE } from "@/lib/answer-match"

const DAY_MS = 86400000
const QUESTION_SCAN_CAP = 100
const QUESTION_LIST_SIZE = 6
const HARVEST_RECALL_CAP = 20
const HARVEST_LIST_SIZE = 4

export type StrainQuestionStatus = "solved" | "answered" | "open"

export interface StrainQuestionItem {
  slug: string
  title: string
  authorId: string
  status: StrainQuestionStatus
  replyCount: number
  views: number
  lastActivityAt: string
}

export interface StrainQuestionKnowledge {
  /** question threads tagged with this strain (bounded scan) */
  total: number
  solved: number
  /** true when the scan hit QUESTION_SCAN_CAP — counts are a lower bound */
  truncated: boolean
  /** co-occurring tags on the question threads, excluding the strain tag —
   *  the "most discussed topics" signal. Only tags raised by ≥2 questions. */
  topics: { name: string; count: number }[]
  items: StrainQuestionItem[]
}

export interface StrainHarvestExample {
  id: string
  slug: string | null
  title: string
  authorId: string
  authorName: string
  rating: number | null
  difficulty: string | null
  /** oz, unit-normalized — null when the grower marked the yield private */
  yieldOz: number | null
  days: number | null
}

export interface StrainKnowledge {
  /** existing outcome aggregate: grows, growers, yields, rating,
   *  difficulty, techniques, mediums, lights, stage durations, tier */
  stats: StrainGrowStats
  /** existing experiment/lesson aggregate */
  evidence: StrainEvidenceSummary
  questions: StrainQuestionKnowledge
  /** representative public harvests — highest-rated first, deterministic */
  harvests: StrainHarvestExample[]
}

// ── Questions tagged with the strain ───────────────────────────────
// The tag link is the canonical strain↔thread mechanism (same predicate
// as the strain page's discussion list and member-home "around your
// grows"). Title contains-matching is deliberately NOT used here — the
// knowledge card needs precision, and question categories are already
// the noisy end of the corpus.
// Uncached core — exported for behavioral tests (unstable_cache cannot
// run outside the Next runtime).
export async function computeStrainQuestions(strainName: string): Promise<StrainQuestionKnowledge> {
    const categories = await prisma.category.findMany({
      where: { hidden: false },
      select: { id: true, slug: true, name: true },
    })
    const questionCatIds = categories
      .filter((c) => QUESTION_CATEGORY_RE.test(`${c.slug} ${c.name}`))
      .map((c) => c.id)
    if (!questionCatIds.length) {
      return { total: 0, solved: 0, truncated: false, topics: [], items: [] }
    }

    const threads = await prisma.thread.findMany({
      where: {
        deleted: false,
        author: activeAuthor(),
        categoryId: { in: questionCatIds },
        tags: { some: { tag: { name: { equals: strainName, mode: "insensitive" } } } },
      },
      orderBy: [{ lastActivityAt: "desc" }, { id: "asc" }],
      take: QUESTION_SCAN_CAP,
      select: {
        id: true,
        slug: true,
        title: true,
        authorId: true,
        replyCount: true,
        views: true,
        lastActivityAt: true,
        acceptedAnswer: { select: { id: true, deleted: true } },
        tags: { select: { tag: { select: { name: true } } } },
      },
    })

    const strainTag = strainName.trim().toLowerCase()
    const topicCounts = new Map<string, number>()
    const topicDisplay = new Map<string, string>()
    let solved = 0
    const items: StrainQuestionItem[] = []
    for (const t of threads) {
      const isSolved = !!t.acceptedAnswer && !t.acceptedAnswer.deleted
      if (isSolved) solved++
      const status: StrainQuestionStatus = isSolved ? "solved" : t.replyCount > 0 ? "answered" : "open"
      items.push({
        slug: t.slug,
        title: t.title,
        authorId: t.authorId,
        status,
        replyCount: t.replyCount,
        views: t.views,
        lastActivityAt: t.lastActivityAt.toISOString(),
      })
      for (const { tag } of t.tags) {
        const key = tag.name.trim().toLowerCase()
        if (!key || key === strainTag) continue
        topicCounts.set(key, (topicCounts.get(key) ?? 0) + 1)
        if (!topicDisplay.has(key)) topicDisplay.set(key, tag.name.trim())
      }
    }

    const statusRank: Record<StrainQuestionStatus, number> = { solved: 0, answered: 1, open: 2 }
    items.sort(
      (a, b) =>
        statusRank[a.status] - statusRank[b.status] ||
        b.replyCount - a.replyCount ||
        b.lastActivityAt.localeCompare(a.lastActivityAt) ||
        a.slug.localeCompare(b.slug)
    )

    return {
      total: threads.length,
      solved,
      truncated: threads.length === QUESTION_SCAN_CAP,
      topics: [...topicCounts.entries()]
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 6)
        .map(([key, count]) => ({ name: topicDisplay.get(key) ?? key, count })),
      items: items.slice(0, QUESTION_LIST_SIZE),
    }
}

const getQuestions = unstable_cache(computeStrainQuestions, ["strain-knowledge-questions"], {
  revalidate: 300,
  tags: ["strains", "forum"],
})

// ── Representative public harvests ─────────────────────────────────
// "Notable" = highest member-rated harvested public grows, deterministic
// tie-break by recency. Reported outcomes, not rankings of quality —
// the UI labels them as community records.
export async function computeStrainHarvests(
  strainName: string,
  strainId: string
): Promise<StrainHarvestExample[]> {
    const raw = await prisma.growDiary.findMany({
      where: {
        deleted: false,
        author: activeAuthor(),
        ...publicDiaryWhere,
        harvested: true,
        OR: [
          { strainId },
          { strain: { contains: escapeLike(strainName), mode: "insensitive" } },
        ],
      },
      orderBy: [
        { harvestRating: { sort: "desc", nulls: "last" } },
        { harvestedAt: { sort: "desc", nulls: "last" } },
        { id: "asc" },
      ],
      take: HARVEST_RECALL_CAP,
      select: {
        id: true,
        slug: true,
        title: true,
        strain: true,
        strainId: true,
        authorId: true,
        startDate: true,
        harvestedAt: true,
        harvestRating: true,
        harvestDifficulty: true,
        yieldAmount: true,
        yieldUnit: true,
        yieldPrivate: true,
        author: { select: publicUserSelect },
      },
    })

    return raw
      .filter((d) => d.strainId === strainId || strainFieldMatches(d.strain, strainName))
      .slice(0, HARVEST_LIST_SIZE)
      .map((d) => {
        const days =
          d.harvestedAt && d.startDate
            ? Math.max(1, Math.round((d.harvestedAt.getTime() - d.startDate.getTime()) / DAY_MS))
            : null
        return {
          id: d.id,
          slug: d.slug,
          title: d.title,
          authorId: d.authorId,
          authorName: d.author.profile?.username || d.author.name || "Member",
          rating: d.harvestRating,
          difficulty: d.harvestDifficulty
            ? DIFFICULTY_LABELS[d.harvestDifficulty as keyof typeof DIFFICULTY_LABELS] ?? d.harvestDifficulty
            : null,
          yieldOz:
            d.yieldAmount != null && !d.yieldPrivate
              ? Math.round(toOz(toGrams(d.yieldAmount, d.yieldUnit)) * 10) / 10
              : null,
          days: days != null && days < 1000 ? days : null,
        }
      })
}

const getHarvests = unstable_cache(computeStrainHarvests, ["strain-knowledge-harvests"], {
  revalidate: 300,
  tags: ["strains", "diaries"],
})

/**
 * Canonical strain knowledge record — the single entry point the strain
 * page (and future TerpBot retrieval / grows-like-yours consumers) use
 * for "what has the community learned growing this strain". Composes
 * the existing cached aggregates with the question/harvest synthesis;
 * every source query is public-only, bounded, and cached.
 */
export async function getStrainKnowledge(strainName: string, strainId: string): Promise<StrainKnowledge> {
  const [stats, evidence, questions, harvests] = await Promise.all([
    getStrainGrowStats(strainName, strainId),
    getStrainEvidence(strainName, strainId),
    getQuestions(strainName),
    getHarvests(strainName, strainId),
  ])
  return { stats, evidence, questions, harvests }
}

/** Uncached twin of getStrainKnowledge — the test seam. Same
 *  composition, same shape, just straight through to the compute cores. */
export async function computeStrainKnowledge(strainName: string, strainId: string): Promise<StrainKnowledge> {
  const [stats, evidence, questions, harvests] = await Promise.all([
    computeStrainGrowStats(strainName, strainId),
    computeStrainEvidence(strainName, strainId),
    computeStrainQuestions(strainName),
    computeStrainHarvests(strainName, strainId),
  ])
  return { stats, evidence, questions, harvests }
}
