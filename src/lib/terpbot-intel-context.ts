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
  buildMetricBaseline,
  detectChange,
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
  MetricBaseline,
  MetricId,
  ResolutionClaim,
  StructuredObservation,
} from "@/lib/terpbot-intel-types"
import { parseGrowText } from "@/lib/terpbot-nl-parse"
import { freshnessOf, LOGGED_SERIES } from "@/lib/terpbot-intel-merge"
import { stageTransitions } from "@/lib/terpbot-intel-timeline"
import { safeGrowerText } from "@/lib/terpbot-intel-types"
import type { ExperimentRef, InterventionRecord } from "@/lib/terpbot-intel-types"

// Last-12-updates window: enough for trend detection (min 3 points) and
// recent-vs-baseline comparisons at typical weekly-ish cadence, while
// staying a single indexed, bounded fetch.
export const INTEL_WINDOW = 12

/** Deterministic experiment category → measured target. Only categories
 *  where the schema leaves no ambiguity get a metric: LIGHTING acts on
 *  canopy PPFD, FEEDING on input EC, WATERING on applied liters.
 *  ENVIRONMENT (temp vs RH vs VPD), TRAINING, ISSUE_RESPONSE, SETUP,
 *  TECHNIQUE and OTHER have no single measurable target — they stay
 *  unmapped and produce context only, never metric evidence. `expected`
 *  prose is never parsed for a target. */
export const EXPERIMENT_TARGET_METRIC: Partial<Record<string, MetricId>> = {
  LIGHTING: "ppfd",
  FEEDING: "ec",
  WATERING: "watering",
}

/** Live statuses that synthesize an intervention record — the change is
 *  underway and its follow-up window is open. PLANNED hasn't happened
 *  (nothing to evaluate); COMPLETED/ABANDONED leave active reasoning. */
const LIVE_EXPERIMENT_STATUSES = new Set(["ACTIVE", "OBSERVING"])

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
  wateringLiters: number | null
  ppfd: number | null
  photoperiodHours: number | null
  runoffPh: number | null
  runoffEc: number | null
  nightTemperature: number | null
  substrateTemperature: number | null
  co2Ppm: number | null
}

// Symptoms reported in update text count as evidence only while recent
// — a yellowing report from 40 days ago is history, not a live signal.
export const OBSERVATION_MAX_AGE_DAYS = 21

type SeriesField =
  | "temperature" | "humidity" | "vpd" | "ph" | "ec" | "heightCm"
  | "wateringLiters" | "ppfd" | "photoperiodHours" | "runoffPh" | "runoffEc"

function buildSeries(rows: UpdateRow[], field: SeriesField, epsKey: string, now: number): IntelSeries {
  const points: MetricPoint[] = []
  for (const u of rows) {
    const v = u[field]
    if (v != null && Number.isFinite(v)) points.push({ t: u.createdAt.getTime(), v })
  }
  // Stable sort: rows already arrive ordered by (createdAt, id), so
  // equal timestamps keep their DB order — output is deterministic.
  points.sort((a, b) => a.t - b.t)
  const eps = METRIC_EPSILON[epsKey] ?? 1
  return {
    ...seriesStats(points),
    points,
    trend: detectTrend(points, eps),
    change: detectChange(points, eps, { now }),
  }
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
    strain: null,
    experiments: [],
    setup: { present: false, medium: null, capabilities: [] },
    now,
    day: 1,
    week: 1,
    stageDays: 0,
    stageStartCensored: true,
    stageTransitions: [],
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
      watering: emptySeries(),
      ppfd: emptySeries(),
      photoperiod: emptySeries(),
    },
    vpdDivergence: null,
    missing: ["temperature", "humidity", "ph", "ec", "height", "vpd"],
    freshness: {},
    observations: [],
    baselines: {},
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
  // Measurement instruments — evidence a metric CAN be produced, used by
  // the capability model as "plausible" (never "proven": a keyword is a
  // claim, a series point is proof).
  [/\bph\s*(meter|pen|tester|probe|kit|strips?)\b|bluelab/i, "ph-meter"],
  [/\b(ec|tds|ppm)\s*(meter|pen|tester|probe)\b|truncheon|bluelab|conductivity/i, "ec-meter"],
  [/hygrometer|thermometer|thermo[- ]?hygro|sensorpush|govee/i, "env-monitor"],
  [/\b(par|ppfd|dli|lux)\s*(meter|sensor)\b|quantum sensor|apogee|photone/i, "light-meter"],
  [/loupe|microscope|jewel/i, "loupe"],
  [/\bco2\b|carbon dioxide/i, "co2"],
  [/autopot|blumat|drip|ebb ?(and|&) ?flow|flood ?(and|&) ?drain|self[- ]?water|auto[- ]?water|irrigation/i, "auto-irrigation"],
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

/** First plausible runoff value in a row's parsed feeding/content text,
 *  or null. `runoffEc` accepts unit "mscm" or an unstated unit with
 *  value ≤ 6 (growers write runoff in mS/cm by convention); ppm is
 *  rejected outright — never accepted, never converted ("runoff ppm 4"
 *  can't smuggle in as 4 mS/cm). `runoffPh` accepts 0–14. The parser
 *  itself guards proximity: a runoff metric phrase binds a number only
 *  through a direct connector (was/is/at/of/= or adjacency), so
 *  "runoff ec on 2 plants" can't mint a value here. */
function runoffMeasurement(
  parsed: (ReturnType<typeof parseGrowText> | null)[],
  metric: "runoffPh" | "runoffEc"
): number | null {
  for (const p of parsed) {
    if (!p) continue
    const hits = p.measurements
      .filter((m) => m.metric === metric && m.value != null && m.unit !== "ppm")
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
    // harvested diaries DO produce intelligence — post-harvest stages
    // (HARVEST/DRYING/CURING) have their own rules and playbooks. The
    // harvested flag reaches the view; selection layers (intelContextFor
    // fallback, assist scan, primaryGrow) still prefer active diaries.
    where: { id: diaryId, authorId: opts.ownerId, deleted: false, ...scope },
    select: {
      id: true, slug: true, title: true, stage: true, visibility: true,
      startDate: true, harvested: true,
      mediumType: true, lightType: true, growType: true, techniques: true,
      // Authoritative structured strain link — a public catalog row
      // joined on the same bounded diary fetch (no extra query). The
      // free-text `strain` field is intentionally NOT consulted here:
      // no fuzzy matching inside the intelligence layer.
      strainRef: {
        select: { id: true, name: true, genetics: true, type: true, floweringWeeks: true, seedToHarvestWeeks: true, difficulty: true },
      },
      // Documented experiments — same diary row, same scope. Bounded;
      // the linked-update include carries only the newest timestamp for
      // the follow-up check (_count gives the true total).
      experiments: {
        orderBy: [{ startedAt: "desc" }, { id: "asc" }],
        take: 8,
        select: {
          id: true, title: true, category: true, status: true,
          expected: true, startedAt: true, endedAt: true,
          updates: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
          _count: { select: { updates: true } },
        },
      },
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
        heightCm: true, wateringLiters: true, ppfd: true, photoperiodHours: true,
        runoffPh: true, runoffEc: true,
        nightTemperature: true, substrateTemperature: true, co2Ppm: true,
      },
    }),
    // True start of the current stage: the newest update at a different
    // stage. Indexed; if none exists the stage began at/before the
    // earliest logged update (censored).
    prisma.diaryUpdate.findFirst({
      where: { diaryId: diary.id, stage: { not: diary.stage } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { createdAt: true, stage: true },
    }),
  ])

  // Same total order as the query — (createdAt, id) — so equal
  // timestamps can't reorder the window between runs.
  const rows = [...windowDesc].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)
  )
  const now = (opts.now ?? new Date()).getTime()

  // Parse each row's free text once — feeding and content feed both the
  // runoff series below and the reported-symptom observation pass.
  const parsedRows = rows.map((u) => ({
    feeding: u.feeding ? parseGrowText(u.feeding) : null,
    content: u.content ? parseGrowText(u.content) : null,
  }))

  const mkSeries = (points: MetricPoint[], eps: number): IntelSeries => ({
    ...seriesStats(points),
    points,
    trend: detectTrend(points, eps),
    change: detectChange(points, eps, { now }),
  })

  const series = {
    temperature: buildSeries(rows, "temperature", "temperature", now),
    humidity: buildSeries(rows, "humidity", "humidity", now),
    ph: buildSeries(rows, "ph", "ph", now),
    ec: buildSeries(rows, "ec", "ec", now),
    height: buildSeries(rows, "heightCm", "height", now),
    vpdEntered: buildSeries(rows, "vpd", "vpd", now),
    vpdComputed: (() => {
      const points: MetricPoint[] = []
      for (const u of rows) {
        const r = vpdFromTempRh(u.temperature, u.humidity)
        if (r.valid && r.value != null) points.push({ t: u.createdAt.getTime(), v: r.value })
      }
      return mkSeries(points, METRIC_EPSILON.vpd)
    })(),
    // Structured runoff columns win when present; the free-text parse of
    // `feeding`/`content` remains the fallback for updates written before
    // the columns existed (and for growers who still log it in prose).
    // Convention for the fallback: runoff EC only counts when the unit is
    // mS/cm or unstated with a plausible mS/cm value (≤6) — ppm is
    // rejected, never converted. First value by span wins per row.
    runoffPh: (() => {
      const points: MetricPoint[] = []
      rows.forEach((u, i) => {
        const v = u.runoffPh ?? runoffMeasurement([parsedRows[i].feeding, parsedRows[i].content], "runoffPh")
        if (v != null) points.push({ t: u.createdAt.getTime(), v })
      })
      return mkSeries(points, METRIC_EPSILON.ph)
    })(),
    runoffEc: (() => {
      const points: MetricPoint[] = []
      rows.forEach((u, i) => {
        const v = u.runoffEc ?? runoffMeasurement([parsedRows[i].feeding, parsedRows[i].content], "runoffEc")
        if (v != null) points.push({ t: u.createdAt.getTime(), v })
      })
      return mkSeries(points, METRIC_EPSILON.ec)
    })(),
    // Schema-backed metrics TerpBot could already ask about but never
    // store — now logged data flows into the same series machinery.
    watering: buildSeries(rows, "wateringLiters", "watering", now),
    ppfd: buildSeries(rows, "ppfd", "ppfd", now),
    photoperiod: buildSeries(rows, "photoperiodHours", "photoperiod", now),
  }

  // Personal baselines — logged points only (session reports never
  // build "normal"). Detects change vs the grow's own usual range;
  // never asserts the usual range is correct.
  const baselines: Partial<Record<MetricId, MetricBaseline>> = {}
  for (const [key, metric] of [
    ["temperature", "temperature"], ["humidity", "humidity"], ["ph", "ph"],
    ["ec", "ec"], ["height", "height"], ["vpdComputed", "vpd"],
    ["runoffPh", "runoffPh"], ["runoffEc", "runoffEc"],
    ["watering", "watering"], ["ppfd", "ppfd"], ["photoperiod", "photoperiod"],
  ] as [keyof typeof series, MetricId][]) {
    const b = buildMetricBaseline(series[key].points, now)
    if (b.tier !== "insufficient") baselines[metric] = b
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
        (u) =>
          u.temperature != null || u.humidity != null || u.vpd != null || u.ph != null || u.ec != null ||
          u.nightTemperature != null || u.substrateTemperature != null || u.co2Ppm != null ||
          u.wateringLiters != null || u.ppfd != null || u.photoperiodHours != null ||
          u.runoffPh != null || u.runoffEc != null
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

  // Documented experiments — normalized as grower-declared records.
  // Live ones (ACTIVE/OBSERVING) also synthesize an InterventionRecord
  // keyed `experiment:<id>` so the existing pending/answered/lapsed
  // state machine, adjust cooldown and follow-up surfaces see them
  // exactly like a chat-reported change. Ended experiments produce no
  // intervention. beforeReading is the honest "before": newest real
  // series point at/before the declared start.
  const experiments: ExperimentRef[] = diary.experiments.map((e) => ({
    id: e.id,
    title: e.title,
    category: e.category,
    status: e.status,
    expected: e.expected,
    startedAt: e.startedAt.getTime(),
    endedAt: e.endedAt?.getTime() ?? null,
    updateCount: e._count.updates,
    latestUpdateAt: e.updates[0]?.createdAt.getTime() ?? null,
  }))
  const interventions: InterventionRecord[] = []
  for (const e of experiments) {
    if (!LIVE_EXPERIMENT_STATUSES.has(e.status)) continue
    const targetMetric = EXPERIMENT_TARGET_METRIC[e.category]
    const key = targetMetric ? LOGGED_SERIES[targetMetric] : undefined
    const pts = key ? series[key].points : []
    let beforeReading: { v: number; t: number } | undefined
    for (const p of pts) {
      if (p.tApproximate || p.t > e.startedAt) continue
      if (!beforeReading || p.t > beforeReading.t) beforeReading = { v: p.v, t: p.t }
    }
    interventions.push({
      type: `experiment:${e.id}`,
      at: e.startedAt,
      eventT: e.startedAt,
      targetMetric,
      diaryId: diary.id,
      beforeReading,
      label: safeGrowerText(e.title),
    })
  }

  // Reported-symptom channel: recent update text → structured
  // observations. Parse only what's still evidence-relevant; store
  // normalized ids + refIds, never the raw text.
  const obsMaxAge = OBSERVATION_MAX_AGE_DAYS * 86400000
  const observations: StructuredObservation[] = []
  const resolutions: ResolutionClaim[] = []
  for (const [i, u] of rows.entries()) {
    if (now - u.createdAt.getTime() > obsMaxAge) continue
    const parsed = parsedRows[i].content
    if (!parsed) continue
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
    // resolution/progression claims in diary text — same evidence
    // window as observations
    for (const r of parsed.resolutions) {
      resolutions.push({
        symptom: r.symptom,
        location: r.location,
        kind: r.kind,
        t: u.createdAt.getTime(),
        source: "diary-text",
      })
    }
  }

  const stageDays = prevStage
    ? Math.max(0, Math.floor((now - prevStage.createdAt.getTime()) / 86400000))
    : Math.max(0, Math.floor((now - (rows[0]?.createdAt.getTime() ?? diary.startDate.getTime())) / 86400000))

  const transitions = stageTransitions(rows, diary.stage, prevStage)

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
    // Nulls preserved as stored — a missing catalog field means "not
    // reliably reported", never inferred.
    strain: diary.strainRef
      ? {
          strainId: diary.strainRef.id,
          name: diary.strainRef.name,
          genetics: diary.strainRef.genetics,
          type: diary.strainRef.type,
          floweringWeeks: diary.strainRef.floweringWeeks,
          seedToHarvestWeeks: diary.strainRef.seedToHarvestWeeks,
          difficulty: diary.strainRef.difficulty,
        }
      : null,
    setup: {
      present: !!diary.setup && !diary.setup.deleted,
      // normalized enum only — the raw GrowSetup.medium free text is
      // never carried into the view (nothing should render user text)
      medium: diary.mediumType,
      capabilities: setupCapabilities(diary.setup && !diary.setup.deleted ? diary.setup : null),
    },
    now,
    day: diaryDay(diary.startDate, new Date(now)),
    week: diaryWeek(diary.startDate, new Date(now)),
    stageDays,
    stageStartCensored: !prevStage,
    stageTransitions: transitions,
    updateCount: rows.length,
    daysSinceUpdate: latest ? Math.floor((now - latest.createdAt.getTime()) / 86400000) : null,
    envCoverage,
    series,
    vpdDivergence: divergence,
    missing,
    freshness: freshnessOf(series, now),
    observations,
    baselines,
    resolutions,
    experiments,
    interventions,
  }
}
