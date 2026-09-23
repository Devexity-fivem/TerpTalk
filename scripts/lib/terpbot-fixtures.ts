// Shared fixtures for the pure TerpBot suites: the point/series builders
// whose bodies are identical across files. mkCtx/withSeries stay local —
// each file's defaults differ (diary fields, scope, session shape), and
// longitudinal's mkSeries additionally computes `change` via detectChange.
import { detectTrend, seriesStats } from "@/lib/terpbot-intel-calc"
import type { IntelSeries, MetricPoint } from "@/lib/terpbot-intel-types"

export const DAY = 86400000
export const T0 = Date.UTC(2025, 0, 1)

export const emptySeries: IntelSeries = {
  n: 0, latest: null, mean: null, min: null, max: null,
  medianIntervalDays: null, points: [], trend: "insufficient",
}

export const pts = (vals: number[], stepMs = DAY, prov?: "user-reported"): MetricPoint[] =>
  vals.map((v, i) => ({ t: T0 + i * stepMs, v, ...(prov ? { provenance: prov } : {}) }))

// Trend-only series builder (no `change` field) — shared by the
// intelligence and decisions suites.
export const mkSeries = (vals: number[], eps: number, stepMs = DAY): IntelSeries => {
  const points = pts(vals, stepMs)
  return { ...seriesStats(points), points, trend: detectTrend(points, eps) }
}
