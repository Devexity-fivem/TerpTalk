// TerpBot intelligence — pure deterministic calculations.
// No I/O, no Prisma, no Date.now() unless the caller passes "now".
// Every function validates inputs, reports what was missing, and never
// fabricates precision the inputs can't support. Thresholds that are
// horticultural claims live in terpbot-intel.ts rules, not here — this
// module only does math and statistics.

export interface MetricPoint {
  /** epoch ms of the EVENT the point measures (update createdAt for
   *  logged points; resolved event time for reported points) */
  t: number
  v: number
  /** "logged" = a diary update column; "user-reported" = a value the
   *  grower told the bot in chat. Undefined is treated as logged. */
  provenance?: "logged" | "user-reported"
  /** the timestamp is an unbounded approximation ("a while back") —
   *  excluded from "current reading" paths but kept as history */
  tApproximate?: boolean
}

export interface CalcResult {
  value: number | null
  unit: string
  valid: boolean
  /** input names that were absent/invalid */
  missing: string[]
  /** assumptions the caller/user should know about */
  assumptions: string[]
}

const calc = (partial: Partial<CalcResult> & Pick<CalcResult, "unit">): CalcResult => ({
  value: null,
  valid: true,
  missing: [],
  assumptions: [],
  ...partial,
})

// ── Units ───────────────────────────────────────────────────────────

export const fToC = (f: number) => (f - 32) * (5 / 9)
export const cToF = (c: number) => c * (9 / 5) + 32

/** EC (mS/cm) → ppm. The 500 vs 700 scale is a real ambiguity in grower
 *  practice — the caller must pass the scale; we never guess it. */
export function ecToPpm(ec: number, scale: 500 | 700): CalcResult {
  if (!Number.isFinite(ec) || ec < 0) return calc({ unit: "ppm", valid: false, missing: ["ec"] })
  return calc({ unit: "ppm", value: ec * scale, assumptions: [`${scale} scale`] })
}

// ── VPD ─────────────────────────────────────────────────────────────
// Magnus/Tetens saturation vapor pressure (FAO-56 form):
//   SVP(T°C) = 0.6108 · exp(17.27·T / (T + 237.3))  kPa
//   VPD      = SVP · (1 − RH/100)
// Reference vector: 25°C / 50% RH → SVP ≈ 3.167 kPa → VPD ≈ 1.58 kPa.
//
// IMPORTANT: this is AIR-temperature VPD. TerpTalk does not store leaf
// temperature, so true leaf-surface VPD is unavailable — under strong
// light the leaf is often 1–3°C warmer, which raises real VPD. The
// assumption is returned, not hidden.

export const VPD_LEAF_TEMP_ASSUMPTION =
  "air temperature used — leaf temperature not recorded; real leaf VPD can differ under strong light"

export function vpdFromTempRh(tempF: number | null | undefined, rh: number | null | undefined): CalcResult {
  const missing: string[] = []
  if (tempF == null || !Number.isFinite(tempF)) missing.push("temperature")
  if (rh == null || !Number.isFinite(rh)) missing.push("humidity")
  if (missing.length || tempF == null || rh == null) return calc({ unit: "kPa", valid: false, missing })
  if (tempF < -40 || tempF > 140 || rh < 0 || rh > 100) {
    return calc({ unit: "kPa", valid: false, missing: [], assumptions: ["input outside plausible range"] })
  }
  const tC = fToC(tempF)
  const svp = 0.6108 * Math.exp((17.27 * tC) / (tC + 237.3))
  const vpd = svp * (1 - rh / 100)
  return calc({
    unit: "kPa",
    value: Math.round(vpd * 100) / 100,
    assumptions: [VPD_LEAF_TEMP_ASSUMPTION],
  })
}

/** Compare a user-entered VPD against the computed value. Returns the
 *  signed difference (entered − computed) or null when either side is
 *  missing — divergence is a finding, never silently resolved. */
export function vpdDivergence(entered: number | null, computed: number | null): number | null {
  if (entered == null || computed == null) return null
  if (!Number.isFinite(entered) || !Number.isFinite(computed)) return null
  return Math.round((entered - computed) * 100) / 100
}

// ── DLI ─────────────────────────────────────────────────────────────
// DLI (mol/m²/day) = PPFD (μmol/m²/s) × photoperiod (h) × 3600 / 1e6.
// The schema has no PPFD or photoperiod field — callers must supply both.

export function dliFromPpfd(ppfd: number | null | undefined, hours: number | null | undefined): CalcResult {
  const missing: string[] = []
  if (ppfd == null || !Number.isFinite(ppfd)) missing.push("ppfd")
  if (hours == null || !Number.isFinite(hours)) missing.push("photoperiodHours")
  if (missing.length || ppfd == null || hours == null) return calc({ unit: "mol/m²/day", valid: false, missing })
  if (ppfd < 0 || ppfd > 3000 || hours <= 0 || hours > 24) {
    return calc({ unit: "mol/m²/day", valid: false, assumptions: ["input outside plausible range"] })
  }
  return calc({ unit: "mol/m²/day", value: Math.round(ppfd * hours * 0.0036 * 10) / 10 })
}

// ── Series statistics ───────────────────────────────────────────────

export interface SeriesStats {
  n: number
  latest: number | null
  mean: number | null
  min: number | null
  max: number | null
  /** median gap between consecutive points, days — null when <2 points */
  medianIntervalDays: number | null
}

export function seriesStats(points: MetricPoint[]): SeriesStats {
// Array.prototype.sort is stable (ES2019) — equal timestamps keep input order
  const clean = points.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v)).sort((a, b) => a.t - b.t)
  const n = clean.length
  if (!n) return { n: 0, latest: null, mean: null, min: null, max: null, medianIntervalDays: null }
  const vals = clean.map((p) => p.v)
  let medianIntervalDays: number | null = null
  if (n >= 2) {
    const gaps: number[] = []
    for (let i = 1; i < n; i++) gaps.push(clean[i].t - clean[i - 1].t)
    medianIntervalDays = median(gaps) / 86400000
  }
  return {
    n,
    latest: vals[n - 1],
    mean: Math.round((vals.reduce((a, b) => a + b, 0) / n) * 1000) / 1000,
    min: Math.min(...vals),
    max: Math.max(...vals),
    medianIntervalDays,
  }
}

export function median(values: number[]): number {
  if (!values.length) return NaN
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// ── Trend detection ─────────────────────────────────────────────────
// Deterministic, scale-free structure; the caller supplies `epsilon` —
// the smallest per-step change treated as real movement (a noise floor,
// NOT a horticultural threshold). Rules pick epsilons per metric.
//
// Classification (points sorted by time):
//   n < 3                                   → "insufficient"
//   no consecutive step ≥ epsilon           → "stable"
//   ≥2 sign flips among significant steps   → "volatile"
//     AND flips ≥ half of significant steps
//   |mean(second half) − mean(first half)| < epsilon → "stable"
//   otherwise                               → "rising" | "falling"
// Two points never produce a trend — they produce a delta, which the
// caller can read from seriesStats but must not label a trend.

export type Trend = "rising" | "falling" | "stable" | "volatile" | "insufficient"

export function detectTrend(points: MetricPoint[], epsilon: number): Trend {
// Array.prototype.sort is stable (ES2019) — equal timestamps keep input order
  const clean = points.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v)).sort((a, b) => a.t - b.t)
  if (clean.length < 3) return "insufficient"
  const vals = clean.map((p) => p.v)
  const diffs: number[] = []
  for (let i = 1; i < vals.length; i++) diffs.push(vals[i] - vals[i - 1])
  const significant = diffs.filter((d) => Math.abs(d) >= epsilon)
  if (!significant.length) return "stable"
  let flips = 0
  for (let i = 1; i < significant.length; i++) {
    if (Math.sign(significant[i]) !== Math.sign(significant[i - 1])) flips++
  }
  if (flips >= 2 && flips >= significant.length / 2) return "volatile"
  const half = Math.floor(vals.length / 2)
  const earlier = vals.slice(0, vals.length - half)
  const recent = vals.slice(vals.length - half)
  const drift = recent.reduce((a, b) => a + b, 0) / recent.length - earlier.reduce((a, b) => a + b, 0) / earlier.length
  if (Math.abs(drift) < epsilon) return "stable"
  return drift > 0 ? "rising" : "falling"
}

// ── Excursions ──────────────────────────────────────────────────────

export interface ExcursionResult {
  n: number
  /** points outside [lo, hi] */
  count: number
  /** longest consecutive run outside the band */
  longestRun: number
  /** fraction of points outside, 0–1 */
  fraction: number
  /** most recent point outside? */
  latestOutside: boolean
}

export function countExcursions(points: MetricPoint[], lo: number, hi: number): ExcursionResult {
// Array.prototype.sort is stable (ES2019) — equal timestamps keep input order
  const clean = points.filter((p) => Number.isFinite(p.v)).sort((a, b) => a.t - b.t)
  let count = 0
  let longestRun = 0
  let run = 0
  for (const p of clean) {
    if (p.v < lo || p.v > hi) {
      count++
      run++
      longestRun = Math.max(longestRun, run)
    } else {
      run = 0
    }
  }
  const last = clean[clean.length - 1]
  return {
    n: clean.length,
    count,
    longestRun,
    fraction: clean.length ? count / clean.length : 0,
    latestOutside: last ? last.v < lo || last.v > hi : false,
  }
}

// ── Growth ──────────────────────────────────────────────────────────

/** Height gain rate in cm/day over the window (latest − earliest over
 *  elapsed days). Requires ≥2 points and >0 elapsed days. */
export function growthRateCmPerDay(points: MetricPoint[]): CalcResult {
// Array.prototype.sort is stable (ES2019) — equal timestamps keep input order
  const clean = points.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v)).sort((a, b) => a.t - b.t)
  if (clean.length < 2) return calc({ unit: "cm/day", valid: false, missing: ["heightHistory"] })
  const days = (clean[clean.length - 1].t - clean[0].t) / 86400000
  if (days <= 0) return calc({ unit: "cm/day", valid: false, assumptions: ["heights logged on the same day"] })
  const rate = (clean[clean.length - 1].v - clean[0].v) / days
  return calc({ unit: "cm/day", value: Math.round(rate * 100) / 100 })
}
