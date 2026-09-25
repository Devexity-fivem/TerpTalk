// TerpBot intelligence — measurement/observation capability model
// (Phase I). Answers one question per NextStepId: "can this grower
// actually produce this evidence?"
//
// Epistemics, strictly enforced:
//   proven     — the grower HAS produced this evidence (series points
//                exist) or the step is intrinsic (visual inspections,
//                plant height — no instrument required)
//   plausible  — declared/heuristic evidence only: an instrument
//                keyword hit in setup free text, or a structured diary
//                enum that makes the instrument near-universal (a DWC
//                grow without a pH meter is not survivable). A keyword
//                is a claim, not proof.
//   unknown    — no evidence either way. MISSING DATA NEVER LOWERS A
//                CAPABILITY: "no EC readings" means "no EC readings",
//                not "no EC meter".
//   excluded   — structurally inapplicable to THIS grow (runoff metrics
//                on DWC — there is no runoff; the reservoir IS the root
//                zone). Stronger than unknown: never ask.
//   unreportable — the step has no series/parser path; even a willing
//                grower's answer can't be persisted (ppfd, leafTemp,
//                substrateMoisture, watering, photoperiod). Never an ask.
//
// Pure — no Prisma, no I/O. Setup keyword hits arrive through
// ctx.setup.capabilities (canonical ids minted in intel-context.ts);
// diary enums are declared facts. Neither ever becomes a diagnosis.

import { LOGGED_SERIES, REPORTABLE_METRICS, SERIES_KEY } from "@/lib/terpbot-intel-merge"
import type { GrowContextView, MetricId, NextStepId } from "@/lib/terpbot-intel-types"

export type StepFeasibility =
  | "proven"
  | "plausible"
  | "unknown"
  | "excluded"
  | "unreportable"

export interface StepCapability {
  stepId: NextStepId
  feasibility: StepFeasibility
  /** canonical evidence tag — safe to render/persist, never raw text */
  basis: "series" | "intrinsic" | "setup-text" | "declared" | "structural" | "none"
}

/** Instrument keywords (canonical capability ids) that make a metric
 *  plausible. Keyword hits come from setup free text — heuristic only. */
const INSTRUMENT_CAPS: Partial<Record<MetricId, string[]>> = {
  temperature: ["env-monitor", "controllers/sensors", "ac"],
  humidity: ["env-monitor", "controllers/sensors", "dehumidifier", "humidifier"],
  vpd: ["env-monitor", "controllers/sensors"],
  ph: ["ph-meter"],
  ec: ["ec-meter"],
  runoffPh: ["ph-meter"],
  runoffEc: ["ec-meter"],
}

/** Soilless mediums where pH/EC management is structural to the method
 *  — a declared enum fact that makes the meters plausible even without
 *  a keyword. Soil/living-soil grows legitimately may not own either. */
const SOILLESS = new Set(["COCO", "HYDRO", "DWC"])

/** Metrics structurally absent in DWC — the reservoir is the root
 *  zone; there is no runoff to collect. mediumType is validated to
 *  canonical values at write time, but normalize defensively anyway. */
const DWC_EXCLUDED = new Set<MetricId>(["runoffPh", "runoffEc"])
const isDwc = (mediumType: string | null) =>
  (mediumType ?? "").toUpperCase().includes("DWC")

/** Steps requiring no instrument at all — observing is intrinsic. */
const INTRINSIC = new Set<MetricId>(["height"])

export function stepCapability(ctx: GrowContextView, stepId: NextStepId): StepCapability {
  if (stepId.startsWith("inspect:")) {
    // every grower can look — a loupe improves trichome checks but the
    // inspection itself never requires equipment
    return { stepId, feasibility: "proven", basis: "intrinsic" }
  }
  const m = stepId as MetricId
  if (DWC_EXCLUDED.has(m) && isDwc(ctx.diary.mediumType)) {
    return { stepId, feasibility: "excluded", basis: "structural" }
  }
  // Logged diary data proves the metric even when chat answers can't
  // normalize onto it (watering/ppfd/photoperiod are diary-form only).
  const loggedKey = LOGGED_SERIES[m]
  if (loggedKey && ctx.series[loggedKey].n > 0) {
    return { stepId, feasibility: "proven", basis: "series" }
  }
  if (!REPORTABLE_METRICS.has(m)) {
    return { stepId, feasibility: "unreportable", basis: "none" }
  }
  const key = SERIES_KEY[m]
  if (key && ctx.series[key].n > 0) {
    return { stepId, feasibility: "proven", basis: "series" }
  }
  // VPD is derivable — a grower with temp+RH data can always produce it
  if (m === "vpd" && ctx.series.temperature.n > 0 && ctx.series.humidity.n > 0) {
    return { stepId, feasibility: "proven", basis: "series" }
  }
  if (INTRINSIC.has(m)) {
    return { stepId, feasibility: "proven", basis: "intrinsic" }
  }
  if (INSTRUMENT_CAPS[m]?.some((c) => ctx.setup.capabilities.includes(c))) {
    return { stepId, feasibility: "plausible", basis: "setup-text" }
  }
  if (SOILLESS.has((ctx.diary.mediumType ?? "").toUpperCase()) && (m === "ph" || m === "ec")) {
    return { stepId, feasibility: "plausible", basis: "declared" }
  }
  return { stepId, feasibility: "unknown", basis: "none" }
}

/** Deterministic ranking bonus for the action engine — feasibility
 *  shifts ties and near-ties but never outranks a required-input gate
 *  (+4) or a live conflict (+2 on top of state weight). Bounded by
 *  construction: 0 | 1 | 2. */
export function feasibilityBonus(cap: StepCapability): number {
  switch (cap.feasibility) {
    case "proven": return 2
    case "plausible": return 1
    default: return 0
  }
}

/** Adjustment capabilities the setup gives evidence for — heuristic
 *  (setup free text) or structural (growType). Rendered as canonical
 *  labels only; never asserts the equipment works, only that the setup
 *  text claims it. */
export interface AdjustCapability {
  /** canonical id — "humidity-down", "temperature-down", … */
  id: string
  basis: "setup-text" | "structural" | "declared"
}

const ADJUST_CAPS: [string, string][] = [
  ["dehumidifier", "humidity-down"],
  ["humidifier", "humidity-up"],
  ["ac", "temperature-down"],
  ["airflow", "airflow"],
  ["co2", "co2"],
  ["auto-irrigation", "irrigation-timing"],
]

export function adjustCapabilities(ctx: GrowContextView): AdjustCapability[] {
  const out: AdjustCapability[] = []
  for (const [cap, id] of ADJUST_CAPS) {
    if (ctx.setup.capabilities.includes(cap)) out.push({ id, basis: "setup-text" })
  }
  // Structural: outdoor growers cannot adjust the environment — the
  // weather decides. Greenhouse sits between; only OUTDOOR excludes.
  if (ctx.diary.growType === "OUTDOOR") {
    return out.filter((c) => c.id === "irrigation-timing")
  }
  return out
}
