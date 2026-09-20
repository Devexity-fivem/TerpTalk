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
//   forScore     = Σ(for) + Σ(risk)
//   againstScore = Σ(against)
//   no evidence                              → INSUFFICIENT
//   a confirmed:true item with no opposition → CONFIRMED
//     (measured facts only; contradiction drops through to CONFLICTING)
//   forScore ≥3 AND againstScore ≥3          → CONFLICTING
//   forScore ≥3                              → STRONG
//   forScore ≥1                              → POSSIBLE
//   otherwise                                → INSUFFICIENT
//   then clamped to the candidate's maxState (condition/risk candidates
//   can never be CONFIRMED; thin-provenance candidates cap at POSSIBLE).
// Standalone findings use the same table, with kind:"gap" forced to
// INSUFFICIENT. CONFLICTING preserves BOTH sides plus a resolving
// measurement — evidence is never hidden to produce a cleaner answer.

import { countExcursions } from "@/lib/terpbot-intel-calc"
import { CANDIDATES, SOURCES } from "@/lib/terpbot-intel-knowledge"
import type {
  CandidateDef,
  CandidateResult,
  Diagnosis,
  Finding,
  GrowContextView,
  IntelEvidence,
  IntelRule,
  MeasurementHint,
  MetricId,
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

const TEMP_HIGH_F = 86 // ~30°C — Chandra 2008 photosynthetic optimum edge
const TEMP_LOW_F = 62 // cold-root / slowed-growth floor (stage-tips germ band)
const RH_FLOWER_RISK = 65 // Punja 2022: botrytis favored >70% RH; 65 = approaching
const RH_SUSTAINED = 70 // sustained-high threshold for the humidity_high candidate
const EC_ELEVATED = 2.5 // mS/cm — above typical coco/hydro feed range

/** Discriminating-measurement preference order — final tie-break between
 *  equally-scored measurements. Every MetricId appears so the sort is
 *  total (indexOf can never return -1 for a listed hint). */
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
  "vpd",
]

/** Label + generic "why" for every recommendable measurement. Candidate-
 *  specific reasons come from the candidate's discriminatingInputs —
 *  this map is the fallback renderer vocabulary. */
const MEASUREMENT_INFO: Record<MetricId, { label: string; why: string }> = {
  runoffEc: { label: "runoff EC", why: "best separates salt buildup from under-watering" },
  runoffPh: { label: "runoff pH", why: "confirms whether the root zone is actually drifting" },
  substrateMoisture: { label: "substrate moisture / pot weight", why: "separates watering issues from environment issues" },
  leafTemp: { label: "leaf/canopy temperature", why: "explains the gap between recorded and calculated VPD" },
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

const hint = (id: MetricId): MeasurementHint => ({ id, ...MEASUREMENT_INFO[id] })
const f1 = (v: number) => Math.round(v * 10) / 10

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
    id: "env.vpd-band",
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
        return [
          {
            direction: "risk",
            strength,
            candidate: "env.heat-stress",
            text: `Calculated VPD is running above the ${lo}–${hi} kPa ${ctx.diary.stage.toLowerCase()} range (${exc.count}/${exc.n} readings out) — high transpiration can stress leaf edges.`,
            measurement: hint("leafTemp"),
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
    domain: "environment",
    kind: "risk",
    title: "Humidity trending upward",
    applies: (ctx) => ctx.series.humidity.trend === "rising",
    evaluate: (ctx) => {
      const ev: IntelEvidence[] = [
        {
          direction: "for",
          strength: "weak",
          candidate: "humidity_high",
          text: "Humidity is trending upward across recent readings.",
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
          direction: "for",
          strength: "moderate",
          candidate: "env.heat-stress",
          text: `Temperature above ${TEMP_HIGH_F}°F in ${exc.count} of the last ${exc.n} readings — photosynthetic rate drops and stress compounds past ~30°C.`,
          measurement: hint("leafTemp"),
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
          direction: "for",
          strength: "weak",
          candidate: "env.cold-stress",
          text: `Temperature below ${TEMP_LOW_F}°F in ${exc.count} of the last ${exc.n} readings — cold roots slow uptake and stall growth.`,
        },
      ]
    },
    sourceIds: ["terptalk-stage-tips", "cornell-cannabis-guidebook"],
  },
  {
    id: "env.instability",
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
      const ev: IntelEvidence[] = [
        {
          direction: "for",
          strength: exc.count >= 3 ? "moderate" : "weak",
          candidate: "ph_lockout",
          text: `pH ${ctx.series.ph.latest} is outside the ${lo}–${hi} range ${wide ? "generally used" : `for ${medium.toLowerCase().replace("_", " ")}`} — off-range pH can lock nutrients out.`,
          measurement: hint("runoffPh"),
        },
      ]
      if (!exc.latestOutside && exc.count >= 2) {
        ev.push({
          direction: "against",
          strength: "weak",
          candidate: "ph_lockout",
          text: `Latest pH (${ctx.series.ph.latest}) is back inside the ${lo}–${hi} band — the drift may already be correcting.`,
        })
      }
      // Combination: out-of-band pH alongside rising EC is a salt-
      // accumulation signature, not just a pH problem.
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
    sourceIds: ["canna-coco-ph", "cornell-cannabis-guidebook", "terptalk-stage-tips"],
  },
  {
    id: "chem.ec-drift",
    domain: "chemistry",
    kind: "risk",
    title: "EC trending upward",
    applies: (ctx) => ctx.series.ec.trend === "rising",
    evaluate: (ctx) => [
      {
        direction: "for",
        strength: "weak",
        candidate: "salt_buildup",
        text: `EC is trending upward across recent readings (latest ${ctx.series.ec.latest}) — climbing EC can mean salt accumulation or under-watering.`,
        measurement: hint("runoffEc"),
      },
    ],
    sourceIds: ["canna-coco-ph"],
  },
  {
    id: "chem.ec-elevated",
    domain: "chemistry",
    kind: "risk",
    title: "EC running high",
    applies: (ctx) => ctx.series.ec.n >= 3,
    evaluate: (ctx) => {
      const exc = countExcursions(ctx.series.ec.points, -Infinity, EC_ELEVATED)
      if (exc.fraction < 0.6 || exc.count < 3) return []
      return [
        {
          direction: "for",
          strength: "moderate",
          candidate: "salt_buildup",
          text: `EC above ${EC_ELEVATED} mS/cm in ${exc.count} of the last ${exc.n} readings — sustained high feed strength accumulates salts.`,
          measurement: hint("runoffEc"),
        },
      ]
    },
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
          candidate: "stunted_growth",
          text: `Height is roughly flat over ${Math.round(days)} days of veg (~${f1(rate)} cm/day) — training can mask this, but light or root issues can too.`,
          measurement: hint("ppfd"),
        },
      ]
    },
    sourceIds: ["chandra-2008-photosynthesis", "rodriguez-morrison-2021-light"],
  },
  {
    id: "data.sparse-env",
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
]

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

function scoreEvidence(evidence: IntelEvidence[]) {
  let forScore = 0
  let againstScore = 0
  let confirmed = false
  for (const e of evidence) {
    if (e.confirmed) confirmed = true
    if (e.direction === "against") againstScore += W[e.strength]
    else if (e.direction === "info") continue // neutral — never scored
    else forScore += W[e.strength]
  }
  let state: Finding["state"]
  if (!evidence.length) state = "insufficient"
  // A confirmed measured fact counts as strong support for conflict
  // detection — strong counter-evidence turns it CONFLICTING rather
  // than letting the confirmed flag mask the contradiction.
  else if (confirmed) state = againstScore >= W.strong ? "conflicting" : "confirmed"
  else if (forScore >= W.strong && againstScore >= W.strong) state = "conflicting"
  else if (forScore >= W.strong) state = "strong"
  else if (forScore >= W.weak) state = "possible"
  else state = "insufficient"
  return { state, forScore, againstScore, confirmed }
}

/** Candidate-level assessment: scoreEvidence + maxState clamp.
 *  CONFLICTING is never clamped — it's honest uncertainty, not an
 *  overclaim. CONFIRMED/STRONG clamp to the candidate's ceiling. */
export function assessCandidate(
  def: CandidateDef,
  evidence: IntelEvidence[]
): Pick<CandidateResult, "state" | "forScore" | "againstScore"> {
  const { state, forScore, againstScore } = scoreEvidence(evidence)
  if (state === "confirmed" || state === "strong") {
    return { state: STATE_RANK[state] > STATE_RANK[def.maxState] ? def.maxState : state, forScore, againstScore }
  }
  return { state, forScore, againstScore }
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
      b.supporting.length + b.opposing.length - (a.supporting.length + a.opposing.length) ||
      a.id.localeCompare(b.id)
  )
}

// ── Evaluation ──────────────────────────────────────────────────────

export function evaluateContext(ctx: GrowContextView): Diagnosis {
  const findings: Finding[] = []
  const byCandidate = new Map<string, { ruleIds: Set<string>; sourceIds: Set<string>; evidence: IntelEvidence[] }>()

  for (const rule of INTEL_RULES) {
    if (!rule.applies(ctx)) continue
    const evidence = rule.evaluate(ctx).filter((e) => e.text.trim().length > 0)
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
    if (!def) continue // orphan candidateId — validator catches this
    const { state, forScore, againstScore } = assessCandidate(def, bucket.evidence)
    const requiredMissing = def.requiredInputs.filter((m) => !measurementAvailable(ctx, m))
    candidates.push({
      id,
      name: def.name,
      domain: def.domain,
      kind: def.kind,
      severity: def.severity,
      state,
      forScore,
      againstScore,
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
      nextMeasurement: candidateNextMeasurement(def, ctx),
      sourceIds: [...bucket.sourceIds].sort(),
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
// recommend data the grower already logged.
// Tie-break: MEASUREMENT_PRIORITY order, then id — a total order.

const SCHEMA_SERIES: Partial<Record<MetricId, keyof GrowContextView["series"]>> = {
  temperature: "temperature",
  humidity: "humidity",
  ph: "ph",
  ec: "ec",
  height: "height",
  vpd: "vpdEntered",
}

export function measurementAvailable(ctx: GrowContextView, m: MetricId): boolean {
  const key = SCHEMA_SERIES[m]
  return key ? ctx.series[key].n > 0 : false
}

const priorityOf = (id: MetricId) => {
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
    .filter((m) => !measurementAvailable(ctx, m))[0]
  if (!wanted) return undefined
  return hint(wanted)
}

/** The single most uncertainty-reducing measurement across the whole
 *  diagnosis. Documented deterministic ranking, not Bayesian gain. */
export function nextUsefulMeasurement(ctx: GrowContextView, diagnosis: Diagnosis): MeasurementHint | null {
  const scores = new Map<MetricId, number>()
  const add = (m: MetricId | undefined, w: number) => {
    if (!m || measurementAvailable(ctx, m)) return
    scores.set(m, (scores.get(m) ?? 0) + w)
  }

  for (const c of diagnosis.candidates) {
    const def = CANDIDATES[c.id]
    if (!def) continue
    const w = STATE_WEIGHT[c.state]
    for (const m of def.discriminatingInputs) {
      add(m, w + (c.state === "conflicting" ? 2 : 0))
    }
    for (const m of c.requiredMissing) add(m, 1)
    for (const e of [...c.supporting, ...c.opposing, ...c.info]) add(e.measurement?.id, w)
  }
  for (const f of diagnosis.findings) {
    add(f.nextMeasurement?.id, STATE_WEIGHT[f.state])
    for (const e of f.evidence) add(e.measurement?.id, STATE_WEIGHT[f.state])
  }

  const best = [...scores.entries()].sort(
    (a, b) => b[1] - a[1] || priorityOf(a[0]) - priorityOf(b[0]) || a[0].localeCompare(b[0])
  )[0]
  return best ? hint(best[0]) : null
}

// ── Rendering ───────────────────────────────────────────────────────
// Compact block appended inside the /checkin diary block. Labels make
// the epistemics explicit: observed = logged values, calculated =
// derived, interpretation = candidate evidence, missing = what would
// help. Candidates render as warnings/assessments — never as diagnoses.

export function renderIntelLines(ctx: GrowContextView, diagnosis: Diagnosis): string[] {
  const lines: string[] = []
  const observed: string[] = []
  if (ctx.series.temperature.latest != null) observed.push(`${ctx.series.temperature.latest}°F`)
  if (ctx.series.humidity.latest != null) observed.push(`${ctx.series.humidity.latest}% RH`)
  if (ctx.series.ph.latest != null) observed.push(`pH ${ctx.series.ph.latest}`)
  if (ctx.series.ec.latest != null) observed.push(`EC ${ctx.series.ec.latest}`)
  const calculated: string[] = []
  if (ctx.series.vpdComputed.latest != null) calculated.push(`VPD ≈${ctx.series.vpdComputed.latest} kPa`)

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
  if (calculated.length) lines.push(`Calculated: ${calculated.join(" · ")} (air temp — leaf temp not logged)`)

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
    lines.push(`Assessment: ${top.name} — ${top.state.toUpperCase()}`)
  }
  if (next) lines.push(`Next useful measurement: ${next.label} — ${next.why}`)
  return lines
}
