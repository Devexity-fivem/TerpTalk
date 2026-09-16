// Pure helpers for the grow-diary timeline. Week/day numbers are DERIVED from
// the update's createdAt relative to the diary startDate — never from the
// optional user-entered dayNumber/weekNumber fields, which are unvalidated
// annotations and can be missing, negative, or inconsistent.

export const STAGE_ORDER = [
  "GERMINATION",
  "SEEDLING",
  "VEGETATIVE",
  "FLOWER",
  "HARVEST",
  "DRYING",
  "CURING",
  "COMPLETED",
] as const

export interface DiaryUpdateLike {
  id: string
  stage: string
  createdAt: Date | string
  dayNumber?: number | null
  weekNumber?: number | null
  temperature?: number | null
  humidity?: number | null
  vpd?: number | null
  ph?: number | null
  ec?: number | null
  feeding?: string | null
  training?: string | null
  images?: { id: string }[]
}

export interface DiaryLike {
  startDate: Date | string
  stage?: string
  harvested: boolean
  harvestedAt?: Date | string | null
  yieldAmount?: number | null
  yieldUnit?: string | null
  strain?: string | null
  medium?: string | null
  lighting?: string | null
  nutrients?: string | null
  containerSize?: string | null
  equipment?: string | null
  spaceDimensions?: string | null
}

const DAY_MS = 86400000

/** Days since the diary started (1-based; update on startDate is day 1). */
export function diaryDay(startDate: Date | string, at: Date | string): number {
  const days = Math.floor(
    (new Date(at).getTime() - new Date(startDate).getTime()) / DAY_MS
  )
  return Math.max(1, days + 1)
}

/** Grow week (1-based; days 1–7 are week 1). */
export function diaryWeek(startDate: Date | string, at: Date | string): number {
  return Math.floor((diaryDay(startDate, at) - 1) / 7) + 1
}

export interface WeekGroup<T extends DiaryUpdateLike = DiaryUpdateLike> {
  week: number
  /** Most-advanced stage touched in this week (stage-order max). */
  stage: string
  /** Inclusive day range covered by the week's updates. */
  dayStart: number
  dayEnd: number
  updates: T[]
  photoCount: number
  /** True if any update in the week logged an environment reading. */
  hasEnv: boolean
}

/** Group chronologically-sorted updates into grow weeks, oldest week first. */
export function groupUpdatesByWeek<T extends DiaryUpdateLike>(
  updates: T[],
  startDate: Date | string
): WeekGroup<T>[] {
  const weeks = new Map<number, WeekGroup<T>>()
  for (const u of updates) {
    const week = diaryWeek(startDate, u.createdAt)
    const day = diaryDay(startDate, u.createdAt)
    let g = weeks.get(week)
    if (!g) {
      g = { week, stage: u.stage, dayStart: day, dayEnd: day, updates: [], photoCount: 0, hasEnv: false }
      weeks.set(week, g)
    }
    g.updates.push(u)
    g.dayStart = Math.min(g.dayStart, day)
    g.dayEnd = Math.max(g.dayEnd, day)
    g.photoCount += u.images?.length ?? 0
    if (u.temperature != null || u.humidity != null || u.vpd != null || u.ph != null || u.ec != null) {
      g.hasEnv = true
    }
    // Track the furthest stage reached in the week (non-linear, e.g. re-veg
    // shows as the most advanced stage touched that week)
    if (STAGE_ORDER.indexOf(u.stage as (typeof STAGE_ORDER)[number]) > STAGE_ORDER.indexOf(g.stage as (typeof STAGE_ORDER)[number])) {
      g.stage = u.stage
    }
  }
  return [...weeks.values()].sort((a, b) => a.week - b.week)
}

// ─── Harvest report ─────────────────────────────────────────────────

export interface HarvestReport {
  yieldAmount: number | null
  yieldUnit: string | null
  harvestedAt: Date
  totalDays: number
  vegDays: number | null
  flowerDays: number | null
  updateCount: number
  photoCount: number
  avgTemp: number | null
  avgHumidity: number | null
  avgVpd: number | null
  avgPh: number | null
  avgEc: number | null
  stageDays: { stage: string; days: number }[]
  trainingTechniques: string[]
}

function avg(values: (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && isFinite(v))
  return nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null
}

/** Summarize a harvested diary into a report card. Returns null if not harvested. */
export function buildHarvestReport(
  diary: DiaryLike,
  updates: DiaryUpdateLike[]
): HarvestReport | null {
  if (!diary.harvested || !diary.harvestedAt) return null
  const start = new Date(diary.startDate).getTime()
  const end = new Date(diary.harvestedAt).getTime()
  const totalDays = Math.max(1, Math.round((end - start) / DAY_MS))

  const firstFlower = updates.find((u) => u.stage === "FLOWER")
  const vegDays = firstFlower
    ? Math.max(0, Math.round((new Date(firstFlower.createdAt).getTime() - start) / DAY_MS))
    : null
  const flowerDays = firstFlower
    ? Math.max(0, Math.round((end - new Date(firstFlower.createdAt).getTime()) / DAY_MS))
    : null

  // Stage-day breakdown — count distinct days per stage
  const daysByStage = new Map<string, Set<number>>()
  for (const u of updates) {
    const day = diaryDay(diary.startDate, u.createdAt)
    let set = daysByStage.get(u.stage)
    if (!set) {
      set = new Set()
      daysByStage.set(u.stage, set)
    }
    set.add(day)
  }
  const stageDays = [...daysByStage.entries()]
    .map(([stage, days]) => ({ stage, days: days.size }))
    .sort((a, b) => STAGE_ORDER.indexOf(a.stage as (typeof STAGE_ORDER)[number]) - STAGE_ORDER.indexOf(b.stage as (typeof STAGE_ORDER)[number]))

  const trainingTechniques = [...new Set(
    updates
      .map((u) => u.training?.trim())
      .filter((t): t is string => !!t)
      .flatMap((t) => t.split(/[,;\/]/).map((s) => s.trim()).filter(Boolean))
  )].slice(0, 8)

  return {
    yieldAmount: diary.yieldAmount ?? null,
    yieldUnit: diary.yieldUnit ?? null,
    harvestedAt: new Date(diary.harvestedAt),
    totalDays,
    vegDays,
    flowerDays,
    updateCount: updates.length,
    photoCount: updates.reduce((n, u) => n + (u.images?.length ?? 0), 0),
    avgTemp: avg(updates.map((u) => u.temperature)),
    avgHumidity: avg(updates.map((u) => u.humidity)),
    avgVpd: avg(updates.map((u) => u.vpd)),
    avgPh: avg(updates.map((u) => u.ph)),
    avgEc: avg(updates.map((u) => u.ec)),
    stageDays,
    trainingTechniques,
  }
}

// ─── Growth summary ─────────────────────────────────────────────────

export interface GrowthSummary {
  measurements: number
  currentHeight: number | null
  previousHeight: number | null
  /** cm change since the previous measurement — null when <2 readings. */
  delta: number | null
  /** Calendar days between the latest two measurements — 0 for same-day. */
  deltaDays: number | null
  /** Days since grow start (harvest day when harvested). */
  totalDays: number
  latestAt: Date | null
  latestDay: number | null
  latestWeek: number | null
}

/**
 * Factual height summary — deliberately no growth-rate metric; sparse
 * readings make cm/day misleading. Ordering is by createdAt only; the
 * user-entered dayNumber/weekNumber annotations are never trusted.
 */
export function growthSummary(
  diary: DiaryLike,
  updates: { createdAt: Date | string; heightCm?: number | null }[],
  now: Date = new Date()
): GrowthSummary {
  const measured = updates
    .filter((u) => u.heightCm != null)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  const last = measured[measured.length - 1]
  const prev = measured.length >= 2 ? measured[measured.length - 2] : undefined
  const end = diary.harvested && diary.harvestedAt ? diary.harvestedAt : now
  return {
    measurements: measured.length,
    currentHeight: last?.heightCm ?? null,
    previousHeight: prev?.heightCm ?? null,
    delta: last && prev ? Math.round((last.heightCm! - prev.heightCm!) * 10) / 10 : null,
    deltaDays: last && prev
      ? Math.round((new Date(last.createdAt).getTime() - new Date(prev.createdAt).getTime()) / DAY_MS)
      : null,
    totalDays: diaryDay(diary.startDate, end),
    latestAt: last ? new Date(last.createdAt) : null,
    latestDay: last ? diaryDay(diary.startDate, last.createdAt) : null,
    latestWeek: last ? diaryWeek(diary.startDate, last.createdAt) : null,
  }
}

// ─── Stage durations ────────────────────────────────────────────────

export interface StageDuration {
  stage: string
  /** Elapsed days in this stage — sum across re-entries (e.g. re-veg). */
  days: number
}

/**
 * Chronological stage runs as elapsed-day spans — the generalized form of
 * the diary page's inline "consecutive observed days" calc. A run starts
 * the day a new stage is first observed and ends the day before the next
 * stage appears; re-entering a stage (e.g. re-veg) produces a new segment.
 * The final run extends through harvest day when harvested, else through
 * `now` — the recorded stage persists until the grower logs otherwise.
 * Stages only seen inside a same-day switch span no days and are omitted
 * rather than invented. Output shape matches StageTimeline's `runs` prop.
 */
export function stageDurations(
  diary: DiaryLike,
  updates: Pick<DiaryUpdateLike, "createdAt" | "stage">[],
  now: Date = new Date()
): StageDuration[] {
  const sorted = [...updates].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )
  if (sorted.length === 0) return []

  const endDay = diary.harvested && diary.harvestedAt
    ? diaryDay(diary.startDate, diary.harvestedAt)
    : diaryDay(diary.startDate, now)

  // Boundaries: the diary day each new stage is first observed.
  const bounds: { stage: string; startDay: number }[] = []
  for (const u of sorted) {
    const day = diaryDay(diary.startDate, u.createdAt)
    const last = bounds[bounds.length - 1]
    if (!last || last.stage !== u.stage) bounds.push({ stage: u.stage, startDay: day })
  }
  return bounds
    .map((b, i) => ({
      stage: b.stage,
      days: Math.max(0, (bounds[i + 1]?.startDay ?? endDay + 1) - b.startDay),
    }))
    .filter((r) => r.days > 0)
}

// ─── Diary completeness (owner-facing quality indicator) ────────────

export interface CompletenessResult {
  percent: number
  missing: string[]
}

/**
 * How well-documented is this grow? Rewards what makes a diary useful to the
 * community — not form-filling for its own sake.
 */
export function diaryCompleteness(
  diary: DiaryLike,
  updates: DiaryUpdateLike[]
): CompletenessResult {
  const missing: string[] = []
  let score = 0
  const total = 7

  if (diary.strain?.trim()) score++
  else missing.push("Add the strain name")
  if (diary.medium?.trim() || diary.lighting?.trim()) score++
  else missing.push("Describe your medium or lighting in grow setup")
  if (updates.length >= 3) score++
  else missing.push("Log at least 3 updates")
  if (updates.some((u) => (u.images?.length ?? 0) > 0)) score++
  else missing.push("Add a photo to an update")
  if (updates.some((u) => u.temperature != null || u.humidity != null || u.vpd != null)) score++
  else missing.push("Log environment readings (temp/RH/VPD)")
  if (
    updates.some((u) => u.stage === "FLOWER") ||
    STAGE_ORDER.indexOf((diary.stage ?? "GERMINATION") as (typeof STAGE_ORDER)[number]) >= STAGE_ORDER.indexOf("FLOWER")
  ) score++
  else missing.push("Reach the flower stage")
  if (diary.harvested) score++
  else missing.push("Log your harvest when done")

  return { percent: Math.round((score / total) * 100), missing: missing.slice(0, 4) }
}
