// TerpBot intelligence — deterministic diagnostic engine.
//
// Pipeline: GrowContext → rules → candidate-bound evidence → ranked
// candidates + standalone findings → rendered lines.
// No Prisma, no I/O — pure evaluation over the context object so every
// rule is unit-testable with a fabricated context.
//
// Model:
//   • Rules emit evidence bound to a CANDIDATE (a hypothesis like
//     "salt_buildup" or "humidity_high") or unbound (data-quality
//     observations and gap signals, which become standalone Findings).
//   • Evidence direction: for|risk raise a candidate, against opposes
//     it, info is neutral (display only — never scored).
//   • Strength is categorical: weak 1 / moderate 2 / strong 3.
//
// Per-candidate assessment (deterministic, documented — no percentages):
//   Evidence groups by (direction, signal) — evidence sharing a signal
//   is correlated, so a group contributes its MAX weight, not a sum.
//   support      = Σ(for groups) + Σ(risk groups; capped at weak for
//                  condition candidates — predisposition ≠ proof)
//   againstScore = Σ(against groups)
//   independentSignals = count of distinct (for|risk) signal groups
//   no evidence                              → INSUFFICIENT
//   a confirmed:true item with no opposition → CONFIRMED
//     (measured facts only; contradiction drops through to CONFLICTING)
//   support ≥2 AND against ≥2 AND support−against ≤1 → CONFLICTING
//   support ≥3 AND (independentSignals ≥2 OR a strong item) → STRONG
//   support ≥1                              → POSSIBLE
//   otherwise                               → INSUFFICIENT
//   then clamped to the candidate's maxState (condition/risk candidates
//   can never be CONFIRMED; thin-provenance candidates cap at POSSIBLE).
// Standalone findings use the same table, with kind:"gap" forced to
// INSUFFICIENT. CONFLICTING preserves BOTH sides plus a resolving
// measurement — evidence is never hidden to produce a cleaner answer.

import { countExcursions, dewPointFromTempRh, excursionEpisodes } from "@/lib/terpbot-intel-calc"
import { episodesFromObservations } from "@/lib/terpbot-intel-episodes"
import { feedsForSymptom } from "@/lib/terpbot-nl-parse"
import { CANDIDATES, SOURCES } from "@/lib/terpbot-intel-knowledge"
import {
  LOCATION_LABELS,
  SYMPTOM_LABELS,
} from "@/lib/terpbot-nl-vocab"
import { METRIC_EPSILON, SIGNAL_METRICS, STALE_DAYS } from "@/lib/terpbot-intel-types"
import type {
  ActionClass,
  ActionRequest,
  CandidateDef,
  CandidateResult,
  Diagnosis,
  Finding,
  GrowContextView,
  IntelEvidence,
  IntelRule,
  IntelSeries,
  MeasurementHint,
  MetricId,
  MetricPoint,
  NextStepId,
  SignalId,
  SymptomId,
} from "@/lib/terpbot-intel-types"

export type { GrowContextView, Finding, IntelRule, CandidateResult, Diagnosis } from "@/lib/terpbot-intel-types"

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
// stage-tips hydro guidance, soil per stage-tips/Cornell soil band.
const PH_BANDS: Record<string, [number, number]> = {
  SOIL: [6.0, 6.8],
  LIVING_SOIL: [6.0, 6.8],
  COCO: [5.5, 6.2],
  HYDRO: [5.5, 6.2],
  DWC: [5.5, 6.2],
}
const PH_BAND_UNKNOWN: [number, number] = [5.5, 7.0]

// Stage-conditioned temperature bands (°F). Growth-stage ceiling 86°F
// = ~30°C adverse edge (Chandra 2008). Germination/seedling bands are
// tighter — small root zones buffer less (stage-tips 22–25°C germ).
const TEMP_BANDS: Record<string, [number, number]> = {
  GERMINATION: [70, 80],
  SEEDLING: [68, 82],
  VEGETATIVE: [64, 86],
  FLOWER: [64, 86],
  HARVEST: [64, 86],
  DRYING: [57, 68],
  CURING: [58, 68],
}
const TEMP_BAND_DEFAULT: [number, number] = [62, 86]

// Stage-conditioned RH bands — floors feed humidity_low, ceilings catch
// "elevated for this stage" below the stage-agnostic 70% disease line.
const RH_BANDS: Record<string, [number, number]> = {
  GERMINATION: [60, 85],
  SEEDLING: [55, 75],
  VEGETATIVE: [40, 70],
  FLOWER: [40, 55],
  DRYING: [50, 65],
  CURING: [55, 65],
}

const RH_FLOWER_RISK = 65 // Punja 2022: botrytis favored >70% RH; 65 = approaching
const RH_SUSTAINED = 70 // sustained-high threshold for the humidity_high candidate
const RH_DISEASE = 70 // confirmed favorable-RH line (Punja/UTIA/BC)
const BOTRYTIS_TEMP_F: [number, number] = [63, 75] // 17–24°C — Punja 2022
const PM_TEMP_F: [number, number] = [75, 86] // 24–30°C — UTIA/arch (UTIA text says 70–80°F; the gap is covered by the botrytis window)
const LATE_FLOWER_DAYS = 35 // Punja & Ni 2025: infection sets wk2–5, symptoms ~wk5+
const TEMP_SWING_F = 15 // window spread suggesting day/night swing
const EC_ELEVATED = 2.5 // mS/cm — above typical coco/hydro feed range
const EC_VERY_HIGH = 4.0 // Hershkowitz 2025 tolerance bound — beyond is genuinely extreme
const EC_FEED_MIN = 0.8 // below this, "feeding at strength" can't be claimed
const EC_FLOOR: Record<string, number> = { VEGETATIVE: 0.8, FLOWER: 1.0 }
const EC_SEEDLING_CEILING = 1.0 // seedlings need minimal feed (convention)
const PH_DANGER_LOW = 5.0 // Whipker/agg2: growth measurably inhibited below
const PH_EDGE = 0.3 // distance to band edge that makes drift actionable
const LATE_FLOWER_TAPER_DAYS = 42 // ~week 6+ — senescence/flush territory
const GROWTH_STAGES = new Set(["GERMINATION", "SEEDLING", "VEGETATIVE", "FLOWER"])

/** Deficiency candidates a reported symptom can feed — the lockout
 *  confounder rule emits against/for into this set. */
const DEFICIENCY_CANDIDATES = new Set([
  "nitrogen_def", "magnesium_def", "potassium_def", "iron_def",
  "sulfur_def", "phosphorus_def", "cal_mag", "zinc_boron",
])

/** Symptoms that are direct sightings, not circumstantial signs —
 *  "I see spider mites" or "white powder" carries more weight than
 *  "spots on leaves". */
const DIRECT_SIGNAL = new Set<SymptomId>([
  "PEST_MITES", "PEST_MITES_OTHER", "PEST_APHIDS", "PEST_THRIPS",
  "PEST_FUNGUS_GNATS", "PEST_WHITEFLIES", "PEST_CATERPILLARS",
  "PEST_SLUGS", "WEBBING", "POWDERY", "SLIME_TRAIL", "FUZZ_MOLD",
  "ROOT_ROT", "BUD_ROT", "HERMIE", "STEM_SPLIT", "NO_SPROUT",
  "SALT_CRUST", "GRASSY_SMELL", "WIND_BURN", "LIGHT_BURN",
  "PH_UNSTABLE", "EC_RISING",
])

/** Current-state reports in words — "the soil is soggy" is closer to a
 *  moisture reading than a sighting, so it lands moderate, not strong.
 *  Self-diagnoses ("I overwatered") aren't even that — they stay weak. */
const STATE_REPORT = new Set<SymptomId>(["MEDIUM_WET", "MEDIUM_DRY"])

/** Reports that actively argue against a rival candidate. */
export const CONTRA: Partial<Record<SymptomId, string[]>> = {
  MEDIUM_WET: ["underwater"],
  MEDIUM_DRY: ["overwater"],
  OVERWATERED: ["underwater"],
  UNDERWATERED: ["overwater"],
  // Deep glossy green is adequate-N foliage — it argues against the
  // deficiencies that read as pale/yellow. NOT phosphorus: cannabis P
  // deficiency itself presents as dark green with purple/red stems.
  LEAF_DARK_GREEN: ["nitrogen_def", "sulfur_def"],
}

/** Discriminating-measurement preference order — final tie-break between
 *  equally-scored next steps. Metrics first (they're loggable), then
 *  inspections, then the rest — a total order over NextStepId. */
export const MEASUREMENT_PRIORITY: NextStepId[] = [
  "runoffEc",
  "runoffPh",
  "substrateMoisture",
  "inspect:leaf-undersides",
  "inspect:sticky-cards",
  "inspect:roots",
  "inspect:bud-interior",
  "inspect:leaf-pattern",
  "inspect:stem-base",
  "inspect:trichomes",
  "inspect:leaf-surfaces",
  "inspect:flowers",
  "inspect:canopy-tops",
  "leafTemp",
  "watering",
  "ph",
  "ec",
  "temperature",
  "humidity",
  "ppfd",
  "photoperiod",
  "height",
  "vpd",
]

/** Label + generic "why" for every recommendable measurement. Candidate-
 *  specific reasons come from the candidate's discriminatingInputs —
 *  this map is the fallback renderer vocabulary. */
export const MEASUREMENT_INFO: Record<MetricId, { label: string; why: string }> = {
  runoffEc: { label: "runoff EC", why: "best separates salt buildup from under-watering" },
  runoffPh: { label: "runoff pH", why: "confirms whether the root zone is actually drifting" },
  substrateMoisture: { label: "substrate moisture / pot weight", why: "separates watering issues from environment issues" },
  leafTemp: { label: "leaf/canopy temperature", why: "leaf temperature, not air, drives transpiration — an IR reading tells whether the calculated VPD is what the canopy actually sees" },
  watering: { label: "watering interval/volume", why: "distinguishes over- vs under-watering patterns" },
  ph: { label: "pH", why: "the measurement most often behind mysterious deficiencies" },
  ec: { label: "EC", why: "feed-strength trend unlocks root-zone reasoning" },
  temperature: { label: "temperature + humidity", why: "the highest-value pair — unlocks VPD and trend analysis" },
  humidity: { label: "humidity", why: "pairs with temperature for VPD" },
  ppfd: { label: "canopy light intensity (PPFD)", why: "stalled or stretched growth can't be separated from light limits without it" },
  photoperiod: { label: "photoperiod hours", why: "needed to compute DLI" },
  height: { label: "plant height", why: "growth rate needs ≥2 height readings" },
  vpd: { label: "VPD", why: "can be entered manually or derived from temperature/RH" },
}

/** Visual inspections — recommendable next steps that aren't metrics.
 *  resolvedBy lists symptoms whose presence means the inspection was
 *  effectively done (don't ask to check undersides after webbing is
 *  already reported there). */
export const INSPECTION_INFO: Record<string, { label: string; why: string; resolvedBy?: SymptomId[] }> = {
  "inspect:leaf-undersides": {
    label: "leaf-underside inspection (loupe or phone macro)",
    why: "mites, thrips, aphids, and eggs hide there — most pest questions resolve here",
    resolvedBy: ["WEBBING", "PEST_MITES", "PEST_APHIDS", "PEST_THRIPS", "PEST_WHITEFLIES", "PEST_CATERPILLARS"],
  },
  "inspect:sticky-cards": {
    label: "yellow sticky cards at canopy level",
    why: "shows which flying pest is present before any treatment",
    resolvedBy: ["PEST_FUNGUS_GNATS", "PEST_WHITEFLIES", "PEST_THRIPS"],
  },
  "inspect:roots": {
    label: "root inspection (slide the root ball out)",
    why: "white spreading roots vs brown slime settles root-zone questions",
    resolvedBy: ["ROOT_ROT", "ROOT_BOUND"],
  },
  "inspect:bud-interior": {
    label: "inside dense colas",
    why: "bud rot starts inside where humidity is trapped — outer leaves look fine",
    resolvedBy: ["BUD_ROT", "FUZZ_MOLD"],
  },
  "inspect:leaf-pattern": {
    label: "where on the plant the pattern starts (lower vs new growth)",
    why: "mobile deficiencies show on old leaves first; immobile on new — that split narrows the cause",
    resolvedBy: ["LEAF_YELLOWING", "LEAF_PALE"],
  },
  "inspect:stem-base": {
    label: "the stem base at soil line",
    why: "damping-off and stem rot show there first — a pinched dark base is diagnostic",
    resolvedBy: ["COLLAPSED", "FUZZ_MOLD"],
  },
  "inspect:trichomes": {
    label: "trichome color under a loupe",
    why: "clear→milky→amber is the real maturity signal, not calendar days",
    resolvedBy: ["GRASSY_SMELL"],
  },
  "inspect:leaf-surfaces": {
    label: "upper leaf surfaces",
    why: "powdery mildew shows on top first — flour-like wipe-able coating",
    resolvedBy: ["POWDERY"],
  },
  "inspect:flowers": {
    label: "buds for pollen sacs / nanners",
    why: "confirms hermie vs swollen calyxes — only act on confirmed sacs",
    resolvedBy: ["HERMIE"],
  },
  "inspect:canopy-tops": {
    label: "tops closest to the light",
    why: "light burn bleaches the crown first — distance tells light burn from deficiency",
    resolvedBy: ["BLEACHING"],
  },
  // No resolvedBy — satisfied by a known stage, not a symptom report.
  "inspect:stage": {
    label: "which stage and week you're in",
    why: "temperature/RH/VPD targets shift by stage",
  },
}

const hint = (id: NextStepId): MeasurementHint => {
  if (id.startsWith("inspect:")) {
    const info = INSPECTION_INFO[id]
    return { id, label: info?.label ?? id, why: info?.why ?? "", resolvedBy: info?.resolvedBy }
  }
  return { id, ...MEASUREMENT_INFO[id as MetricId] }
}
const f1 = (v: number) => Math.round(v * 10) / 10

/** Any series carries a user-reported point whose EVENT is younger
 *  than STALE_DAYS — a fresh report keeps stale logged data from
 *  suppressing analysis. Approximate historical points can't count:
 *  "runoff EC was 2.1 a while back" is history, not a fresh reading. */
const hasFreshReport = (ctx: GrowContextView) =>
  Object.values(ctx.series).some((s) => {
    const p = s.points[s.points.length - 1]
    return (
      p?.provenance === "user-reported" &&
      !p.tApproximate &&
      (ctx.now - p.t) / 86400000 < STALE_DAYS
    )
  })

/** A reading describing "now" must be recent — older than this it's
 *  history (staleness handles the >STALE_DAYS case; this guards the
 *  gap in between, and excludes approximate points entirely). */
const CURRENT_MS = 2 * 86400000

/** Is the series' newest point usable as a CURRENT reading? Approximate
 *  points never qualify; a point older than CURRENT_MS doesn't either. */
const latestIsCurrent = (s: { points: MetricPoint[] }, now: number) => {
  const p = s.points[s.points.length - 1]
  return p != null && !p.tApproximate && now - p.t <= CURRENT_MS
}

/** Two readings of the same metric disagree meaningfully only when they
 *  claim to describe the same time — |Δevent| beyond this isn't a
 *  contradiction, it's two different days. */
const CONFLICT_WINDOW_MS = 2 * 86400000

/** Per-series material difference + display format. Height is absent:
 *  growth makes different-day heights legitimately different. */
const CONFLICT_DELTA: [
  keyof GrowContextView["series"],
  SignalId,
  number,
  (v: number) => string,
][] = [
  ["temperature", "temperature", 5, (v) => `${f1(v)}°F`],
  ["humidity", "humidity", 10, (v) => `${Math.round(v)}% RH`],
  ["ph", "ph", 0.4, (v) => `pH ${f1(v)}`],
  ["ec", "ec", 0.5, (v) => `EC ${f1(v)}`],
  ["vpdEntered", "env:temp-rh", 0.3, (v) => `VPD ${f1(v)} kPa`],
  ["runoffPh", "runoff", 0.4, (v) => `runoff pH ${f1(v)}`],
  ["runoffEc", "runoff", 0.5, (v) => `runoff EC ${f1(v)}`],
]

/** Latest logged vs latest user-reported point on each series —
 *  a material disagreement between two provenance channels describing
 *  the same time window. Neither side is assumed right. */
function metricConflicts(ctx: GrowContextView) {
  const out: { signal: SignalId; metric: MetricId; text: string }[] = []
  for (const [key, signal, delta, fmt] of CONFLICT_DELTA) {
    const pts = ctx.series[key].points
    const logged = [...pts].reverse().find((p) => (p.provenance ?? "logged") === "logged")
    const reported = [...pts].reverse().find((p) => p.provenance === "user-reported")
    if (!logged || !reported || reported.tApproximate) continue
    if (Math.abs(logged.t - reported.t) > CONFLICT_WINDOW_MS) continue
    if (Math.abs(logged.v - reported.v) < delta) continue
    const newest = reported.t >= logged.t ? "your report" : "the logged value"
    out.push({
      signal,
      metric: SERIES_TO_CONFLICT_METRIC[key],
      text: `Logged ${fmt(logged.v)} vs your reported ${fmt(reported.v)} disagree — timing, spot, or instrument may explain it. I'm working from ${newest}.`,
    })
  }
  return out
}

const SERIES_TO_CONFLICT_METRIC: Record<string, MetricId> = {
  temperature: "temperature",
  humidity: "humidity",
  ph: "ph",
  ec: "ec",
  vpdEntered: "vpd",
  runoffPh: "runoffPh",
  runoffEc: "runoffEc",
}

/** Age in days of the newest point backing a signal — freshness for
 *  metric-backed signals, observation age for `symptom:*`. Null when
 *  the signal has no aging source (stage/data). */
export function signalAgeDays(ctx: GrowContextView, signal: string): number | null {
  if (signal.startsWith("symptom:")) {
    // composite "symptom:A+B" groups age at their OLDEST member —
    // the compound claim is only as fresh as its stalest part
    const members = signal.slice("symptom:".length).split("+")
    const ages = members
      .map((m) => {
        const ts = ctx.observations.filter((o) => o.symptom === m).map((o) => o.t)
        return ts.length ? (ctx.now - Math.max(...ts)) / 86400000 : null
      })
      .filter((a): a is number => a != null)
    return ages.length ? Math.max(...ages) : null
  }
  const metrics = SIGNAL_METRICS[signal as SignalId]
  if (!metrics?.length) return null
  const ages = metrics
    .map((m) => ctx.freshness[m])
    .filter((a): a is number => a != null)
  if (!ages.length) return null
  // a signal is only as fresh as its oldest required series
  return Math.max(...ages)
}

// ── First rule set ──────────────────────────────────────────────────
// Deliberately small: only rules the current schema can feed without
// guessing. Evidence pools into shared candidates — one observation
// can support several hypotheses, and opposing evidence is emitted
// explicitly rather than suppressed. No nutrient diagnoses, no pest
// certainty, no undocumented thresholds — those wait for the full
// knowledge phase.

export const INTEL_RULES: IntelRule[] = [
  {
    id: "data.vpd-divergence",
    signal: "env:temp-rh",
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
        measurement: hint("leafTemp"),
      },
    ],
    sourceIds: ["fao56-svp"],
  },
  {
    // Logged vs chat-reported disagreement on the same metric inside a
    // shared window — surfaced, never silently resolved. Data-quality
    // observation only; no horticultural claim → no sources.
    id: "data.metric-conflict",
    signal: "data",
    domain: "data",
    kind: "observation",
    title: "Logged and reported readings disagree",
    applies: (ctx) => metricConflicts(ctx).length > 0,
    evaluate: (ctx) =>
      metricConflicts(ctx).map((c) => ({
        direction: "info" as const,
        strength: "strong" as const,
        confirmed: true,
        signal: c.signal,
        text: c.text,
        measurement: hint(c.metric),
      })),
    sourceIds: [],
  },
  {
    id: "env.vpd-band",
    signal: "env:temp-rh",
    domain: "environment",
    kind: "risk",
    title: "VPD outside stage range",
    applies: (ctx) => ctx.diary.stage in VPD_BANDS && ctx.series.vpdComputed.n >= 3,
    evaluate: (ctx) => {
      const [lo, hi] = VPD_BANDS[ctx.diary.stage]
      const exc = countExcursions(ctx.series.vpdComputed.points, lo, hi)
      if (!exc.count) return []
      const strength = exc.fraction >= 0.6 || exc.longestRun >= 3 ? "moderate" : "weak"
      const high = ctx.series.vpdComputed.latest != null && ctx.series.vpdComputed.latest > hi
      if (high) {
        const seedling = ctx.diary.stage === "SEEDLING" || ctx.diary.stage === "GERMINATION"
        return [
          {
            direction: "for",
            strength: seedling ? "moderate" : strength,
            candidate: "heat_stress",
            text: `Calculated VPD is running above the ${lo}–${hi} kPa ${ctx.diary.stage.toLowerCase()} range (${exc.count}/${exc.n} readings out) — high transpiration can stress leaf edges.${seedling ? " Small root zones can't supply that demand." : ""}`,
            measurement: hint("leafTemp"),
          },
          {
            direction: "for",
            strength: "weak",
            candidate: "humidity_low",
            text: "High calculated VPD — the air is pulling water faster than roots can supply.",
          },
          {
            direction: "against",
            strength: "weak",
            candidate: "humidity_high",
            text: "VPD running high argues against a moisture-saturated environment.",
          },
        ]
      }
      const ev: IntelEvidence[] = [
        {
          direction: "for",
          strength,
          candidate: "humidity_high",
          text: `Calculated VPD is running below the ${lo}–${hi} kPa ${ctx.diary.stage.toLowerCase()} range (${exc.count}/${exc.n} readings out) — weak transpiration means moisture-laden air around the plant.`,
          measurement: hint("leafTemp"),
        },
      ]
      if (ctx.diary.stage === "FLOWER") {
        ev.push({
          direction: "risk",
          strength,
          candidate: "env.moisture-disease-risk",
          text: `Low calculated VPD during flower (${exc.count}/${exc.n} readings under ${lo} kPa) — stagnant moist air is the bud-rot recipe.`,
        })
      }
      return ev
    },
    sourceIds: ["cs-vpd-ranges", "ieee-greenhouse-survey", "fao56-svp", "terptalk-stage-tips"],
  },
  {
    id: "env.rh-flower-high",
    signal: "humidity",
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
          candidate: "env.moisture-disease-risk",
          text: `RH ≥65% in ${high.length} of the last ${pts.length} readings during flower — sustained humidity this late raises bud-rot and powdery-mildew risk.`,
        },
        {
          direction: "for",
          strength: "moderate",
          candidate: "humidity_high",
          text: `RH ≥65% in ${high.length} of the last ${pts.length} readings — humidity is running high.`,
        },
      ]
    },
    sourceIds: ["punja-2022-botrytis", "utia-pm-hemp", "bc-cannabis-diseases"],
  },
  {
    id: "env.rh-sustained-high",
    signal: "humidity",
    domain: "environment",
    kind: "assessment",
    title: "Sustained high humidity",
    applies: (ctx) => ctx.series.humidity.n >= 3,
    evaluate: (ctx) => {
      // "above threshold" excursions: band (-Infinity, RH_SUSTAINED)
      const exc = countExcursions(ctx.series.humidity.points, -Infinity, RH_SUSTAINED)
      const ev: IntelEvidence[] = []
      if (exc.count >= 3 && exc.fraction >= 0.6) {
        ev.push({
          direction: "for",
          strength: exc.longestRun >= 3 ? "strong" : "moderate",
          candidate: "humidity_high",
          text: `RH above ${RH_SUSTAINED}% in ${exc.count} of the last ${exc.n} readings${exc.longestRun >= 3 ? ` (${exc.longestRun} in a row)` : ""} — sustained, not a blip.`,
          measurement: hint("substrateMoisture"),
        })
        // Honest opposition: the newest reading back under threshold
        // argues the elevation may already be correcting.
        if (!exc.latestOutside) {
          const latest = ctx.series.humidity.latest!
          ev.push({
            direction: "against",
            strength: latest < 65 ? "moderate" : "weak",
            candidate: "humidity_high",
            text: `Latest RH (${latest}%) is back under ${RH_SUSTAINED}% — the elevation may already be correcting.`,
            measurement: hint("humidity"),
          })
        }
      }
      if (ctx.series.humidity.trend === "falling" && ev.length) {
        ev.push({
          direction: "against",
          strength: "weak",
          candidate: "humidity_high",
          text: "Humidity trend is falling across recent readings.",
        })
      }
      return ev
    },
    sourceIds: ["bc-cannabis-diseases", "cornell-cannabis-guidebook"],
  },
  {
    id: "env.rh-trend",
    signal: "humidity",
    domain: "environment",
    kind: "risk",
    title: "Humidity trending upward",
    applies: (ctx) => ctx.series.humidity.trend === "rising",
    evaluate: (ctx) => {
      const latest = ctx.series.humidity.latest
      const [, hi] = RH_BANDS[ctx.diary.stage] ?? [40, 70]
      // In-band movement is just movement — only flag when the trend
      // has carried RH to or past the stage ceiling.
      if (latest == null || latest < hi) return []
      const ev: IntelEvidence[] = [
        {
          direction: "for",
          strength: "weak",
          candidate: "humidity_high",
          text: `Humidity is trending upward and the latest reading (${latest}%) is at/past the ${ctx.diary.stage.toLowerCase()} ceiling (${hi}%).`,
        },
      ]
      if (ctx.diary.stage === "FLOWER") {
        ev.push({
          direction: "risk",
          strength: "weak",
          candidate: "env.moisture-disease-risk",
          text: "Rising humidity during flower compounds moisture-related disease risk.",
        })
      }
      return ev
    },
    sourceIds: ["bc-cannabis-diseases"],
  },
  {
    id: "env.rh-trend-low",
    signal: "humidity",
    domain: "environment",
    kind: "risk",
    title: "Humidity trending downward",
    applies: (ctx) => ctx.series.humidity.trend === "falling",
    evaluate: () => [
      {
        direction: "for",
        strength: "weak",
        candidate: "humidity_low",
        text: "Humidity is trending downward across recent readings.",
      },
    ],
    sourceIds: ["cs-vpd-ranges"],
  },
  {
    id: "env.temp-high",
    signal: "temperature",
    domain: "environment",
    kind: "assessment",
    title: "Sustained high temperature",
    applies: (ctx) => GROWTH_STAGES.has(ctx.diary.stage) && ctx.series.temperature.n >= 3,
    evaluate: (ctx) => {
      const [, hi] = TEMP_BANDS[ctx.diary.stage] ?? TEMP_BAND_DEFAULT
      const exc = countExcursions(ctx.series.temperature.points, -Infinity, hi)
      const ev: IntelEvidence[] = []
      if (exc.fraction >= 0.6 && exc.count >= 3) {
        const seedling = ctx.diary.stage === "SEEDLING" || ctx.diary.stage === "GERMINATION"
        ev.push({
          direction: "for",
          strength: exc.longestRun >= 3 ? "strong" : "moderate",
          candidate: "heat_stress",
          text: `Temperature above ${hi}°F in ${exc.count} of the last ${exc.n} readings — sustained heat past the ${ctx.diary.stage.toLowerCase()} ceiling; photosynthesis drops past ~30°C.${seedling ? " Seedlings have no buffer — heat stalls them faster." : ""}`,
          measurement: hint("leafTemp"),
        })
        if (!exc.latestOutside) {
          ev.push({
            direction: "against",
            strength: "moderate",
            candidate: "heat_stress",
            text: `Latest reading (${ctx.series.temperature.latest}°F) is back under ${hi}°F — the heat may already be correcting.`,
          })
        }
      } else if (exc.latestOutside) {
        ev.push({
          direction: "for",
          strength: "weak",
          candidate: "heat_stress",
          text: `Latest reading (${ctx.series.temperature.latest}°F) is above the ${hi}°F ${ctx.diary.stage.toLowerCase()} ceiling — one reading may be a lights-on peak; watch the next.`,
          measurement: hint("temperature"),
        })
      }
      return ev
    },
    sourceIds: ["chandra-2008-photosynthesis", "terptalk-stage-tips", "cornell-cannabis-guidebook"],
  },
  {
    id: "env.temp-low",
    signal: "temperature",
    domain: "environment",
    kind: "assessment",
    title: "Sustained low temperature",
    applies: (ctx) => GROWTH_STAGES.has(ctx.diary.stage) && ctx.series.temperature.n >= 3,
    evaluate: (ctx) => {
      const [lo] = TEMP_BANDS[ctx.diary.stage] ?? TEMP_BAND_DEFAULT
      const exc = countExcursions(ctx.series.temperature.points, lo, Infinity)
      const ev: IntelEvidence[] = []
      if (exc.fraction >= 0.6 && exc.count >= 3) {
        const tender = ctx.diary.stage === "SEEDLING" || ctx.diary.stage === "GERMINATION"
        ev.push({
          direction: "for",
          strength: tender ? "moderate" : "weak",
          candidate: "env.cold-stress",
          text: `Temperature below ${lo}°F in ${exc.count} of the last ${exc.n} readings — cold roots slow uptake and stall growth.${tender ? " Germination fails and seedlings stall in this range." : ""}`,
        })
        if (!exc.latestOutside) {
          ev.push({
            direction: "against",
            strength: "weak",
            candidate: "env.cold-stress",
            text: `Latest reading (${ctx.series.temperature.latest}°F) is back above ${lo}°F — the cold spell may be over.`,
          })
        }
      } else if (exc.latestOutside) {
        ev.push({
          direction: "for",
          strength: "weak",
          candidate: "env.cold-stress",
          text: `Latest reading (${ctx.series.temperature.latest}°F) is below the ${lo}°F ${ctx.diary.stage.toLowerCase()} floor — watch whether it persists.`,
        })
      }
      return ev
    },
    sourceIds: ["terptalk-stage-tips", "cornell-cannabis-guidebook"],
  },
  {
    id: "env.instability",
    signal: "env:temp-rh",
    domain: "environment",
    kind: "risk",
    title: "Volatile environment",
    applies: (ctx) =>
      ctx.series.temperature.trend === "volatile" || ctx.series.humidity.trend === "volatile",
    evaluate: (ctx) => {
      const ev: IntelEvidence[] = []
      if (ctx.series.temperature.trend === "volatile") {
        ev.push({
          direction: "risk",
          strength: "weak",
          candidate: "env.instability",
          text: "Temperature is swinging between readings — swings stress plants and hide in single daily logs.",
          measurement: hint("leafTemp"),
        })
      }
      if (ctx.series.humidity.trend === "volatile") {
        ev.push({
          direction: "risk",
          strength: "weak",
          candidate: "env.instability",
          text: "Humidity is swinging between readings — check exhaust/controller deadband.",
          measurement: hint("leafTemp"),
        })
      }
      return ev
    },
    sourceIds: ["ieee-greenhouse-survey"],
  },
  {
    id: "chem.ph-band",
    signal: "chem:ph-ec",
    domain: "chemistry",
    kind: "assessment",
    title: "pH outside medium range",
    applies: (ctx) => ctx.series.ph.n >= 1,
    evaluate: (ctx) => {
      const medium = ctx.diary.mediumType ?? "OTHER"
      const [lo, hi] = PH_BANDS[medium] ?? PH_BAND_UNKNOWN
      const exc = countExcursions(ctx.series.ph.points, lo, hi)
      // An out-of-band latest still supports the candidate when it's
      // old — but "is outside" is a current claim, so stale readings
      // render past-tense (the ≥STALE_DAYS clamp handles real aging).
      const phCurrent = latestIsCurrent(ctx.series.ph, ctx.now)
      const latestOut = exc.latestOutside && phCurrent
      if (!exc.latestOutside && exc.count < 3) return []
      const wide = !(medium in PH_BANDS)
      // Every item derived ONLY from the pH series stamps signal "ph" —
      // chem.ph-low-danger reads the same series under "ph", and the
      // two must collapse to ONE signal group (a lone pH series can
      // never reach STRONG). Only the EC-combination item below keeps
      // this rule's "chem:ph-ec" signal — it genuinely reads EC too.
      const ev: IntelEvidence[] = [
        {
          direction: "for",
          strength: exc.count >= 3 ? "moderate" : "weak",
          candidate: "ph_lockout",
          signal: "ph",
          text: latestOut
            ? `pH ${ctx.series.ph.latest} is outside the ${lo}–${hi} range ${wide ? "generally used" : `for ${medium.toLowerCase().replace("_", " ")}`} — off-range pH can lock nutrients out.`
            : `pH last ran outside the ${lo}–${hi} range ${wide ? "generally used" : `for ${medium.toLowerCase().replace("_", " ")}`} (${exc.count} reading${exc.count === 1 ? "" : "s"} out) — verify it's still off before correcting.`,
          measurement: hint("runoffPh"),
        },
      ]
      if (!exc.latestOutside && phCurrent && exc.count >= 2) {
        ev.push({
          direction: "against",
          strength: "weak",
          candidate: "ph_lockout",
          signal: "ph",
          text: `Latest pH (${ctx.series.ph.latest}) is back inside the ${lo}–${hi} band — the drift may already be correcting.`,
        })
      }
      // Medium-conditioning edge cases — honest about what input pH
      // means in buffered vs water-culture media.
      if (medium === "LIVING_SOIL") {
        ev.push({
          direction: "info",
          strength: "weak",
          candidate: "ph_lockout",
          signal: "ph",
          text: "Living soil buffers pH in the root zone — input pH matters less than the soil itself; verify with a slurry or runoff before correcting.",
          measurement: hint("runoffPh"),
        })
      }
      if ((medium === "HYDRO" || medium === "DWC") && ctx.series.ph.n < 3) {
        ev.push({
          direction: "info",
          strength: "weak",
          candidate: "ph_lockout",
          signal: "ph",
          text: "Reservoir pH moves fast in water culture — one off-band reading needs a repeat, not a correction.",
        })
      }
      // Combination: out-of-band pH alongside rising EC is a salt-
      // accumulation signature, not just a pH problem. This item DOES
      // read the EC series — it keeps the rule's chem:ph-ec signal.
      if (ctx.series.ec.trend === "rising") {
        ev.push({
          direction: "for",
          strength: "weak",
          candidate: "salt_buildup",
          text: "pH drifting out of band while EC climbs — a salt-accumulation pattern.",
          measurement: hint("runoffEc"),
        })
      }
      return ev
    },
    sourceIds: ["canna-coco-ph", "cornell-cannabis-guidebook", "terptalk-stage-tips", "purdue-hydro-nutrition"],
  },
  {
    id: "chem.ec-drift",
    signal: "ec",
    domain: "chemistry",
    kind: "risk",
    title: "EC trending",
    applies: (ctx) => ctx.series.ec.trend === "rising" || ctx.series.ec.trend === "falling",
    evaluate: (ctx) => {
      if (ctx.series.ec.trend === "falling") {
        return [
          {
            direction: "against",
            strength: "weak",
            candidate: "salt_buildup",
            text: "EC is falling across recent readings — accumulation is unlikely; confirm the drop is an intentional taper, not dilution drift.",
          },
        ]
      }
      return [
        {
          direction: "for",
          strength: "weak",
          candidate: "salt_buildup",
          text: `EC is trending upward across recent readings (latest ${ctx.series.ec.latest}) — climbing EC can mean salt accumulation or under-watering.`,
          measurement: hint("runoffEc"),
        },
      ]
    },
    sourceIds: ["canna-coco-ph"],
  },
  {
    id: "chem.ec-elevated",
    signal: "ec",
    domain: "chemistry",
    kind: "risk",
    title: "EC running high",
    applies: (ctx) => ctx.series.ec.n >= 3,
    evaluate: (ctx) => {
      const medium = ctx.diary.mediumType ?? "OTHER"
      const exc = countExcursions(ctx.series.ec.points, -Infinity, EC_ELEVATED)
      if (exc.fraction < 0.6 || exc.count < 3) return []
      const ev: IntelEvidence[] = [
        {
          direction: "for",
          strength: "moderate",
          candidate: "salt_buildup",
          text: `EC above ${EC_ELEVATED} mS/cm in ${exc.count} of the last ${exc.n} readings — sustained high feed strength accumulates salts.`,
          measurement: hint("runoffEc"),
        },
      ]
      // Honest counter-evidence: closed-system hydro cannabis tolerated
      // EC to ~4 mS/cm with no yield loss (single study — capped weak).
      if ((medium === "HYDRO" || medium === "DWC") && (ctx.series.ec.max ?? 0) <= EC_VERY_HIGH) {
        ev.push({
          direction: "against",
          strength: "weak",
          candidate: "salt_buildup",
          text: "Closed-system hydro cannabis tolerated EC up to ~4 mS/cm without yield loss in one study — high input EC alone doesn't prove accumulation; runoff EC settles it.",
          measurement: hint("runoffEc"),
        })
      }
      if (medium === "LIVING_SOIL") {
        ev.push({
          direction: "info",
          strength: "weak",
          candidate: "salt_buildup",
          text: "In amended soil, input EC isn't the accumulation signal — runoff EC is.",
          measurement: hint("runoffEc"),
        })
      }
      return ev
    },
    sourceIds: ["canna-coco-ph", "hershkowitz-2025-ec", "cornell-cannabis-guidebook"],
  },
  {
    id: "growth.stalled",
    signal: "height",
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
          candidate: "stunt",
          text: `Height is roughly flat over ${Math.round(days)} days of veg (~${f1(rate)} cm/day) — training can mask this, but light or root issues can too.`,
          measurement: hint("ppfd"),
        },
      ]
    },
    sourceIds: ["chandra-2008-photosynthesis", "rodriguez-morrison-2021-light"],
  },

  // ── Environment: stage-band + interaction rules ───────────────────
  {
    id: "env.rh-low",
    signal: "humidity",
    domain: "environment",
    kind: "assessment",
    title: "Sustained low humidity",
    applies: (ctx) =>
      ctx.diary.stage in RH_BANDS && ctx.diary.stage !== "DRYING" && ctx.series.humidity.n >= 3,
    evaluate: (ctx) => {
      const [lo] = RH_BANDS[ctx.diary.stage]
      const exc = countExcursions(ctx.series.humidity.points, lo, Infinity)
      const ev: IntelEvidence[] = []
      if (exc.count >= 3 && exc.fraction >= 0.6) {
        const seedling = ctx.diary.stage === "SEEDLING" || ctx.diary.stage === "GERMINATION"
        ev.push({
          direction: "for",
          strength: seedling || ctx.diary.stage === "VEGETATIVE" ? "moderate" : "weak",
          candidate: "humidity_low",
          text: `RH below ${lo}% in ${exc.count} of the last ${exc.n} readings — ${seedling ? "small root zones dry fast and VPD demand is high" : "transpiration stress and crispy edges follow"}.`,
          measurement: hint("leafTemp"),
        })
        if (!exc.latestOutside) {
          ev.push({
            direction: "against",
            strength: "weak",
            candidate: "humidity_low",
            text: `Latest RH (${ctx.series.humidity.latest}%) is back above ${lo}% — may already be correcting.`,
          })
        }
        if (ctx.series.humidity.trend === "rising") {
          ev.push({
            direction: "against",
            strength: "weak",
            candidate: "humidity_low",
            text: "Humidity is trending upward — the dry spell may be passing.",
          })
        }
      } else if (exc.latestOutside) {
        ev.push({
          direction: "for",
          strength: "weak",
          candidate: "humidity_low",
          text: `Latest RH (${ctx.series.humidity.latest}%) is under the ${lo}% ${ctx.diary.stage.toLowerCase()} floor — one reading may be a dry afternoon; watch the next.`,
        })
      }
      return ev
    },
    sourceIds: ["cs-vpd-ranges", "terptalk-stage-tips", "fao56-svp"],
  },
  {
    id: "env.rh-band-high",
    signal: "humidity",
    domain: "environment",
    kind: "risk",
    title: "Humidity above stage ceiling",
    applies: (ctx) => ctx.diary.stage in RH_BANDS && ctx.series.humidity.n >= 3,
    evaluate: (ctx) => {
      const [, hi] = RH_BANDS[ctx.diary.stage]
      const elevated = ctx.series.humidity.points.filter((p) => p.v > hi && p.v < RH_DISEASE)
      if (elevated.length < 3 || elevated.length / ctx.series.humidity.n < 0.5) return []
      const ev: IntelEvidence[] = []
      if (ctx.diary.stage === "DRYING" || ctx.diary.stage === "CURING") {
        ev.push({
          direction: "risk",
          strength: "weak",
          candidate: "env.dry-quality-risk",
          text: `RH above ${hi}% in the ${ctx.diary.stage.toLowerCase()} room in ${elevated.length} of ${ctx.series.humidity.n} readings — slow wet drying is the mold window.`,
        })
      } else {
        ev.push({
          direction: "for",
          strength: "weak",
          candidate: "humidity_high",
          text: `RH above the ${ctx.diary.stage.toLowerCase()} ceiling (${hi}%) though under ${RH_DISEASE}% — elevated for this stage in ${elevated.length} of ${ctx.series.humidity.n} readings.`,
        })
        if (ctx.diary.stage === "FLOWER") {
          ev.push({
            direction: "risk",
            strength: "weak",
            candidate: "env.moisture-disease-risk",
            text: `RH approaching the ≥${RH_DISEASE}% infection-favorable line during flower.`,
          })
        }
        if (ctx.diary.stage === "SEEDLING") {
          ev.push({
            direction: "risk",
            strength: "weak",
            candidate: "env.moisture-disease-risk",
            text: "B. cinerea also causes damping-off — high RH in a seedling dome needs ventilation.",
          })
        }
      }
      return ev
    },
    sourceIds: ["terptalk-stage-tips", "punja-2022-botrytis", "bc-cannabis-diseases"],
  },
  {
    id: "env.vpd-trend",
    signal: "env:temp-rh",
    domain: "environment",
    kind: "risk",
    title: "Calculated VPD trending",
    applies: (ctx) =>
      ctx.series.vpdComputed.trend === "rising" || ctx.series.vpdComputed.trend === "falling",
    evaluate: (ctx) => {
      const latest = ctx.series.vpdComputed.latest
      if (ctx.series.vpdComputed.trend === "rising") {
        return [
          {
            direction: "for",
            strength: "weak",
            candidate: "heat_stress",
            text: `Calculated VPD is climbing across recent readings (latest ≈${latest} kPa) — transpiration demand is rising.`,
            measurement: hint("leafTemp"),
          },
          {
            direction: "for",
            strength: "weak",
            candidate: "humidity_low",
            text: `Calculated VPD trending up — the canopy air is drying out.`,
          },
        ]
      }
      const ev: IntelEvidence[] = [
        {
          direction: "for",
          strength: "weak",
          candidate: "humidity_high",
          text: "Calculated VPD trending down — canopy air is drying more slowly.",
        },
      ]
      if (ctx.diary.stage === "FLOWER") {
        ev.push({
          direction: "risk",
          strength: "weak",
          candidate: "env.moisture-disease-risk",
          text: "Falling VPD during flower compounds moisture-related disease risk.",
        })
      }
      return ev
    },
    sourceIds: ["cs-vpd-ranges", "fao56-svp"],
  },
  {
    id: "env.disease-window",
    // humidity is the driver — temperature only qualifies which window.
    // Stamping env:temp-rh would let one RH series masquerade as a
    // second independent signal alongside the pure-RH rules.
    signal: "humidity",
    domain: "disease",
    kind: "risk",
    title: "Temperature–humidity disease window",
    applies: (ctx) =>
      ["SEEDLING", "VEGETATIVE", "FLOWER"].includes(ctx.diary.stage) &&
      ctx.series.humidity.n >= 3 &&
      ctx.series.temperature.n >= 3,
    evaluate: (ctx) => {
      const rhExc = countExcursions(ctx.series.humidity.points, -Infinity, RH_DISEASE)
      const rhHigh = rhExc.count >= 3 && rhExc.fraction >= 0.5
      const t = ctx.series.temperature.mean ?? ctx.series.temperature.latest!
      const inBotrytis = t >= BOTRYTIS_TEMP_F[0] && t <= BOTRYTIS_TEMP_F[1]
      const inPm = t >= PM_TEMP_F[0] && t <= PM_TEMP_F[1]
      const ev: IntelEvidence[] = []

      if (rhHigh && ctx.diary.stage === "FLOWER" && inBotrytis) {
        ev.push({
          direction: "risk",
          strength: "moderate",
          candidate: "env.moisture-disease-risk",
          text: `RH ≥${RH_DISEASE}% with temps ~${BOTRYTIS_TEMP_F[0]}–${BOTRYTIS_TEMP_F[1]}°F during flower sits inside the botrytis window — a risk assessment, not a disease diagnosis.`,
          measurement: hint("inspect:bud-interior"),
        })
        if (ctx.stageDays >= LATE_FLOWER_DAYS) {
          ev.push({
            direction: "risk",
            strength: "weak",
            candidate: "env.moisture-disease-risk",
            text: `Day ${ctx.stageDays} of flower — bud-rot infections set in weeks 2–5 and symptoms show around weeks 5–6; dense late colas are the vulnerable tissue.`,
          })
        }
      }
      if (rhHigh && inPm) {
        ev.push({
          direction: "risk",
          strength: ctx.diary.stage === "FLOWER" ? "moderate" : "weak",
          candidate: "env.moisture-disease-risk",
          text: `Warm + humid is the powdery-mildew window (~${PM_TEMP_F[0]}–${PM_TEMP_F[1]}°F, >${RH_DISEASE}% RH) — PM needs no leaf wetness, so dry foliage does not remove the risk.`,
        })
      }
      if (rhHigh && ctx.diary.stage === "SEEDLING") {
        ev.push({
          direction: "risk",
          strength: "weak",
          candidate: "env.moisture-disease-risk",
          text: `Sustained ≥${RH_DISEASE}% RH at seedling stage — damping-off pathogens favor this; vent the dome.`,
        })
      }
      // Honest opposition — RH high but temp outside both windows.
      if (rhHigh && !inBotrytis && !inPm && ctx.diary.stage !== "SEEDLING") {
        ev.push({
          direction: "against",
          strength: "weak",
          candidate: "env.moisture-disease-risk",
          text: `Humidity is high but ${f1(t)}°F sits outside the main infection windows — risk is reduced, not zero.`,
        })
      }
      // PM caveat — low RH does NOT clear PM (corrects folk wisdom).
      if (!rhHigh && inPm && ctx.diary.stage === "FLOWER") {
        ev.push({
          direction: "info",
          strength: "weak",
          candidate: "env.moisture-disease-risk",
          text: "Temps are in the PM-favored range; PM can develop even below 50% RH — keep scouting despite controlled humidity.",
        })
      }
      return ev
    },
    sourceIds: ["punja-2022-botrytis", "punja-ni-2025-budrot", "utia-pm-hemp", "bc-cannabis-diseases"],
  },
  {
    id: "env.co-variation",
    signal: "env:temp-rh",
    domain: "environment",
    kind: "risk",
    title: "Temperature–humidity co-variation",
    applies: (ctx) => ctx.series.temperature.n >= 3 && ctx.series.humidity.n >= 3,
    evaluate: (ctx) => {
      const tt = ctx.series.temperature.trend
      const ht = ctx.series.humidity.trend
      if (tt === "volatile" && ht === "volatile") {
        return [
          {
            direction: "risk",
            strength: "moderate",
            candidate: "env.instability",
            text: "Temperature AND humidity both swinging — co-varying swings suggest real instability, not one noisy sensor.",
            measurement: hint("photoperiod"),
          },
        ]
      }
      if (tt === "rising" && ht === "falling") {
        return [
          {
            direction: "info",
            strength: "weak",
            candidate: "env.instability",
            text: "Temp up while RH falls is normal inverse coupling — VPD (which combines both) is the number to watch.",
          },
        ]
      }
      if (tt === "rising" && ht === "rising") {
        return [
          {
            direction: "risk",
            strength: "weak",
            candidate: "env.instability",
            text: "Temp and RH climbing together is unusual — check exhaust capacity.",
          },
        ]
      }
      return []
    },
    sourceIds: ["ieee-greenhouse-survey", "fao56-svp"],
  },
  {
    id: "env.diurnal-swing",
    signal: "temperature",
    domain: "environment",
    kind: "risk",
    title: "Large temperature spread (possible day/night swing)",
    applies: (ctx) => ctx.series.temperature.n >= 4,
    evaluate: (ctx) => {
      const s = ctx.series.temperature
      const range = (s.max ?? 0) - (s.min ?? 0)
      if (range < TEMP_SWING_F) return []
      return [
        {
          direction: "risk",
          strength: s.trend === "volatile" ? "moderate" : "weak",
          candidate: "env.instability",
          text: `Temperature spread is ${f1(range)}°F across logged readings — if these mix lights-on and lights-off samples, the swing is large; log at consistent times to separate swing from drift.`,
          measurement: hint("leafTemp"),
        },
      ]
    },
    sourceIds: ["ieee-greenhouse-survey", "terptalk-stage-tips"],
  },
  {
    id: "env.dry-band",
    signal: "env:temp-rh",
    domain: "environment",
    kind: "risk",
    title: "Drying/curing room off-target",
    applies: (ctx) =>
      ["DRYING", "CURING", "HARVEST"].includes(ctx.diary.stage) &&
      (ctx.series.temperature.n >= 3 || ctx.series.humidity.n >= 3),
    evaluate: (ctx) => {
      const ev: IntelEvidence[] = []
      const t = ctx.series.temperature
      const h = ctx.series.humidity
      if (t.n >= 3 && (t.mean ?? t.latest ?? 60) > 68 || (h.n >= 3 && (h.mean ?? h.latest ?? 60) < 50)) {
        ev.push({
          direction: "risk",
          strength: "weak",
          candidate: "env.dry-quality-risk",
          text: "Dry room running hot or dry — fast drying degrades terpenes and burns harsh.",
        })
      }
      if ((t.n >= 3 && (t.mean ?? t.latest ?? 60) < 57) || (h.n >= 3 && (h.mean ?? h.latest ?? 60) > 65)) {
        ev.push({
          direction: "risk",
          strength: "moderate",
          candidate: "env.dry-quality-risk",
          text: "Cool and damp in the dry room — the slow wet dry is the mold window.",
        })
      }
      return ev
    },
    sourceIds: ["terptalk-stage-tips", "postharvest-review-2022"],
  },

  // ── Chemistry: drift, lockout confounder, nutrition bands ─────────
  {
    id: "chem.ph-drift",
    signal: "ph",
    domain: "chemistry",
    kind: "assessment",
    title: "pH trending / unstable",
    applies: (ctx) =>
      ["rising", "falling", "volatile"].includes(ctx.series.ph.trend),
    evaluate: (ctx) => {
      const medium = ctx.diary.mediumType ?? "OTHER"
      const [lo, hi] = PH_BANDS[medium] ?? PH_BAND_UNKNOWN
      const latest = ctx.series.ph.latest
      if (latest == null) return []
      const ev: IntelEvidence[] = []
      if (ctx.series.ph.trend === "volatile") {
        ev.push({
          direction: "for",
          strength: "weak",
          candidate: "ph_drift",
          text: "pH readings are erratic — inconsistent water source, probe drift, or salt interaction.",
          measurement: hint("runoffPh"),
        })
      } else {
        const inside = latest >= lo && latest <= hi
        const mid = (lo + hi) / 2
        const towardEdge =
          (ctx.series.ph.trend === "rising" && latest > mid) ||
          (ctx.series.ph.trend === "falling" && latest < mid)
        const nearEdge = latest < lo + PH_EDGE || latest > hi - PH_EDGE
        if (!inside) {
          ev.push({
            direction: "for",
            strength: "moderate",
            candidate: "ph_drift",
            text: `pH ${latest} is out of the ${lo}–${hi} band AND still moving ${ctx.series.ph.trend} — directional drift, not a blip.`,
            measurement: hint("runoffPh"),
          })
        } else if (towardEdge && nearEdge) {
          ev.push({
            direction: "for",
            strength: "weak",
            candidate: "ph_drift",
            text: `pH trending ${ctx.series.ph.trend} and nearing the edge of the ${lo}–${hi} band (latest ${latest}) — correcting drift now is cheaper than lockout later.`,
            measurement: hint("runoffPh"),
          })
        } else {
          ev.push({
            direction: "info",
            strength: "weak",
            candidate: "ph_drift",
            text: `pH drifting ${ctx.series.ph.trend} but comfortably in-band — watching.`,
          })
        }
      }
      if (medium === "HYDRO" || medium === "DWC") {
        ev.push({
          direction: "info",
          strength: "weak",
          candidate: "ph_drift",
          text: "Some reservoir drift between adjustments is normal in water culture — rate and direction are what matter.",
        })
      }
      return ev
    },
    sourceIds: ["canna-coco-ph", "cornell-cannabis-guidebook", "purdue-hydro-nutrition", "terptalk-stage-tips"],
  },
  {
    id: "chem.lockout-signature",
    signal: "chem:ph-ec",
    domain: "chemistry",
    kind: "assessment",
    title: "Fed but potentially locked out",
    applies: (ctx) => ctx.series.ph.n >= 1,
    evaluate: (ctx) => {
      const medium = ctx.diary.mediumType ?? "OTHER"
      const [lo, hi] = PH_BANDS[medium] ?? PH_BAND_UNKNOWN
      // A current-state signature — historical readings can't claim
      // "fed but locked out NOW". Same for the EC half of the pair.
      if (!latestIsCurrent(ctx.series.ph, ctx.now)) return []
      const phLatest = ctx.series.ph.latest
      if (phLatest == null) return []
      const phOut = phLatest < lo || phLatest > hi
      const ecLatest = latestIsCurrent(ctx.series.ec, ctx.now)
        ? ctx.series.ec.latest
        : null

      // deficiency candidates any reported symptom feeds — and which
      // symptom(s) fed them, so emitted evidence can carry the real
      // signal (a reported symptom, correlated across repeated reports)
      const fedDeficiencySymptoms = new Map<string, Set<string>>()
      for (const o of ctx.observations) {
        const stage = o.stage ?? ctx.diary.stage
        // Intersect stage×location refinements — a FLOWER interveinal
        // report keeps iron (both tables agree) instead of widening
        // back to the stage's generic set.
        const feeds = feedsForSymptom(o.symptom, o.location, stage).feeds
        for (const f of feeds) {
          if (!DEFICIENCY_CANDIDATES.has(f)) continue
          const s = fedDeficiencySymptoms.get(f) ?? new Set<string>()
          s.add(o.symptom)
          fedDeficiencySymptoms.set(f, s)
        }
      }
      const fedDeficiencies = new Set(fedDeficiencySymptoms.keys())
      const fedSignal = (d: string) =>
        `symptom:${[...fedDeficiencySymptoms.get(d)!].sort().join("+")}`

      const ev: IntelEvidence[] = []
      if (phOut && ecLatest == null) {
        ev.push({
          direction: "info",
          strength: "weak",
          candidate: "ph_lockout",
          text: "pH is off-band and no current EC is available — can't tell whether feed is reaching the plant.",
          measurement: hint("ec"),
        })
      } else if (phOut && ecLatest != null && ecLatest >= EC_FEED_MIN && ecLatest <= EC_ELEVATED) {
        ev.push({
          direction: "for",
          strength: "moderate",
          candidate: "ph_lockout",
          text: `Feed strength looks adequate (EC ${ecLatest}) but pH ${phLatest} is outside ${lo}–${hi} — nutrients can be present yet unavailable; verify runoff pH before adding feed.`,
          measurement: hint("runoffPh"),
        })
        // the confounder: reported symptoms point at availability, not supply
        for (const d of fedDeficiencies) {
          ev.push({
            direction: "against",
            strength: "weak",
            candidate: d,
            signal: fedSignal(d),
            text: `pH ${phLatest} is out of band — deficiency-looking symptoms are more likely lockout than missing nutrients; fix pH first.`,
            measurement: hint("runoffPh"),
          })
        }
      } else if (phOut && ecLatest != null && ecLatest > EC_ELEVATED) {
        ev.push({
          direction: "for",
          strength: "weak",
          candidate: "salt_buildup",
          text: "High EC plus off-band pH — salt accumulation and lockout feed each other.",
          measurement: hint("runoffEc"),
        })
      } else if (phOut && ecLatest != null && ecLatest < EC_FEED_MIN) {
        // Lockout shadow: low feed EC + off-band pH. Raising feed here
        // is the classic wrong move — uptake is gated by pH, so added
        // nutrients just accumulate as salts.
        ev.push({
          direction: "for",
          strength: "weak",
          candidate: "ph_lockout",
          text: `EC ${ecLatest} is low AND pH ${phLatest} is outside ${lo}–${hi} — correct pH before raising feed; locked-out nutrients don't reach the plant at any feed strength.`,
          measurement: hint("runoffPh"),
        })
        ev.push({
          direction: "against",
          strength: "weak",
          candidate: "nutrition.undersupply",
          text: "Low EC under off-band pH looks like underfeeding but the pH problem gates uptake first — don't raise feed until pH is in band.",
          measurement: hint("runoffPh"),
        })
        for (const d of fedDeficiencies) {
          ev.push({
            direction: "against",
            strength: "weak",
            candidate: d,
            signal: fedSignal(d),
            text: `pH ${phLatest} is out of band — deficiency-looking symptoms are more likely lockout than missing nutrients; fix pH first.`,
            measurement: hint("runoffPh"),
          })
        }
      } else if (!phOut && fedDeficiencies.size) {
        // in-band pH removes the usual confounder — info only, NOT
        // support: an absence-of-lockout doesn't raise every deficiency.
        for (const d of fedDeficiencies) {
          ev.push({
            direction: "info",
            strength: "weak",
            candidate: d,
            signal: fedSignal(d),
            text: `pH ${phLatest} is inside the ${lo}–${hi} band — uptake isn't obviously locked out.`,
            measurement: hint("runoffPh"),
          })
        }
      }
      return ev
    },
    sourceIds: ["canna-coco-ph", "whipker-ph-micro", "purdue-hydro-nutrition", "cornell-cannabis-guidebook"],
  },
  {
    id: "chem.ph-low-danger",
    signal: "ph",
    domain: "chemistry",
    kind: "assessment",
    title: "pH dangerously low",
    applies: (ctx) =>
      ctx.series.ph.n >= 2 &&
      latestIsCurrent(ctx.series.ph, ctx.now) &&
      ctx.series.ph.latest != null &&
      ctx.series.ph.latest < PH_DANGER_LOW,
    evaluate: (ctx) => [
      {
        direction: "for",
        strength: "moderate",
        candidate: "ph_lockout",
        text: `pH ${ctx.series.ph.latest} is below ${PH_DANGER_LOW} — risk climbs sharply in this range (cannabis hydro showed measured growth inhibition around pH ≤4.0) and micronutrient solubility rises as pH falls. Low pH is the dangerous direction, not high.`,
        measurement: hint("runoffPh"),
      },
      {
        direction: "against",
        strength: "weak",
        candidate: "nutrition.undersupply",
        text: `Very low pH increases nutrient solubility — apparent deficiency below ~pH ${PH_DANGER_LOW} is availability/toxicity, not supply.`,
        measurement: hint("runoffPh"),
      },
    ],
    sourceIds: ["whipker-ph-micro", "canna-coco-ph"],
  },
  {
    id: "chem.ec-stage-band",
    signal: "ec",
    domain: "nutrition",
    kind: "assessment",
    title: "EC vs stage needs",
    applies: (ctx) =>
      ctx.series.ec.n >= 3 &&
      GROWTH_STAGES.has(ctx.diary.stage) &&
      ctx.diary.mediumType !== "LIVING_SOIL" &&
      ctx.stageDays >= 5,
    evaluate: (ctx) => {
      const floor = EC_FLOOR[ctx.diary.stage] ?? 0.8
      const lo = countExcursions(ctx.series.ec.points, floor, Infinity)
      const hi = countExcursions(ctx.series.ec.points, -Infinity, EC_ELEVATED)
      const vhi = countExcursions(ctx.series.ec.points, -Infinity, EC_VERY_HIGH)
      const ev: IntelEvidence[] = []
      if (lo.count >= 3 && lo.fraction >= 0.6 && ctx.diary.stage !== "GERMINATION" && ctx.diary.stage !== "SEEDLING") {
        ev.push({
          direction: "for",
          strength: ctx.diary.mediumType === "SOIL" ? "weak" : "moderate",
          candidate: "nutrition.undersupply",
          text: `Logged EC ran under ${floor} mS/cm in ${lo.count}/${lo.n} readings during ${ctx.diary.stage.toLowerCase()} — below published cannabis feed requirements. If these are feed readings, supply is likely low.`,
          measurement: hint("runoffEc"),
        })
        if (!lo.latestOutside) {
          ev.push({
            direction: "against",
            strength: "weak",
            candidate: "nutrition.undersupply",
            text: `Latest EC (${ctx.series.ec.latest}) is back above ${floor} — the shortfall may already be correcting.`,
          })
        }
      }
      if (vhi.count >= 3 && vhi.fraction >= 0.6) {
        ev.push({
          direction: "for",
          strength: "moderate",
          candidate: "nutrition.excess",
          text: `Logged EC above ${EC_VERY_HIGH} mS/cm in ${vhi.count}/${vhi.n} readings — beyond the level cannabis tolerated without yield loss in a 2025 hydroponic study; burn risk is real at this level.`,
          measurement: hint("runoffEc"),
        })
      } else if (hi.count >= 3 && hi.fraction >= 0.6) {
        ev.push({
          direction: "risk",
          strength: "weak",
          candidate: "nutrition.excess",
          text: `EC above ${EC_ELEVATED} mS/cm in ${hi.count}/${hi.n} readings — cannabis tolerated up to ~4.0 in one study, so this is a watch signal (waste + antagonism risk), not a burn verdict.`,
          measurement: hint("runoffEc"),
        })
      }
      return ev
    },
    sourceIds: ["bevan-2021-npk-dwc", "saloner-bernstein-2020-n", "hershkowitz-2025-ec", "canna-coco-ph"],
  },
  {
    id: "chem.ec-falling",
    signal: "ec",
    domain: "nutrition",
    kind: "risk",
    title: "EC trending downward",
    applies: (ctx) => ctx.series.ec.trend === "falling",
    evaluate: (ctx) => {
      // Late-flower taper is normal finish practice — oppose, don't support.
      if (ctx.diary.stage === "FLOWER" && ctx.stageDays >= LATE_FLOWER_TAPER_DAYS) {
        return [
          {
            direction: "against",
            strength: "weak",
            candidate: "nutrition.undersupply",
            text: `EC is falling at day ${ctx.stageDays} of flower — a late-flower taper/senescence pattern, not necessarily underfeeding.`,
          },
        ]
      }
      return [
        {
          direction: "for",
          strength: "weak",
          candidate: "nutrition.undersupply",
          text: `EC is trending downward across recent readings (latest ${ctx.series.ec.latest}) — feed strength is dropping.`,
          measurement: hint("runoffEc"),
        },
      ]
    },
    sourceIds: ["bevan-2021-npk-dwc", "saloner-bernstein-2020-n"],
  },
  {
    id: "chem.seedling-ec",
    signal: "ec",
    domain: "nutrition",
    kind: "assessment",
    title: "Feed strength at seedling stage",
    applies: (ctx) =>
      ["SEEDLING", "GERMINATION"].includes(ctx.diary.stage) &&
      ctx.series.ec.n >= 1 &&
      latestIsCurrent(ctx.series.ec, ctx.now),
    evaluate: (ctx) => {
      const latest = ctx.series.ec.latest!
      if (latest <= EC_SEEDLING_CEILING) return []
      return [
        {
          direction: "for",
          strength: ctx.series.ec.n >= 2 ? "moderate" : "weak",
          candidate: "nutrition.excess",
          text: `EC ${latest} mS/cm during ${ctx.diary.stage.toLowerCase()} — seedlings need little to no supplemental feed; early burn is usually medium-preload or too-strong feed.`,
          measurement: hint("runoffEc"),
        },
      ]
    },
    sourceIds: ["canna-coco-ph", "terptalk-stage-tips"],
  },
  {
    id: "chem.high-ec-antagonism",
    signal: "chem:ph-ec",
    domain: "nutrition",
    kind: "risk",
    title: "High-EC antagonism risk",
    applies: (ctx) => ctx.series.ec.n >= 3 && ctx.series.ph.n >= 1,
    evaluate: (ctx) => {
      const medium = ctx.diary.mediumType ?? "OTHER"
      const [lo, hi] = PH_BANDS[medium] ?? PH_BAND_UNKNOWN
      const phLatest = ctx.series.ph.latest
      const phInBand = phLatest != null && phLatest >= lo && phLatest <= hi
      const ecHigh = countExcursions(ctx.series.ec.points, -Infinity, EC_ELEVATED)
      if (!phInBand || ecHigh.fraction < 0.6 || ecHigh.count < 3) return []
      return [
        {
          direction: "risk",
          strength: "weak",
          candidate: "nutrition.excess",
          text: "EC high while pH is in band — sustained high-strength feeds can induce antagonistic deficiencies (e.g., excess Mg suppresses Ca/K uptake in cannabis). Correct concentration before adding single-nutrient supplements.",
          measurement: hint("runoffEc"),
        },
      ]
    },
    sourceIds: ["morad-bernstein-2023-mg", "hershkowitz-2025-ec"],
  },

  // ── Reported symptoms (diary update text → observations) ──────────
  {
    id: "symptom.reported",
    domain: "data",
    kind: "assessment",
    title: "Reported symptoms",
    applies: (ctx) => ctx.observations.length > 0,
    evaluate: (ctx) => {
      const ev: IntelEvidence[] = []
      // persistence: the same symptom across distinct updates carries
      // more weight than a one-off mention
      const reportCount = new Map<SymptomId, Set<string>>()
      for (const o of ctx.observations) {
        const set = reportCount.get(o.symptom) ?? new Set<string>()
        set.add(o.refId ?? String(o.t))
        reportCount.set(o.symptom, set)
      }

      for (const o of ctx.observations) {
        // night droop is normal nyctinasty — info, never evidence
        if (o.symptom === "DROOPING" && (o.period === "NIGHT" || o.period === "LIGHTS_OFF")) {
          ev.push({
            direction: "info",
            strength: "weak",
            text: "Drooping right after lights-off is normal (nyctinasty) — not a watering signal.",
          })
          continue
        }

        const effStage = o.stage ?? ctx.diary.stage
        // Intersect stage×location refinements — replacing feeds with
        // the stage table alone would silently widen e.g. FLOWER
        // interveinal yellowing back to the generic nutrient set.
        const res = feedsForSymptom(o.symptom, o.location, effStage)
        const feeds = res.feeds
        const refined = res.refined || !!o.refined

        const label = SYMPTOM_LABELS[o.symptom] ?? o.symptom.toLowerCase()
        const locLabel = o.location ? ` on ${LOCATION_LABELS[o.location]}` : ""
        const persistent = (reportCount.get(o.symptom)?.size ?? 0) >= 2
        // A direct sighting ("webbing under leaves", "gnats") is strong
        // evidence; location/stage-refined or repeated reports are
        // moderate; everything else stays weak.
        const strength =
          DIRECT_SIGNAL.has(o.symptom)
            ? "strong"
            : STATE_REPORT.has(o.symptom) || refined || persistent
              ? "moderate"
              : "weak"

        for (const cid of feeds) {
          const def = CANDIDATES[cid]
          if (!def) continue
          const nextStep = def.discriminatingInputs.find((s) => !nextStepSatisfied(ctx, s))
          ev.push({
            direction: "for",
            strength,
            candidate: cid,
            signal: `symptom:${o.symptom}`,
            text: `Reported ${label}${locLabel}${persistent ? " (more than once)" : ""} — consistent with ${def.name.toLowerCase()}.`,
            measurement: nextStep ? hint(nextStep) : undefined,
          })
        }
        for (const cid of CONTRA[o.symptom] ?? []) {
          ev.push({
            direction: "against",
            strength: "weak",
            candidate: cid,
            signal: `symptom:${o.symptom}`,
            text: `Reported ${label}${locLabel} argues against ${CANDIDATES[cid]?.name.toLowerCase() ?? cid}.`,
          })
        }
      }
      return ev
    },
    sourceIds: ["cockson-2019-nutrient-disorders"],
  },
  {
    id: "symptom.senescence",
    domain: "stage",
    kind: "assessment",
    title: "Late-flower fade vs deficiency",
    applies: (ctx) =>
      ctx.diary.stage === "FLOWER" &&
      ctx.stageDays >= LATE_FLOWER_DAYS &&
      ctx.observations.some(
        (o) =>
          o.symptom === "LEAF_YELLOWING" &&
          (o.location === "LOWER_OLD" || o.location === "SUGAR_LEAVES" || !o.location)
      ),
    evaluate: (ctx) => {
      const ev: IntelEvidence[] = [
        {
          direction: "for",
          strength: "moderate",
          candidate: "bud_nutrient",
          signal: "symptom:LEAF_YELLOWING",
          text: `Lower-leaf yellowing at day ${ctx.stageDays} of flower is the normal finish pattern — the plant is moving stored nutrients into the buds.`,
          measurement: hint("ph"),
        },
      ]
      // the same report is honest opposition against deficiency reads
      const fed = new Set<string>()
      for (const o of ctx.observations) {
        if (o.symptom !== "LEAF_YELLOWING") continue
        const feeds = feedsForSymptom(o.symptom, o.location, o.stage ?? ctx.diary.stage).feeds
        for (const f of feeds) if (DEFICIENCY_CANDIDATES.has(f)) fed.add(f)
      }
      for (const d of fed) {
        ev.push({
          direction: "against",
          strength: "moderate",
          candidate: d,
          signal: "symptom:LEAF_YELLOWING",
          text: "Late-flower yellowing is usually senescence, not deficiency — check whether new growth is also affected before feeding more.",
          measurement: hint("inspect:leaf-pattern"),
        })
      }
      return ev
    },
    sourceIds: ["cockson-2019-nutrient-disorders", "terptalk-stage-tips"],
  },

  {
    id: "data.sparse-env",
    signal: "data",
    domain: "data",
    kind: "gap",
    title: "Sparse environmental logging",
    applies: (ctx) => ctx.updateCount >= 1 && ctx.envCoverage < 0.5,
    evaluate: (ctx) => {
      const want = ctx.missing.includes("ph") ? "ph" : "temperature"
      return [
        {
          direction: "info",
          strength: "weak",
          text: `Only ${Math.round(ctx.envCoverage * 100)}% of recent updates recorded environment data — interpretation is limited without it.`,
          measurement: hint(want),
        },
      ]
    },
    sourceIds: [],
  },
  {
    id: "data.no-env",
    signal: "data",
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
        measurement: hint("temperature"),
      },
    ],
    sourceIds: [],
  },

  // Single fresh reading — every trend rule needs n≥3 and a known stage,
  // so one reported temp/RH pair previously contributed nothing. This
  // rule scores the LATEST values only, never stronger than moderate:
  // one reading is one reading. Per-branch gating: once a series is
  // thick enough for the trend rules (n≥3) the matching branch goes
  // silent so snapshot and trend rules can't stack on the same data.
  {
    id: "env.snapshot",
    signal: "env:temp-rh",
    domain: "environment",
    kind: "assessment",
    title: "Latest environment reading",
    applies: (ctx) =>
      (ctx.series.temperature.n > 0 && ctx.series.temperature.n < 3) ||
      (ctx.series.vpdComputed.n > 0 && ctx.series.vpdComputed.n < 3) ||
      (ctx.series.humidity.n > 0 && ctx.series.humidity.n < 3),
    evaluate: (ctx) => {
      const stage = ctx.diary.stage
      const stageKnown = stage in VPD_BANDS
      const [vLo, vHi] = VPD_BANDS[stage] ?? [0.4, 1.5]
      const [tLo, tHi] = TEMP_BANDS[stage] ?? TEMP_BAND_DEFAULT
      const [rLo, rHi] = RH_BANDS[stage] ?? [40, 70]
      const suffix = stageKnown ? "" : " (stage unknown — using the general range)"
      const snapshot = "a single snapshot, so treat as a lead, not a trend"
      // Only readings describing NOW count — a historical report
      // ("temp hit 95 last week") can't be a current snapshot.
      const cur = (s: IntelSeries) =>
        latestIsCurrent(s, ctx.now) ? s.latest : null
      const t = cur(ctx.series.temperature)
      const v = cur(ctx.series.vpdComputed)
      const rh = cur(ctx.series.humidity)
      const tempThin = ctx.series.temperature.n < 3
      const vpdThin = ctx.series.vpdComputed.n < 3
      const rhThin = ctx.series.humidity.n < 3
      const ev: IntelEvidence[] = []
      if (tempThin && t != null && t > tHi) {
        ev.push({
          direction: "for",
          strength: stageKnown && t >= tHi + 4 ? "moderate" : "weak",
          candidate: "heat_stress",
          text: `Latest reading ${f1(t)}°F is above the ${tLo}–${tHi}°F ${stage.toLowerCase()} range${suffix} — ${snapshot}.`,
          measurement: ctx.series.humidity.n ? hint("leafTemp") : hint("humidity"),
        })
      } else if (tempThin && t != null && t < tLo) {
        ev.push({
          direction: "for",
          strength: stageKnown && t <= tLo - 4 ? "moderate" : "weak",
          candidate: "env.cold-stress",
          text: `Latest reading ${f1(t)}°F is below the ${tLo}–${tHi}°F ${stage.toLowerCase()} range${suffix} — ${snapshot}.`,
          measurement: hint("temperature"),
        })
      }
      if (vpdThin && v != null && v > vHi) {
        ev.push({
          direction: "for",
          strength: stageKnown && v >= vHi + 0.5 ? "moderate" : "weak",
          candidate: "heat_stress",
          text: `Latest VPD ≈${f1(v)} kPa is above the ${vLo}–${vHi} kPa ${stage.toLowerCase()} range${suffix} — ${snapshot}.`,
          measurement: rh == null ? hint("humidity") : hint("leafTemp"),
        })
        if (rhThin && rh != null && rh < rLo) {
          ev.push({
            direction: "for",
            strength: stageKnown && v >= vHi + 0.5 ? "moderate" : "weak",
            candidate: "humidity_low",
            text: `Latest RH ${rh}% is under the ${rLo}–${rHi}% ${stage.toLowerCase()} floor${suffix} — ${snapshot}.`,
            measurement: hint("humidity"),
          })
        }
      } else if ((vpdThin && v != null && v < vLo) || (rhThin && rh != null && rh > rHi)) {
        const large = (vpdThin && v != null && v <= vLo - 0.3) || (rhThin && rh != null && rh > rHi)
        const strength = stageKnown && large ? "moderate" : "weak"
        const cause =
          vpdThin && v != null && v < vLo
            ? `Latest VPD ≈${f1(v)} kPa is below the ${vLo}–${vHi} kPa ${stage.toLowerCase()} range${suffix}`
            : `Latest RH ${rh}% is above the ${rLo}–${rHi}% ${stage.toLowerCase()} range${suffix}`
        ev.push({
          direction: "risk",
          strength,
          candidate: "env.moisture-disease-risk",
          text: `${cause} — ${snapshot}.`,
          measurement: hint("humidity"),
        })
        ev.push({
          direction: "for",
          strength,
          candidate: "humidity_high",
          text: `${cause} — ${snapshot}.`,
          measurement: hint("humidity"),
        })
      }
      return ev
    },
    sourceIds: [
      "cs-vpd-ranges",
      "chandra-2008-photosynthesis",
      "terptalk-stage-tips",
      "ieee-greenhouse-survey",
      "fao56-svp",
      "cornell-cannabis-guidebook",
    ],
  },

  // Runoff vs feed EC: leachate running hotter than the input means the
  // medium is accumulating salts. General substrate guidance (PourThru
  // convention) — cannabis-specific runoff thresholds aren't published,
  // so strength caps at moderate.
  {
    id: "chem.runoff-ec-gap",
    signal: "runoff",
    domain: "chemistry",
    kind: "assessment",
    title: "Runoff EC above feed EC",
    applies: (ctx) =>
      ctx.series.runoffEc.n >= 1 &&
      ctx.series.ec.n >= 1 &&
      Math.abs(
        ctx.series.runoffEc.points[ctx.series.runoffEc.points.length - 1].t -
          ctx.series.ec.points[ctx.series.ec.points.length - 1].t
      ) <= 3 * 86400000,
    evaluate: (ctx) => {
      const r = ctx.series.runoffEc.latest!
      const f = ctx.series.ec.latest!
      const gap = f1(r - f)
      const caveat = " (general substrate guidance — cannabis-specific runoff thresholds aren't published)"
      if (gap >= 1.0) {
        return [
          {
            direction: "for",
            strength: "moderate",
            candidate: "salt_buildup",
            text: `Runoff EC ${r} is ${gap} mS/cm above feed EC ${f} — salts accumulating in the medium.${caveat}`,
            measurement: hint("runoffPh"),
          },
        ]
      }
      if (gap >= 0.5) {
        return [
          {
            direction: "for",
            strength: "weak",
            candidate: "salt_buildup",
            text: `Runoff EC ${r} is ${gap} mS/cm above feed EC ${f} — early salt accumulation, watch the trend.${caveat}`,
            measurement: hint("runoffPh"),
          },
        ]
      }
      if (gap <= -0.5) {
        return [
          {
            direction: "info",
            strength: "weak",
            text: `Runoff EC ${r} is ${f1(f - r)} mS/cm below feed EC ${f} — the medium is being drawn down/leached rather than accumulating salts.${caveat}`,
          },
        ]
      }
      return []
    },
    sourceIds: ["ncsu-pourthru-2009"],
  },
  {
    id: "chem.runoff-ph-shift",
    signal: "runoff",
    domain: "chemistry",
    kind: "assessment",
    title: "Runoff pH shifted from feed pH",
    applies: (ctx) =>
      ctx.series.runoffPh.n >= 1 &&
      ctx.series.ph.n >= 1 &&
      Math.abs(
        ctx.series.runoffPh.points[ctx.series.runoffPh.points.length - 1].t -
          ctx.series.ph.points[ctx.series.ph.points.length - 1].t
      ) <= 3 * 86400000,
    evaluate: (ctx) => {
      const r = ctx.series.runoffPh.latest!
      const f = ctx.series.ph.latest!
      const shift = f1(r - f)
      if (Math.abs(shift) < 0.5) return []
      const caveat = " (general substrate guidance — cannabis-specific runoff thresholds aren't published)"
      return [
        {
          direction: "for",
          strength: Math.abs(shift) >= 0.8 ? "moderate" : "weak",
          candidate: "ph_drift",
          text: `Runoff pH ${r} is ${Math.abs(shift)} ${shift > 0 ? "above" : "below"} feed pH ${f} — the root zone is drifting ${shift > 0 ? "up" : "down"} from what's going in.${caveat}`,
          measurement: hint("ph"),
        },
      ]
    },
    sourceIds: ["ncsu-pourthru-2009"],
  },

  {
    id: "nutrition.ec-burn-signature",
    // the compound signature pairs a reported symptom with a measured
    // feed/runoff value — the measurement side is the independent signal
    signal: "ec",
    domain: "nutrition",
    kind: "assessment",
    title: "Tip burn + elevated feed",
    applies: (ctx) =>
      ctx.observations.some((o) => o.symptom === "TIP_BURN") &&
      (ctx.series.ec.n >= 1 || ctx.series.runoffEc.n >= 1),
    evaluate: (ctx) => {
      const ev: IntelEvidence[] = []
      // Only pair a current reading with a recent report — burnt tips
      // from weeks ago plus today's EC are not the same event.
      const tipRecent = ctx.observations.some(
        (o) => o.symptom === "TIP_BURN" && ctx.now - o.t <= 7 * 86400000
      )
      if (!tipRecent) return []
      const ecLatest = latestIsCurrent(ctx.series.ec, ctx.now)
        ? ctx.series.ec.latest
        : null
      if (ecLatest != null && ecLatest >= EC_ELEVATED) {
        ev.push({
          direction: "for",
          strength: "moderate",
          candidate: "nutrient_burn",
          text: `Burnt tips reported while feed EC is ${ecLatest} — the pair is the classic over-feed signature. Cannabis tolerated EC 4.0 in one hydro study, so this is a signature, not proof.`,
          measurement: hint("runoffEc"),
        })
      }
      const r = ctx.series.runoffEc.latest
      const f = ctx.series.ec.latest
      // the pair must be near in time AND near the present — a
      // three-week-old EC pair + fresh tip-burn isn't one event
      const paired =
        ctx.series.runoffEc.n >= 1 &&
        ctx.series.ec.n >= 1 &&
        Math.abs(
          ctx.series.runoffEc.points[ctx.series.runoffEc.points.length - 1].t -
            ctx.series.ec.points[ctx.series.ec.points.length - 1].t
        ) <= 3 * 86400000 &&
        ctx.now -
          Math.max(
            ctx.series.runoffEc.points[ctx.series.runoffEc.points.length - 1].t,
            ctx.series.ec.points[ctx.series.ec.points.length - 1].t
          ) <=
          7 * 86400000
      if (paired && r != null && f != null && r - f >= 0.5) {
        ev.push({
          direction: "for",
          strength: "moderate",
          candidate: "salt_buildup",
          signal: "runoff",
          text: `Burnt tips while runoff EC ${r} sits ${f1(r - f)} above feed EC ${f} — salts concentrating in the medium fits the tip burn.`,
          measurement: hint("runoffPh"),
        })
      }
      return ev
    },
    sourceIds: ["hershkowitz-2025-ec", "ncsu-pourthru-2009", "cockson-2019-nutrient-disorders"],
  },
  {
    id: "env.dew-point",
    // humidity is the driver — temperature only sets the dew point.
    // Stamping env:temp-rh would let the same RH series stack as a
    // second independent signal beside the pure-RH disease rules.
    signal: "humidity",
    domain: "disease",
    kind: "risk",
    title: "Calculated dew-point proximity",
    applies: (ctx) =>
      ["SEEDLING", "VEGETATIVE", "FLOWER"].includes(ctx.diary.stage) &&
      ctx.series.temperature.n >= 1 &&
      ctx.series.humidity.n >= 1,
    evaluate: (ctx) => {
      // Pair each RH point with the nearest temp reading ≤6h away.
      // Approximate ("a while back") points never pair — they don't
      // describe the same air.
      let last: { t: number; tempF: number; rh: number } | null = null
      for (const h of ctx.series.humidity.points) {
        if (h.tApproximate) continue
        let best: MetricPoint | null = null
        for (const tp of ctx.series.temperature.points) {
          if (tp.tApproximate) continue
          const d = Math.abs(tp.t - h.t)
          if (d <= 6 * 3600000 && (!best || d < Math.abs(best.t - h.t))) best = tp
        }
        if (best) last = { t: Math.max(h.t, best.t), tempF: best.v, rh: h.v }
      }
      // A historical pairing isn't a current condensation risk.
      if (!last || ctx.now - last.t > 2 * 86400000) return []
      const dp = dewPointFromTempRh(last.tempF, last.rh)
      if (!dp.valid || dp.value == null) return []
      const depression = last.tempF - dp.value // °F air-above-dew-point
      if (depression > 7) return [] // ~4°C of headroom — air comfortably unsaturated
      const ev: IntelEvidence[] = [
        {
          direction: "risk",
          strength: depression <= 3.6 ? "moderate" : "weak",
          candidate: "env.moisture-disease-risk",
          text:
            depression <= 3.6
              ? `Calculated dew point ${dp.value}°F from ${f1(last.tempF)}°F / ${last.rh}% RH — within ~2°C of air temperature, so cool surfaces and dense canopy interiors can reach leaf wetness. A risk flag, not a disease diagnosis.`
              : `Calculated dew point ${dp.value}°F from ${f1(last.tempF)}°F / ${last.rh}% RH — air is within ~4°C of saturation; night drops could push surfaces to condensation.`,
        },
      ]
      if (ctx.diary.stage === "FLOWER" && depression <= 3.6) {
        ev.push({
          direction: "risk",
          strength: "weak",
          candidate: "env.moisture-disease-risk",
          text: "In flower, condensation inside dense colas is the classic bud-rot setup — keep airflow through the canopy.",
          measurement: hint("inspect:bud-interior"),
        })
      }
      return ev
    },
    sourceIds: ["fao56-svp", "punja-2022-botrytis", "bc-cannabis-diseases"],
  },
  {
    id: "pest.stipple-pattern",
    domain: "pest",
    kind: "assessment",
    title: "Stipple pattern",
    applies: (ctx) => ctx.observations.some((o) => o.symptom === "STIPPLING" && !o.tApproximate),
    evaluate: (ctx) => {
      // pest signs persist — a 7d pairing window is honest co-occurrence
      const near = (sym: SymptomId) =>
        ctx.observations.some(
          (o) =>
            o.symptom === "STIPPLING" &&
            !o.tApproximate &&
            ctx.observations.some(
              (m) => m.symptom === sym && !m.tApproximate && Math.abs(m.t - o.t) <= 7 * 86400000
            )
        )
      const ev: IntelEvidence[] = []
      if (near("SILVERING")) {
        ev.push({
          direction: "for",
          strength: "moderate",
          candidate: "thrips",
          // stamp the primary observation — the silvering half already
          // contributes its own symptom:SILVERING signal via
          // symptom.reported; a combined key would mint a third signal
          // out of the same two facts
          signal: "symptom:STIPPLING",
          text: "Stippling plus a silvery sheen is the classic thrips feeding pattern — confirm on the leaf undersides before treating.",
          measurement: hint("inspect:leaf-undersides"),
        })
      }
      if (near("WEBBING") || near("PEST_MITES")) {
        ev.push({
          direction: "for",
          strength: "moderate",
          candidate: "spider_mites",
          signal: "symptom:STIPPLING",
          text: "Stippling with mites or webbing sighted — the damage pattern and the pest agree; confirm population on undersides.",
          measurement: hint("inspect:leaf-undersides"),
        })
      }
      return ev
    },
    sourceIds: ["bc-cannabis-diseases", "cornell-cannabis-guidebook"],
  },
  {
    id: "pest.gnats-moisture",
    domain: "pest",
    kind: "assessment",
    title: "Gnats + wet medium",
    applies: (ctx) =>
      ctx.observations.some(
        (o) =>
          o.symptom === "PEST_FUNGUS_GNATS" &&
          !o.tApproximate &&
          ctx.observations.some(
            (m) =>
              (m.symptom === "MEDIUM_WET" || m.symptom === "OVERWATERED") &&
              !m.tApproximate &&
              Math.abs(m.t - o.t) <= 7 * 86400000
          )
      ),
    evaluate: () => [
      {
        direction: "for",
        strength: "moderate",
        candidate: "fungus_gnats",
        // merges with the sighting's own symptom:PEST_FUNGUS_GNATS
        // signal — the wet-medium half keeps its own MEDIUM_WET signal
        signal: "symptom:PEST_FUNGUS_GNATS",
        text: "Fungus gnats breed in consistently moist media — the wet-medium report and the pest sighting point the same direction.",
        measurement: hint("watering"),
      },
      {
        direction: "for",
        strength: "weak",
        candidate: "overwater",
        signal: "symptom:PEST_FUNGUS_GNATS",
        text: "An established gnat population is weak evidence the medium is staying wet — larvae need moist substrate.",
      },
    ],
    sourceIds: ["bc-cannabis-diseases", "cornell-cannabis-guidebook"],
  },
  {
    id: "watering.droop-split",
    domain: "watering",
    kind: "assessment",
    title: "Droop + medium moisture",
    applies: (ctx) =>
      ctx.observations.some(
        (o) =>
          o.symptom === "DROOPING" &&
          o.period !== "NIGHT" &&
          o.period !== "LIGHTS_OFF" &&
          !o.tApproximate &&
          ctx.observations.some(
            (m) =>
              (m.symptom === "MEDIUM_WET" || m.symptom === "MEDIUM_DRY") &&
              !m.tApproximate &&
              Math.abs(m.t - o.t) <= 3 * 86400000
          )
      ),
    evaluate: (ctx) => {
      const ev: IntelEvidence[] = []
      const has = (sym: SymptomId) =>
        ctx.observations.some(
          (o) =>
            o.symptom === "DROOPING" &&
            o.period !== "NIGHT" &&
            o.period !== "LIGHTS_OFF" &&
            !o.tApproximate &&
            ctx.observations.some(
              (m) => m.symptom === sym && !m.tApproximate && Math.abs(m.t - o.t) <= 3 * 86400000
            )
        )
      if (has("MEDIUM_WET")) {
        ev.push({
          direction: "for",
          strength: "moderate",
          candidate: "overwater",
          // the droop signal upgrades to moderate; the wet-medium
          // report keeps its own symptom:MEDIUM_WET signal — two
          // observations, two signals, no third minted
          signal: "symptom:DROOPING",
          text: "Drooping while the medium is wet is the overwatering shape — roots can't take up water they can't breathe around.",
          measurement: hint("watering"),
        })
        ev.push({
          direction: "against",
          strength: "weak",
          candidate: "underwater",
          // the wet-medium report is what argues — stamp it so this
          // merges with CONTRA's same-direction evidence instead of
          // summing a second weak group
          signal: "symptom:MEDIUM_WET",
          text: "A wet medium argues against underwatering as the droop cause.",
        })
      }
      if (has("MEDIUM_DRY")) {
        ev.push({
          direction: "for",
          strength: "moderate",
          candidate: "underwater",
          signal: "symptom:DROOPING",
          text: "Drooping while the medium is dry is the underwatering shape — the simplest explanation fits.",
          measurement: hint("watering"),
        })
        ev.push({
          direction: "against",
          strength: "weak",
          candidate: "overwater",
          signal: "symptom:MEDIUM_DRY",
          text: "A dry medium argues against overwatering as the droop cause.",
        })
      }
      return ev
    },
    sourceIds: ["cornell-cannabis-guidebook", "fao56-svp"],
  },
  {
    id: "growth.stretch-context",
    domain: "growth",
    kind: "assessment",
    title: "Stretch in context",
    applies: (ctx) => ctx.observations.some((o) => o.symptom === "STRETCHED"),
    evaluate: (ctx) => {
      const ev: IntelEvidence[] = []
      // Weeks 1–3 of flower carry a normal stretch — the same report
      // means something different there than in veg. stageStartCensored
      // means stageDays is a floor, not a fact — don't print it.
      if (ctx.diary.stage === "FLOWER" && !ctx.stageStartCensored && ctx.stageDays <= 21) {
        ev.push({
          direction: "info",
          strength: "weak",
          candidate: "stretch",
          signal: "stage",
          text: `Day ${ctx.stageDays} of flower — the first ~3 weeks carry a natural stretch as the plant sets its frame; it isn't a light problem by itself.`,
        })
        ev.push({
          direction: "against",
          strength: "weak",
          candidate: "insufficient_light",
          signal: "stage",
          text: "Early-flower stretch is expected — it doesn't prove the light is short, though canopy PPFD would settle it.",
          measurement: hint("ppfd"),
        })
        return ev
      }
      const tLatest = latestIsCurrent(ctx.series.temperature, ctx.now)
        ? ctx.series.temperature.latest
        : null
      const [, tHi] = TEMP_BANDS[ctx.diary.stage] ?? TEMP_BAND_DEFAULT
      if (tLatest != null && tLatest >= tHi) {
        // emit for the stage-refined stretch target — at SEEDLING the
        // report refines to seedling_stretch, not the generic candidate
        const obs = ctx.observations.find((o) => o.symptom === "STRETCHED")
        const targets = feedsForSymptom("STRETCHED", obs?.location, obs?.stage ?? ctx.diary.stage)
          .feeds.filter((f) => f in CANDIDATES && (f === "stretch" || f === "seedling_stretch"))
        for (const cid of targets.length ? targets : ["stretch"]) {
          ev.push({
            direction: "for",
            strength: "moderate",
            candidate: cid,
            signal: "temperature",
            text: `Stretching while temps run ${f1(tLatest)}°F (≥${tHi}°F) — heat and light limits can both sit behind elongation; can't separate them without a light reading.`,
            measurement: hint("ppfd"),
          })
        }
        ev.push({
          direction: "for",
          strength: "weak",
          candidate: "heat_stress",
          signal: "temperature",
          text: `Stretch plus ${f1(tLatest)}°F is consistent with heat pushing elongation.`,
          measurement: hint("leafTemp"),
        })
      }
      return ev
    },
    sourceIds: ["rodriguez-morrison-2021-light", "cornell-cannabis-guidebook"],
  },
  {
    id: "env.light-heat-compound",
    domain: "environment",
    kind: "assessment",
    title: "Light symptom + high temperature",
    applies: (ctx) =>
      ctx.observations.some((o) => o.symptom === "LIGHT_BURN" || o.symptom === "BLEACHING") &&
      ctx.series.temperature.n >= 1,
    evaluate: (ctx) => {
      const tLatest = latestIsCurrent(ctx.series.temperature, ctx.now)
        ? ctx.series.temperature.latest
        : null
      const [, tHi] = TEMP_BANDS[ctx.diary.stage] ?? TEMP_BAND_DEFAULT
      if (tLatest == null || tLatest < tHi) return []
      const upperOnly = ctx.observations.some(
        (o) => (o.symptom === "LIGHT_BURN" || o.symptom === "BLEACHING") && o.location === "UPPER_NEW"
      )
      return [
        {
          direction: "for",
          strength: upperOnly ? "moderate" : "weak",
          candidate: "light_burn",
          signal: "temperature",
          text: `Light-burn symptoms${upperOnly ? " on the upper canopy" : ""} while canopy temps run ${f1(tLatest)}°F — light and heat stress compound; actual PPFD at the tops would separate them.`,
          measurement: hint("ppfd"),
        },
      ]
    },
    sourceIds: ["rodriguez-morrison-2021-light", "chandra-2008-photosynthesis"],
  },
  {
    id: "stage.harvest-window",
    signal: "stage",
    domain: "stage",
    kind: "assessment",
    title: "Typical harvest window",
    applies: (ctx) =>
      ctx.diary.stage === "FLOWER" && !ctx.stageStartCensored && ctx.stageDays >= 49,
    evaluate: (ctx) => [
      {
        direction: "info",
        strength: "strong",
        // a context fact (days in flower) rendered as a finding — not a
        // readiness verdict; week count alone never proves harvest
        confirmed: true,
        text: `Day ${ctx.stageDays} of flower — many cultivars finish somewhere in the 8–10+ week range, but week count alone never proves readiness; trichome colour is the indicator to check.`,
        measurement: hint("inspect:trichomes"),
      },
    ],
    sourceIds: ["cornell-cannabis-guidebook", "postharvest-review-2022"],
  },
  {
    id: "post.dry-env",
    signal: "humidity",
    domain: "postharvest",
    kind: "risk",
    title: "Drying-room conditions",
    applies: (ctx) =>
      ctx.diary.stage === "DRYING" &&
      (ctx.series.humidity.n >= 1 || ctx.series.temperature.n >= 1),
    evaluate: (ctx) => {
      const ev: IntelEvidence[] = []
      const rh = latestIsCurrent(ctx.series.humidity, ctx.now)
        ? ctx.series.humidity.latest
        : null
      const t = latestIsCurrent(ctx.series.temperature, ctx.now)
        ? ctx.series.temperature.latest
        : null
      if (rh != null && rh > 65) {
        ev.push({
          direction: "risk",
          strength: rh >= 70 ? "moderate" : "weak",
          candidate: "post.dry-mold-risk",
          text: `Drying space at ${rh}% RH — above ~65% slows the dry enough for mold to set inside dense buds; aim for roughly 50–60%.`,
          measurement: hint("temperature"),
        })
      }
      if (rh != null && rh < 45) {
        ev.push({
          direction: "risk",
          strength: "weak",
          candidate: "post.dry-too-fast",
          signal: "humidity",
          text: `Dry space at ${rh}% RH — fast drying crusts the outside while cores stay wet; target a slow ~10–14 day dry for even moisture loss.`,
          measurement: hint("temperature"),
        })
      }
      // the warm arm only applies when the air isn't already wet —
      // warm HUMID air dries slowly (that's the mold branch above)
      if (t != null && t > 68 && (rh == null || rh <= 55)) {
        ev.push({
          direction: "risk",
          strength: "weak",
          candidate: "post.dry-too-fast",
          signal: "temperature",
          text: `Dry space at ${f1(t)}°F — warm dry air strips surface moisture too fast; aim nearer ~60°F.`,
          measurement: hint("humidity"),
        })
      }
      if (rh != null && rh >= 45 && rh <= 65 && (t == null || t <= 68)) {
        ev.push({
          direction: "info",
          strength: "weak",
          candidate: "post.dry-mold-risk",
          text: `Dry space at ${rh}% RH${t != null ? ` / ${f1(t)}°F` : ""} — inside the commonly targeted slow-dry envelope.`,
        })
      }
      return ev
    },
    sourceIds: ["postharvest-review-2022"],
  },
  {
    id: "post.cure-rh",
    signal: "humidity",
    domain: "postharvest",
    kind: "assessment",
    title: "Cure moisture",
    applies: (ctx) => ctx.diary.stage === "CURING" && ctx.series.humidity.n >= 1,
    evaluate: (ctx) => {
      const rh = latestIsCurrent(ctx.series.humidity, ctx.now)
        ? ctx.series.humidity.latest
        : null
      if (rh == null) return []
      // the humidity series is ambient logging — a jar hygrometer
      // reading tells the same story but the label must stay honest
      if (rh > 65) {
        return [
          {
            direction: "for",
            strength: rh >= 70 ? "moderate" : "weak",
            candidate: "post.cure-moisture",
            text: `Logged cure-space humidity at ${rh}% — if the jars read the same, that's mold territory; burp more often and check buds aren't clumping.`,
            measurement: hint("humidity"),
          },
        ]
      }
      if (rh < 55) {
        return [
          {
            direction: "for",
            strength: "weak",
            candidate: "post.cure-moisture",
            text: `Logged cure-space humidity at ${rh}% — below ~55% the cure stalls; buds may be over-dried.`,
          },
        ]
      }
      return [
        {
          direction: "info",
          strength: "weak",
          candidate: "post.cure-moisture",
          text: `Logged cure-space humidity at ${rh}% — inside the commonly targeted 55–65% band.`,
        },
      ]
    },
    sourceIds: ["postharvest-review-2022"],
  },

  {
    id: "data.stage-unknown",
    signal: "data",
    domain: "data",
    kind: "gap",
    title: "Stage unknown",
    applies: (ctx) => ctx.diary.stage === "UNKNOWN",
    evaluate: () => [
      {
        direction: "info",
        strength: "weak",
        text: "I don't know your stage — say e.g. 'week 3 flower' so I can use the right ranges.",
        measurement: hint("inspect:stage"),
      },
    ],
    sourceIds: [],
  },
  {
    id: "data.stale",
    signal: "data",
    domain: "data",
    kind: "gap",
    title: "Readings are stale",
    applies: (ctx) =>
      ctx.daysSinceUpdate != null &&
      ctx.daysSinceUpdate >= STALE_DAYS &&
      !hasFreshReport(ctx),
    evaluate: (ctx) => [
      {
        direction: "info",
        strength: "weak",
        text: `Latest logged readings are ${ctx.daysSinceUpdate} days old — tell me current temp/RH (or log an update) before I lean on them.`,
        measurement: hint("temperature"),
      },
    ],
    sourceIds: [],
  },

  // ── Longitudinal rules (Phase H) ─────────────────────────────────
  // Episodes, interventions, baselines — temporal bookkeeping over the
  // grower's OWN history. These rules never assert horticultural truth
  // from history alone: a resolved/improving claim COUNTER-WEIGHS the
  // symptom's standing evidence, a recurrence RE-RAISES it, an
  // intervention is evaluated against the series honestly, and a
  // personal-baseline deviation is info-only (their norm ≠ correct).

  {
    id: "longitudinal.episode",
    domain: "data",
    kind: "observation",
    title: "Symptom episode status",
    applies: (ctx) => (ctx.episodes?.length ?? 0) > 0,
    evaluate: (ctx) => {
      const ev: IntelEvidence[] = []
      for (const ep of ctx.episodes ?? []) {
        const label = SYMPTOM_LABELS[ep.symptom] ?? ep.symptom.toLowerCase()
        const loc = ep.location ? ` on ${LOCATION_LABELS[ep.location]}` : ""
        const signal = `symptom:${ep.symptom}`
        const feeds = feedsForSymptom(ep.symptom, ep.location, ctx.diary.stage).feeds
        const quietDays = Math.floor((ctx.now - ep.lastSeen) / 86400000)

        if (ep.status === "resolved") {
          for (const cid of feeds) {
            ev.push({
              direction: "against",
              strength: "moderate",
              candidate: cid,
              signal,
              text: `You reported the ${label}${loc} resolved — the earlier reports shouldn't still weigh for ${CANDIDATES[cid]?.name.toLowerCase() ?? cid}.`,
            })
          }
          continue
        }
        if (ep.status === "improving") {
          for (const cid of feeds) {
            ev.push({
              direction: "against",
              strength: "weak",
              candidate: cid,
              signal,
              text: `Reported ${label}${loc} improving — still counted, but the trajectory argues against ${CANDIDATES[cid]?.name.toLowerCase() ?? cid} progressing.`,
            })
          }
          continue
        }
        if (ep.status === "recurred") {
          for (const cid of feeds) {
            ev.push({
              direction: "for",
              strength: "moderate",
              candidate: cid,
              signal,
              text: `${label}${loc} returned after a reported resolution — a recurring pattern, not a first occurrence.`,
            })
          }
          ev.push({
            direction: "info",
            strength: "moderate",
            signal,
            text: `Recurring: ${label}${loc} resolved then came back (episode ${ep.episodeCount}).`,
          })
          continue
        }
        if (ep.status === "stable") {
          ev.push({
            direction: "info",
            strength: "weak",
            signal,
            text: `${label}${loc} reported stable — still present, not progressing.`,
          })
          continue
        }
        // active/recurred episodes with no fresh reports are "quiet" —
        // unresolved, never silently closed
        if (quietDays >= 5) {
          ev.push({
            direction: "info",
            strength: "weak",
            signal,
            text: `No new ${label}${loc} reports in ${quietDays}d — unresolved; silence isn't resolution.`,
          })
        }
      }
      return ev
    },
    sourceIds: [],
  },
  {
    id: "longitudinal.intervention",
    domain: "data",
    kind: "observation",
    title: "Intervention follow-through",
    applies: (ctx) => (ctx.interventions?.length ?? 0) > 0,
    evaluate: (ctx) => {
      const ev: IntelEvidence[] = []
      for (const iv of ctx.interventions ?? []) {
        const key = iv.targetMetric ? SCHEMA_SERIES[iv.targetMetric] : undefined
        const metricLabel = iv.targetMetric ? MEASUREMENT_INFO[iv.targetMetric]?.label ?? iv.targetMetric : null
        const signal = iv.targetMetric ? METRIC_SIGNAL[iv.targetMetric] : "data"
        const at = iv.eventT ?? iv.at
        const daysAgo = Math.max(0, Math.floor((ctx.now - at) / 86400000))

        if (!key || !iv.targetMetric) {
          ev.push({
            direction: "info",
            strength: "weak",
            signal,
            text: `You reported an adjustment (${daysAgo === 0 ? "today" : `${daysAgo}d ago`}) — I'll watch the next readings for movement.`,
          })
          continue
        }
        const series = ctx.series[key]
        const after = series.points.filter((p) => !p.tApproximate && p.t > at)
        const before = iv.beforeReading
        const eps = METRIC_EPSILON[iv.targetMetric] ?? 1

        if (!before) {
          ev.push({
            direction: "info",
            strength: "weak",
            signal,
            text: `No ${metricLabel} reading before your reported change — nothing to compare against.`,
            measurement: hint(iv.targetMetric),
          })
          continue
        }
        if (!after.length) {
          ev.push({
            direction: "info",
            strength: "weak",
            signal,
            text: `${metricLabel} hasn't been logged since the reported change (${daysAgo === 0 ? "today" : `${daysAgo}d ago`}) — a new reading shows whether it moved.`,
            measurement: hint(iv.targetMetric),
          })
          continue
        }
        const latest = after[after.length - 1]
        const delta = Math.round((latest.v - before.v) * 100) / 100
        const moved = Math.abs(delta) >= eps
        const intended =
          !iv.direction ||
          (iv.direction === "down" && delta < 0) ||
          (iv.direction === "up" && delta > 0)
        ev.push({
          direction: "info",
          strength: moved && intended ? "moderate" : "weak",
          signal,
          text: moved
            ? intended
              ? `${metricLabel} moved ${before.v} → ${latest.v} after your reported change — timing is consistent, not proof it caused it.`
              : `${metricLabel} moved ${before.v} → ${latest.v} — opposite the intended direction of your reported change.`
            : `${metricLabel} hasn't measurably moved since your reported change (${before.v} → ${latest.v}).`,
        })
      }
      return ev
    },
    sourceIds: [],
  },
  {
    // Personal-baseline deviation — info ONLY. "Above your usual" is a
    // change statement, never a correctness claim: their norm isn't
    // horticulturally endorsed (Phase H spec §29).
    id: "longitudinal.baseline",
    domain: "data",
    kind: "observation",
    title: "Shift from your recent norm",
    applies: (ctx) =>
      BASELINE_SERIES.some(
        ([metric, key]) =>
          ctx.baselines[metric]?.tier !== undefined &&
          ctx.baselines[metric]!.tier !== "insufficient" &&
          (ctx.series[key].change?.direction === "up" || ctx.series[key].change?.direction === "down")
      ),
    evaluate: (ctx) => {
      const ev: IntelEvidence[] = []
      for (const [metric, key] of BASELINE_SERIES) {
        const b = ctx.baselines[metric]
        const ch = ctx.series[key].change
        if (!b || b.tier === "insufficient" || !ch || (ch.direction !== "up" && ch.direction !== "down")) continue
        const label = MEASUREMENT_INFO[metric]?.label ?? metric
        const band = b.lo != null && b.hi != null ? `usual ${b.lo}–${b.hi}` : `usual ≈${b.median}`
        ev.push({
          direction: "info",
          strength: b.tier === "established" ? "moderate" : "weak",
          signal: METRIC_SIGNAL[metric],
          text: `${label} is running ${ch.direction === "up" ? "above" : "below"} your ${band} (${b.tier} baseline, ${b.n} readings) — a change from your norm, not a verdict.`,
        })
      }
      return ev
    },
    sourceIds: [],
  },
  {
    // Recurring out-of-band RH — episode segmentation, not a single
    // spike. ≥2 closed episodes = a recurring pattern; an open episode
    // after a closed one = "it's back".
    id: "env.rh-episodes",
    domain: "environment",
    signal: "humidity",
    kind: "risk",
    title: "Recurring humidity excursions",
    applies: (ctx) => ctx.series.humidity.n >= 4,
    evaluate: (ctx) => {
      const band = RH_BANDS[ctx.diary.stage]
      if (!band) return []
      const eps = excursionEpisodes(ctx.series.humidity.points, -Infinity, band[1])
      if (eps.length < 2) return []
      const open = eps[eps.length - 1].end == null
      const spanDays = Math.round((eps[eps.length - 1].start - eps[0].start) / 86400000)
      const ev: IntelEvidence[] = [
        {
          direction: "for",
          strength: "moderate",
          candidate: "humidity_high",
          signal: "humidity",
          text: `RH above ${band[1]}% has happened in ${eps.length} separate episodes over ~${spanDays}d — a recurring pattern, not one spike.`,
        },
      ]
      if (ctx.diary.stage === "FLOWER") {
        ev.push({
          direction: "risk",
          strength: "weak",
          candidate: "bud_rot",
          signal: "humidity",
          text: `Repeated elevated-RH episodes in flower keep the bud-rot window open${open ? " — and it's elevated right now" : ""}.`,
          measurement: hint("inspect:bud-interior"),
        })
      }
      if (open) {
        ev.push({
          direction: "info",
          strength: "weak",
          signal: "humidity",
          text: "The latest readings are still above the band — the current episode hasn't closed.",
        })
      }
      return ev
    },
    sourceIds: ["punja-2022-botrytis", "bc-cannabis-diseases"],
  },
  {
    // Recent stage transition — ranges changed; say so once.
    id: "stage.transition",
    domain: "stage",
    signal: "stage",
    kind: "observation",
    title: "Stage changed",
    applies: (ctx) =>
      ctx.stageTransitions.length > 0 &&
      (ctx.now - ctx.stageTransitions[ctx.stageTransitions.length - 1].t) / 86400000 <= 3,
    evaluate: (ctx) => {
      const tr = ctx.stageTransitions[ctx.stageTransitions.length - 1]
      return [
        {
          direction: "info",
          strength: "weak",
          signal: "stage",
          text: `Stage moved ${tr.from.toLowerCase()} → ${tr.to.toLowerCase()}${tr.censored ? " (boundary predates the fetched window)" : ` ${Math.max(0, Math.floor((ctx.now - tr.t) / 86400000))}d ago`} — targets and tolerances shift with it.`,
        },
      ]
    },
    sourceIds: ["terptalk-stage-tips"],
  },
]

// series key per baseline-eligible metric — baselines exist only where
// a logged series exists
const BASELINE_SERIES: [MetricId, keyof GrowContextView["series"]][] = [
  ["temperature", "temperature"],
  ["humidity", "humidity"],
  ["ph", "ph"],
  ["ec", "ec"],
  ["runoffPh", "runoffPh"],
  ["runoffEc", "runoffEc"],
]

const METRIC_SIGNAL: Partial<Record<MetricId, SignalId>> = {
  temperature: "temperature",
  humidity: "humidity",
  ph: "ph",
  ec: "ec",
  height: "height",
  runoffPh: "runoff",
  runoffEc: "runoff",
  vpd: "env:temp-rh",
}

// ── Assessment ──────────────────────────────────────────────────────

const STATE_RANK: Record<Finding["state"], number> = {
  insufficient: 0,
  possible: 1,
  strong: 2,
  confirmed: 3,
  conflicting: 4,
}

/** Deterministic finding-state classifier for standalone (non-candidate)
 *  findings — kept exported so tests can pin every state directly. */
export function findingStateFor(kind: Finding["kind"], evidence: IntelEvidence[]): Finding["state"] {
  if (kind === "gap") return "insufficient"
  const { state } = scoreEvidence(evidence)
  return state
}

/** Signal-grouped scoring: evidence sharing (direction, signal) is
 *  correlated — each group contributes its MAX weight, never a sum.
 *  A lone humidity series can't stack four rules into STRONG. */
function scoreEvidence(evidence: IntelEvidence[], opts?: { candidateKind?: "condition" | "risk" }) {
  let confirmed = false
  let hasStrongItem = false
  const groups = new Map<string, { signal: string; direction: "for" | "risk" | "against"; weight: number }>()
  for (const e of evidence) {
    if (e.confirmed) confirmed = true
    if (e.direction === "info") continue // neutral — never scored
    if ((e.direction === "for" || e.direction === "risk") && e.strength === "strong") hasStrongItem = true
    const direction = e.direction as "for" | "risk" | "against"
    const signal = e.signal ?? "?"
    const key = `${direction}|${signal}`
    const g = groups.get(key)
    if (!g || W[e.strength] > g.weight) groups.set(key, { signal, direction, weight: W[e.strength] })
  }
  let forScore = 0
  let riskScore = 0
  let againstScore = 0
  for (const g of groups.values()) {
    if (g.direction === "for") forScore += g.weight
    else if (g.direction === "risk") riskScore += g.weight
    else againstScore += g.weight
  }
  // For condition candidates, favorable-environment evidence is one
  // predisposing signal — never proof of the condition itself.
  if (opts?.candidateKind === "condition") riskScore = Math.min(riskScore, W.weak)
  const support = forScore + riskScore
  // Independent signals are the *meaningful* support groups — moderate or
  // stronger. Weak items still add to support but a weak second signal
  // cannot by itself lift a candidate to STRONG (moderate + weak stays
  // POSSIBLE; moderate + moderate from two signals is STRONG).
  const independentSignals = [...groups.values()].filter(
    (g) => (g.direction === "for" || g.direction === "risk") && g.weight >= W.moderate
  ).length
  const signalBreakdown = [...groups.values()].sort(
    (a, b) => a.signal.localeCompare(b.signal) || a.direction.localeCompare(b.direction)
  )
  let state: Finding["state"]
  if (!evidence.length) state = "insufficient"
  // A confirmed measured fact counts as strong support for conflict
  // detection — strong counter-evidence turns it CONFLICTING rather
  // than letting the confirmed flag mask the contradiction.
  else if (confirmed) state = againstScore >= W.strong ? "conflicting" : "confirmed"
  // CONFLICTING: both sides carry real evidence AND support doesn't
  // clearly dominate (within one weight class). Moderate-only disputes
  // surface — spec: "pH fine + burn tips + EC high → CONFLICTING".
  else if (support >= W.moderate && againstScore >= W.moderate && support - againstScore <= 1) state = "conflicting"
  else if (support >= W.strong && (independentSignals >= 2 || hasStrongItem)) state = "strong"
  else if (support >= W.weak) state = "possible"
  else state = "insufficient"
  return { state, forScore: support, againstScore, confirmed, independentSignals, signalBreakdown }
}

/** Candidate-level assessment: scoreEvidence + maxState clamp.
 *  CONFLICTING is never clamped — it's honest uncertainty, not an
 *  overclaim. CONFIRMED/STRONG clamp to the candidate's ceiling. */
export function assessCandidate(
  def: CandidateDef,
  evidence: IntelEvidence[]
): Pick<CandidateResult, "state" | "forScore" | "againstScore" | "independentSignals" | "signals"> {
  const { state, forScore, againstScore, independentSignals, signalBreakdown } = scoreEvidence(evidence, {
    candidateKind: def.kind,
  })
  const signals = signalBreakdown
  if (state === "confirmed" || state === "strong") {
    return {
      state: STATE_RANK[state] > STATE_RANK[def.maxState] ? def.maxState : state,
      forScore, againstScore, independentSignals, signals,
    }
  }
  return { state, forScore, againstScore, independentSignals, signals }
}

/** Deterministic candidate ordering — conflicting first (needs
 *  resolution), then strong, possible, insufficient; ties break on
 *  forScore desc, evidence count desc, id asc. Total order: stable
 *  under rule-array reordering. */
export function rankCandidates(candidates: CandidateResult[]): CandidateResult[] {
  const order: Record<Finding["state"], number> = {
    conflicting: 0,
    strong: 1,
    confirmed: 1,
    possible: 2,
    insufficient: 3,
  }
  return [...candidates].sort(
    (a, b) =>
      order[a.state] - order[b.state] ||
      b.forScore - a.forScore ||
      b.independentSignals - a.independentSignals ||
      b.supporting.length + b.opposing.length - (a.supporting.length + a.opposing.length) ||
      a.id.localeCompare(b.id)
  )
}

// ── Evaluation ──────────────────────────────────────────────────────

export function evaluateContext(ctx: GrowContextView): Diagnosis {
  const findings: Finding[] = []
  const byCandidate = new Map<string, { ruleIds: Set<string>; sourceIds: Set<string>; evidence: IntelEvidence[] }>()

  // Episodes derive at eval time from observations + resolution claims —
  // never persisted (they'd go stale under edited diary updates).
  const evalCtx: GrowContextView = {
    ...ctx,
    episodes: episodesFromObservations(ctx.observations, ctx.resolutions ?? []),
  }

  for (const rule of INTEL_RULES) {
    if (!rule.applies(evalCtx)) continue
    const evidence = rule
      .evaluate(evalCtx)
      .filter((e) => e.text.trim().length > 0)
      // Evidence without its own signal inherits the rule's — rules
      // that iterate observations stamp per-symptom signals themselves.
      .map((e) => ({ ...e, signal: e.signal ?? rule.signal ?? rule.id }))
    // A rule that evaluated but found nothing produces nothing — an
    // empty finding is noise, not an INSUFFICIENT signal.
    if (!evidence.length) continue

    const standalone = evidence.filter((e) => !e.candidate)
    const pooled = evidence.filter((e) => e.candidate)

    if (standalone.length) {
      findings.push({
        ruleId: rule.id,
        title: rule.title,
        domain: rule.domain,
        kind: rule.kind,
        state: findingStateFor(rule.kind, standalone),
        evidence: standalone,
        nextMeasurement: standalone
          .map((e) => e.measurement)
          .filter((m): m is MeasurementHint => !!m)
          .sort((a, b) => priorityOf(a.id) - priorityOf(b.id))[0],
        sourceIds: rule.sourceIds.filter((id) => id in SOURCES),
      })
    }

    for (const e of pooled) {
      const cid = e.candidate!
      const bucket = byCandidate.get(cid) ?? { ruleIds: new Set<string>(), sourceIds: new Set<string>(), evidence: [] }
      bucket.ruleIds.add(rule.id)
      for (const s of rule.sourceIds) if (s in SOURCES) bucket.sourceIds.add(s)
      bucket.evidence.push(e)
      byCandidate.set(cid, bucket)
    }
  }

  const candidates: CandidateResult[] = []
  for (const [id, bucket] of byCandidate) {
    const def = CANDIDATES[id]
    if (!def) continue // orphan candidateId — validateRuleEmissions catches this
    const requiredMissing = def.requiredInputs.filter((m) => !measurementAvailable(evalCtx, m))
    const scored = assessCandidate(def, bucket.evidence)
    // Missing required data caps STRONG/CONFIRMED at POSSIBLE — a
    // reported symptom can surface a candidate, never assert it.
    // CONFLICTING passes through: it's honest uncertainty.
    let state =
      requiredMissing.length > 0 && (scored.state === "strong" || scored.state === "confirmed")
        ? "possible"
        : scored.state
    // Stale-evidence clamp: when EVERY supporting signal group rests on
    // readings ≥ STALE_DAYS old, STRONG/CONFIRMED can't stand — demote
    // to POSSIBLE and say so. CONFLICTING is never touched.
    const supportSignals = scored.signals.filter(
      (s) => s.direction === "for" || s.direction === "risk"
    )
    const stale =
      (state === "strong" || state === "confirmed") &&
      supportSignals.length > 0 &&
      supportSignals.every((s) => {
        const age = signalAgeDays(evalCtx, s.signal)
        return age != null && age >= STALE_DAYS
      })
    if (stale) {
      state = "possible"
      // Render the real age of the stalest supporting signal — daysSinceUpdate
      // can be null when all data came from chat reports.
      const displayAge = Math.round(
        Math.max(...supportSignals.map((s) => signalAgeDays(evalCtx, s.signal) ?? 0))
      )
      bucket.evidence.push({
        direction: "info",
        strength: "weak",
        candidate: id,
        signal: "data",
        text: `Based on readings ${displayAge} days old — current values would firm this up.`,
      })
    }
    const { forScore, againstScore, independentSignals, signals } = scored
    candidates.push({
      id,
      name: def.name,
      domain: def.domain,
      kind: def.kind,
      severity: def.severity,
      state,
      forScore,
      againstScore,
      independentSignals,
      signals,
      // evidence sorted strongest-first (stable) so [0] is the best
      // line to render
      supporting: bucket.evidence
        .filter((e) => e.direction === "for" || e.direction === "risk")
        .sort((a, b) => W[b.strength] - W[a.strength]),
      opposing: bucket.evidence
        .filter((e) => e.direction === "against")
        .sort((a, b) => W[b.strength] - W[a.strength]),
      info: bucket.evidence.filter((e) => e.direction === "info"),
      ruleIds: [...bucket.ruleIds].sort(),
      requiredMissing,
      nextMeasurement: candidateNextMeasurement(def, evalCtx),
      sourceIds: [...bucket.sourceIds].sort(),
      ...(stale ? { stale: true } : {}),
    })
  }

  return { candidates: rankCandidates(candidates), findings }
}

// ── Next-measurement selection ──────────────────────────────────────
// Deterministic scoring — NOT information gain:
//   score(m) = Σ over candidates referencing m of stateWeight(state)
//            + 2 if m discriminates a CONFLICTING candidate (resolves a dispute)
//            + 1 per candidate where m is a missing requiredInput (unblocks it)
//   findings' hints score by their finding's state weight.
// Measurements already present in the context are eliminated — never
// recommend data the grower already logged — EXCEPT stale ones: a metric
// ≥ STALE_DAYS old that still backs a live candidate/finding is worth
// re-measuring, so it scores through a separate bypass pass.
// Tie-break: MEASUREMENT_PRIORITY order, then id — a total order.

const SCHEMA_SERIES: Partial<Record<MetricId, keyof GrowContextView["series"]>> = {
  temperature: "temperature",
  humidity: "humidity",
  ph: "ph",
  ec: "ec",
  height: "height",
  vpd: "vpdEntered",
  runoffPh: "runoffPh",
  runoffEc: "runoffEc",
}

export function measurementAvailable(ctx: GrowContextView, m: MetricId): boolean {
  const key = SCHEMA_SERIES[m]
  return key ? ctx.series[key].n > 0 : false
}

/** Whether a next-step ask is already satisfied — metrics by series
 *  data, inspections by a reported observation that covers them. */
export function nextStepSatisfied(ctx: GrowContextView, id: NextStepId): boolean {
  if (id.startsWith("inspect:")) {
    if (id === "inspect:stage") return ctx.diary.stage !== "UNKNOWN"
    const resolved = INSPECTION_INFO[id]?.resolvedBy
    return resolved ? ctx.observations.some((o) => resolved.includes(o.symptom)) : false
  }
  return measurementAvailable(ctx, id as MetricId)
}

const priorityOf = (id: NextStepId) => {
  const i = MEASUREMENT_PRIORITY.indexOf(id)
  return i < 0 ? MEASUREMENT_PRIORITY.length : i
}

const STATE_WEIGHT: Record<Finding["state"], number> = {
  conflicting: 4,
  strong: 3,
  confirmed: 1, // a known fact carries no residual uncertainty
  possible: 2,
  insufficient: 1,
}

function candidateNextMeasurement(
  def: CandidateDef,
  ctx: GrowContextView
): MeasurementHint | undefined {
  // Declared order is author-ranked by discriminative power for THIS
  // condition — global priority is only for cross-candidate scoring.
  const wanted = [...def.discriminatingInputs, ...def.requiredInputs]
    .filter((m) => !nextStepSatisfied(ctx, m))[0]
  if (!wanted) return undefined
  return hint(wanted)
}

/** The single most uncertainty-reducing measurement across the whole
 *  diagnosis. Documented deterministic ranking, not Bayesian gain. */
export function nextUsefulMeasurement(ctx: GrowContextView, diagnosis: Diagnosis): MeasurementHint | null {
  const best = scoredSteps(ctx, diagnosis)[0]
  return best ? hint(best[0]) : null
}

/** Every recommendable step with its deterministic score, best first.
 *  Total order: score desc → MEASUREMENT_PRIORITY → id. */
function scoredSteps(ctx: GrowContextView, diagnosis: Diagnosis): [NextStepId, number][] {
  const scores = new Map<NextStepId, number>()
  const add = (m: NextStepId | undefined, w: number) => {
    if (!m || nextStepSatisfied(ctx, m)) return
    scores.set(m, (scores.get(m) ?? 0) + w)
  }

  for (const c of diagnosis.candidates) {
    const def = CANDIDATES[c.id]
    if (!def) continue
    const w = STATE_WEIGHT[c.state]
    for (const m of def.discriminatingInputs) {
      add(m, w + (c.state === "conflicting" ? 2 : 0))
    }
    // a missing required input GATES the candidate — it must outrank
    // ordinary discriminating asks or the grower is sent to refine a
    // candidate that can't even progress
    for (const m of c.requiredMissing) add(m, w + 4)
    for (const e of [...c.supporting, ...c.opposing, ...c.info]) add(e.measurement?.id, w)
  }
  for (const f of diagnosis.findings) {
    add(f.nextMeasurement?.id, STATE_WEIGHT[f.state])
    for (const e of f.evidence) add(e.measurement?.id, STATE_WEIGHT[f.state])
  }

  // Stale-refresh pass — a metric that already HAS data is skipped by
  // `add`, but when that data is ≥ STALE_DAYS old and still backs a live
  // candidate or finding, re-measuring it is the best next step. Write
  // directly, bypassing the satisfied-check intentionally.
  const bumpStale = (m: NextStepId | undefined, w: number) => {
    if (!m || m.startsWith("inspect:")) return
    const age = ctx.freshness[m as MetricId]
    if (age != null && age >= STALE_DAYS) {
      scores.set(m, (scores.get(m) ?? 0) + w)
    }
  }
  for (const c of diagnosis.candidates
    .filter((c) => c.state !== "insufficient")
    .slice(0, 3)) {
    const def = CANDIDATES[c.id]
    if (!def) continue
    const w = STATE_WEIGHT[c.state]
    for (const m of def.discriminatingInputs) bumpStale(m, w)
    for (const e of [...c.supporting, ...c.opposing, ...c.info]) {
      bumpStale(e.measurement?.id, w)
    }
  }
  for (const f of diagnosis.findings) {
    if (f.state === "insufficient") continue
    const w = STATE_WEIGHT[f.state]
    bumpStale(f.nextMeasurement?.id, w)
    for (const e of f.evidence) bumpStale(e.measurement?.id, w)
  }

  return [...scores.entries()].sort(
    (a, b) => b[1] - a[1] || priorityOf(a[0]) - priorityOf(b[0]) || a[0].localeCompare(b[0])
  )
}

// ── Action engine (Phase H4) ────────────────────────────────────────
// Classifies the ranked steps into explicit action classes. The list is
// what "what's the single most useful thing to do next" draws from.
//
// Class rules:
//   COMPARE — the step discriminates a CONFLICTING candidate (a live
//             dispute it can resolve)
//   VERIFY  — the target metric already has data but it's stale —
//             re-measuring tests whether the old reading still holds
//   MEASURE — a fresh instrument reading that reduces uncertainty
//   OBSERVE — a visual inspection ("inspect:*")
//   ADJUST  — emitted ONLY at STRONG with zero opposing evidence on a
//             non-urgent candidate; the text is verbatim from the
//             candidate's author-vetted recommendedActions. Never at
//             POSSIBLE — measurement beats adjustment under uncertainty.
//   WAIT    — a recent intervention hasn't had a follow-up reading yet;
//             time is the discriminator
//   LOG     — sparse logging is itself the limiting factor

export function nextActions(ctx: GrowContextView, diagnosis: Diagnosis): ActionRequest[] {
  const actions: ActionRequest[] = []

  // step-classified actions — top 3 scored steps
  for (const [id, score] of scoredSteps(ctx, diagnosis).slice(0, 3)) {
    const isInspect = id.startsWith("inspect:")
    const stale =
      !isInspect &&
      measurementAvailable(ctx, id as MetricId) &&
      (ctx.freshness[id as MetricId] ?? 0) >= STALE_DAYS
    const serves = diagnosis.candidates.filter((c) => {
      const def = CANDIDATES[c.id]
      if (!def) return false
      return (
        def.discriminatingInputs.includes(id) ||
        def.requiredInputs.includes(id as MetricId) ||
        [...c.supporting, ...c.opposing, ...c.info].some((e) => e.measurement?.id === id)
      )
    })
    const conflicting = serves.filter((c) => c.state === "conflicting").map((c) => c.id)
    const cls: ActionClass = isInspect
      ? "OBSERVE"
      : conflicting.length
        ? "COMPARE"
        : stale
          ? "VERIFY"
          : "MEASURE"
    const h = hint(id)
    actions.push({
      actionClass: cls,
      stepId: id,
      candidateIds: serves.map((c) => c.id),
      findingIds: diagnosis.findings
        .filter((f) => f.nextMeasurement?.id === id || f.evidence.some((e) => e.measurement?.id === id))
        .map((f) => f.ruleId),
      reason: h.why,
      discriminates: conflicting,
      confidence: serves[0]?.state ?? "insufficient",
      riskTier: "none",
      factors: {
        stateWeight: score,
        unblocksRequired: serves.some((c) => c.requiredMissing.includes(id as MetricId)),
        resolvesConflict: conflicting.length > 0,
        refreshesStale: stale,
        evidenceHints: serves.length,
        priorityIndex: priorityOf(id),
      },
    })
  }

  // ADJUST — gated: STRONG, no opposing evidence, non-urgent, authored
  // action exists. One at most, always below measurement classes.
  const top = diagnosis.candidates[0]
  if (top && top.state === "strong" && top.againstScore === 0) {
    const def = CANDIDATES[top.id]
    const action = def?.recommendedActions[0]
    if (def && action && def.severity !== "urgent") {
      actions.push({
        actionClass: "ADJUST",
        actionText: action,
        candidateIds: [top.id],
        reason: `${def.name} reached STRONG with no opposing evidence — the listed adjustment is the low-risk next step.`,
        discriminates: [],
        confidence: "strong",
        riskTier: "low",
        factors: {
          stateWeight: STATE_WEIGHT.strong,
          unblocksRequired: false,
          resolvesConflict: false,
          refreshesStale: false,
          evidenceHints: 0,
          priorityIndex: MEASUREMENT_PRIORITY.length,
        },
      })
    }
  }

  // WAIT — a reported intervention with no after-reading is waiting on
  // time, not on the grower measuring more right now
  const pending = (ctx.interventions ?? []).filter((iv) => {
    const key = iv.targetMetric ? SCHEMA_SERIES[iv.targetMetric] : undefined
    if (!key) return false
    const at = iv.eventT ?? iv.at
    return (
      (ctx.now - at) / 86400000 <= 7 &&
      !ctx.series[key].points.some((p) => !p.tApproximate && p.t > at)
    )
  })
  if (pending.length) {
    const iv = pending[pending.length - 1]
    const label = iv.targetMetric ? MEASUREMENT_INFO[iv.targetMetric]?.label ?? iv.targetMetric : "the affected readings"
    actions.push({
      actionClass: "WAIT",
      candidateIds: [],
      reason: `You reported an adjustment ${Math.floor((ctx.now - (iv.eventT ?? iv.at)) / 86400000)}d ago — ${label} hasn't been logged since. Give it ~2 days, then re-measure.`,
      discriminates: [],
      confidence: "possible",
      riskTier: "none",
      factors: {
        stateWeight: 0,
        unblocksRequired: false,
        resolvesConflict: false,
        refreshesStale: false,
        evidenceHints: 0,
        priorityIndex: MEASUREMENT_PRIORITY.length,
      },
    })
  }

  // LOG — sparse data is itself the bottleneck
  if (ctx.updateCount > 0 && (ctx.envCoverage < 0.5 || (ctx.daysSinceUpdate ?? 0) >= 4)) {
    actions.push({
      actionClass: "LOG",
      candidateIds: [],
      reason:
        ctx.envCoverage < 0.5
          ? `Only ${Math.round(ctx.envCoverage * 100)}% of recent updates logged environment data — a temp/RH/pH/EC entry unlocks the most reasoning.`
          : `Last update was ${ctx.daysSinceUpdate}d ago — a fresh update keeps the picture current.`,
      discriminates: [],
      confidence: "insufficient",
      riskTier: "none",
      factors: {
        stateWeight: 0,
        unblocksRequired: false,
        resolvesConflict: false,
        refreshesStale: false,
        evidenceHints: 0,
        priorityIndex: MEASUREMENT_PRIORITY.length,
      },
    })
  }

  // WAIT outranks ADJUST — never stack a second adjustment on top of an
  // intervention that hasn't had an after-reading yet.
  const CLASS_RANK: Record<ActionClass, number> = {
    COMPARE: 0, VERIFY: 1, MEASURE: 2, OBSERVE: 3, WAIT: 4, ADJUST: 5, LOG: 6,
  }
  return actions
    .sort((a, b) => CLASS_RANK[a.actionClass] - CLASS_RANK[b.actionClass])
    .slice(0, 4)
}

// ── Rendering ───────────────────────────────────────────────────────
// Compact block appended inside the /checkin diary block. Labels make
// the epistemics explicit: observed = logged values, calculated =
// derived, interpretation = candidate evidence, missing = what would
// help. Candidates render as warnings/assessments — never as diagnoses.

export function renderIntelLines(
  ctx: GrowContextView,
  diagnosis: Diagnosis,
  opts?: { provenanceMarks?: boolean }
): string[] {
  const lines: string[] = []
  // "(you)" marks a latest point that came from a chat report rather than a
  // logged diary update — only when the caller opts in (diagnose).
  const you = (s: IntelSeries) =>
    opts?.provenanceMarks && s.points[s.points.length - 1]?.provenance === "user-reported"
      ? " (you)"
      : ""
  const observed: string[] = []
  if (ctx.series.temperature.latest != null) observed.push(`${ctx.series.temperature.latest}°F${you(ctx.series.temperature)}`)
  if (ctx.series.humidity.latest != null) observed.push(`${ctx.series.humidity.latest}% RH${you(ctx.series.humidity)}`)
  if (ctx.series.ph.latest != null) observed.push(`pH ${ctx.series.ph.latest}${you(ctx.series.ph)}`)
  if (ctx.series.ec.latest != null) observed.push(`EC ${ctx.series.ec.latest}${you(ctx.series.ec)}`)
  const calculated: string[] = []
  if (ctx.series.vpdComputed.latest != null) calculated.push(`VPD ≈${ctx.series.vpdComputed.latest} kPa`)

  // What the grower reported in update text — canonical labels only,
  // never raw free text (parsed observations, not diagnoses).
  const reported: string[] = []
  for (const o of ctx.observations) {
    const label = SYMPTOM_LABELS[o.symptom]
    if (!label) continue
    const loc = o.location ? ` (${LOCATION_LABELS[o.location]})` : ""
    const s = `${label}${loc}`
    if (!reported.includes(s)) reported.push(s)
  }

  // Confirmed standalone observations (e.g. VPD divergence) render first —
  // they are measured facts, not hypotheses.
  const confirmedFindings = diagnosis.findings.filter(
    (f) => f.state === "confirmed" || f.state === "strong"
  )
  const watchCandidates = diagnosis.candidates
    .filter((c) => c.state === "conflicting" || c.state === "strong" || c.state === "possible")
    .slice(0, 3 - Math.min(confirmedFindings.length, 3))
  const next = nextUsefulMeasurement(ctx, diagnosis)

  const top = diagnosis.candidates[0]
  const showAssessment = top && top.state !== "insufficient"

  // Nothing to say → render nothing.
  if (!observed.length && !calculated.length && !confirmedFindings.length && !watchCandidates.length && !next)
    return []

  lines.push(`📊 Reading the last ${ctx.updateCount} update${ctx.updateCount === 1 ? "" : "s"}:`)
  if (observed.length) lines.push(`Observed: ${observed.join(" · ")}`)
  const vpdYou = you(ctx.series.vpdComputed)
  if (calculated.length)
    lines.push(
      `Calculated: ${calculated.join(" · ")} (${vpdYou ? "from your reported temp/RH" : "air temp — leaf temp not logged"})`
    )
  if (reported.length) lines.push(`Reported: ${reported.slice(0, 3).join(" · ")}`)

  if (confirmedFindings.length || watchCandidates.length) {
    lines.push("Worth watching:")
    for (const f of confirmedFindings.slice(0, 2)) {
      lines.push(`• ${f.evidence[0]?.text ?? f.title}`)
    }
    for (const c of watchCandidates) {
      if (c.state === "conflicting") {
        const forText = c.supporting[0]?.text ?? c.name
        const againstText = c.opposing[0]?.text ?? "counter-evidence"
        const resolve = c.nextMeasurement ? ` Verify ${c.nextMeasurement.label} first.` : ""
        lines.push(`⚠ ${c.name}: evidence conflicts — ${forText} / ${againstText}${resolve}`)
      } else {
        const marker = c.state === "strong" ? "•" : "·"
        lines.push(`${marker} ${c.supporting[0]?.text ?? c.name}`)
      }
    }
  }
  if (showAssessment) {
    // Risk candidates render as warnings — never as diagnoses.
    lines.push(`${top.kind === "risk" ? "Risk" : "Assessment"}: ${top.name} — ${top.state.toUpperCase()}`)
    // Actions are proportional to certainty: only STRONG surfaces a
    // suggested intervention; weaker states get a measurement instead.
    const action = top.state === "strong" ? CANDIDATES[top.id]?.recommendedActions[0] : undefined
    if (action) lines.push(`Suggested: ${action}`)
  }
  if (next) lines.push(`Next useful measurement: ${next.label} — ${next.why}`)
  return lines
}
