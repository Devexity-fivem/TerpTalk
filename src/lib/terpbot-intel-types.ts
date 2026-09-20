// TerpBot intelligence — shared types.
// Pure type/constant module: imported by the calc layer, the context
// builder, the rule engine, and tests. No Prisma, no I/O.

import type { MetricPoint, SeriesStats, Trend } from "@/lib/terpbot-intel-calc"

export type { MetricPoint, SeriesStats, Trend }

// ── Measurements ────────────────────────────────────────────────────
// Schema-backed metrics plus discriminating measurements the schema
// cannot store yet — the engine may *recommend* them without pretending
// they exist as data.
export type MetricId =
  | "temperature"
  | "humidity"
  | "vpd"
  | "ph"
  | "ec"
  | "height"
  | "runoffPh"
  | "runoffEc"
  | "substrateMoisture"
  | "leafTemp"
  | "watering"
  | "ppfd"
  | "photoperiod"

/** Per-metric noise floor for trend detection — the smallest step treated
 *  as real movement. These are statistical significance epsilons, NOT
 *  horticultural thresholds; rule bands live in the rules themselves. */
export const METRIC_EPSILON: Record<string, number> = {
  temperature: 2, // °F
  humidity: 3, // % RH
  vpd: 0.15, // kPa
  ph: 0.15,
  ec: 0.2, // mS/cm
  height: 2, // cm
}

// ── Sources / provenance ────────────────────────────────────────────

export type EvidenceTier =
  | "PEER_REVIEWED"
  | "EXTENSION"
  | "GOVERNMENT"
  | "PROFESSIONAL"
  | "COMMUNITY"
  | "INTERNAL_DATA"

export interface KnowledgeSource {
  id: string
  title: string
  author: string
  publication: string
  url: string
  year: number
  tier: EvidenceTier
  /** false → general plant science; never presented as cannabis-established */
  cannabisSpecific: boolean
}

// ── Evidence & rules ────────────────────────────────────────────────

export type EvidenceDirection = "for" | "against" | "risk" | "info"
export type EvidenceStrength = "weak" | "moderate" | "strong"

/** A measurement the engine can recommend to reduce uncertainty. */
export interface MeasurementHint {
  id: MetricId
  label: string
  why: string
}

export interface IntelEvidence {
  direction: EvidenceDirection
  strength: EvidenceStrength
  /** rendered explanation line — already safe to display */
  text: string
  /** true → a directly measured fact, not an inference (→ CONFIRMED).
   *  Reserved for observations whose truth survives even if every
   *  declared/heuristic context field were wrong. */
  confirmed?: boolean
  measurement?: MeasurementHint
  /** candidate this evidence pools into. Absent → standalone finding
   *  (data-quality observations and gap signals, not hypotheses). */
  candidate?: CandidateId
}

export type FindingKind =
  | "observation" // verified measurement fact (vpd divergence)
  | "assessment" // interpretation of observed data (pH out of range)
  | "risk" // hazard condition accumulating (high RH in flower)
  | "gap" // missing data — maps to INSUFFICIENT

export type FindingState =
  | "confirmed"
  | "strong"
  | "possible"
  | "insufficient"
  | "conflicting"

export interface GrowContextView {
  // defined structurally here so the rule engine never imports Prisma
  scope: "public" | "owner"
  diary: {
    id: string
    slug: string | null
    title: string
    stage: string
    visibility: string
    startDate: Date
    harvested: boolean
    mediumType: string | null
    lightType: string | null
    growType: string
    techniques: string[]
  }
  setup: {
    present: boolean
    medium: string | null
    /** capabilities keyword-matched from setup free text — heuristic */
    capabilities: string[]
  }
  /** epoch ms the context was built at */
  now: number
  day: number
  week: number
  /** days spent in the current stage; censored when the true stage
   *  boundary predates the fetched window */
  stageDays: number
  stageStartCensored: boolean
  /** number of updates in the analysis window */
  updateCount: number
  daysSinceUpdate: number | null
  medianUpdateIntervalDays: number | null
  /** fraction of window updates carrying ≥1 env metric (0–1) */
  envCoverage: number
  series: {
    temperature: IntelSeries
    humidity: IntelSeries
    ph: IntelSeries
    ec: IntelSeries
    height: IntelSeries
    vpdEntered: IntelSeries
    /** VPD computed from temp+RH pairs — distinct from user-entered */
    vpdComputed: IntelSeries
  }
  /** latest entered−computed VPD difference, or null */
  vpdDivergence: number | null
  /** schema metrics with zero readings in the window */
  missing: MetricId[]
}

export interface IntelSeries extends SeriesStats {
  points: MetricPoint[]
  trend: Trend
}

export interface IntelRule {
  id: string
  domain: "environment" | "chemistry" | "growth" | "stage" | "data"
  kind: FindingKind
  /** finding/candidate label, e.g. "Bud-rot risk" */
  title: string
  applies: (ctx: GrowContextView) => boolean
  evaluate: (ctx: GrowContextView) => IntelEvidence[]
  sourceIds: string[]
}

export interface Finding {
  ruleId: string
  title: string
  domain: IntelRule["domain"]
  kind: FindingKind
  state: FindingState
  evidence: IntelEvidence[]
  nextMeasurement?: MeasurementHint
  sourceIds: string[]
}

// ── Diagnostic candidates ───────────────────────────────────────────
// A candidate is what evidence accumulates INTO — many rules can feed
// one candidate, and one rule can feed several. Candidates are the
// unit of multi-hypothesis reasoning; standalone Findings are reserved
// for data-quality observations and gap signals (never hypotheses).

export type CandidateId = string

/** Reuses the wizard severity vocabulary so WizardResult → CandidateDef
 *  mapping needs no second enum (Thread.wizardResultId bridge). */
export type CandidateSeverity = "urgent" | "moderate" | "watch"

export interface CandidateDef {
  /** For wizard-migrated branches this IS the wizard result id
   *  ("humidity_high") so downstream stats/validation never see a
   *  namespace change. Engine-native candidates use "<domain>.<slug>"
   *  ("env.heat-stress") or a wizard-compatible slug when a future
   *  migration target exists ("ph_lockout" ↔ "ph_drift"). */
  id: CandidateId
  domain: IntelRule["domain"]
  /** "condition" = a state of the grow; "risk" = a hazard accumulating.
   *  Risk candidates render as warnings, never as diagnoses. */
  kind: "condition" | "risk"
  name: string
  /** Why this condition happens — maps to WizardResult.cause. */
  mechanism: string
  severity: CandidateSeverity
  /** Ceiling on assessment state. Condition/risk candidates can never
   *  be CONFIRMED — only measured data-quality facts are. */
  maxState: "strong" | "possible"
  /** metrics that must have data before this candidate can rise above
   *  INSUFFICIENT */
  requiredInputs: MetricId[]
  /** measurements that separate this candidate from live rivals —
   *  feeds next-measurement selection */
  discriminatingInputs: MetricId[]
  /** interventions — surfaced only at STRONG per the uncertainty rules;
   *  below that the engine emits a measurement recommendation instead */
  recommendedActions: string[]
  sourceIds: string[]
  /** WIZARD_RESULTS key this candidate is the engine-side mirror of.
   *  Preserves Thread.wizardResultId → symptom-tag → solve-rate stats. */
  wizardResultId?: string
}

/** A candidate after evaluation — carries the full evidence trail so a
 *  future /why surface can explain for/against/missing without
 *  re-running rules. */
export interface CandidateResult {
  id: CandidateId
  name: string
  domain: IntelRule["domain"]
  kind: CandidateDef["kind"]
  severity: CandidateSeverity
  state: FindingState
  forScore: number
  againstScore: number
  /** direction for|risk — what supports this candidate */
  supporting: IntelEvidence[]
  /** direction against — what argues against it (never hidden) */
  opposing: IntelEvidence[]
  /** direction info — neutral observations, display only */
  info: IntelEvidence[]
  /** ids of every rule that contributed evidence (rulesMatched trail) */
  ruleIds: string[]
  /** requiredInputs with no data in the context */
  requiredMissing: MetricId[]
  /** most useful measurement for THIS candidate, if determinable */
  nextMeasurement?: MeasurementHint
  sourceIds: string[]
}

export interface Diagnosis {
  /** ranked hypotheses — deterministic order (see rankCandidates) */
  candidates: CandidateResult[]
  /** standalone data-quality / gap outputs (non-hypothesis) */
  findings: Finding[]
}
