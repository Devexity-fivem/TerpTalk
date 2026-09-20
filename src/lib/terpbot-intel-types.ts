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

/** Visual/physical inspections a grower can perform — recommendable as
 *  next steps exactly like measurements, but never "logged" metrics.
 *  "inspect:leaf-undersides", "inspect:sticky-cards", … */
export type InspectionId = `inspect:${string}`

/** Anything the engine can ask for next: an instrument reading or a
 *  visual inspection. requiredInputs stays MetricId-only — those mean
 *  data the schema can actually hold. */
export type NextStepId = MetricId | InspectionId

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
  id: NextStepId
  label: string
  why: string
  /** observations whose presence satisfies an inspection ask — prevents
   *  re-recommending "check leaf undersides" after webbing is reported */
  resolvedBy?: SymptomId[]
}

// ── Structured observations (reported symptoms) ─────────────────────
// Natural-language symptom reports normalized by terpbot-nl-parse into
// canonical ids. Parsing produces observations ONLY — the rule engine
// does the reasoning.

export type SymptomId =
  | "LEAF_YELLOWING" | "LEAF_PALE" | "LEAF_DARK_GREEN" | "LEAF_PURPLE_RED"
  | "STEM_PURPLE" | "BROWNING" | "BLEACHING"
  | "CLAW_DOWN" | "CURL_UP" | "CURL_UNDER" | "CRISPY" | "LIMP_SOFT"
  | "DISTORTED" | "TIP_BURN" | "LIGHT_BURN" | "SPOTS" | "RUST_SPOTS"
  | "DARK_SPOTS" | "STIPPLING" | "SILVERING" | "POWDERY" | "STICKY_RESIDUE"
  | "WEBBING" | "SLIME_TRAIL" | "HOLES" | "FUZZ_MOLD"
  | "STUNTED" | "STRETCHED" | "DROOPING" | "COLLAPSED"
  | "MEDIUM_WET" | "MEDIUM_DRY" | "OVERWATERED" | "UNDERWATERED"
  | "ENV_HOT" | "ENV_COLD" | "ENV_HUMID" | "ENV_DRY" | "WIND_BURN"
  | "ROOT_ROT" | "ROOT_BOUND" | "BUD_ROT" | "HERMIE" | "AIRY_BUDS"
  | "GRASSY_SMELL" | "STEM_SPLIT" | "NO_SPROUT" | "PH_UNSTABLE"
  | "EC_RISING" | "SALT_CRUST"
  | "PEST_MITES" | "PEST_MITES_OTHER" | "PEST_APHIDS" | "PEST_THRIPS"
  | "PEST_FUNGUS_GNATS" | "PEST_WHITEFLIES" | "PEST_CATERPILLARS"
  | "PEST_SLUGS" | "PEST_GENERIC"

export type LocationId =
  | "LOWER_OLD" | "UPPER_NEW" | "LEAF_TIPS" | "LEAF_MARGINS" | "VEINS"
  | "INTERVEINAL" | "STEMS" | "BUDS" | "SUGAR_LEAVES" | "ROOTS"
  | "UNDERSIDE" | "COTYLEDONS" | "BASE" | "WHOLE_PLANT"

export interface StructuredObservation {
  symptom: SymptomId
  location?: LocationId
  /** utterance-claimed stage; falls back to ctx.diary.stage in rules */
  stage?: string
  /** utterance-claimed period — "NIGHT" | "LIGHTS_ON" | "LIGHTS_OFF".
   *  Matters because some symptoms are normal in a period (nyctinasty) */
  period?: string
  /** epoch ms of the report (update createdAt / mention time) */
  t: number
  source: "nl" | "diary-text"
  /** diaryUpdate id — provenance for a future /why; never rendered */
  refId?: string
  /** wizard result ids this observation supports (after refinement) */
  feeds: string[]
  /** how the feeds list was derived — "refined" means a location or
   *  stage discriminator fired, so the match carries more weight */
  refined?: boolean
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
  /** normalized symptom reports parsed from diary update text —
   *  [] when no parseable symptom was reported. Observations only;
   *  the rule engine does the reasoning. */
  observations: StructuredObservation[]
}

export interface IntelSeries extends SeriesStats {
  points: MetricPoint[]
  trend: Trend
}

export interface IntelRule {
  id: string
  domain:
    | "environment" | "chemistry" | "growth" | "stage" | "data"
    | "nutrition" | "pest" | "disease" | "watering"
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
   *  POSSIBLE — the engine clamps state when any are missing */
  requiredInputs: MetricId[]
  /** measurements or inspections that separate this candidate from
   *  live rivals — feeds next-step selection */
  discriminatingInputs: NextStepId[]
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
