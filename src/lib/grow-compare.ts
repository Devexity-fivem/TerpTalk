/**
 * Grow comparison — privacy-safe, deterministic "your grow vs the
 * community" rows for the diary page. Community values come from
 * getStrainGrowStats (public/UNLISTED diaries only, already min-sample
 * gated); the diary's own numbers are facts already visible on the page.
 *
 * Language contract: comparisons are descriptive, never judgmental —
 * "community median", "across N grows". No ordering growers against each
 * other, no grading, no invented baselines. A row is emitted only when
 * both sides have real data.
 */
import type { StrainGrowStats } from "@/lib/strain-stats"
import type { StageDuration } from "@/lib/diary-weeks"

export interface CompareRow {
  label: string
  yours: string
  community: string
  /** factual relative note — "above/below the median", only when honest */
  note?: string
}

const STAGE_LABELS: Record<string, string> = {
  GERMINATION: "germination",
  SEEDLING: "seedling",
  VEGETATIVE: "vegetative",
  FLOWER: "flowering",
  HARVEST: "harvest",
  DRYING: "drying",
  CURING: "curing",
}

function relativeNote(yours: number, median: number, unit: string): string | undefined {
  const delta = yours - median
  const pct = Math.abs(delta) / Math.max(median, 1)
  if (pct < 0.08) return "close to the community median"
  return delta > 0 ? `${Math.round(Math.abs(delta))}${unit} above the community median` : `${Math.round(Math.abs(delta))}${unit} below the community median`
}

export function buildGrowComparison(input: {
  stageRuns: StageDuration[]
  totalDays: number
  harvested: boolean
  yieldOz: number | null
  harvestRating: number | null
  avgTemp: number | null
  avgRh: number | null
  stats: StrainGrowStats
}): CompareRow[] {
  const { stats } = input
  const rows: CompareRow[] = []
  if (stats.tier === "none" || stats.growCount === 0) return rows

  // Stage timing — compare completed runs against community medians.
  // The diary's CURRENT open run is skipped: an in-progress stage is
  // censored data and would inflate the "yours" side unfairly.
  const openStage = !input.harvested ? input.stageRuns[input.stageRuns.length - 1]?.stage : null
  const stageRows: CompareRow[] = []
  for (const run of input.stageRuns) {
    if (run.stage === openStage) continue
    const med = stats.stageDurations.find((s) => s.stage === run.stage)
    if (!med || med.medianDays == null) continue
    const label = STAGE_LABELS[run.stage] ?? run.stage.toLowerCase()
    stageRows.push({
      label: `Time in ${label}`,
      yours: `${run.days}d`,
      community: `median ${med.medianDays}d across ${med.n} grow${med.n === 1 ? "" : "s"}`,
      note: relativeNote(run.days, med.medianDays, "d"),
    })
  }
  rows.push(...stageRows.slice(0, 3))

  // Total grow length — only meaningful once harvested (the run closed).
  if (input.harvested && stats.avgTotalDays != null) {
    rows.push({
      label: "Grow length",
      yours: `${input.totalDays}d`,
      community: `average ${stats.avgTotalDays}d across ${stats.totalDaysSample} harvested grow${stats.totalDaysSample === 1 ? "" : "s"}`,
    })
  }

  // Yield — community median only exists at minSample; neutral framing.
  if (input.yieldOz != null && stats.medianYieldOz != null) {
    rows.push({
      label: "Harvest yield",
      yours: `${input.yieldOz}oz`,
      community: `median ${stats.medianYieldOz}oz across ${stats.yieldSample} grow${stats.yieldSample === 1 ? "" : "s"}`,
      note: relativeNote(input.yieldOz, stats.medianYieldOz, "oz"),
    })
  }

  if (input.harvestRating != null && stats.avgRating != null) {
    rows.push({
      label: "Harvest rating",
      yours: `${input.harvestRating}/10`,
      community: `average ${stats.avgRating}/10 across ${stats.ratingSample} grow${stats.ratingSample === 1 ? "" : "s"}`,
    })
  }

  if (input.avgTemp != null && stats.env.temp != null) {
    rows.push({
      label: "Average temp",
      yours: `${input.avgTemp}°F`,
      community: `average ${stats.env.temp}°F across ${stats.envSamples.temp} grow${stats.envSamples.temp === 1 ? "" : "s"}`,
    })
  }
  if (input.avgRh != null && stats.env.rh != null) {
    rows.push({
      label: "Average RH",
      yours: `${input.avgRh}%`,
      community: `average ${stats.env.rh}% across ${stats.envSamples.rh} grow${stats.envSamples.rh === 1 ? "" : "s"}`,
    })
  }

  return rows.slice(0, 6)
}
