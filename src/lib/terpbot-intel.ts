// TerpBot intelligence — thin deterministic rule/evidence engine.
//
// Pipeline: GrowContext → rules → evidence → findings → rendered lines.
// No Prisma, no I/O — pure evaluation over the context object so every
// rule is unit-testable with a fabricated context.
//
// Aggregation model (documented, deterministic — no percentages):
//   • evidence carries direction (for/risk raise a candidate, against
//     opposes, info is neutral) and categorical strength (1/2/3)
//   • forScore = Σ(for) + Σ(risk); againstScore = Σ(against)
//   • a confirmed:true evidence item is a measured fact → CONFIRMED
//   • forScore ≥3 and againstScore ≥3                  → CONFLICTING
//   • forScore ≥3                                      → STRONG
//   • forScore ≥1                                      → POSSIBLE
//   • no evidence, or kind:"gap"                       → INSUFFICIENT
// Gap findings never render as "watch" items — they drive the
// "next useful measurement" line instead.

import { countExcursions } from "@/lib/terpbot-intel-calc"
import { SOURCES } from "@/lib/terpbot-intel-knowledge"
import type {
  Finding,
  GrowContextView,
  IntelEvidence,
  IntelRule,
  MeasurementHint,
  MetricId,
} from "@/lib/terpbot-intel-types"

export type { GrowContextView, Finding, IntelRule } from "@/lib/terpbot-intel-types"

const W = { weak: 1, moderate: 2, strong: 3 } as const

// ── Threshold bands (rule data — horticultural values live here, not
//    inside calculators) ─────────────────────────────────────────────
// VPD targets: Cannabis Sci&Tech (0.8–1.1 veg / 1.0–1.5 flower),
// IEEE greenhouse survey (~0.8 propagation). Seedling band widened down.
const VPD_BANDS: Record<string, [number, number]> = {
  GERMINATION: [0.4, 0.9],
  SEEDLING: [0.4, 0.9],
  VEGETATIVE: [0.8, 1.2],
  FLOWER: [1.0, 1.5],
  DRYING: [0.5, 0.9], // ~60°F/60%RH ≈ 0.7 kPa (stage-tips + postharvest review)
}
// pH bands keyed by structured mediumType; soilless per CANNA coco /
// stage-tips hydro guidance, soil per stage-tips soil band.
const PH_BANDS: Record<string, [number, number]> = {
  SOIL: [6.0, 6.8],
  LIVING_SOIL: [6.0, 6.8],
  COCO: [5.5, 6.2],
  HYDRO: [5.5, 6.2],
  DWC: [5.5, 6.2],
}
const PH_BAND_UNKNOWN: [number, number] = [5.5, 7.0]

const TEMP_HIGH_F = 86 // ~30°C — Chandra 2008 photosynthetic optimum edge
const TEMP_LOW_F = 62 // cold-root / slowed-growth floor (stage-tips germ band)
const RH_FLOWER_RISK = 65 // Punja 2022: botrytis favored >70% RH; 65 = approaching

/** Discriminating-measurement preference order — used only to break ties
 *  between measurements referenced by equally-weighted findings. */
const MEASUREMENT_PRIORITY: MetricId[] = [
  "runoffEc",
  "runoffPh",
  "substrateMoisture",
  "leafTemp",
  "watering",
  "ph",
  "ec",
  "temperature",
  "humidity",
  "ppfd",
  "photoperiod",
  "height",
]

const HINTS = {
  leafTemp: {
    id: "leafTemp",
    label: "leaf/canopy temperature",
    why: "explains the gap between recorded and calculated VPD",
  },
  runoffEc: {
    id: "runoffEc",
    label: "runoff EC",
    why: "best separates salt buildup from underfeeding",
  },
  runoffPh: {
    id: "runoffPh",
    label: "runoff pH",
    why: "confirms whether the root zone is actually drifting",
  },
  ppfd: {
    id: "ppfd",
    label: "canopy light intensity (PPFD)",
    why: "stalled or stretched growth can't be separated from light limits without it",
  },
  substrateMoisture: {
    id: "substrateMoisture",
    label: "substrate moisture / pot weight",
    why: "separates watering issues from environment issues",
  },
} satisfies Record<string, MeasurementHint>

const frac = (s: string, n: number) => s.replace("{n}", String(n))
const f1 = (v: number) => Math.round(v * 10) / 10

// ── First rule set ──────────────────────────────────────────────────
// Deliberately small: only rules the current schema can feed without
// guessing. No nutrient diagnoses, no pest certainty, no undocumented
// thresholds — those wait for the full knowledge phase.

export const INTEL_RULES: IntelRule[] = [
  {
    id: "data.vpd-divergence",
    domain: "data",
    kind: "observation",
    title: "Recorded vs calculated VPD mismatch",
    applies: (ctx) => ctx.vpdDivergence != null && Math.abs(ctx.vpdDivergence) >= 0.3,
    evaluate: (ctx) => [
      {
        direction: "info",
        strength: "strong",
        confirmed: true,
        text: `Recorded VPD (${ctx.series.vpdEntered.latest}) differs by ${f1(Math.abs(ctx.vpdDivergence!))} kPa from the value calculated from temperature/RH (${ctx.series.vpdComputed.latest}) — one of them is off.`,
        measurement: HINTS.leafTemp,
      },
    ],
    sourceIds: ["fao56-svp"],
  },
  {
    id: "env.vpd-band",
    domain: "environment",
    kind: "risk",
    title: "VPD outside stage range",
    applies: (ctx) => ctx.diary.stage in VPD_BANDS && ctx.series.vpdComputed.n >= 3,
    evaluate: (ctx) => {
      const [lo, hi] = VPD_BANDS[ctx.diary.stage]
      const exc = countExcursions(ctx.series.vpdComputed.points, lo, hi)
      if (!exc.count) return []
      const side = ctx.series.vpdComputed.latest != null && ctx.series.vpdComputed.latest > hi ? "high" : "low"
      const text =
        side === "high"
          ? `Calculated VPD is running above the ${lo}–${hi} kPa ${ctx.diary.stage.toLowerCase()} range ({n}/${exc.n} readings out) — high transpiration can stress leaf edges.`
          : `Calculated VPD is running below the ${lo}–${hi} kPa ${ctx.diary.stage.toLowerCase()} range ({n}/${exc.n} readings out) — weak transpiration slows nutrient flow and invites moisture issues.`
      return [
        {
          direction: "risk",
          strength: exc.fraction >= 0.6 || exc.longestRun >= 3 ? "moderate" : "weak",
          text: frac(text, exc.count),
          measurement: HINTS.leafTemp,
        },
      ]
    },
    sourceIds: ["cs-vpd-ranges", "ieee-greenhouse-survey", "fao56-svp"],
  },
  {
    id: "env.rh-flower-high",
    domain: "environment",
    kind: "risk",
    title: "Elevated humidity in flower",
    applies: (ctx) => ctx.diary.stage === "FLOWER" && ctx.series.humidity.n >= 3,
    evaluate: (ctx) => {
      const pts = ctx.series.humidity.points.slice(-5)
      const high = pts.filter((p) => p.v >= RH_FLOWER_RISK)
      if (high.length < 3) return []
      return [
        {
          direction: "risk",
          strength: "moderate",
          text: `RH ≥65% in ${high.length} of the last ${pts.length} readings during flower — sustained humidity this late raises bud-rot and powdery-mildew risk.`,
        },
      ]
    },
    sourceIds: ["punja-2022-botrytis", "utia-pm-hemp", "bc-cannabis-diseases"],
  },
  {
    id: "env.rh-trend",
    domain: "environment",
    kind: "risk",
    title: "Humidity trending upward",
    applies: (ctx) => ctx.series.humidity.trend === "rising",
    evaluate: () => [
      {
        direction: "risk",
        strength: "weak",
        text: "Humidity is trending upward across recent readings.",
      },
    ],
    sourceIds: ["bc-cannabis-diseases"],
  },
  {
    id: "env.temp-high",
    domain: "environment",
    kind: "risk",
    title: "Sustained high temperature",
    applies: (ctx) => ctx.series.temperature.n >= 3,
    evaluate: (ctx) => {
      const exc = countExcursions(ctx.series.temperature.points, -Infinity, TEMP_HIGH_F)
      if (exc.fraction < 0.6 || exc.count < 3) return []
      return [
        {
          direction: "risk",
          strength: "moderate",
          text: `Temperature above ${TEMP_HIGH_F}°F in ${exc.count} of the last ${exc.n} readings — photosynthetic rate drops and stress compounds past ~30°C.`,
        },
      ]
    },
    sourceIds: ["chandra-2008-photosynthesis"],
  },
  {
    id: "env.temp-low",
    domain: "environment",
    kind: "risk",
    title: "Sustained low temperature",
    applies: (ctx) => ctx.series.temperature.n >= 3,
    evaluate: (ctx) => {
      const exc = countExcursions(ctx.series.temperature.points, TEMP_LOW_F, Infinity)
      if (exc.fraction < 0.6 || exc.count < 3) return []
      return [
        {
          direction: "risk",
          strength: "weak",
          text: `Temperature below ${TEMP_LOW_F}°F in ${exc.count} of the last ${exc.n} readings — cold roots slow uptake and stall growth.`,
        },
      ]
    },
    sourceIds: ["terptalk-stage-tips"],
  },
  {
    id: "chem.ph-band",
    domain: "chemistry",
    kind: "assessment",
    title: "pH outside medium range",
    applies: (ctx) => ctx.series.ph.n >= 1,
    evaluate: (ctx) => {
      const medium = ctx.diary.mediumType ?? "OTHER"
      const [lo, hi] = PH_BANDS[medium] ?? PH_BAND_UNKNOWN
      const exc = countExcursions(ctx.series.ph.points, lo, hi)
      if (!exc.latestOutside && exc.count < 3) return []
      const wide = !(medium in PH_BANDS)
      return [
        {
          direction: "for",
          strength: exc.count >= 3 ? "moderate" : "weak",
          text: `pH ${ctx.series.ph.latest} is outside the ${lo}–${hi} range ${wide ? "generally used" : `for ${medium.toLowerCase().replace("_", " ")}`} — off-range pH can lock nutrients out.`,
          measurement: HINTS.runoffPh,
        },
      ]
    },
    sourceIds: ["canna-coco-ph", "terptalk-stage-tips"],
  },
  {
    id: "chem.ec-drift",
    domain: "chemistry",
    kind: "risk",
    title: "EC trending upward",
    applies: (ctx) => ctx.series.ec.trend === "rising",
    evaluate: (ctx) => [
      {
        direction: "risk",
        strength: "weak",
        text: `EC is trending upward across recent readings (latest ${ctx.series.ec.latest}) — climbing EC can mean salt accumulation or under-watering.`,
        measurement: HINTS.runoffEc,
      },
    ],
    sourceIds: ["canna-coco-ph"],
  },
  {
    id: "growth.stalled",
    domain: "growth",
    kind: "assessment",
    title: "Height growth appears stalled",
    applies: (ctx) =>
      ctx.diary.stage === "VEGETATIVE" &&
      ctx.series.height.n >= 3 &&
      ctx.series.height.points.length >= 3 &&
      ctx.series.height.points[ctx.series.height.points.length - 1].t - ctx.series.height.points[0].t >= 7 * 86400000,
    evaluate: (ctx) => {
      const pts = ctx.series.height.points
      const days = (pts[pts.length - 1].t - pts[0].t) / 86400000
      const rate = (pts[pts.length - 1].v - pts[0].v) / days
      if (Math.abs(rate) >= 0.2) return []
      return [
        {
          direction: "for",
          strength: "weak",
          text: `Height is roughly flat over ${Math.round(days)} days of veg (~${f1(rate)} cm/day) — training can mask this, but light or root issues can too.`,
          measurement: HINTS.ppfd,
        },
      ]
    },
    sourceIds: ["chandra-2008-photosynthesis"],
  },
  {
    id: "data.sparse-env",
    domain: "data",
    kind: "gap",
    title: "Sparse environmental logging",
    applies: (ctx) => ctx.updateCount >= 1 && ctx.envCoverage < 0.5,
    evaluate: (ctx) => {
      const want = ctx.missing.includes("ph")
        ? ({ id: "ph", label: "pH", why: "pH is the measurement most often behind mysterious deficiencies" } satisfies MeasurementHint)
        : ({ id: "temperature", label: "temperature + humidity", why: "they unlock VPD calculation on every update" } satisfies MeasurementHint)
      return [
        {
          direction: "info",
          strength: "weak",
          text: `Only ${Math.round(ctx.envCoverage * 100)}% of recent updates recorded environment data — interpretation is limited without it.`,
          measurement: want,
        },
      ]
    },
    sourceIds: [],
  },
  {
    id: "data.no-env",
    domain: "data",
    kind: "gap",
    title: "No environmental readings",
    applies: (ctx) =>
      ctx.updateCount >= 1 &&
      ctx.series.temperature.n + ctx.series.humidity.n + ctx.series.ph.n + ctx.series.ec.n === 0,
    evaluate: () => [
      {
        direction: "info",
        strength: "weak",
        text: "No temperature, humidity, pH, or EC has been logged yet — there's nothing to interpret.",
        measurement: {
          id: "temperature",
          label: "temperature + humidity",
          why: "the single highest-value pair — it unlocks VPD and trend analysis",
        },
      },
    ],
    sourceIds: [],
  },
]

// ── Aggregation ─────────────────────────────────────────────────────

/** Deterministic finding-state classifier — exported so tests can pin
 *  every state directly, including paths the current rule set can't
 *  reach naturally (e.g. conflicting evidence). */
export function findingStateFor(kind: Finding["kind"], evidence: IntelEvidence[]): Finding["state"] {
  if (kind === "gap") return "insufficient"
  let forScore = 0
  let againstScore = 0
  let confirmed = false
  for (const e of evidence) {
    if (e.confirmed) confirmed = true
    if (e.direction === "against") againstScore += W[e.strength]
    else forScore += W[e.strength]
  }
  if (confirmed) return "confirmed"
  if (forScore >= 3 && againstScore >= 3) return "conflicting"
  if (forScore >= 3) return "strong"
  if (forScore >= 1) return "possible"
  return "insufficient"
}

export function evaluateContext(ctx: GrowContextView): Finding[] {
  const findings: Finding[] = []
  for (const rule of INTEL_RULES) {
    if (!rule.applies(ctx)) continue
    const evidence = rule.evaluate(ctx).filter((e) => e.text.trim().length > 0)
    // A rule that evaluated but found nothing produces no finding —
    // an empty finding is noise, not an INSUFFICIENT signal.
    if (!evidence.length) continue
    const state = findingStateFor(rule.kind, evidence)

    // Deterministic next-measurement: hints from the highest-weight
    // evidence first, tie-broken by MEASUREMENT_PRIORITY order.
    const hinted = evidence
      .map((e) => e.measurement)
      .filter((m): m is MeasurementHint => !!m)
      .sort(
        (a, b) => MEASUREMENT_PRIORITY.indexOf(a.id) - MEASUREMENT_PRIORITY.indexOf(b.id)
      )[0]

    findings.push({
      ruleId: rule.id,
      title: rule.title,
      domain: rule.domain,
      kind: rule.kind,
      state,
      evidence,
      nextMeasurement: hinted,
      sourceIds: rule.sourceIds.filter((id) => id in SOURCES),
    })
  }
  return findings
}

/** The single most uncertainty-reducing measurement across findings.
 *  Scored by the state weight of every finding referencing it
 *  (conflicting 4 > strong 3 > possible 2 > insufficient 1), tie-broken
 *  by MEASUREMENT_PRIORITY. Deterministic — not an information-gain
 *  estimate, just a documented ranking. */
export function nextUsefulMeasurement(findings: Finding[]): MeasurementHint | null {
  const stateW: Record<Finding["state"], number> = {
    conflicting: 4,
    strong: 3,
    confirmed: 3,
    possible: 2,
    insufficient: 1,
  }
  const scores = new Map<string, { hint: MeasurementHint; score: number }>()
  for (const f of findings) {
    if (!f.nextMeasurement) continue
    const cur = scores.get(f.nextMeasurement.id)
    const w = stateW[f.state]
    if (cur) cur.score += w
    else scores.set(f.nextMeasurement.id, { hint: f.nextMeasurement, score: w })
  }
  const best = [...scores.values()].sort(
    (a, b) =>
      b.score - a.score ||
      MEASUREMENT_PRIORITY.indexOf(a.hint.id) - MEASUREMENT_PRIORITY.indexOf(b.hint.id)
  )[0]
  return best?.hint ?? null
}

// ── Rendering ───────────────────────────────────────────────────────
// Compact block appended inside the /checkin diary block. Labels make
// the epistemics explicit: observed = logged values, calculated =
// derived, interpretation = rule output, missing = what would help.

const ORDER: Finding["state"][] = ["conflicting", "strong", "confirmed", "possible"]

export function renderIntelLines(ctx: GrowContextView, findings: Finding[]): string[] {
  const lines: string[] = []
  const observed: string[] = []
  if (ctx.series.temperature.latest != null) observed.push(`${ctx.series.temperature.latest}°F`)
  if (ctx.series.humidity.latest != null) observed.push(`${ctx.series.humidity.latest}% RH`)
  if (ctx.series.ph.latest != null) observed.push(`pH ${ctx.series.ph.latest}`)
  if (ctx.series.ec.latest != null) observed.push(`EC ${ctx.series.ec.latest}`)
  const calculated: string[] = []
  if (ctx.series.vpdComputed.latest != null) calculated.push(`VPD ≈${ctx.series.vpdComputed.latest} kPa`)
  const watch = findings
    .filter((f) => f.kind !== "gap" && ORDER.includes(f.state))
    .sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state))
    .slice(0, 3)
  const next = nextUsefulMeasurement(findings)

  // Nothing to say → render nothing.
  if (!observed.length && !calculated.length && !watch.length && !next) return []

  lines.push(`📊 Reading the last ${ctx.updateCount} update${ctx.updateCount === 1 ? "" : "s"}:`)
  if (observed.length) lines.push(`Observed: ${observed.join(" · ")}`)
  if (calculated.length) lines.push(`Calculated: ${calculated.join(" · ")} (air temp — leaf temp not logged)`)
  if (watch.length) {
    lines.push("Worth watching:")
    for (const f of watch) {
      const mark = f.state === "confirmed" ? "•" : f.state === "conflicting" ? "⚠" : f.state === "strong" ? "•" : "·"
      lines.push(`${mark} ${f.evidence[0]?.text ?? f.title}`)
    }
  }
  if (next) lines.push(`Next useful measurement: ${next.label} — ${next.why}`)
  return lines
}
