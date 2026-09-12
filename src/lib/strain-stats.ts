import { prisma } from "@/lib/prisma"
import { unstable_cache } from "next/cache"
import { toGrams, toOz } from "@/lib/yield"
import { activeAuthor } from "@/lib/security"

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
  /** Honesty tier driven by sample size — the UI must show this. */
  tier: "none" | "minimal" | "early" | "established"
  label: string
}



const getStats = unstable_cache(
  async (strainName: string): Promise<StrainGrowStats> => {
    const [rawDiaries, setupCount] = await Promise.all([
      prisma.growDiary.findMany({
        where: {
          deleted: false,
          author: activeAuthor(),
          strain: { contains: escapeLike(strainName), mode: "insensitive" },
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
        },
        take: 500,
      }),
      prisma.growSetup.count({
        where: {
          deleted: false,
          author: activeAuthor(),
          strain: { contains: escapeLike(strainName), mode: "insensitive" },
        },
      }),
    ])

    // `contains` is a recall-oriented pre-filter served by the trigram index;
    // post-filter for precision so short/common names can't pollute stats.
    const diaries = rawDiaries.filter((d) => strainFieldMatches(d.strain, strainName))
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

export function getStrainGrowStats(strainName: string) {
  return getStats(strainName)
}
