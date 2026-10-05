// Grows-Like-Yours — the canonical deterministic grow matcher. One source,
// consumed by member home, the weekly digest, and /mydigest.
//
// Model: the viewer's own most-relevant PUBLIC diary is the reference;
// candidate PUBLIC diaries are compared on the structured fields the
// schema actually stores — strain, medium, lighting, techniques, grow
// type, stage. Every point of score maps to a visible, explainable reason
// — no embeddings, no opaque similarity.
//
// Privacy: candidates are public-discovery scope only (PUBLIC, not
// deleted, active author, no block in either direction). The viewer's
// PRIVATE/UNLISTED diaries are never a reference and never a candidate —
// matching only uses grow data the member chose to make discoverable.
import { prisma } from "@/lib/prisma"
import { activeAuthor, blockedUserIds, publicUserSelect } from "@/lib/security"
import { publicDiaryWhere } from "@/lib/diary-visibility"
import { diaryPath } from "@/lib/slugs"
import type { Prisma } from "@prisma/client"

// Bounded candidate pool → in-memory scoring → top RESULT_LIMIT. The pool
// is pre-filtered in SQL to grows sharing at least one attribute.
const CANDIDATE_CAP = 120
const RESULT_LIMIT = 3
// Below this a match is too weak to surface — a shared generic trait
// alone (e.g. "both indoor") never qualifies.
const MIN_SCORE = 30
const STRONG_SCORE = 55

// Weights follow informational value: same genetics >> same substrate >>
// same light >> shared technique >> common grow type >> same stage.
const W = { STRAIN: 40, MEDIUM: 20, LIGHTING: 15, TECHNIQUE: 8, GROW_TYPE: 10, STAGE: 5 }
const TECHNIQUE_CAP = 24

export type GrowMatchReasonKind = "STRAIN" | "MEDIUM" | "LIGHTING" | "TECHNIQUE" | "GROW_TYPE" | "STAGE"

export interface GrowMatchReason {
  kind: GrowMatchReasonKind
  label: string
}

export interface GrowMatch {
  diaryId: string
  href: string
  title: string
  stage: string
  harvested: boolean
  strainName: string | null
  author: { username: string | null; name: string | null; image: string | null }
  score: number
  strength: "STRONG" | "MODERATE"
  reasons: GrowMatchReason[]
}

export interface GrowMatchesResult {
  /** The member's grow used as the comparison baseline — null when they
   *  have no public diary (or none with comparable attributes). */
  reference: { diaryId: string; href: string; title: string; strainName: string | null } | null
  matches: GrowMatch[]
}

const MEDIUM_LABELS: Record<string, string> = {
  SOIL: "soil", COCO: "coco", HYDRO: "hydro", DWC: "DWC", LIVING_SOIL: "living soil", OTHER: "other",
}
const LIGHT_LABELS: Record<string, string> = {
  LED: "LED", HPS: "HPS", CMH: "CMH", FLUORESCENT: "fluorescent", SUN: "sun-grown", OTHER: "other",
}
const GROW_TYPE_LABELS: Record<string, string> = {
  INDOOR: "indoor", OUTDOOR: "outdoor", GREENHOUSE: "greenhouse", HYDROPONIC: "hydroponic", OTHER: "other",
}
const STAGE_LABELS: Record<string, string> = {
  GERMINATION: "germinating", SEEDLING: "seedling", VEGETATIVE: "in veg", FLOWER: "in flower",
  HARVEST: "at harvest", DRYING: "drying", CURING: "curing", COMPLETED: "completed",
}
const label = (map: Record<string, string>, v: string) => map[v] ?? v.toLowerCase()

const norm = (s: string | null | undefined) => (s ? s.trim().toLowerCase() : null)

const REF_SELECT = {
  id: true, slug: true, title: true, stage: true, strain: true, strainId: true,
  mediumType: true, lightType: true, growType: true, techniques: true,
  strainRef: { select: { name: true } },
} satisfies Prisma.GrowDiarySelect
type RefRow = Prisma.GrowDiaryGetPayload<{ select: typeof REF_SELECT }>

/**
 * The viewer's comparison baseline: their most recently touched live
 * public grow, else their most recent public grow at all. PRIVATE and
 * UNLISTED diaries never qualify — a member with no public grow gets no
 * reference and no matches.
 */
async function referenceGrowFor(userId: string): Promise<RefRow | null> {
  const base = { authorId: userId, deleted: false, visibility: "PUBLIC" }
  return (
    (await prisma.growDiary.findFirst({
      where: { ...base, harvested: false },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: REF_SELECT,
    })) ??
    (await prisma.growDiary.findFirst({
      where: base,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: REF_SELECT,
    }))
  )
}

interface ScoredCandidate {
  strainId: string | null
  strain: string | null
  strainRefName: string | null
  mediumType: string | null
  lightType: string | null
  growType: string
  techniques: string[]
  stage: string
}

/**
 * Pure scoring — exported for tests and for any consumer that already has
 * rows in memory. Reasons come from the same component hits that produced
 * the score, so an explanation can never disagree with the ranking.
 */
export function scoreGrowMatch(
  ref: { strainId: string | null; strainName: string | null; mediumType: string | null; lightType: string | null; growType: string; techniques: string[]; stage: string },
  cand: ScoredCandidate
): { score: number; reasons: GrowMatchReason[] } {
  let score = 0
  const reasons: GrowMatchReason[] = []

  const refStrain = norm(ref.strainName)
  const candStrain = norm(cand.strainRefName ?? cand.strain)
  if (refStrain && candStrain && ((ref.strainId && cand.strainId === ref.strainId) || refStrain === candStrain)) {
    score += W.STRAIN
    reasons.push({ kind: "STRAIN", label: `Same strain — ${cand.strainRefName ?? cand.strain}` })
  }
  if (ref.mediumType && cand.mediumType === ref.mediumType) {
    score += W.MEDIUM
    reasons.push({ kind: "MEDIUM", label: `Same medium — ${label(MEDIUM_LABELS, cand.mediumType)}` })
  }
  if (ref.lightType && cand.lightType === ref.lightType) {
    score += W.LIGHTING
    reasons.push({ kind: "LIGHTING", label: `Same lighting — ${label(LIGHT_LABELS, cand.lightType)}` })
  }
  const sharedTech = cand.techniques.filter((t) => ref.techniques.includes(t))
  if (sharedTech.length) {
    score += Math.min(sharedTech.length * W.TECHNIQUE, TECHNIQUE_CAP)
    reasons.push({ kind: "TECHNIQUE", label: `Shared techniques: ${sharedTech.join(", ")}` })
  }
  if (cand.growType === ref.growType) {
    score += W.GROW_TYPE
    reasons.push({ kind: "GROW_TYPE", label: `Both ${label(GROW_TYPE_LABELS, cand.growType)}` })
  }
  if (cand.stage === ref.stage) {
    score += W.STAGE
    reasons.push({ kind: "STAGE", label: `Same stage — ${label(STAGE_LABELS, cand.stage)}` })
  }
  return { score, reasons }
}

export async function growMatchesForUser(
  userId: string,
  opts: { /** Test seam: restrict the candidate pool to these diary ids. */ candidateIds?: string[] } = {}
): Promise<GrowMatchesResult> {
  const ref = await referenceGrowFor(userId)
  if (!ref) return { reference: null, matches: [] }

  const refName = ref.strainRef?.name ?? ref.strain
  // SQL pre-filter: candidates sharing at least one comparable attribute.
  // Skip unset dimensions entirely — a null never matches anything.
  const or: Prisma.GrowDiaryWhereInput[] = []
  if (ref.strainId) or.push({ strainId: ref.strainId })
  if (refName) {
    or.push({ strainRef: { is: { name: { equals: refName, mode: "insensitive" } } } })
    or.push({ strain: { equals: refName, mode: "insensitive" } })
  }
  if (ref.mediumType) or.push({ mediumType: ref.mediumType })
  if (ref.lightType) or.push({ lightType: ref.lightType })
  if (ref.techniques.length) or.push({ techniques: { hasSome: ref.techniques } })
  if (ref.growType) or.push({ growType: ref.growType })

  const refDto = {
    diaryId: ref.id,
    href: diaryPath(ref),
    title: ref.title,
    strainName: refName,
  }
  if (!or.length) return { reference: refDto, matches: [] }

  const blocked = await blockedUserIds(userId)
  const candidates = await prisma.growDiary.findMany({
    where: {
      deleted: false,
      ...publicDiaryWhere,
      author: activeAuthor(),
      authorId: { not: userId, ...(blocked.length ? { notIn: blocked } : {}) },
      OR: or,
      ...(opts.candidateIds ? { id: { in: opts.candidateIds } } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: CANDIDATE_CAP,
    select: {
      id: true, slug: true, title: true, stage: true, harvested: true, updatedAt: true,
      strain: true, strainId: true, mediumType: true, lightType: true, growType: true, techniques: true,
      strainRef: { select: { name: true } },
      author: { select: publicUserSelect },
    },
  })

  const refScore = {
    strainId: ref.strainId,
    strainName: refName,
    mediumType: ref.mediumType,
    lightType: ref.lightType,
    growType: ref.growType,
    techniques: ref.techniques,
    stage: ref.stage,
  }
  const scored = candidates
    .map((c) => ({
      c,
      ...scoreGrowMatch(refScore, {
        strainId: c.strainId,
        strain: c.strain,
        strainRefName: c.strainRef?.name ?? null,
        mediumType: c.mediumType,
        lightType: c.lightType,
        growType: c.growType,
        techniques: c.techniques,
        stage: c.stage,
      }),
    }))
    .filter((s) => s.score >= MIN_SCORE)
    // Deterministic: score → recent activity → id. Same input, same ranking.
    .sort((a, b) => b.score - a.score || b.c.updatedAt.getTime() - a.c.updatedAt.getTime() || a.c.id.localeCompare(b.c.id))
    .slice(0, RESULT_LIMIT)

  return {
    reference: refDto,
    matches: scored.map((s) => ({
      diaryId: s.c.id,
      href: diaryPath(s.c),
      title: s.c.title,
      stage: s.c.stage,
      harvested: s.c.harvested,
      strainName: s.c.strainRef?.name ?? s.c.strain,
      author: {
        username: s.c.author.profile?.username ?? null,
        name: s.c.author.name,
        image: s.c.author.image,
      },
      score: s.score,
      strength: s.score >= STRONG_SCORE ? "STRONG" : "MODERATE",
      reasons: s.reasons,
    })),
  }
}
