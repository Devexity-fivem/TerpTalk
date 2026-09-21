// TerpBot intelligence — merge user-reported data into a context.
//
// Precedence: logged diary points are NEVER modified or removed;
// user-reported points are strictly additive. `latest` is the newest-t
// point regardless of provenance, so a fresh chat report supersedes a
// stale logged reading for "current" purposes while history stays
// intact. Ambiguous values are never guessed at — they land on
// `unresolved` so the response can ask.
//
// Pure — no Prisma, no I/O.

import { detectTrend, seriesStats, vpdFromTempRh } from "@/lib/terpbot-intel-calc"
import { feedsForSymptom } from "@/lib/terpbot-nl-parse"
import {
  METRIC_EPSILON,
  type GrowContextView,
  type IntelSeries,
  type MetricId,
  type MetricPoint,
  type ReportedPoint,
  type SessionObservation,
  type StructuredObservation,
} from "@/lib/terpbot-intel-types"
const DAY_MS = 86400000
const PAIR_MS = 60 * 60 * 1000

const SERIES_TO_METRIC: [keyof GrowContextView["series"], MetricId][] = [
  ["temperature", "temperature"],
  ["humidity", "humidity"],
  ["ph", "ph"],
  ["ec", "ec"],
  ["height", "height"],
  ["vpdEntered", "vpd"],
  ["vpdComputed", "vpd"],
  ["runoffPh", "runoffPh"],
  ["runoffEc", "runoffEc"],
]

/** age in days of each series' newest point — only series with data.
 *  Pure; used by both buildGrowContext and mergeReported. */
export function freshnessOf(
  series: GrowContextView["series"],
  now: number
): Partial<Record<MetricId, number>> {
  const out: Partial<Record<MetricId, number>> = {}
  for (const [key, metric] of SERIES_TO_METRIC) {
    const s = series[key]
    if (!s.n || !s.points.length) continue
    const latest = s.points[s.points.length - 1].t
    const days = Math.max(0, Math.floor((now - latest) / DAY_MS))
    if (out[metric] == null || days < out[metric]!) out[metric] = days
  }
  return out
}

const SERIES_KEY: Partial<Record<MetricId, keyof GrowContextView["series"]>> = {
  temperature: "temperature",
  humidity: "humidity",
  ph: "ph",
  ec: "ec",
  height: "height",
  vpd: "vpdEntered",
  runoffPh: "runoffPh",
  runoffEc: "runoffEc",
}

const round1 = (v: number) => Math.round(v * 10) / 10
const degCtoF = (c: number) => round1(c * 1.8 + 32)
const inchToCm = (v: number) => Math.round(v * 2.54 * 10) / 10

/** Normalize a user-reported point to a stored value + unit, or return
 *  null when the value is ambiguous/out-of-range (→ unresolved). */
function accept(p: ReportedPoint): { v: number } | null {
  switch (p.metric) {
    case "temperature":
      if (p.unit === "degF") return { v: p.value }
      if (p.unit === "degC") return { v: degCtoF(p.value) }
      return null // unit undefined or unrecognized — ask °F or °C
    case "humidity":
      if (p.unit === "percent" || p.unit == null) {
        return p.value >= 0 && p.value <= 100 ? { v: p.value } : null
      }
      return null
    case "ph":
    case "runoffPh":
      return p.value >= 0 && p.value <= 14 ? { v: p.value } : null
    case "ec":
    case "runoffEc":
      // only mS/cm is unambiguous — ppm scales (500/700) never convert,
      // a bare number could be either
      return p.unit === "mscm" ? { v: p.value } : null
    case "vpd":
      return p.unit === "kpa" ? { v: p.value } : null
    case "height":
      if (p.unit === "cm") return { v: p.value }
      if (p.unit === "inch") return { v: inchToCm(p.value) }
      return null
    default:
      return null // no series exists for this metric yet
  }
}

function rebuild(points: MetricPoint[], metric: MetricId): IntelSeries {
  // sort by t then provenance — logged first on ties so a same-time
  // report never rewrites the logged record's position
  const sorted = [...points].sort(
    (a, b) => a.t - b.t || (a.provenance ?? "logged").localeCompare(b.provenance ?? "logged")
  )
  return {
    ...seriesStats(sorted),
    points: sorted,
    trend: detectTrend(sorted, METRIC_EPSILON[metric] ?? 1),
  }
}

/** Merge user-reported measurements into the context — returns a NEW
 *  view; the input is not mutated. */
export function mergeReported(
  ctx: GrowContextView,
  reported: ReportedPoint[],
  now: number
): GrowContextView {
  if (!reported.length) return ctx

  const series = { ...ctx.series }
  const unresolved: ReportedPoint[] = [...(ctx.unresolved ?? [])]
  const acceptedByMetric = new Map<MetricId, MetricPoint[]>()

  for (const p of reported) {
    const key = SERIES_KEY[p.metric]
    const ok = key ? accept(p) : null
    if (!key || !ok) {
      unresolved.push(p)
      continue
    }
    const point: MetricPoint = { t: p.t, v: ok.v, provenance: "user-reported" }
    const list = acceptedByMetric.get(p.metric) ?? []
    list.push(point)
    acceptedByMetric.set(p.metric, list)
  }

  for (const [metric, added] of acceptedByMetric) {
    const key = SERIES_KEY[metric]!
    series[key] = rebuild([...series[key].points, ...added], metric)
  }

  // a user-reported temp+RH pair close in time yields a computed VPD
  // point at the later t — same math as the logged pipeline
  const reportedTemp = acceptedByMetric.get("temperature")
  const reportedRh = acceptedByMetric.get("humidity")
  if (reportedTemp?.length && reportedRh?.length) {
    const tT = reportedTemp[reportedTemp.length - 1]
    const tH = reportedRh[reportedRh.length - 1]
    if (Math.abs(tT.t - tH.t) <= PAIR_MS) {
      const r = vpdFromTempRh(tT.v, tH.v)
      if (r.valid && r.value != null) {
        const at = Math.max(tT.t, tH.t)
        series.vpdComputed = rebuild(
          [...series.vpdComputed.points, { t: at, v: r.value, provenance: "user-reported" }],
          "vpd"
        )
      }
    }
  }

  // vpdDivergence intentionally recomputed from LOGGED pairs only —
  // reported values never relax the entered-vs-computed check.
  const missing = ctx.missing.filter(
    (m) => !(SERIES_KEY[m] && series[SERIES_KEY[m]!].n > 0)
  )

  return {
    ...ctx,
    series,
    missing,
    unresolved: unresolved.length ? unresolved : undefined,
    freshness: freshnessOf(series, now),
  }
}

const dayOf = (t: number) => Math.floor(t / DAY_MS)

/** Merge session observations into the context — deduped against
 *  existing observations on (symptom, location, stage, day). */
export function mergeObservations(
  ctx: GrowContextView,
  obs: SessionObservation[]
): GrowContextView {
  if (!obs.length) return ctx
  const seen = new Set(
    ctx.observations.map(
      (o) => `${o.symptom}|${o.location ?? ""}|${o.stage ?? ""}|${dayOf(o.t)}`
    )
  )
  const added: StructuredObservation[] = []
  for (const o of obs) {
    const stage = o.stage ?? (ctx.diary.stage !== "UNKNOWN" ? ctx.diary.stage : undefined)
    const key = `${o.symptom}|${o.location ?? ""}|${stage ?? ""}|${dayOf(o.t)}`
    if (seen.has(key)) continue
    seen.add(key)
    const { feeds, refined } = feedsForSymptom(o.symptom, o.location, stage)
    added.push({
      symptom: o.symptom,
      location: o.location,
      stage,
      period: o.period,
      t: o.t,
      source: "nl",
      feeds,
      refined,
    })
  }
  return { ...ctx, observations: [...ctx.observations, ...added] }
}
