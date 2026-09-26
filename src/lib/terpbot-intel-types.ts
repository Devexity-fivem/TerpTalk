// TerpBot intelligence — shared types.
// Pure type/constant module: imported by the calc layer, the context
// builder, the rule engine, and tests. No Prisma, no I/O.

import type {
  BaselineTier,
  ChangeResult,
  MetricBaseline,
  MetricPoint,
  SeriesStats,
  Trend,
} from "@/lib/terpbot-intel-calc"

export type { BaselineTier, ChangeResult, MetricBaseline, MetricPoint, SeriesStats, Trend }

// ── Measurements ────────────────────────────────────────────────────
// Schema-backed metrics plus discriminating measurements the schema
// cannot store yet — the engine may *recommend* them without pretending
// they exist as data.
export const METRIC_IDS = [
  "temperature",
  "humidity",
  "vpd",
  "ph",
  "ec",
  "height",
  "runoffPh",
  "runoffEc",
  "substrateMoisture",
  "leafTemp",
  "watering",
  "ppfd",
  "photoperiod",
] as const

export type MetricId = (typeof METRIC_IDS)[number]

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
  watering: 0.5, // L
  ppfd: 50, // µmol/m²/s — canopy readings vary by tens
  photoperiod: 0.5, // hours
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

// ── Strain context ──────────────────────────────────────────────────
// Normalized catalog facts for a diary's linked strain. Loaded once in
// buildGrowContext via the structured strainRef relation — rules read
// this object, never Prisma. Every field is a stored catalog value
// (breeder/database/community-derived, docs/data/strain-research.md) —
// an expectation, never a verdict; null means "not reliably reported".

export interface StrainGrowContext {
  strainId: string
  name: string
  genetics: string | null
  /** STRAIN_TYPES vocab — AUTO_FLOWER suppresses photoperiod-flip
   *  guidance: the plant transitions on age, not a light-cycle change */
  type: string | null
  /** catalog-reported flowering estimate — bounds stage-duration
   *  expectations; never becomes an exact harvest date */
  floweringWeeks: number | null
  /** AUTO_FLOWER seed-to-harvest estimate — the whole lifecycle clock for
   *  autos, where floweringWeeks deliberately stays null */
  seedToHarvestWeeks: number | null
  /** EASY | NORMAL | HARD — catalog cultivation difficulty */
  difficulty: string | null
}

// ── Experiment context ──────────────────────────────────────────────
// A documented GrowExperiment row normalized for the intelligence
// layer. Grower-declared records — "I changed X, watching Y" — internal
// data, never horticultural truth: `expected` is the grower's own words
// and is never parsed into metrics or treated as a verified outcome.
// Visibility follows the diary row itself: an experiment enters a
// context only when buildGrowContext already resolved that diary under
// the caller's scope (same boundary as the updates it links to).

export interface ExperimentRef {
  id: string
  /** grower-authored title — sanitize before rendering in bot output */
  title: string
  /** EXPERIMENT_CATEGORIES vocab (src/lib/experiments.ts) */
  category: string
  /** EXPERIMENT_STATUSES vocab: PLANNED|ACTIVE|OBSERVING|COMPLETED|ABANDONED */
  status: string
  /** grower-stated expectation — display only, never metric-inferred */
  expected: string | null
  /** epoch ms of the declared change (schema: non-null) */
  startedAt: number
  /** epoch ms — set for COMPLETED/ABANDONED */
  endedAt: number | null
  /** diary updates explicitly tagged to this experiment */
  updateCount: number
  /** epoch ms of the newest tagged update — drives follow-up logic */
  latestUpdateAt: number | null
}

/** Grower-authored text is untrusted output — same stripping contract
 *  as terpbot.ts's sanitizeEcho, kept in this pure module so context
 *  builders and rules can sanitize without importing the Prisma-coupled
 *  bot layer: no line breaks, no URLs/domains, no markdown or mention
 *  syntax. Bot output bypasses enforceLinkTrust, so echoed text must
 *  never smuggle a link. */
export function safeGrowerText(text: string, max = 60): string {
  const t = text
    .replace(/[\r\n]+/g, " ")
    .replace(/(?:https?:\/\/|www\.)\S*/gi, "")
    .replace(/\b[a-z0-9-]+\.[a-z]{2,}\b/gi, "")
    .replace(/[[\]()*`<>@\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
  return t.length > max ? t.slice(0, max) : t
}

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

export const SYMPTOM_IDS = [
  "LEAF_YELLOWING", "LEAF_PALE", "LEAF_DARK_GREEN", "LEAF_PURPLE_RED",
  "STEM_PURPLE", "BROWNING", "BLEACHING",
  "CLAW_DOWN", "CURL_UP", "CURL_UNDER", "CRISPY", "LIMP_SOFT",
  "DISTORTED", "TIP_BURN", "LIGHT_BURN", "SPOTS", "RUST_SPOTS",
  "DARK_SPOTS", "STIPPLING", "SILVERING", "POWDERY", "STICKY_RESIDUE",
  "WEBBING", "SLIME_TRAIL", "HOLES", "FUZZ_MOLD",
  "STUNTED", "STRETCHED", "DROOPING", "COLLAPSED",
  "MEDIUM_WET", "MEDIUM_DRY", "OVERWATERED", "UNDERWATERED",
  "ENV_HOT", "ENV_COLD", "ENV_HUMID", "ENV_DRY", "WIND_BURN",
  "ROOT_ROT", "ROOT_BOUND", "BUD_ROT", "HERMIE", "AIRY_BUDS",
  "GRASSY_SMELL", "STEM_SPLIT", "NO_SPROUT", "PH_UNSTABLE",
  "EC_RISING", "SALT_CRUST",
  "PEST_MITES", "PEST_MITES_OTHER", "PEST_APHIDS", "PEST_THRIPS",
  "PEST_FUNGUS_GNATS", "PEST_WHITEFLIES", "PEST_CATERPILLARS",
  "PEST_SLUGS", "PEST_GENERIC",
] as const

export type SymptomId = (typeof SYMPTOM_IDS)[number]

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
  /** epoch ms of the EVENT — update createdAt for diary-text
   *  observations; resolved event time for session observations */
  t: number
  /** timestamp is an unbounded approximation ("a while back") —
   *  historical context only, never a "current" claim */
  tApproximate?: boolean
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
  /** the underlying signal this evidence is derived from; evidence
   *  sharing a signal is correlated, not independent. Stamped by
   *  evaluateContext from the emitting rule when unset. */
  signal?: string
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
  /** normalized catalog strain linked via diary.strainId — null when no
   *  structured link exists (free-text strain names are never matched).
   *  Visibility: it only enters a context the diary's own scope already
   *  permitted — public catalog fields, owner-scoped association. */
  strain: StrainGrowContext | null
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
  /** stage boundaries detected within the analysis window plus the
   *  boundary into the current stage (censored when it predates the
   *  window). Ordered by time. Diary-derived provenance — never a
   *  user claim. */
  stageTransitions: StageTransition[]
  /** number of updates in the analysis window */
  updateCount: number
  daysSinceUpdate: number | null
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
    /** runoff measurements — structured DiaryUpdate columns preferred,
     *  falling back to parsed diary feeding/content text; session-reported
     *  points still merge at query time */
    runoffPh: IntelSeries
    runoffEc: IntelSeries
    /** liters applied per update — schema-backed (wateringLiters) */
    watering: IntelSeries
    /** µmol/m²/s at canopy — schema-backed (ppfd) */
    ppfd: IntelSeries
    /** lights-on hours per day — schema-backed (photoperiodHours) */
    photoperiod: IntelSeries
  }
  /** latest entered−computed VPD difference, or null */
  vpdDivergence: number | null
  /** schema metrics with zero readings in the window */
  missing: MetricId[]
  /** age in days of each series' latest point, measured from `now` —
   *  present only for series with n > 0 */
  freshness: Partial<Record<MetricId, number>>
  /** user-reported values that couldn't be accepted unambiguously
   *  (unit or scale unclear) — surfaced so the response can ask */
  unresolved?: ReportedPoint[]
  /** normalized symptom reports parsed from diary update text —
   *  [] when no parseable symptom was reported. Observations only;
   *  the rule engine does the reasoning. */
  observations: StructuredObservation[]
  /** per-metric personal baselines — logged provenance only, derived
   *  on read. Detects change-vs-own-norm; never asserts correctness. */
  baselines: Partial<Record<MetricId, MetricBaseline>>
  /** grower resolution/progression claims (diary text + session),
   *  canonical ids only — feeds episode derivation */
  resolutions?: ResolutionClaim[]
  /** grower-reported adjustments from the session AND documented
   *  experiments (ACTIVE/OBSERVING → `experiment:<id>` records) —
   *  evaluated against the series, never fed as measurements */
  interventions?: InterventionRecord[]
  /** documented experiments on this diary — grower-declared change
   *  records. [] when none exist. Same diary scope as the row itself. */
  experiments: ExperimentRef[]
  /** derived per (symptom, location) episode status — computed at
   *  evaluateContext time, never persisted */
  episodes?: SymptomEpisode[]
}

/** A grower's claim that a symptom resolved/improved/worsened/stabilized —
 *  never raw text; produced by the parser's negation/progression harvest. */
export interface ResolutionClaim {
  /** the symptom the claim refers to — undefined for unscoped claims
   *  ("looking better") which apply to the most recent active episode */
  symptom?: SymptomId
  location?: LocationId
  kind: "resolved" | "improving" | "stable" | "worsening"
  /** epoch ms of the claim event */
  t: number
  source: "nl" | "diary-text"
  /** diary attribution for session-persisted claims — same contract as
   *  ReportedPoint.diaryId; diary-text claims carry their own diary */
  diaryId?: string
}

export type EpisodeStatus = "active" | "stable" | "improving" | "resolved" | "recurred"

export interface SymptomEpisode {
  symptom: SymptomId
  location?: LocationId
  firstSeen: number
  lastSeen: number
  status: EpisodeStatus
  /** epoch ms the status last changed */
  statusAt: number
  /** 1 on first occurrence; +1 per resolved→recurred cycle */
  episodeCount: number
  lastResolvedAt?: number
  /** the newest report is an unbounded approximation ("a while back") —
   *  the episode is real history, not a current sighting */
  approximate?: boolean
}

/** A grower-reported adjustment — structured intent, never raw text.
 *  Persisted in session state; evaluated against later series points. */
export interface InterventionRecord {
  /** canonical intervention id from the vocab table ("RH_DOWN", …) */
  type: string
  /** epoch ms of the report */
  at: number
  /** resolved event time ("lowered rh yesterday") — same contract as
   *  ReportedPoint.eventT */
  eventT?: number
  pastUnresolved?: boolean
  /** intended direction of the adjustment */
  direction?: "up" | "down"
  /** the metric it targets when one exists */
  targetMetric?: MetricId
  /** claimed setpoint — NOT a reading; "lowered rh to 50" */
  setpoint?: { value: number; unit?: string }
  /** newest non-approximate series point ≤ eventT at capture time —
   *  the honest "before"; absent when nothing was logged */
  beforeReading?: { v: number; t: number }
  /** diary attribution — same contract as ReportedPoint.diaryId */
  diaryId?: string
  /** display name for non-chat interventions — documented experiments
   *  carry their pre-sanitized title so renderers can name the record
   *  instead of printing the raw `type` id */
  label?: string
}

export interface IntelSeries extends SeriesStats {
  points: MetricPoint[]
  trend: Trend
  /** median(recent) − median(earlier), epsilon-gated — the grow's own
   *  baseline-relative movement. Absent on hand-built series. */
  change?: ChangeResult
}

// ── Grow timeline ───────────────────────────────────────────────────
// Derived-on-read chronology — DiaryUpdate rows are editable, so the
// timeline is rebuilt from source rows every time and never persisted.
// Events carry references + canonical scalars only (no raw text).

export type TimelineEventKind =
  | "grow-start"
  | "stage-change"
  | "env-reading"
  | "measurement"
  | "feeding"
  | "training"
  | "symptom"
  | "photo"
  | "harvest"
  | "completed"

export interface GrowTimelineEvent {
  /** deterministic id: "<kind>:<refId>" ("<kind>:diary:<diaryId>" for
   *  diary-level events) — stable across rebuilds */
  id: string
  kind: TimelineEventKind
  /** epoch ms — update createdAt / diary startDate / harvestedAt.
   *  Never dayNumber/weekNumber (user annotations are untrusted). */
  t: number
  refId: string
  refModel: "DiaryUpdate" | "GrowDiary"
  /** canonical stage id the event occurred under */
  stage?: string
  /** canonical scalars only — metric ids/values, symptom ids, counts */
  data?: Record<string, number | string | boolean>
}

/** A detected stage boundary. `censored` marks a transition whose exact
 *  time predates the fetched window — the boundary is real but `t` is a
 *  lower bound, not a fact. */
export interface StageTransition {
  from: string
  to: string
  /** epoch ms of the first update at the new stage (or the boundary
   *  estimate for censored transitions) */
  t: number
  censored?: boolean
}

/** Rule-level signal ids — the shared underlying signal everything a
 *  rule emits derives from. Evidence grouping keys on this so several
 *  rules reading the SAME series can't stack as independent support. */
export const SIGNAL_IDS = [
  "humidity",
  "temperature",
  "env:temp-rh",
  "ph",
  "ec",
  "chem:ph-ec",
  "height",
  "runoff",
  "stage",
  "data",
] as const

export type SignalId = (typeof SIGNAL_IDS)[number]

/** Readings older than this no longer firm up a candidate on their own —
 *  STRONG/CONFIRMED clamps to POSSIBLE until something fresh arrives. */
export const STALE_DAYS = 10

/** Which metric series feed each signal — used for the stale-evidence
 *  clamp. `symptom:*` signals use the observation age instead; stage/data
 *  signals are never stale. */
export const SIGNAL_METRICS: Record<SignalId, MetricId[]> = {
  humidity: ["humidity"],
  temperature: ["temperature"],
  "env:temp-rh": ["temperature", "humidity"],
  ph: ["ph"],
  ec: ["ec"],
  "chem:ph-ec": ["ph", "ec"],
  height: ["height"],
  runoff: ["runoffEc", "runoffPh"],
  stage: [],
  data: [],
}

export interface IntelRule {
  id: string
  domain:
    | "environment" | "chemistry" | "growth" | "stage" | "data"
    | "nutrition" | "pest" | "disease" | "watering" | "postharvest"
  kind: FindingKind
  /** finding/candidate label, e.g. "Bud-rot risk" */
  title: string
  /** default signal for everything the rule emits — evaluateContext
   *  stamps it onto evidence that doesn't declare its own (symptom
   *  rules stamp per-observation `symptom:<id>` signals instead). */
  signal?: SignalId
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
  /** support score: Σ max-weights over `for` signal groups + Σ
   *  max-weights over `risk` signal groups (risk capped at weak for
   *  condition candidates — predisposition is never proof). */
  forScore: number
  againstScore: number
  /** number of distinct (for|risk) signal groups — how many INDEPENDENT
   *  signals support this candidate (correlated rules collapse to 1) */
  independentSignals: number
  /** per-signal evidence breakdown — the /why trail: which underlying
   *  signals supported or opposed, and at what weight */
  signals: { signal: string; direction: "for" | "risk" | "against"; weight: number }[]
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
  /** set when STRONG/CONFIRMED was clamped to POSSIBLE because every
   *  supporting signal rests on readings ≥ STALE_DAYS old */
  stale?: boolean
}

export interface Diagnosis {
  /** ranked hypotheses — deterministic order (see rankCandidates) */
  candidates: CandidateResult[]
  /** standalone data-quality / gap outputs (non-hypothesis) */
  findings: Finding[]
}

// ── Session state + /why trail ──────────────────────────────────────
// Persisted on BotSession.state (Json). PRIVACY: no raw message text,
// no spans, no refIds, no room ids — only structured values and the
// already-render-safe evidence texts.

/** a value the grower told the bot in chat */
export interface ReportedPoint {
  metric: MetricId
  value: number
  unit?: string
  /** epoch ms of the report — when the grower TOLD us */
  t: number
  /** epoch ms of the EVENT, when a recency phrase resolved one
   *  ("runoff EC was 2.1 two weeks ago"). Absent → the report is
   *  treated as current. Never invented — unresolved timing leaves
   *  this unset. */
  eventT?: number
  /** clearly-historical but unbounded ("a while back") — merges at
   *  report time but is excluded from every "current reading" path */
  pastUnresolved?: boolean
  /** diary this report was attributed to at write time (Phase I) —
   *  internal routing only, never rendered. Absent on legacy records:
   *  those merge onto any diary (24h session TTL bounds the window). */
  diaryId?: string
}

/** a symptom the grower reported in chat — no provenance back to the
 *  message it came from */
export interface SessionObservation {
  symptom: SymptomId
  location?: LocationId
  stage?: string
  period?: string
  t: number
  /** epoch ms of the EVENT when the report carried a resolvable
   *  recency phrase — same contract as ReportedPoint.eventT */
  eventT?: number
  /** clearly-historical but unbounded — merges as an old approximate
   *  point, never a current observation */
  pastUnresolved?: boolean
  /** diary attribution — same contract as ReportedPoint.diaryId */
  diaryId?: string
}

export interface SessionState {
  reported: ReportedPoint[]
  observations: SessionObservation[]
  /** canonical stage id the grower claimed in chat ("week 3 flower"),
   *  when no public diary supplies one — newest wins */
  stage?: string
  trail?: WhyTrail
  /** grower-reported adjustments — bounded, canonical ids only */
  interventions?: InterventionRecord[]
  /** grower resolution/progression claims — bounded */
  resolutions?: (Omit<ResolutionClaim, "source">)[]
  /** compact snapshot of the last status render — the diff base for
   *  /changes. Canonical ids + numbers + one timestamp only. */
  snapshot?: SessionSnapshot
}

/** What /changes diffs against — written at each /checkin//status.
 *  Bounded: latest-per-metric + symptom ids + stage + counts. */
export interface SessionSnapshot {
  at: number
  stage: string
  updateCount: number
  latest: Partial<Record<MetricId, number>>
  /** distinct active symptom ids at snapshot time */
  symptoms: SymptomId[]
  /** top candidate at snapshot time, if any */
  topCandidate?: { id: string; state: FindingState }
  /** metrics with no data at snapshot time — the gap set that lets a
   *  later BOT_ASSIST notice when fresh evidence closes one */
  missing?: MetricId[]
  /** the diary this snapshot describes — gap-fill assists must not
   *  apply a snapshot taken on one grow to another */
  diaryId?: string
}

// ── Next-action engine ──────────────────────────────────────────────

export type ActionClass =
  | "MEASURE" // instrument reading that reduces uncertainty
  | "OBSERVE" // visual check or stage claim
  | "COMPARE" // resolve a CONFLICTING pair / provenance disagreement
  | "WAIT" // evidence says do nothing — time is the discriminator
  | "VERIFY" // re-measure stale/conflicting data
  | "ADJUST" // whitelisted low-risk intervention at strong evidence
  | "LOG" // diary upkeep — coverage/freshness, not a diagnosis

export type RiskTier = "none" | "low" | "medium" | "never"

export interface ActionRequest {
  actionClass: ActionClass
  /** MEASURE/OBSERVE/COMPARE/VERIFY target */
  stepId?: NextStepId
  /** ADJUST — verbatim from CandidateDef.recommendedActions */
  actionText?: string
  /** every candidate this step discriminates/unblocks */
  candidateIds: CandidateId[]
  /** rule ids of contributing standalone findings */
  findingIds?: string[]
  /** render-safe reason line */
  reason: string
  /** live rivals this step separates */
  discriminates: CandidateId[]
  /** state of the best candidate this action serves */
  confidence: FindingState
  riskTier: RiskTier
  /** explainable factor breakdown — every contributor named, never an
   *  opaque score */
  factors: {
    stateWeight: number
    unblocksRequired: boolean
    resolvesConflict: boolean
    refreshesStale: boolean
    evidenceHints: number
    priorityIndex: number
  }
}

/** The persisted explanation — enough to answer "why did you say
 *  that" for 24h without storing a diagnosis snapshot of everything. */
export interface WhyTrail {
  knowledgeVersion: string
  /** epoch ms the diagnosis was produced */
  at: number
  /** null when reasoning ran without a public diary */
  diaryTitle: string | null
  basis: {
    logged: number
    reported: number
    observations: number
    /** days since the newest logged/merged point; null when no data */
    staleDays: number | null
    /** stage timing was estimated (stage boundary predates the window) */
    stageEstimated?: boolean
  }
  candidates: {
    id: string
    name: string
    kind: "condition" | "risk"
    state: FindingState
    independentSignals: number
    signals: {
      signal: string
      direction: "for" | "risk" | "against"
      weight: number
      /** OBSERVED = a measurement or reported symptom; DERIVED = a value
       *  calculated from measurements (VPD, dew point, pH+EC pairs);
       *  INFERRED = an engine judgment about data/context, not a reading */
      evidenceClass: "observed" | "derived" | "inferred"
      /** age of the newest underlying point in days — historical
       *  evidence is labeled, never hidden */
      ageDays?: number
      /** the rendered evidence text — already safe to display */
      text: string
    }[]
    opposing: string[]
    /** direction-info lines (in-band readings, honest caveats) — capped
     *  at 1, rendered as context, never scored */
    info?: string[]
    requiredMissing: MetricId[]
    next?: MeasurementHint
    sourceIds: string[]
    /** stale-clamped — every supporting signal rests on old readings */
    stale?: boolean
  }[]
  findings: { title: string; state: FindingState; text: string }[]
  next?: MeasurementHint
  /** longitudinal state at trail time — canonical ids + scalars only */
  longitudinal?: {
    /** metric shifts vs the grower's own baseline (bounded: 3) */
    changes: { metric: MetricId; direction: "up" | "down"; delta: number; durationDays: number | null }[]
    /** non-active episode states (bounded: 3) — resolved/improving/recurred */
    episodes: { symptom: SymptomId; status: EpisodeStatus; lastSeenDaysAgo: number }[]
    /** interventions awaiting an after-reading (bounded: 2) */
    pendingInterventions: { type: string; targetMetric?: MetricId; daysAgo: number; label?: string }[]
    /** the chosen next action — the canonical decision class + target,
     *  matching /next and /check (MONITOR is a decision-layer class) */
    action?: { class: ActionClass | "MONITOR"; stepId?: NextStepId; reason: string }
  }
}
