// TerpBot intelligence — GrowContext builder.
// One bounded read set: diary row + latest INTEL_WINDOW updates +
// stage-boundary lookup. Rides @@index([diaryId, createdAt]). Never
// unbounded; never crosses the visibility scope the caller asked for.
//
// scope "public"  → diary must be visibility:"PUBLIC" (room output)
// scope "owner"   → caller's own diary, any visibility (private surfaces
//                   like BOT_ASSIST — /checkin itself stays public)

import { prisma } from "@/lib/prisma"
import { publicDiaryWhere } from "@/lib/diary-visibility"
import { diaryDay, diaryWeek } from "@/lib/diary-weeks"
import {
  detectTrend,
  seriesStats,
  vpdDivergence,
  vpdFromTempRh,
  type MetricPoint,
} from "@/lib/terpbot-intel-calc"
import { METRIC_EPSILON } from "@/lib/terpbot-intel-types"
import type {
  GrowContextView,
  IntelSeries,
  MetricId,
  StructuredObservation,
} from "@/lib/terpbot-intel-types"
import { parseGrowText } from "@/lib/terpbot-nl-parse"
import { freshnessOf } from "@/lib/terpbot-intel-merge"

// Last-12-updates window: enough for trend detection (min 3 points) and
// recent-vs-baseline comparisons at typical weekly-ish cadence, while
// staying a single indexed, bounded fetch.
export const INTEL_WINDOW = 12

type UpdateRow = {
  id: string
  createdAt: Date
  stage: string
  content: string
  temperature: number | null
  humidity: number | null
  vpd: number | null
  ph: number | null
  ec: number | null
  heightCm: number | null
}

// Symptoms reported in update text count as evidence only while recent
// — a yellowing report from 40 days ago is history, not a live signal.
export const OBSERVATION_MAX_AGE_DAYS = 21

type SeriesField = "temperature" | "humidity" | "vpd" | "ph" | "ec" | "heightCm"

function buildSeries(rows: UpdateRow[], field: SeriesField, epsKey: string): IntelSeries {
  const points: MetricPoint[] = []
  for (const u of rows) {
    const v = u[field]
    if (v != null && Number.isFinite(v)) points.push({ t: u.createdAt.getTime(), v })
  }
  // Stable sort: rows already arrive ordered by (createdAt, id), so
  // equal timestamps keep their DB order — output is deterministic.
  points.sort((a, b) => a.t - b.t)
  return { ...seriesStats(points), points, trend: detectTrend(points, METRIC_EPSILON[epsKey] ?? 1) }
}

function emptySeries(): IntelSeries {
  return {
    n: 0, latest: null, mean: null, min: null, max: null,
    medianIntervalDays: null, points: [], trend: "insufficient",
  }
}

/** A context with no diary — used when reasoning runs purely on what
 *  the grower has told the bot. Stage "UNKNOWN" passes no stage gate
 *  (GROWTH_STAGES does not contain it), so stage-scoped rules simply
 *  do not apply. Pure — no Prisma. */
export function emptyContext(now: number, stage = "UNKNOWN"): GrowContextView {
  return {
    scope: "public",
    diary: {
      id: "",
      slug: null,
      title: "",
      stage,
      visibility: "PUBLIC",
      startDate: new Date(now),
      harvested: false,
      mediumType: null,
      lightType: null,
      growType: "INDOOR",
      techniques: [],
    },
    setup: { present: false, medium: null, capabilities: [] },
    now,
    day: 1,
    week: 1,
    stageDays: 0,
    stageStartCensored: true,
    updateCount: 0,
    daysSinceUpdate: null,
    envCoverage: 0,
    series: {
      temperature: emptySeries(),
      humidity: emptySeries(),
      ph: emptySeries(),
      ec: emptySeries(),
      height: emptySeries(),
      vpdEntered: emptySeries(),
      vpdComputed: emptySeries(),
      runoffPh: emptySeries(),
      runoffEc: emptySeries(),
    },
    vpdDivergence: null,
    missing: ["temperature", "humidity", "ph", "ec", "height", "vpd"],
    freshness: {},
    observations: [],
  }
}

// Capability hints keyword-matched from setup free text — heuristic by
// nature (the schema stores these fields as free text); only used to
// soften/qualify interpretations, never asserted as fact.
const CAPABILITY_PATTERNS: [RegExp, string][] = [
  [/dehumid/i, "dehumidifier"],
  [/humidif/i, "humidifier"],
  [/\bac\b|air ?con/i, "ac"],
  [/fan|circulat|exhaust|inline/i, "airflow"],
  [/sensor|controller|automat|inkbird|ac infinity|vivosun/i, "controllers/sensors"],
]

function setupCapabilities(setup: { ventilation: string | null; fans: string | null; controllers: string | null; equipment: string | null; lighting: string | null } | null): string[] {
  if (!setup) return []
  const blob = [setup.ventilation, setup.fans, setup.controllers, setup.equipment, setup.lighting]
    .filter(Boolean)
    .join(" ")
  const caps = new Set<string>()
  for (const [re, cap] of CAPABILITY_PATTERNS) if (re.test(blob)) caps.add(cap)
  return [...caps]
}

/** First plausible runoff value in a row's feeding/content text, or
 *  null. `runoffEc` accepts unit "mscm" or an unstated unit with value
 *  ≤ 6 (growers write runoff in mS/cm by convention); ppm is rejected.
 *  `runoffPh` accepts 0–14. */
function runoffMeasurement(
  u: { content: string | null; feeding: string | null },
  metric: "runoffPh" | "runoffEc"
): number | null {
  const candidates = [u.feeding, u.content].filter((t): t is string => !!t)
  for (const text of candidates) {
    const hits = parseGrowText(text).measurements
      .filter((m) => m.metric === metric && m.value != null)
      .sort((a, b) => a.span[0] - b.span[0])
    for (const m of hits) {
      if (metric === "runoffPh" && m.value! >= 0 && m.value! <= 14) return m.value!
      if (
        metric === "runoffEc" &&
        (m.unit === "mscm" || (m.unit == null && m.value! <= 6))
      ) {
        return m.value!
      }
    }
  }
  return null
}

export async function buildGrowContext(
  diaryId: string,
  opts: { ownerId: string; scope: "public" | "owner"; now?: Date }
): Promise<GrowContextView | null> {
  const scope = opts.scope === "public" ? publicDiaryWhere : {}
  const diary = await prisma.growDiary.findFirst({
    where: { id: diaryId, authorId: opts.ownerId, deleted: false, ...scope },
    select: {
      id: true, slug: true, title: true, stage: true, visibility: true,
      startDate: true, harvested: true,
      mediumType: true, lightType: true, growType: true, techniques: true,
      // deleted included so a soft-deleted setup is treated as absent —
      // soft-delete is a flag, setupId is not cleared on the diary.
      setup: {
        select: { deleted: true, medium: true, ventilation: true, fans: true, controllers: true, equipment: true, lighting: true },
      },
    },
  })
  if (!diary) return null

  const [windowDesc, prevStage] = await Promise.all([
    prisma.diaryUpdate.findMany({
      where: { diaryId: diary.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: INTEL_WINDOW,
      select: {
        id: true, createdAt: true, stage: true, content: true, feeding: true,
        temperature: true, humidity: true, vpd: true, ph: true, ec: true,
        heightCm: true,
      },
    }),
    // True start of the current stage: the newest update at a different
    // stage. Indexed; if none exists the stage began at/before the
    // earliest logged update (censored).
    prisma.diaryUpdate.findFirst({
      where: { diaryId: diary.id, stage: { not: diary.stage } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { createdAt: true },
    }),
  ])

  // Same total order as the query — (createdAt, id) — so equal
  // timestamps can't reorder the window between runs.
  const rows = [...windowDesc].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)
  )
  const now = (opts.now ?? new Date()).getTime()

  const series = {
    temperature: buildSeries(rows, "temperature", "temperature"),
    humidity: buildSeries(rows, "humidity", "humidity"),
    ph: buildSeries(rows, "ph", "ph"),
    ec: buildSeries(rows, "ec", "ec"),
    height: buildSeries(rows, "heightCm", "height"),
    vpdEntered: buildSeries(rows, "vpd", "vpd"),
    vpdComputed: (() => {
      const points: MetricPoint[] = []
      for (const u of rows) {
        const r = vpdFromTempRh(u.temperature, u.humidity)
        if (r.valid && r.value != null) points.push({ t: u.createdAt.getTime(), v: r.value })
      }
      return { ...seriesStats(points), points, trend: detectTrend(points, METRIC_EPSILON.vpd) }
    })(),
    // Runoff metrics have no schema columns — they come out of `feeding`
    // (and `content`) free text via the grow parser. Convention: runoff
    // EC only counts when the unit is mS/cm or unstated with a plausible
    // mS/cm value (≤6) — ppm is rejected, never converted. When one row
    // yields several values for a metric, the first by span wins.
    runoffPh: (() => {
      const points: MetricPoint[] = []
      for (const u of rows) {
        const m = runoffMeasurement(u, "runoffPh")
        if (m != null) points.push({ t: u.createdAt.getTime(), v: m })
      }
      return { ...seriesStats(points), points, trend: detectTrend(points, METRIC_EPSILON.ph) }
    })(),
    runoffEc: (() => {
      const points: MetricPoint[] = []
      for (const u of rows) {
        const m = runoffMeasurement(u, "runoffEc")
        if (m != null) points.push({ t: u.createdAt.getTime(), v: m })
      }
      return { ...seriesStats(points), points, trend: detectTrend(points, METRIC_EPSILON.ec) }
    })(),
  }

  // Entered-vs-computed divergence on the newest update carrying both.
  let divergence: number | null = null
  for (let i = rows.length - 1; i >= 0; i--) {
    const u = rows[i]
    if (u.vpd == null || u.temperature == null || u.humidity == null) continue
    const c = vpdFromTempRh(u.temperature, u.humidity)
    divergence = vpdDivergence(u.vpd, c.valid ? c.value : null)
    break
  }

  const envCoverage = rows.length
    ? rows.filter(
        (u) => u.temperature != null || u.humidity != null || u.vpd != null || u.ph != null || u.ec != null
      ).length / rows.length
    : 0

  const missing: MetricId[] = []
  if (series.temperature.n === 0) missing.push("temperature")
  if (series.humidity.n === 0) missing.push("humidity")
  if (series.ph.n === 0) missing.push("ph")
  if (series.ec.n === 0) missing.push("ec")
  if (series.height.n === 0) missing.push("height")
  if (series.vpdEntered.n === 0) missing.push("vpd")

  const latest = rows[rows.length - 1]

  // Reported-symptom channel: recent update text → structured
  // observations. Parse only what's still evidence-relevant; store
  // normalized ids + refIds, never the raw text.
  const obsMaxAge = OBSERVATION_MAX_AGE_DAYS * 86400000
  const observations: StructuredObservation[] = []
  for (const u of rows) {
    if (now - u.createdAt.getTime() > obsMaxAge) continue
    if (!u.content) continue
    const parsed = parseGrowText(u.content)
    for (const o of parsed.observations) {
      observations.push({
        symptom: o.symptom,
        location: o.location,
        stage: o.stage ?? u.stage,
        period: o.period,
        t: u.createdAt.getTime(),
        source: "diary-text",
        refId: u.id,
        feeds: o.feeds,
        refined: o.refined,
      })
    }
  }

  const stageDays = prevStage
    ? Math.max(0, Math.floor((now - prevStage.createdAt.getTime()) / 86400000))
    : Math.max(0, Math.floor((now - (rows[0]?.createdAt.getTime() ?? diary.startDate.getTime())) / 86400000))

  return {
    scope: opts.scope,
    diary: {
      id: diary.id,
      slug: diary.slug,
      title: diary.title,
      stage: diary.stage,
      visibility: diary.visibility,
      startDate: diary.startDate,
      harvested: diary.harvested,
      mediumType: diary.mediumType,
      lightType: diary.lightType,
      growType: diary.growType,
      techniques: diary.techniques,
    },
    setup: {
      present: !!diary.setup && !diary.setup.deleted,
      medium: (diary.setup && !diary.setup.deleted ? diary.setup.medium : null) ?? diary.mediumType,
      capabilities: setupCapabilities(diary.setup && !diary.setup.deleted ? diary.setup : null),
    },
    now,
    day: diaryDay(diary.startDate, new Date(now)),
    week: diaryWeek(diary.startDate, new Date(now)),
    stageDays,
    stageStartCensored: !prevStage,
    updateCount: rows.length,
    daysSinceUpdate: latest ? Math.floor((now - latest.createdAt.getTime()) / 86400000) : null,
    envCoverage,
    series,
    vpdDivergence: divergence,
    missing,
    freshness: freshnessOf(series, now),
    observations,
  }
}
