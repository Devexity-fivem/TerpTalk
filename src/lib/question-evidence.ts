// Question Evidence — the deterministic "what might already help" rail
// for question threads. Composes existing systems; nothing here is a new
// knowledge engine:
//
//   solved questions — QUESTION_CATEGORY_RE threads carrying a live
//                      accepted answer, ranked by tag overlap → activity.
//   grow evidence    — PUBLIC diaries matched on the question's linked
//                      context grow via scoreGrowMatch, or — absent a
//                      usable reference — on the strain/setup signals the
//                      question's tags resolve to (same extraction as
//                      answer-match, via extractQuestionSignals).
//   strain knowledge — one link to the canonical strain surface when a
//                      strain is confidently identified through
//                      structured data (linked grow / catalog tag /
//                      suggestStrainLink). getStrainKnowledge supplies the
//                      summary line; no aggregation is duplicated here.
//
// Privacy: public-discovery scope only — publicDiaryWhere + activeAuthor
// + block-safe in both directions. UNLISTED/PRIVATE diaries are never
// surfaced, and a non-public context grow is never used as a matching
// reference for viewers who couldn't see it.
import { prisma } from "@/lib/prisma"
import { activeAuthor, notBlockedAuthor } from "@/lib/security"
import { publicDiaryWhere } from "@/lib/diary-visibility"
import { diaryPath, strainPath } from "@/lib/slugs"
import {
  QUESTION_CATEGORY_RE,
  questionCategoryIds,
  extractQuestionSignals,
  type QuestionSignals,
} from "@/lib/answer-match"
import { scoreGrowMatch, MIN_SCORE } from "@/lib/grow-matches"
import { suggestStrainLink } from "@/lib/strain-stats"
import { getStrainKnowledge } from "@/lib/strain-knowledge"
import type { Prisma } from "@prisma/client"

const SOLVED_POOL_CAP = 30
const SOLVED_RESULT = 3
const GROW_POOL_CAP = 60
const GROW_RESULT = 3

export interface SolvedQuestionItem {
  slug: string
  title: string
  categoryName: string
}

export interface GrowEvidenceItem {
  href: string
  title: string
  stage: string
  harvested: boolean
  strainName: string | null
  authorName: string
  /** First explainable reason, when the deterministic scorer produced one. */
  reason: string | null
}

export interface StrainEvidenceItem {
  name: string
  href: string
  summary: string
}

export interface QuestionEvidence {
  /** false on non-question threads — the rail never renders there. */
  isQuestion: boolean
  solved: SolvedQuestionItem[]
  grows: GrowEvidenceItem[]
  strain: StrainEvidenceItem | null
  /** Public matching signals extracted for this question — tags plus the
   *  linked grow's fields when that grow is visible to this viewer.
   *  Reused by the page for contextual grower suggestions. */
  signals: QuestionSignals
}

const EMPTY_SIGNALS: QuestionSignals = {
  strainTagNames: [], strainIds: [], techniqueKeys: [],
  setupTokens: [], mediumTypes: [], lightTypes: [], growTypes: [],
}

const EMPTY: QuestionEvidence = { isQuestion: false, solved: [], grows: [], strain: null, signals: EMPTY_SIGNALS }

interface ContextDiaryRef {
  id: string
  authorId: string
  visibility: string
  strain: string | null
  strainId: string | null
  mediumType: string | null
  lightType: string | null
  growType: string
  stage: string
  techniques: string[]
  strainRef: { id: string; slug: string | null; name: string } | null
}

const normKey = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "")

const GROW_SELECT = {
  id: true, slug: true, title: true, stage: true, harvested: true, updatedAt: true,
  strain: true, strainId: true, mediumType: true, lightType: true, growType: true, techniques: true,
  strainRef: { select: { name: true } },
  author: { select: { name: true, profile: { select: { username: true } } } },
} satisfies Prisma.GrowDiarySelect

const authorName = (d: { author: { name: string | null; profile: { username: string | null } | null } }) =>
  d.author.profile?.username || d.author.name || "Member"

/**
 * Evidence for a question thread: solved questions + public grow records
 * + the canonical strain card. All inputs are already-loaded thread
 * fields — this adds a bounded constant number of queries, never a
 * query-per-result.
 */
export async function questionEvidenceForThread(input: {
  threadId: string
  categoryId: string
  category: { slug: string; name: string }
  authorId: string
  tagIds: string[]
  tags: { tag: { name: string } }[]
  /** The page-filtered context diary (null when the viewer can't see it). */
  contextDiary: ContextDiaryRef | null
  viewerId?: string
  blockedIds: string[]
}, opts: {
  /** Knowledge source for the strain item — defaults to the cached
   *  canonical helper; tests pass the uncached compute twin. */
  getKnowledge?: typeof getStrainKnowledge
} = {}): Promise<QuestionEvidence> {
  const { threadId, categoryId, category, authorId, tagIds, tags, blockedIds, viewerId } = input
  if (!QUESTION_CATEGORY_RE.test(`${category.slug} ${category.name}`)) return EMPTY

  // A context grow is a matching reference only when the current viewer
  // could see it — otherwise its attributes would leak through "same X"
  // reasons. (The page already filters; this is defense-in-depth.)
  const refDiary =
    input.contextDiary &&
    (input.contextDiary.visibility === "PUBLIC" || input.contextDiary.authorId === viewerId)
      ? input.contextDiary
      : null

  const [questionCats, signals] = await Promise.all([
    questionCategoryIds(),
    extractQuestionSignals({ id: threadId, tags }),
  ])
  const questionCatIds = questionCats.map((c) => c.id)
  const authorExcluded = {
    not: authorId,
    ...(blockedIds.length ? { notIn: blockedIds } : {}),
  }

  // Grow candidate pool — either scored against the linked grow or
  // pre-filtered on the question's own structured signals.
  const refOr: Prisma.GrowDiaryWhereInput[] = []
  if (refDiary) {
    const refName = refDiary.strainRef?.name ?? refDiary.strain
    if (refDiary.strainId) refOr.push({ strainId: refDiary.strainId })
    if (refName) {
      refOr.push({ strainRef: { is: { name: { equals: refName, mode: "insensitive" } } } })
      refOr.push({ strain: { equals: refName, mode: "insensitive" } })
    }
    if (refDiary.mediumType) refOr.push({ mediumType: refDiary.mediumType })
    if (refDiary.lightType) refOr.push({ lightType: refDiary.lightType })
    if (refDiary.techniques.length) refOr.push({ techniques: { hasSome: refDiary.techniques } })
    if (refDiary.growType) refOr.push({ growType: refDiary.growType })
  }
  const signalOr: Prisma.GrowDiaryWhereInput[] = []
  if (!refDiary) {
    if (signals.strainIds.length) signalOr.push({ strainId: { in: signals.strainIds } })
    if (signals.strainTagNames.length)
      signalOr.push({ strain: { in: signals.strainTagNames, mode: "insensitive" } })
    if (!signalOr.length) {
      if (signals.mediumTypes.length) signalOr.push({ mediumType: { in: signals.mediumTypes } })
      if (signals.lightTypes.length) signalOr.push({ lightType: { in: signals.lightTypes } })
      if (signals.growTypes.length) signalOr.push({ growType: { in: signals.growTypes } })
    }
  }
  const growOr = refDiary ? refOr : signalOr

  const [solvedPool, growPool] = await Promise.all([
    questionCatIds.length
      ? prisma.thread.findMany({
          where: {
            deleted: false,
            id: { not: threadId },
            categoryId: { in: questionCatIds },
            category: { hidden: false },
            acceptedAnswerId: { not: null },
            author: activeAuthor(),
            ...notBlockedAuthor(blockedIds),
            OR: [
              ...(tagIds.length ? [{ tags: { some: { tagId: { in: tagIds } } } }] : []),
              { categoryId },
            ],
          },
          orderBy: [{ lastActivityAt: "desc" }, { id: "asc" }],
          take: SOLVED_POOL_CAP,
          select: {
            id: true,
            slug: true,
            title: true,
            lastActivityAt: true,
            category: { select: { name: true } },
            acceptedAnswer: { select: { deleted: true } },
            tags: { select: { tagId: true } },
          },
        })
      : Promise.resolve([]),
    growOr.length
      ? prisma.growDiary.findMany({
          where: {
            deleted: false,
            ...publicDiaryWhere,
            author: activeAuthor(),
            authorId: authorExcluded,
            ...(refDiary ? { id: { not: refDiary.id } } : {}),
            OR: growOr,
          },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          take: GROW_POOL_CAP,
          select: GROW_SELECT,
        })
      : Promise.resolve([]),
  ])

  // Solved: require a LIVE accepted answer (acceptedAnswerId can point at
  // a deleted post), rank tag-overlap → activity → id.
  const ownTags = new Set(tagIds)
  const solved = solvedPool
    .filter((t) => t.acceptedAnswer && !t.acceptedAnswer.deleted)
    .map((t) => ({
      slug: t.slug,
      title: t.title,
      categoryName: t.category.name,
      overlap: t.tags.filter((tt) => ownTags.has(tt.tagId)).length,
      activity: t.lastActivityAt.getTime(),
      id: t.id,
    }))
    .sort((a, b) => b.overlap - a.overlap || b.activity - a.activity || a.id.localeCompare(b.id))
    .slice(0, SOLVED_RESULT)
    .map(({ slug, title, categoryName }) => ({ slug, title, categoryName }))

  // Grows: context-ref → scoreGrowMatch with the same MIN_SCORE bar; tag
  // signals → deterministic recent-first list with a public reason.
  let grows: GrowEvidenceItem[] = []
  if (refDiary && growPool.length) {
    const refScore = {
      strainId: refDiary.strainId,
      strainName: refDiary.strainRef?.name ?? refDiary.strain,
      mediumType: refDiary.mediumType,
      lightType: refDiary.lightType,
      growType: refDiary.growType,
      techniques: refDiary.techniques,
      stage: refDiary.stage,
    }
    grows = growPool
      .map((d) => ({
        d,
        ...scoreGrowMatch(refScore, {
          strainId: d.strainId,
          strain: d.strain,
          strainRefName: d.strainRef?.name ?? null,
          mediumType: d.mediumType,
          lightType: d.lightType,
          growType: d.growType,
          techniques: d.techniques,
          stage: d.stage,
        }),
      }))
      .filter((s) => s.score >= MIN_SCORE)
      .sort((a, b) => b.score - a.score || b.d.updatedAt.getTime() - a.d.updatedAt.getTime() || a.d.id.localeCompare(b.d.id))
      .slice(0, GROW_RESULT)
      .map((s) => ({
        href: diaryPath(s.d),
        title: s.d.title,
        stage: s.d.stage,
        harvested: s.d.harvested,
        strainName: s.d.strainRef?.name ?? s.d.strain,
        authorName: authorName(s.d),
        reason: s.reasons[0]?.label ?? null,
      }))
  } else if (growPool.length) {
    const strainTagNorms = new Set(signals.strainTagNames.map(normKey))
    grows = growPool
      .filter((d) => {
        if (!signals.strainIds.length && !signals.strainTagNames.length) return true
        if (d.strainId && signals.strainIds.includes(d.strainId)) return true
        return !!d.strain && strainTagNorms.has(normKey(d.strain))
      })
      .slice(0, GROW_RESULT)
      .map((d) => ({
        href: diaryPath(d),
        title: d.title,
        stage: d.stage,
        harvested: d.harvested,
        strainName: d.strainRef?.name ?? d.strain,
        authorName: authorName(d),
        reason:
          d.strainId || d.strain
            ? `Grows ${d.strainRef?.name ?? d.strain}`
            : "Similar setup",
      }))
  }

  // Strain knowledge: structured identification only — linked grow's
  // catalog strain → catalog-resolved tag → conservative free-text
  // suggestion. getStrainKnowledge supplies the honesty-tiered summary.
  let strain: StrainEvidenceItem | null = null
  const strainRef =
    refDiary?.strainRef ??
    (signals.strainIds.length
      ? await prisma.strain.findFirst({
          where: { id: { in: signals.strainIds } },
          orderBy: { name: "asc" },
          select: { id: true, slug: true, name: true },
        })
      : null) ??
    (await suggestStrainLink(refDiary?.strain))
  if (strainRef) {
    const knowledge = await (opts.getKnowledge ?? getStrainKnowledge)(strainRef.name, strainRef.id)
    strain = {
      name: strainRef.name,
      href: strainPath(strainRef),
      summary: knowledge.stats.label || "Community strain profile",
    }
  }

  // Public signals usable for contextual grower suggestions: the tag
  // extraction plus — only when the viewer can see the linked grow —
  // that grow's public matching fields (same rule as refDiary matching).
  const refName = refDiary ? (refDiary.strainRef?.name ?? refDiary.strain) : null
  const growerSignals: QuestionSignals = refDiary
    ? {
        ...signals,
        strainIds: [...new Set([...signals.strainIds, ...(refDiary.strainId ? [refDiary.strainId] : [])])],
        strainTagNames: [...new Set([...signals.strainTagNames, ...(refName ? [refName.toLowerCase()] : [])])],
        techniqueKeys: [...new Set([...signals.techniqueKeys, ...refDiary.techniques])],
        mediumTypes: [...new Set([...signals.mediumTypes, ...(refDiary.mediumType ? [refDiary.mediumType] : [])])],
        lightTypes: [...new Set([...signals.lightTypes, ...(refDiary.lightType ? [refDiary.lightType] : [])])],
        growTypes: [...new Set([...signals.growTypes, refDiary.growType])],
      }
    : signals

  return { isQuestion: true, solved, grows, strain, signals: growerSignals }
}

/**
 * Whether the asker may be offered a person-follow prompt on an accepted
 * answer. Pure eligibility — active-author and block filtering happen in
 * the accepted-answer query; this adds the asker/consent rules on top.
 * The follow itself still goes through POST /api/follows (the
 * authoritative endpoint); nothing auto-follows.
 */
export function helperFollowPromptAllowed(input: {
  viewerId: string | undefined
  threadAuthorId: string
  answerAuthorId: string
  answerAuthorUsername: string | null | undefined
  alreadyFollowing: boolean
  blockedIds: string[]
  terpbotUsername: string
}): boolean {
  const { viewerId, threadAuthorId, answerAuthorId, answerAuthorUsername, alreadyFollowing, blockedIds, terpbotUsername } = input
  if (!viewerId || viewerId !== threadAuthorId) return false
  if (answerAuthorId === viewerId) return false
  if (alreadyFollowing) return false
  if (blockedIds.includes(answerAuthorId)) return false
  if (answerAuthorUsername === terpbotUsername) return false
  return true
}
