// TerpBot intelligence — Grow Intelligence Snapshot (Phase I).
//
// The single deterministic derivation every surface reads: /status,
// /plan, /check, /measurements, the /why trail, and the BOT_ASSIST scan
// all consume this object instead of re-deriving stage, readings,
// baselines, targets, capabilities, episodes, and actions separately.
// One source of truth; different renderers.
//
// Built FROM an already-assembled GrowContextView — no I/O, no Prisma,
// no second DB pass. Everything here is canonical: enum ids, metric
// ids, counts, timestamps. Raw setup free text NEVER enters the
// snapshot (ctx.setup.medium is user text — deliberately not carried).
//
// Provenance discipline:
//   observed  — series points (logged columns or merged reports)
//   derived   — computed values (VPD from temp+RH)
//   declared  — structured diary/setup enums and keyword capability ids
//   inferred  — candidates/findings, always with an evidence state
//   unknown   — missing data stays missing; nothing is fabricated

import {
  evaluateContext,
  nextActions,
  EC_FLOOR,
  PH_BANDS,
  PH_BAND_UNKNOWN,
  RH_BANDS,
  TEMP_BANDS,
  TEMP_BAND_DEFAULT,
  VPD_BANDS,
} from "@/lib/terpbot-intel"
import {
  adjustCapabilities,
  stepCapability,
  type AdjustCapability,
  type StepCapability,
  type StepFeasibility,
} from "@/lib/terpbot-intel-capability"
import { REPORTABLE_METRICS } from "@/lib/terpbot-intel-merge"
import { episodesFromObservations } from "@/lib/terpbot-intel-episodes"
import { STALE_DAYS } from "@/lib/terpbot-intel-types"
import type {
  ActionRequest,
  BaselineTier,
  Diagnosis,
  EpisodeStatus,
  GrowContextView,
  IntelSeries,
  InterventionRecord,
  MetricId,
  SymptomId,
  Trend,
} from "@/lib/terpbot-intel-types"

const DAY_MS = 86400000

const GROWTH_STAGES = new Set(["GERMINATION", "SEEDLING", "VEGETATIVE", "FLOWER"])
const POST_HARVEST_STAGES = new Set(["HARVEST", "DRYING", "CURING", "COMPLETED"])

// ── Reading rows ────────────────────────────────────────────────────
// One row per canonical metric the engine can reason over. Order is
// fixed — snapshot output is byte-identical for identical context.

const READING_ORDER: { metric: MetricId; series: keyof GrowContextView["series"] }[] = [
  { metric: "temperature", series: "temperature" },
  { metric: "humidity", series: "humidity" },
  { metric: "vpd", series: "vpdEntered" },
  { metric: "ph", series: "ph" },
  { metric: "ec", series: "ec" },
  { metric: "runoffPh", series: "runoffPh" },
  { metric: "runoffEc", series: "runoffEc" },
  { metric: "height", series: "height" },
]

export interface SnapshotReading {
  metric: MetricId
  /** newest event-time value — never fabricated */
  value: number
  n: number
  ageDays: number
  provenance: "logged" | "user-reported" | "derived"
  /** newest real point ≥ STALE_DAYS old */
  stale: boolean
  trend: Trend
  /** epsilon-gated movement vs the grow's own earlier level — a
   *  comparison reference, never a correctness claim */
  changeDirection: "up" | "down" | null
  changeDelta: number | null
  baseline: { lo: number; hi: number; tier: BaselineTier } | null
  /** resolved stage/medium band this reading is checked against —
   *  null when no band exists (unknown medium pH, runoff, height) */
  band: [number, number] | null
  /** null when no band — "in range" is never claimed without one */
  inBand: boolean | null
  feasibility: StepFeasibility
}

export interface SnapshotTargets {
  temperature: [number, number]
  humidity: [number, number] | null
  vpd: [number, number] | null
  ph: [number, number] | null
  /** false when mediumType is unset/outside the band table — the pH
   *  band shown is then the generic safe window, not a medium fact */
  phBandKnown: boolean
  ecFloor: number | null
}

export interface SetupIntel {
  /** a GrowSetup row is linked (capabilities may still be empty) */
  present: boolean
  /** declared enum facts — safe canonical labels */
  mediumType: string | null
  lightType: string | null
  growType: string
  techniques: string[]
  /** keyword capability ids from setup free text — heuristic claims */
  controls: string[]
  /** what the grow can plausibly adjust — heuristic/structural */
  adjusts: AdjustCapability[]
}

export interface SnapshotEpisode {
  symptom: SymptomId
  location?: string
  status: EpisodeStatus
  ageDays: number
  episodeCount: number
  approximate?: boolean
}

export interface SnapshotIntervention {
  type: string
  targetMetric?: MetricId
  ageDays: number
  /** no real series point landed on the target after the event */
  pending: boolean
}

export interface GrowIntelligenceSnapshot {
  at: number
  scope: "public" | "owner"
  /** false when reasoning runs on session evidence alone */
  diaryLinked: boolean
  /** effective stage for playbook selection — a harvested diary still
   *  showing a growth stage resolves to HARVEST (the run is over;
   *  post-harvest stages pass through unchanged) */
  stage: string
  /** the diary's declared stage, unmodified */
  declaredStage: string
  harvested: boolean
  stageDays: number
  stageCensored: boolean
  day: number
  week: number
  lastTransition: { from: string; to: string; t: number; censored: boolean } | null
  updateCount: number
  daysSinceUpdate: number | null
  envCoverage: number
  targets: SnapshotTargets
  /** fixed canonical order — one row per metric WITH data */
  readings: SnapshotReading[]
  /** reportable metrics with zero data — excludes structurally-
   *  inapplicable metrics (DWC runoff is not "missing", it's N/A) */
  missingReportable: MetricId[]
  /** reportable metrics whose capability evidence is only "unknown" —
   *  the honest "I can't tell whether you can measure this" list */
  capabilityUnknown: MetricId[]
  /** count only — unresolved reported values are never rendered raw */
  unresolvedCount: number
  episodes: SnapshotEpisode[]
  interventions: SnapshotIntervention[]
  diagnosis: Diagnosis
  /** ranked action list from the action engine (≤4) */
  actions: ActionRequest[]
  nextStep: ActionRequest | null
  /** capability evidence for every askable step — fixed order */
  capabilities: StepCapability[]
  setup: SetupIntel
}

function bandFor(metric: MetricId, stage: string, mediumType: string | null): [number, number] | null {
  switch (metric) {
    case "temperature": return TEMP_BANDS[stage] ?? TEMP_BAND_DEFAULT
    case "humidity": return RH_BANDS[stage] ?? null
    case "vpd": return VPD_BANDS[stage] ?? null
    case "ph": return mediumType ? (PH_BANDS[mediumType] ?? PH_BAND_UNKNOWN) : null
    default: return null
  }
}

function readingRow(
  ctx: GrowContextView,
  metric: MetricId,
  series: IntelSeries,
  /** "auto" reads provenance off the newest real point */
  provenance: SnapshotReading["provenance"] | "auto",
  stage: string
): SnapshotReading | null {
  if (!series.n || series.latest == null) return null
  const realPoints = series.points.filter((p) => !p.tApproximate)
  const newest = realPoints[realPoints.length - 1]
  // An approximate-only series (a vague "was about X a while back" chat
  // claim parked at an estimated time) must never render as a fresh
  // logged reading — it's user-reported and stale by definition.
  const approxOnly = !newest
  const anchor = newest ?? series.points[series.points.length - 1]
  const prov: SnapshotReading["provenance"] =
    provenance === "auto"
      ? approxOnly || newest!.provenance === "user-reported" ? "user-reported" : "logged"
      : provenance
  const ageDays = anchor ? Math.max(0, Math.floor((ctx.now - anchor.t) / DAY_MS)) : 0
  const band = bandFor(metric, stage, ctx.diary.mediumType)
  const value = newest?.v ?? series.latest
  const ch = series.change
  const b = ctx.baselines[metric]
  return {
    metric,
    value,
    n: series.n,
    ageDays,
    provenance: prov,
    stale: approxOnly || ageDays >= STALE_DAYS,
    trend: series.trend,
    changeDirection:
      ch && (ch.direction === "up" || ch.direction === "down") && ch.vsBaselineDelta != null
        ? ch.direction
        : null,
    changeDelta:
      ch && (ch.direction === "up" || ch.direction === "down") ? ch.vsBaselineDelta : null,
    baseline: b && b.tier !== "insufficient" && b.lo != null && b.hi != null
      ? { lo: b.lo, hi: b.hi, tier: b.tier }
      : null,
    band,
    inBand: band ? value >= band[0] && value <= band[1] : null,
    feasibility: stepCapability(ctx, metric).feasibility,
  }
}

/** VPD row prefers the grower-entered series; falls back to the
 *  computed series marked "derived" — never merges the two silently. */
function vpdRow(ctx: GrowContextView, stage: string): SnapshotReading | null {
  return (
    readingRow(ctx, "vpd", ctx.series.vpdEntered, "auto", stage) ??
    readingRow(ctx, "vpd", ctx.series.vpdComputed, "derived", stage)
  )
}

/** pending = intervention ≤7d old with no real after-reading on its
 *  target series — same contract as the action engine's WAIT class. */
function interventionPending(ctx: GrowContextView, iv: InterventionRecord): boolean {
  if (!iv.targetMetric) return false
  const key = ({
    temperature: "temperature", humidity: "humidity", ph: "ph", ec: "ec",
    height: "height", vpd: "vpdEntered", runoffPh: "runoffPh", runoffEc: "runoffEc",
  } as Partial<Record<MetricId, keyof GrowContextView["series"]>>)[iv.targetMetric]
  if (!key) return false
  const at = iv.eventT ?? iv.at
  return (
    (ctx.now - at) / DAY_MS <= 7 &&
    !ctx.series[key].points.some((p) => !p.tApproximate && p.t > at)
  )
}

/** Build the shared snapshot. Deterministic: identical context →
 *  identical snapshot. Costs zero DB queries — derives from the
 *  already-bounded context view. */
export function buildSnapshot(ctx: GrowContextView): GrowIntelligenceSnapshot {
  const diagnosis = evaluateContext(ctx)
  const actions = nextActions(ctx, diagnosis)

  const declaredStage = ctx.diary.stage
  const stage =
    ctx.diary.harvested && !POST_HARVEST_STAGES.has(declaredStage)
      ? "HARVEST"
      : declaredStage

  const readings: SnapshotReading[] = []
  for (const { metric, series } of READING_ORDER) {
    const row =
      metric === "vpd"
        ? vpdRow(ctx, stage)
        : readingRow(ctx, metric, ctx.series[series], "auto", stage)
    if (row) readings.push(row)
  }

  const capabilities: StepCapability[] = [
    ...[...REPORTABLE_METRICS].map((m) => stepCapability(ctx, m)),
    ...[
      "inspect:leaf-undersides", "inspect:sticky-cards", "inspect:roots",
      "inspect:bud-interior", "inspect:leaf-pattern", "inspect:stem-base",
      "inspect:trichomes", "inspect:leaf-surfaces", "inspect:flowers",
      "inspect:canopy-tops",
    ].map((id) => stepCapability(ctx, id as `inspect:${string}`)),
  ]

  const missingReportable = ctx.missing.filter(
    (m) => REPORTABLE_METRICS.has(m) && stepCapability(ctx, m).feasibility !== "excluded"
  )
  const capabilityUnknown = [...REPORTABLE_METRICS].filter(
    (m) => stepCapability(ctx, m).feasibility === "unknown"
  )

  const episodes = (ctx.episodes ?? episodesFromObservations(ctx.observations, ctx.resolutions ?? []))
    .slice()
    .sort((a, b) => {
      const rank = (e: { status: EpisodeStatus }) =>
        e.status === "recurred" ? 0 : e.status === "active" ? 1 : 2
      return rank(a) - rank(b) || b.lastSeen - a.lastSeen
    })
    .slice(0, 4)
    .map((e) => ({
      symptom: e.symptom,
      location: e.location,
      status: e.status,
      ageDays: Math.max(0, Math.floor((ctx.now - e.firstSeen) / DAY_MS)),
      episodeCount: e.episodeCount,
      approximate: e.approximate,
    }))

  const lastTr = ctx.stageTransitions[ctx.stageTransitions.length - 1]

  return {
    at: ctx.now,
    scope: ctx.scope,
    diaryLinked: !!ctx.diary.id,
    stage,
    declaredStage,
    harvested: ctx.diary.harvested,
    stageDays: ctx.stageDays,
    stageCensored: ctx.stageStartCensored,
    day: ctx.day,
    week: ctx.week,
    lastTransition: lastTr
      ? { from: lastTr.from, to: lastTr.to, t: lastTr.t, censored: !!lastTr.censored }
      : null,
    updateCount: ctx.updateCount,
    daysSinceUpdate: ctx.daysSinceUpdate,
    envCoverage: ctx.envCoverage,
    targets: {
      temperature: TEMP_BANDS[stage] ?? TEMP_BAND_DEFAULT,
      humidity: RH_BANDS[stage] ?? null,
      vpd: VPD_BANDS[stage] ?? null,
      ph: ctx.diary.mediumType
        ? (PH_BANDS[ctx.diary.mediumType] ?? PH_BAND_UNKNOWN)
        : null,
      phBandKnown: !!ctx.diary.mediumType && !!PH_BANDS[ctx.diary.mediumType],
      ecFloor: EC_FLOOR[stage] ?? null,
    },
    readings,
    missingReportable,
    capabilityUnknown,
    unresolvedCount: ctx.unresolved?.length ?? 0,
    episodes,
    interventions: (ctx.interventions ?? [])
      .slice(-4)
      .map((iv) => ({
        type: iv.type,
        targetMetric: iv.targetMetric,
        ageDays: Math.max(0, Math.floor((ctx.now - (iv.eventT ?? iv.at)) / DAY_MS)),
        pending: interventionPending(ctx, iv),
      })),
    diagnosis,
    actions,
    nextStep: actions[0] ?? null,
    capabilities,
    setup: {
      present: ctx.setup.present,
      mediumType: ctx.diary.mediumType,
      lightType: ctx.diary.lightType,
      growType: ctx.diary.growType,
      techniques: ctx.diary.techniques.slice(0, 8),
      controls: ctx.setup.capabilities.slice(0, 12),
      adjusts: adjustCapabilities(ctx),
    },
  }
}

/** Lookup helper for renderers/checklist — fixed-list scan, bounded. */
export function capabilityOf(snap: GrowIntelligenceSnapshot, stepId: string): StepCapability | null {
  return snap.capabilities.find((c) => c.stepId === stepId) ?? null
}

/** Reading lookup — null when the metric has no data. */
export function readingOf(snap: GrowIntelligenceSnapshot, metric: MetricId): SnapshotReading | null {
  return snap.readings.find((r) => r.metric === metric) ?? null
}

export { GROWTH_STAGES as SNAPSHOT_GROWTH_STAGES, POST_HARVEST_STAGES }
