import { prisma } from "@/lib/prisma"
import { unstable_cache } from "next/cache"
import { toGrams, toOz } from "@/lib/yield"
import { activeAuthor, publicUserSelect } from "@/lib/security"
import { DIFFICULTY_LABELS, MEDIUM_LABELS, LIGHT_LABELS, TECHNIQUE_LABELS } from "@/lib/grow-fields"

const DAY_MS = 86400000

// Escape user-controlled strings before they reach a `contains` (ILIKE) filter —
// strain names are user-created and could otherwise inject %/_ wildcards.
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

// Normalize a strain name for comparison: lowercase, strip punctuation.
export function normalizeStrain(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

/**
 * Does a free-text diary/setup strain field refer to the catalog strain?
 * Exact normalized match OR catalog name followed by a descriptor
 * ("Blue Dream Auto" counts under "Blue Dream"). Precision over recall:
 * word-substring hits ("Cheese" ≠ "Blue Cheese") and catalog-name
 * substrings of unrelated text are rejected.
 */
export function strainFieldMatches(field: string | null | undefined, strainName: string): boolean {
  if (!field) return false
  const norm = normalizeStrain(field)
  const match = normalizeStrain(strainName)
  if (!match) return false
  return norm === match || norm.startsWith(match + " ")
}

export interface StrainGrowStats {
  growCount: number
  growerCount: number
  setupCount: number
  harvestedCount: number
  /** null = insufficient data for this metric */
  avgYieldOz: number | null
  yieldSample: number
  medianYieldOz: number | null
  topYieldOz: number | null
  avgTotalDays: number | null
  totalDaysSample: number
  avgFlowerDays: number | null
  flowerSample: number
  env: { temp: number | null; rh: number | null; vpd: number | null; ph: number | null; ec: number | null }
  envSamples: { temp: number; rh: number; vpd: number; ph: number; ec: number }
  /** null = insufficient data (fewer than 3 reviews) */
  avgRating: number | null
  ratingSample: number
  difficulty: { easy: number; normal: number; hard: number; total: number }
  topMediums: string[]
  topLightTypes: string[]
  topTechniques: string[]
  /** Member-authored harvest notes — attributed, not anonymized (they're
   *  public diary content, same as the linked-grows list). */
  reviews: { rating: number | null; difficulty: string | null; notes: string; authorName: string; diaryId: string }[]
  /** Honesty tier driven by sample size — the UI must show this. */
  tier: "none" | "minimal" | "early" | "established"
  label: string
}



const getStats = unstable_cache(
  async (strainName: string, strainId: string): Promise<StrainGrowStats> => {
    const [rawDiaries, rawSetups] = await Promise.all([
      prisma.growDiary.findMany({
        where: {
          deleted: false,
          author: activeAuthor(),
          // Union match: structured strainId OR the legacy fuzzy text path.
          // One row per diary either way — no double counting is possible.
          OR: [
            { strainId },
            { strain: { contains: escapeLike(strainName), mode: "insensitive" } },
          ],
        },
        select: {
          id: true,
          authorId: true,
          startDate: true,
          harvested: true,
          harvestedAt: true,
          yieldAmount: true,
          yieldUnit: true,
          strain: true,
          strainId: true,
          title: true,
          mediumType: true,
          lightType: true,
          techniques: true,
          harvestRating: true,
          harvestDifficulty: true,
          harvestNotes: true,
          author: { select: publicUserSelect },
        },
        // Deterministic set + review order: newest diaries first, so both
        // the take:500 window and the attributed-note slice are stable.
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: 500,
      }),
      prisma.growSetup.findMany({
        where: {
          deleted: false,
          author: activeAuthor(),
          strain: { contains: escapeLike(strainName), mode: "insensitive" },
        },
        select: { strain: true },
        take: 500,
      }),
    ])

    // `contains` is a recall-oriented pre-filter served by the trigram index;
    // post-filter for precision so short/common names can't pollute stats.
    // A structured strainId match always counts — that's the explicit link.
    const diaries = rawDiaries.filter(
      (d) => d.strainId === strainId || strainFieldMatches(d.strain, strainName)
    )
    const setupCount = rawSetups.filter((s) => strainFieldMatches(s.strain, strainName)).length
    const diaryIds = diaries.map((d) => d.id)

    const [flowerOnsets, envAgg] = diaryIds.length
      ? await Promise.all([
          prisma.diaryUpdate.findMany({
            where: { stage: "FLOWER", diaryId: { in: diaryIds } },
            orderBy: { createdAt: "asc" },
            distinct: ["diaryId"],
            select: { diaryId: true, createdAt: true },
          }),
          prisma.diaryUpdate.aggregate({
            where: { diaryId: { in: diaryIds } },
            _avg: { temperature: true, humidity: true, vpd: true, ph: true, ec: true },
            _count: { temperature: true, humidity: true, vpd: true, ph: true, ec: true },
          }),
        ])
      : [[], null]

    const onsetByDiary = new Map((flowerOnsets as { diaryId: string; createdAt: Date }[]).map((f) => [f.diaryId, f.createdAt]))

    const yieldsG: number[] = []
    const totalDays: number[] = []
    const flowerDays: number[] = []
    for (const d of diaries) {
      if (d.harvested && d.harvestedAt) {
        const days = (new Date(d.harvestedAt).getTime() - new Date(d.startDate).getTime()) / DAY_MS
        if (days > 0 && days < 1000) totalDays.push(days)
        const onset = onsetByDiary.get(d.id)
        if (onset) {
          const fd = (new Date(d.harvestedAt).getTime() - new Date(onset).getTime()) / DAY_MS
          if (fd > 0 && fd < 500) flowerDays.push(fd)
        }
      }
      if (d.yieldAmount != null) yieldsG.push(toGrams(d.yieldAmount, d.yieldUnit))
    }
    yieldsG.sort((a, b) => a - b)

    const n = diaries.length
    const harvestedCount = diaries.filter((d) => d.harvested).length
    const avgN = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null)
    const round1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10)

    // Member-review + structured-field aggregates.
    const ratings = diaries.map((d) => d.harvestRating).filter((r): r is number => r != null)
    const difficulty = {
      easy: diaries.filter((d) => d.harvestDifficulty === "EASY").length,
      normal: diaries.filter((d) => d.harvestDifficulty === "NORMAL").length,
      hard: diaries.filter((d) => d.harvestDifficulty === "HARD").length,
      total: 0,
    }
    difficulty.total = difficulty.easy + difficulty.normal + difficulty.hard

    const topOf = (pairs: [string, number][], labels: Record<string, string>) =>
      pairs
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k]) => labels[k] ?? k)
    const mediumCounts = new Map<string, number>()
    const lightCounts = new Map<string, number>()
    const techniqueCounts = new Map<string, number>()
    for (const d of diaries) {
      if (d.mediumType) mediumCounts.set(d.mediumType, (mediumCounts.get(d.mediumType) ?? 0) + 1)
      if (d.lightType) lightCounts.set(d.lightType, (lightCounts.get(d.lightType) ?? 0) + 1)
      for (const t of d.techniques) techniqueCounts.set(t, (techniqueCounts.get(t) ?? 0) + 1)
    }

    const reviews = diaries
      .filter((d) => d.harvestNotes && d.harvestNotes.trim())
      .slice(0, 6)
      .map((d) => ({
        rating: d.harvestRating,
        difficulty: d.harvestDifficulty
          ? DIFFICULTY_LABELS[d.harvestDifficulty as keyof typeof DIFFICULTY_LABELS] ?? d.harvestDifficulty
          : null,
        notes: d.harvestNotes!.trim(),
        authorName: d.author.profile?.username || d.author.name || "Member",
        diaryId: d.id,
      }))

    return {
      growCount: n,
      growerCount: new Set(diaries.map((d) => d.authorId)).size,
      setupCount,
      harvestedCount,
      avgYieldOz: yieldsG.length >= 2 ? round1(toOz(avgN(yieldsG)!)) : null,
      yieldSample: yieldsG.length,
      medianYieldOz: yieldsG.length >= 3 ? round1(toOz(yieldsG[Math.floor(yieldsG.length / 2)])) : null,
      topYieldOz: yieldsG.length >= 2 ? round1(toOz(yieldsG[yieldsG.length - 1])) : null,
      avgTotalDays: totalDays.length >= 2 ? Math.round(avgN(totalDays)!) : null,
      totalDaysSample: totalDays.length,
      avgFlowerDays: flowerDays.length >= 2 ? Math.round(avgN(flowerDays)!) : null,
      flowerSample: flowerDays.length,
      env: envAgg
        ? {
            temp: round1(envAgg._avg.temperature),
            rh: round1(envAgg._avg.humidity),
            vpd: round1(envAgg._avg.vpd),
            ph: round1(envAgg._avg.ph),
            ec: round1(envAgg._avg.ec),
          }
        : { temp: null, rh: null, vpd: null, ph: null, ec: null },
      envSamples: envAgg
        ? {
            temp: envAgg._count.temperature,
            rh: envAgg._count.humidity,
            vpd: envAgg._count.vpd,
            ph: envAgg._count.ph,
            ec: envAgg._count.ec,
          }
        : { temp: 0, rh: 0, vpd: 0, ph: 0, ec: 0 },
      avgRating: ratings.length >= 3 ? round1(avgN(ratings)!) : null,
      ratingSample: ratings.length,
      difficulty,
      topMediums: topOf([...mediumCounts.entries()], MEDIUM_LABELS as Record<string, string>),
      topLightTypes: topOf([...lightCounts.entries()], LIGHT_LABELS as Record<string, string>),
      topTechniques: topOf([...techniqueCounts.entries()], TECHNIQUE_LABELS as Record<string, string>),
      reviews,
      tier: n === 0 ? "none" : n <= 2 ? "minimal" : n <= 4 ? "early" : "established",
      label:
        n === 0
          ? ""
          : n <= 2
            ? "Not enough community data yet"
            : n <= 4
              ? `Early community data — ${n} grows`
              : `Based on ${n} community grows`,
    }
  },
  ["strain-grow-stats"],
  { revalidate: 300, tags: ["strains"] }
)

export function getStrainGrowStats(strainName: string, strainId: string) {
  return getStats(strainName, strainId)
}

/**
 * Suggest a canonical catalog strain for a legacy free-text value.
 * Conservative by design: a suggestion is returned only when EXACTLY ONE
 * catalog name produces a normalized-exact match — "blue dream" /
 * "BLUE-DREAM" can suggest "Blue Dream", but "Blue Dream Auto" gets
 * nothing (prefix-fuzzy ≠ exact), and "OG" matching multiple entries gets
 * nothing. No suggestion is always preferred over a wrong association.
 *
 * The query is prefiltered on the input's first normalized token (which
 * must be a substring of the raw catalog name for an exact-normalized
 * match to be possible) so the catalog scan stays bounded.
 */
export async function suggestStrainLink(
  strainText: string | null | undefined
): Promise<{ id: string; name: string } | null> {
  const normalized = normalizeStrain(strainText ?? "")
  if (!normalized) return null
  const firstToken = normalized.split(" ")[0]
  const candidates = await prisma.strain.findMany({
    where: { name: { contains: firstToken, mode: "insensitive" } },
    select: { id: true, name: true },
    take: 100,
  })
  const matches = candidates.filter((s) => normalizeStrain(s.name) === normalized)
  return matches.length === 1 ? matches[0] : null
}
