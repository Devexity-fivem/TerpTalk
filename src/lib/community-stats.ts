// Community-level aggregate grow analytics — the privacy contract lives here.
//
// Everything returned is aggregate-only: counts, distributions, and medians.
// No diary/user/thread IDs, no usernames, no exact dates, no free text —
// the select lists below are deliberately restricted to controlled-vocab
// and numeric fields, and the summarizers emit only rolled-up values.
//
// Sample-size floors (see the Community Analytics blueprint):
//   NUMERIC_MIN = 5  — medians, durations, rates
//   LABEL_MIN   = 3  — a distribution row needs ≥3 contributing diaries
//   CROSS_MIN   = 10 — reserved for future cross-dimensional stats
// Below the floor a metric reports suppressed: true and value: null —
// thin samples are disclosed, never presented as zero or as knowledge.

import { prisma } from "@/lib/prisma"
import { unstable_cache } from "next/cache"
import { toGrams, toOz } from "@/lib/yield"
import { activeAuthor } from "@/lib/security"
import { median } from "@/lib/diary-weeks"
import {
  MEDIUM_LABELS,
  LIGHT_LABELS,
  TECHNIQUE_LABELS,
  GROW_TYPE_LABELS,
} from "@/lib/grow-fields"
import { wizardResultToTag } from "@/lib/symptom-tags"
import { publicDiaryWhere } from "@/lib/diary-visibility"

export const NUMERIC_MIN = 5
export const LABEL_MIN = 3
/** Reserved for future cross-dimensional stats (e.g. yield-by-medium). */
export const CROSS_MIN = 10

const DAY_MS = 86400000
const HOUR_MS = 3600000

export interface DistRow {
  /** Controlled-vocabulary key — never free text, never an ID. */
  value: string
  label: string
  count: number
  /** Share of the dimension's sample, whole percent. */
  pct: number
}

export interface Distribution {
  /** Rows with count < LABEL_MIN are dropped — rare picks don't surface. */
  rows: DistRow[]
  /** Diaries contributing to this dimension (the field was set). */
  n: number
  /** true when n < LABEL_MIN — the whole dimension stays hidden. */
  suppressed: boolean
}

export interface NumericStat {
  value: number | null
  n: number
  /** true when n < NUMERIC_MIN — value stays null, never zero. */
  suppressed: boolean
}

// ─── Community grow stats ────────────────────────────────────────────

/** The only diary fields community analytics may read — select-limited. */
export interface CommunityDiaryRow {
  authorId: string
  startDate: Date | string
  harvested: boolean
  harvestedAt: Date | string | null
  yieldAmount: number | null
  yieldUnit: string | null
  harvestRating: number | null
  harvestDifficulty: string | null
  mediumType: string | null
  lightType: string | null
  growType: string
  techniques: string[]
}

export interface CommunityGrowStats {
  /** All live diaries — honest total even when the stats window truncates. */
  growCount: number
  /** Distinct active authors behind those diaries. */
  growerCount: number
  harvestedCount: number
  /** Diaries the aggregates were computed over (≤ the bounded window). */
  window: number
  methods: {
    mediums: Distribution
    lights: Distribution
    growTypes: Distribution
    techniques: Distribution
  }
  harvest: {
    medianYieldOz: NumericStat
    /** Oz-band distribution of reported yields — no raw min/max. */
    yieldBuckets: Distribution
    medianTotalDays: NumericStat
    /** Count of harvests per 1–10 rating value. */
    ratings: Distribution
    difficulty: {
      easy: number
      normal: number
      hard: number
      total: number
      suppressed: boolean
    }
  }
  tier: "none" | "minimal" | "early" | "established"
  label: string
}

function distribution(
  counts: Map<string, number>,
  n: number,
  labels: Record<string, string>
): Distribution {
  const suppressed = n < LABEL_MIN
  const rows = suppressed
    ? []
    : [...counts.entries()]
        .filter(([, count]) => count >= LABEL_MIN)
        .sort((a, b) => b[1] - a[1])
        .map(([value, count]) => ({
          value,
          label: labels[value] ?? value,
          count,
          pct: Math.round((count / n) * 100),
        }))
  return { rows, n, suppressed }
}

/**
 * Fixed-band histogram (yield bands, rating values). Unlike open label
 * distributions, every band is a known bucket — a band holding one
 * harvest can't identify anyone, so all nonzero bands are shown. The
 * whole histogram still requires NUMERIC_MIN contributors.
 */
function histogram(counts: Map<string, number>, n: number, order: string[]): Distribution {
  const suppressed = n < NUMERIC_MIN
  const rows = suppressed
    ? []
    : order
        .filter((v) => (counts.get(v) ?? 0) > 0)
        .map((value) => ({
          value,
          label: value,
          count: counts.get(value)!,
          pct: Math.round((counts.get(value)! / n) * 100),
        }))
  return { rows, n, suppressed }
}

/** Yield bands in ounces — bands, not endpoints, so no single harvest is pinned. */
const YIELD_BANDS: [string, number, number][] = [
  ["under 1 oz", 0, 1],
  ["1–2 oz", 1, 2],
  ["2–4 oz", 2, 4],
  ["4–8 oz", 4, 8],
  ["8+ oz", 8, Infinity],
]

/**
 * Pure aggregation over already-filtered diary rows — exported so tests
 * can exercise the exact production math without the cache wrapper.
 */
export function summarizeCommunityDiaries(
  diaries: CommunityDiaryRow[],
  growCount: number
): CommunityGrowStats {
  const mediumCounts = new Map<string, number>()
  const lightCounts = new Map<string, number>()
  const growTypeCounts = new Map<string, number>()
  const techniqueCounts = new Map<string, number>()
  let mediumN = 0
  let lightN = 0
  let techniqueN = 0
  let growTypeN = 0
  const growers = new Set<string>()

  const yieldsOz: number[] = []
  const totalDays: number[] = []
  const ratings = new Map<string, number>()
  const difficulty = { easy: 0, normal: 0, hard: 0, total: 0, suppressed: false }
  let harvestedCount = 0

  for (const d of diaries) {
    growers.add(d.authorId)
    if (d.mediumType) {
      mediumN++
      mediumCounts.set(d.mediumType, (mediumCounts.get(d.mediumType) ?? 0) + 1)
    }
    if (d.lightType) {
      lightN++
      lightCounts.set(d.lightType, (lightCounts.get(d.lightType) ?? 0) + 1)
    }
    growTypeN++
    growTypeCounts.set(d.growType, (growTypeCounts.get(d.growType) ?? 0) + 1)
    if (d.techniques.length > 0) {
      techniqueN++
      for (const t of d.techniques) techniqueCounts.set(t, (techniqueCounts.get(t) ?? 0) + 1)
    }

    if (d.harvested && d.harvestedAt) {
      harvestedCount++
      const days = (new Date(d.harvestedAt).getTime() - new Date(d.startDate).getTime()) / DAY_MS
      if (days > 0 && days < 1000) totalDays.push(days)
      if (d.yieldAmount != null) yieldsOz.push(toOz(toGrams(d.yieldAmount, d.yieldUnit)))
      if (d.harvestRating != null) {
        const key = String(d.harvestRating)
        ratings.set(key, (ratings.get(key) ?? 0) + 1)
      }
      if (d.harvestDifficulty === "EASY") difficulty.easy++
      else if (d.harvestDifficulty === "NORMAL") difficulty.normal++
      else if (d.harvestDifficulty === "HARD") difficulty.hard++
    }
  }
  difficulty.total = difficulty.easy + difficulty.normal + difficulty.hard
  difficulty.suppressed = difficulty.total < LABEL_MIN

  const bucketCounts = new Map<string, number>()
  for (const oz of yieldsOz) {
    const band = YIELD_BANDS.find(([, lo, hi]) => oz >= lo && oz < hi)
    if (band) bucketCounts.set(band[0], (bucketCounts.get(band[0]) ?? 0) + 1)
  }

  const round1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10)
  const numeric = (value: number | null, n: number): NumericStat => ({
    value: n >= NUMERIC_MIN ? value : null,
    n,
    suppressed: n < NUMERIC_MIN,
  })

  const n = diaries.length
  return {
    growCount,
    growerCount: growers.size,
    harvestedCount,
    window: n,
    methods: {
      mediums: distribution(mediumCounts, mediumN, MEDIUM_LABELS as Record<string, string>),
      lights: distribution(lightCounts, lightN, LIGHT_LABELS as Record<string, string>),
      growTypes: distribution(growTypeCounts, growTypeN, GROW_TYPE_LABELS),
      techniques: distribution(techniqueCounts, techniqueN, TECHNIQUE_LABELS as Record<string, string>),
    },
    harvest: {
      medianYieldOz: numeric(round1(median(yieldsOz)), yieldsOz.length),
      yieldBuckets: histogram(
        bucketCounts,
        yieldsOz.length,
        YIELD_BANDS.map(([label]) => label)
      ),
      medianTotalDays: numeric(median(totalDays) == null ? null : Math.round(median(totalDays)!), totalDays.length),
      ratings: histogram(
        ratings,
        [...ratings.values()].reduce((a, b) => a + b, 0),
        Array.from({ length: 10 }, (_, i) => String(i + 1))
      ),
      difficulty,
    },
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
}

const getGrowStats = unstable_cache(
  async (): Promise<CommunityGrowStats> => {
    const where = { deleted: false, author: activeAuthor(), ...publicDiaryWhere }
    // Bounded window (same pattern as strain-stats) + an honest total count
    // so "N community grows" stays accurate even once diaries exceed it.
    const [diaries, growCount] = await Promise.all([
      prisma.growDiary.findMany({
        where,
        select: {
          authorId: true,
          startDate: true,
          harvested: true,
          harvestedAt: true,
          yieldAmount: true,
          yieldUnit: true,
          harvestRating: true,
          harvestDifficulty: true,
          mediumType: true,
          lightType: true,
          growType: true,
          techniques: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: 1000,
      }),
      prisma.growDiary.count({ where }),
    ])
    return summarizeCommunityDiaries(diaries, growCount)
  },
  ["community-grow-stats"],
  { revalidate: 300, tags: ["analytics"] }
)

export function getCommunityGrowStats() {
  return getGrowStats()
}

// ─── Plant Doctor outcome stats ──────────────────────────────────────

/** The only thread fields symptom analytics may read — select-limited. */
export interface SymptomThreadRow {
  wizardResultId: string | null
  createdAt: Date | string
  acceptedAnswer: { deleted: boolean; createdAt: Date | string } | null
}

export interface SymptomTagStats {
  slug: string
  name: string
  threads: number
  solved: number
  /** Whole percent, null when the tag has no threads. */
  solvedPct: number | null
  /** Median hours thread→accepted answer; null when answerN < NUMERIC_MIN. */
  medianHoursToAnswer: number | null
  /** Accepted answers contributing to the median. */
  answerN: number
}

export interface SymptomStats {
  threadCount: number
  solvedCount: number
  solvedPct: number | null
  medianHoursToAnswer: number | null
  answerN: number
  topTags: SymptomTagStats[]
}

/**
 * Pure aggregation over already-filtered Plant Doctor thread rows.
 * A thread counts as solved only when its accepted answer exists and is
 * not deleted — the pointer can outlive the post on legacy rows.
 */
export function summarizeSymptomThreads(threads: SymptomThreadRow[]): SymptomStats {
  const byTag = new Map<
    string,
    { slug: string; name: string; threads: number; solved: number; hours: number[] }
  >()
  const allHours: number[] = []
  let threadCount = 0
  let solvedCount = 0

  for (const t of threads) {
    const tag = wizardResultToTag(t.wizardResultId)
    if (!tag) continue // result IDs outside the taxonomy — skip, don't guess
    threadCount++
    let g = byTag.get(tag.slug)
    if (!g) {
      g = { slug: tag.slug, name: tag.name, threads: 0, solved: 0, hours: [] }
      byTag.set(tag.slug, g)
    }
    g.threads++
    if (t.acceptedAnswer && !t.acceptedAnswer.deleted) {
      g.solved++
      solvedCount++
      const hours =
        (new Date(t.acceptedAnswer.createdAt).getTime() - new Date(t.createdAt).getTime()) / HOUR_MS
      // Same sanity bounds as grow durations — a stale pointer can't
      // produce a negative or absurd outlier median.
      if (hours >= 0 && hours < 24 * 365) {
        g.hours.push(hours)
        allHours.push(hours)
      }
    }
  }

  const topTags = [...byTag.values()]
    .sort((a, b) => b.threads - a.threads)
    .map((g) => ({
      slug: g.slug,
      name: g.name,
      threads: g.threads,
      solved: g.solved,
      solvedPct: Math.round((g.solved / g.threads) * 100),
      medianHoursToAnswer: g.hours.length >= NUMERIC_MIN ? Math.round(median(g.hours)!) : null,
      answerN: g.hours.length,
    }))

  return {
    threadCount,
    solvedCount,
    solvedPct: threadCount ? Math.round((solvedCount / threadCount) * 100) : null,
    medianHoursToAnswer: allHours.length >= NUMERIC_MIN ? Math.round(median(allHours)!) : null,
    answerN: allHours.length,
    topTags,
  }
}

const getSymptomStatsCached = unstable_cache(
  async (): Promise<SymptomStats> => {
    const threads = await prisma.thread.findMany({
      where: {
        deleted: false,
        author: activeAuthor(),
        // wizardResultId is only writable on this category, but the slug
        // scoping keeps the aggregate honest even if that ever changes.
        category: { slug: "plant-problems" },
        wizardResultId: { not: null },
      },
      select: {
        wizardResultId: true,
        createdAt: true,
        acceptedAnswer: { select: { deleted: true, createdAt: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 1000,
    })
    return summarizeSymptomThreads(threads)
  },
  ["symptom-stats"],
  { revalidate: 300, tags: ["analytics"] }
)

export function getSymptomStats() {
  return getSymptomStatsCached()
}
