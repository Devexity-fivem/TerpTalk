// TerpBot intelligence — deterministic cultivation checklist engine
// (Phase I). Stage playbooks as predicates over the Grow Intelligence
// Snapshot — a checklist, not a prescription.
//
// Every item is a predicate over canonical snapshot fields (enum stage,
// reading rows, capabilities, episodes, candidates). No raw free text
// is read; no value is fabricated; missing data produces "unknown",
// never a diagnosis. Identical snapshot → identical checklist, item
// order fixed by declaration + the deterministic state sort.
//
// Lifecycle states:
//   concern        — measured/reported evidence says this needs
//                    attention now (a reading outside its stage band,
//                    an active symptom episode)
//   due            — the check should happen now (stale backing data,
//                    a discriminating inspection for a live candidate,
//                    a stage-window observation like trichomes)
//   watch          — standing stage expectation; monitor, no alarm
//   unknown        — the data to evaluate this doesn't exist. This is
//                    the honesty state — never rendered as failure
//   satisfied      — current evidence covers it
//   not_applicable — excluded by stage or structure (DWC runoff,
//                    outdoor environmental control)
//
// Provenance: every item carries the same source registry ids the rule
// engine cites. Nothing here asserts a universal schedule — stage
// windows are expectation ranges, and observable evidence (trichomes,
// stem snap) always outranks calendar days.

import type { GrowIntelligenceSnapshot } from "@/lib/terpbot-intel-snapshot"
import { capabilityOf, readingOf } from "@/lib/terpbot-intel-snapshot"
import type { MetricId, NextStepId, SymptomId } from "@/lib/terpbot-intel-types"
import { DEFICIENCY_CANDIDATES, EC_SEEDLING_CEILING, RH_FLOWER_RISK } from "@/lib/terpbot-intel"

export type ChecklistDomain =
  | "environment"
  | "rootzone"
  | "nutrition"
  | "light"
  | "plant"
  | "pest"
  | "disease"
  | "harvest"
  | "postharvest"
  | "data"

export type ChecklistState =
  | "concern"
  | "due"
  | "watch"
  | "unknown"
  | "satisfied"
  | "not_applicable"

export interface ChecklistItemDef {
  id: string
  domain: ChecklistDomain
  /** effective-stage ids the item applies to — see snapshot.stage */
  stages: string[]
  /** canonical render text — no user-controlled interpolation */
  label: string
  /** why the item exists — surfaces through /why-style explanation */
  why: string
  sourceIds: string[]
  /** the ask this item maps to — used for MEASURE/OBSERVE sections;
   *  unreportable stepIds are listed as UNKNOWN, never asked */
  stepId?: NextStepId
  evaluate: (s: GrowIntelligenceSnapshot) => ChecklistState
}

export interface ChecklistItem extends ChecklistItemDef {
  state: ChecklistState
}

// ── predicate helpers ───────────────────────────────────────────────

const ALL_GROWTH = ["GERMINATION", "SEEDLING", "VEGETATIVE", "FLOWER"]
const LIVING = [...ALL_GROWTH, "HARVEST", "DRYING", "CURING"]

const has = (s: GrowIntelligenceSnapshot, m: MetricId) => readingOf(s, m) != null
const val = (s: GrowIntelligenceSnapshot, m: MetricId) => readingOf(s, m)?.value ?? null
const stale = (s: GrowIntelligenceSnapshot, m: MetricId) => readingOf(s, m)?.stale === true

/** state for "reading vs its resolved band" items — the honest ladder:
 *  no data → unknown; stale → due; outside band → concern; in → satisfied. */
const bandState = (s: GrowIntelligenceSnapshot, m: MetricId): ChecklistState => {
  const r = readingOf(s, m)
  if (!r) return "unknown"
  if (r.stale) return "due"
  if (r.inBand == null) return "watch" // reading exists, but no band to judge it
  return r.inBand === false ? "concern" : "satisfied"
}

const episodeOpen = (s: GrowIntelligenceSnapshot, ids: SymptomId[]) =>
  s.episodes.some((e) => (e.status === "active" || e.status === "recurred") && ids.includes(e.symptom))
const candidateDue = (s: GrowIntelligenceSnapshot, ids: Set<string>) =>
  s.diagnosis.candidates.some(
    (c) => ids.has(c.id) && (c.state === "conflicting" || c.state === "possible" || c.state === "strong")
  )
const excluded = (s: GrowIntelligenceSnapshot, stepId: NextStepId) =>
  capabilityOf(s, stepId)?.feasibility === "excluded"

const PEST_SIGHTINGS: SymptomId[] = [
  "PEST_MITES", "PEST_MITES_OTHER", "PEST_APHIDS", "PEST_THRIPS",
  "PEST_FUNGUS_GNATS", "PEST_WHITEFLIES", "PEST_CATERPILLARS", "PEST_SLUGS",
  "WEBBING", "STIPPLING", "SILVERING", "STICKY_RESIDUE", "HOLES",
]
const MOLD_SIGNS: SymptomId[] = ["BUD_ROT", "FUZZ_MOLD", "POWDERY"]
const PEST_CANDIDATES = new Set(["pests", "spider_mites", "fungus_gnats", "aphids", "slugs_snails", "caterpillars", "whiteflies", "thrips"])
const LATE_FLOWER_D = 35 // same window as the bud-rot rules (Punja & Ni 2025)

// ── The playbook registry ───────────────────────────────────────────
// Declaration order is canonical — ties in the state sort keep this
// order so identical snapshots render identically.

export const CHECKLIST: ChecklistItemDef[] = [
  // ── Environment — applies while anything is alive or drying ──────
  {
    id: "env-temperature",
    domain: "environment",
    stages: LIVING,
    label: "canopy/space temperature",
    why: "stage temperature band — growth stalls and dries drift outside it",
    sourceIds: ["chandra-2008-photosynthesis", "terptalk-stage-tips", "postharvest-review-2022"],
    stepId: "temperature",
    evaluate: (s) => bandState(s, "temperature"),
  },
  {
    id: "env-humidity",
    domain: "environment",
    stages: LIVING,
    label: "relative humidity",
    why: "stage RH band — flower/drying ceilings exist because mold pressure rises",
    sourceIds: ["punja-2022-botrytis", "terptalk-stage-tips", "postharvest-review-2022"],
    stepId: "humidity",
    evaluate: (s) => bandState(s, "humidity"),
  },
  {
    id: "env-vpd",
    domain: "environment",
    stages: [...ALL_GROWTH, "DRYING"],
    label: "VPD (transpiration pressure)",
    why: "VPD integrates temp+RH into the drying force on the plant or harvest",
    sourceIds: ["cs-vpd-ranges", "ieee-greenhouse-survey", "fao56-svp"],
    stepId: "vpd",
    // derivable — temp+RH data produces a computed VPD series, so a
    // missing row means genuinely no data (unknown, never "fine")
    evaluate: (s) => bandState(s, "vpd"),
  },
  {
    id: "env-stability",
    domain: "environment",
    stages: LIVING,
    label: "environmental stability (swings)",
    why: "volatile temp/RH stresses plants and dries unevenly even inside the band",
    sourceIds: ["terptalk-stage-tips"],
    evaluate: (s) => {
      const t = readingOf(s, "temperature")?.trend
      const h = readingOf(s, "humidity")?.trend
      if (t === "volatile" || h === "volatile") return "watch"
      if (t == null && h == null) return "unknown" // no data ≠ stable
      if (t == null || h == null || t === "insufficient" || h === "insufficient")
        return "watch" // partial coverage — can't claim stability
      return "satisfied"
    },
  },

  // ── Root zone ────────────────────────────────────────────────────
  {
    id: "rz-ph",
    domain: "rootzone",
    stages: ALL_GROWTH,
    label: "input pH",
    why: "pH gates nutrient availability — medium decides the target band",
    sourceIds: ["whipker-ph-micro", "canna-coco-ph", "cornell-cannabis-guidebook"],
    stepId: "ph",
    evaluate: (s) => {
      const r = readingOf(s, "ph")
      if (!r) return "unknown"
      if (r.stale) return "due"
      if (!s.targets.phBandKnown) return "watch" // can't narrow without medium
      return r.inBand === false ? "concern" : "satisfied"
    },
  },
  {
    id: "rz-ec",
    domain: "rootzone",
    stages: ALL_GROWTH,
    label: "feed strength (EC)",
    why: "EC trend separates under/over-feeding from environment issues",
    sourceIds: ["hershkowitz-2025-ec", "bevan-2021-npk-dwc", "canna-coco-ph"],
    stepId: "ec",
    evaluate: (s) => {
      const r = readingOf(s, "ec")
      if (!r) return "unknown"
      if (r.stale) return "due"
      const floor = s.targets.ecFloor
      if (floor != null && r.value < floor) return "watch"
      return "satisfied"
    },
  },
  {
    id: "rz-runoff",
    domain: "rootzone",
    stages: ["VEGETATIVE", "FLOWER"],
    label: "runoff pH/EC",
    why: "runoff separates root-zone drift from input — DWC has no runoff to collect",
    sourceIds: ["ncsu-pourthru-2009"],
    stepId: "runoffEc",
    evaluate: (s) => {
      if (excluded(s, "runoffEc")) return "not_applicable"
      if (!has(s, "runoffPh") && !has(s, "runoffEc")) return "unknown"
      if ((has(s, "runoffPh") && stale(s, "runoffPh")) || (has(s, "runoffEc") && stale(s, "runoffEc")))
        return "due" // any logged runoff data that's stale → re-check
      return "satisfied"
    },
  },
  {
    id: "rz-moisture",
    domain: "rootzone",
    stages: ALL_GROWTH,
    label: "watering rhythm / dryback",
    why: "wet-dry pattern distinguishes watering issues from nutrient issues",
    sourceIds: ["terptalk-stage-tips"],
    stepId: "substrateMoisture", // unreportable → UNKNOWN section, never an ask
    evaluate: (s) =>
      episodeOpen(s, ["MEDIUM_WET", "OVERWATERED", "ROOT_ROT"])
        ? "concern"
        : episodeOpen(s, ["MEDIUM_DRY", "UNDERWATERED", "LIMP_SOFT"])
          ? "concern"
          : "watch",
  },

  // ── Nutrition ────────────────────────────────────────────────────
  {
    id: "nut-pattern",
    domain: "nutrition",
    stages: ALL_GROWTH,
    label: "deficiency pattern (old vs new growth)",
    why: "mobile deficiencies show on old leaves first — location narrows the cause",
    sourceIds: ["cockson-2019-nutrient-disorders", "whipker-ph-micro"],
    stepId: "inspect:leaf-pattern",
    evaluate: (s) =>
      episodeOpen(s, ["LEAF_YELLOWING", "LEAF_PALE", "BROWNING", "TIP_BURN"]) ||
      candidateDue(s, DEFICIENCY_CANDIDATES)
        ? "due"
        : "watch",
  },
  {
    id: "nut-burn",
    domain: "nutrition",
    stages: ALL_GROWTH,
    label: "salt buildup / tip burn",
    why: "EC climbs concentrate salts; tip burn tracks excess feeding",
    sourceIds: ["hershkowitz-2025-ec", "ncsu-pourthru-2009"],
    evaluate: (s) =>
      episodeOpen(s, ["TIP_BURN", "SALT_CRUST", "EC_RISING"])
        ? "concern"
        : candidateDue(s, new Set(["salt_buildup", "nutrient_burn"]))
          ? "due"
          : "watch",
  },

  // ── Light ────────────────────────────────────────────────────────
  {
    id: "light-intensity",
    domain: "light",
    stages: ALL_GROWTH,
    label: "light intensity at canopy (PPFD/DLI)",
    why: "stalled or stretched growth can't be separated from light limits without it",
    sourceIds: ["rodriguez-morrison-2021-light", "chandra-2008-photosynthesis"],
    stepId: "ppfd", // unreportable — listed under UNKNOWN, never an ask
    evaluate: (s) => {
      if (episodeOpen(s, ["LIGHT_BURN", "BLEACHING"])) return "concern"
      if (episodeOpen(s, ["STRETCHED"])) return "watch"
      // ppfd is unreportable — a declared light meter (setup-text
      // heuristic) lifts the item to a standing watch, never satisfied
      return s.setup.controls.includes("light-meter") ? "watch" : "unknown"
    },
  },

  // ── Plant ────────────────────────────────────────────────────────
  {
    id: "plant-symptoms",
    domain: "plant",
    stages: ALL_GROWTH,
    label: "open symptom reports",
    why: "unresolved episodes carry forward — a plan should surface them",
    sourceIds: ["terptalk-stage-tips"],
    evaluate: (s) => {
      if (s.episodes.some((e) => e.status === "active" || e.status === "recurred")) return "concern"
      if (s.updateCount === 0 || (s.daysSinceUpdate ?? 99) > 7) return "unknown"
      return "satisfied"
    },
  },
  {
    id: "plant-growth",
    domain: "plant",
    stages: ["SEEDLING", "VEGETATIVE", "FLOWER"],
    label: "growth rate (height trend)",
    why: "a stalled grow at this stage points at environment, light, or roots",
    sourceIds: ["terptalk-stage-tips"],
    stepId: "height",
    evaluate: (s) => {
      const r = readingOf(s, "height")
      if (!r || r.n < 2) return "unknown"
      if (r.stale) return "due"
      return r.trend === "rising" ? "satisfied" : r.trend === "insufficient" ? "unknown" : "watch"
    },
  },

  // ── Pest / disease — IPM observation, not treatment ─────────────
  {
    id: "pest-inspection",
    domain: "pest",
    stages: ALL_GROWTH,
    label: "leaf-underside / sticky-card inspection",
    why: "mites, thrips and aphids hide under leaves — most pest questions resolve there",
    sourceIds: ["bc-cannabis-diseases"],
    stepId: "inspect:leaf-undersides",
    evaluate: (s) => {
      if (episodeOpen(s, PEST_SIGHTINGS)) return "concern"
      if (candidateDue(s, PEST_CANDIDATES)) return "due"
      return "watch"
    },
  },
  {
    id: "disease-budrot",
    domain: "disease",
    stages: ["FLOWER", "HARVEST", "DRYING"],
    label: "bud-rot check inside dense colas",
    why: "botrytis sets in weeks 2–5 of flower and shows inside the bud first",
    sourceIds: ["punja-2022-botrytis", "punja-ni-2025-budrot"],
    stepId: "inspect:bud-interior",
    evaluate: (s) => {
      if (episodeOpen(s, ["BUD_ROT", "FUZZ_MOLD"])) return "concern"
      const rh = val(s, "humidity")
      if (rh != null && rh >= RH_FLOWER_RISK && s.stage !== "DRYING") return "due"
      if (s.stage === "FLOWER" && s.stageDays >= LATE_FLOWER_D) return "due"
      if (s.stage === "DRYING") return "watch"
      return "watch"
    },
  },
  {
    id: "disease-pm",
    domain: "disease",
    stages: ["SEEDLING", "VEGETATIVE", "FLOWER"],
    label: "upper-leaf surfaces (powdery mildew)",
    why: "PM shows on top first — a flour-like wipeable coating",
    sourceIds: ["utia-pm-hemp", "bc-cannabis-diseases"],
    stepId: "inspect:leaf-surfaces",
    evaluate: (s) =>
      episodeOpen(s, ["POWDERY"]) ? "concern"
        : candidateDue(s, new Set(["pm"])) ? "due"
        : "watch",
  },

  // ── Stage-specific expectations ─────────────────────────────────
  {
    id: "germ-moisture",
    domain: "environment",
    stages: ["GERMINATION"],
    label: "medium moist, not wet",
    why: "germination fails from drying out or rotting — the window is narrow",
    sourceIds: ["terptalk-stage-tips"],
    evaluate: (s) =>
      episodeOpen(s, ["MEDIUM_DRY", "MEDIUM_WET", "ROOT_ROT"]) ? "concern" : "watch",
  },
  {
    id: "germ-sprout",
    domain: "plant",
    stages: ["GERMINATION"],
    label: "sprout emergence",
    why: "most viable seeds show within days — silence past the window is a signal",
    sourceIds: ["terptalk-stage-tips"],
    evaluate: (s) => {
      if (episodeOpen(s, ["NO_SPROUT"])) return "concern"
      return s.stageDays >= 5 ? "due" : "watch"
    },
  },
  {
    id: "seed-stretch",
    domain: "light",
    stages: ["SEEDLING"],
    label: "seedling stretch",
    why: "leggy seedlings mean light too weak or too far — fix before veg",
    sourceIds: ["rodriguez-morrison-2021-light", "terptalk-stage-tips"],
    evaluate: (s) =>
      episodeOpen(s, ["STRETCHED", "COLLAPSED"])
        ? "concern"
        : candidateDue(s, new Set(["seedling_stretch", "seedling_light", "damping_off"]))
          ? "due"
          : "watch",
  },
  {
    id: "seed-ec",
    domain: "rootzone",
    stages: ["SEEDLING"],
    label: "feed minimal (seedling EC)",
    why: "seedlings need little feed — early strength burns more than it helps",
    sourceIds: ["terptalk-stage-tips", "bevan-2021-npk-dwc"],
    stepId: "ec",
    evaluate: (s) => {
      const r = readingOf(s, "ec")
      if (!r) return "watch" // seedling feed is optional — not "missing"
      if (r.stale) return "due"
      if (r.value > EC_SEEDLING_CEILING) return "concern"
      return "satisfied"
    },
  },
  {
    id: "veg-canopy",
    domain: "plant",
    stages: ["VEGETATIVE"],
    label: "canopy management window",
    why: "training decisions close once flower stretch ends",
    sourceIds: ["terptalk-stage-tips"],
    evaluate: (s) =>
      s.setup.techniques.length ? "satisfied" : "watch",
  },
  {
    id: "flower-stretch",
    domain: "plant",
    stages: ["FLOWER"],
    label: "transition stretch / canopy height",
    why: "the first ~3 weeks of flower roughly double height — plan headroom",
    sourceIds: ["terptalk-stage-tips"],
    stepId: "height",
    evaluate: (s) => {
      if (s.stage !== "FLOWER" || s.stageDays > 21) return "satisfied"
      return has(s, "height") ? "watch" : "due"
    },
  },
  {
    id: "flower-hermie",
    domain: "plant",
    stages: ["FLOWER"],
    label: "buds for pollen sacs / nanners",
    why: "confirmed sacs only — swollen calyxes mimic them; check before acting",
    sourceIds: ["terptalk-stage-tips"],
    stepId: "inspect:flowers",
    evaluate: (s) =>
      episodeOpen(s, ["HERMIE"]) ? "concern"
        : s.stage === "FLOWER" && s.stageDays >= 21 ? "due"
        : "watch",
  },
  {
    id: "flower-maturity",
    domain: "harvest",
    stages: ["FLOWER"],
    label: "trichome maturity (loupe)",
    why: "clear→milky→amber is the maturity signal — calendar weeks are not",
    sourceIds: ["postharvest-review-2022", "terptalk-stage-tips"],
    stepId: "inspect:trichomes",
    evaluate: (s) =>
      s.stage === "FLOWER" && s.stageDays >= LATE_FLOWER_D ? "due" : "watch",
  },

  // ── Harvest ──────────────────────────────────────────────────────
  {
    id: "harv-trichomes",
    domain: "harvest",
    stages: ["HARVEST"],
    label: "trichome maturity before cutting",
    why: "harvest timing is judged on trichomes, not the calendar",
    sourceIds: ["postharvest-review-2022", "terptalk-stage-tips"],
    stepId: "inspect:trichomes",
    evaluate: (s) =>
      // a live maturity observation is the only thing that satisfies
      // this — bud-rot reports and resolved history don't prove it
      episodeOpen(s, ["GRASSY_SMELL"]) ? "satisfied" : "due",
  },
  {
    id: "harv-dryspace",
    domain: "harvest",
    stages: ["HARVEST"],
    label: "drying space conditions (~60°F / ~60% RH)",
    why: "the dry room is decided before the chop — measure it, don't guess it",
    // 60/60 is the internal stage-tips convention, not a review figure
    sourceIds: ["postharvest-review-2022", "terptalk-stage-tips"],
    stepId: "temperature",
    evaluate: (s) =>
      has(s, "temperature") && has(s, "humidity") && !stale(s, "temperature") && !stale(s, "humidity")
        ? "satisfied"
        : "due",
  },
  {
    id: "harv-airflow",
    domain: "harvest",
    stages: ["HARVEST", "DRYING"],
    label: "gentle airflow in the dry space",
    why: "still air invites mold; direct fans over-dry the outside",
    sourceIds: ["postharvest-review-2022"],
    // a setup-text keyword ("fan"/"exhaust") can't prove airflow — it
    // stays a standing watch item, never satisfied
    evaluate: () => "watch",
  },

  // ── Drying ───────────────────────────────────────────────────────
  {
    id: "dry-environment",
    domain: "postharvest",
    stages: ["DRYING"],
    label: "dry space temp + RH in band",
    why: "~57–68°F and 50–65% RH dries slowly enough to protect quality",
    sourceIds: ["postharvest-review-2022", "terptalk-stage-tips"],
    evaluate: (s) => {
      const t = bandState(s, "temperature")
      const h = bandState(s, "humidity")
      if (t === "concern" || h === "concern") return "concern"
      if (t === "unknown" || h === "unknown") return "due" // dry room numbers are essential
      if (t === "due" || h === "due") return "due"
      return "satisfied"
    },
  },
  {
    id: "dry-mold",
    domain: "postharvest",
    stages: ["DRYING"],
    label: "daily mold inspection",
    why: "mold in the dry room moves fast — interior checks catch it early",
    sourceIds: ["punja-2022-botrytis", "postharvest-review-2022"],
    stepId: "inspect:bud-interior",
    evaluate: (s) => {
      if (episodeOpen(s, MOLD_SIGNS)) return "concern"
      const rh = val(s, "humidity")
      if (rh != null && rh > 65) return "due"
      return "watch"
    },
  },
  {
    id: "dry-stemsnap",
    domain: "postharvest",
    stages: ["DRYING"],
    label: "stem-snap readiness check",
    why: "stems snapping rather than bending is the observable dry endpoint",
    sourceIds: ["postharvest-review-2022"],
    evaluate: (s) =>
      s.stageDays >= 5 ? "due" : "watch",
  },

  // ── Curing ───────────────────────────────────────────────────────
  {
    id: "cure-rh",
    domain: "postharvest",
    stages: ["CURING"],
    // reads the ambient room series — jar-interior RH can't be logged
    // in the schema, so this item is scoped to the cure space itself
    label: "cure-space room RH (~55–65%)",
    why: "a wet cure space keeps jars wet — jar RH can't be measured here, ambient is the available proxy",
    sourceIds: ["postharvest-review-2022"],
    stepId: "humidity",
    evaluate: (s) => {
      const r = readingOf(s, "humidity")
      if (!r) return "due" // jar RH is the cure's one number
      if (r.stale) return "due"
      return r.inBand === false ? "concern" : "satisfied"
    },
  },
  {
    id: "cure-mold",
    domain: "postharvest",
    stages: ["CURING"],
    label: "mold / off-smell check on opening",
    why: "ammonia or fuzz means too wet — catch it at each opening",
    sourceIds: ["postharvest-review-2022", "bc-cannabis-diseases"],
    evaluate: (s) => (episodeOpen(s, MOLD_SIGNS) ? "concern" : "watch"),
  },
  {
    id: "cure-log",
    domain: "data",
    stages: ["CURING"],
    label: "jar observations logged",
    why: "cure progress is slow — a log catches the drift a memory misses",
    sourceIds: ["postharvest-review-2022"],
    evaluate: (s) =>
      s.daysSinceUpdate != null && s.daysSinceUpdate <= 3 ? "satisfied" : "due",
  },

  // ── Data quality — the honesty items ─────────────────────────────
  {
    id: "data-stage",
    domain: "data",
    stages: LIVING,
    label: "current stage confirmed",
    why: "stage sets every band — an estimated boundary softens all targets",
    sourceIds: ["terptalk-stage-tips"],
    stepId: "inspect:stage",
    evaluate: (s) =>
      s.stage === "UNKNOWN" ? "unknown" : s.stageCensored ? "watch" : "satisfied",
  },
  {
    id: "data-freshness",
    domain: "data",
    stages: LIVING,
    label: "recent diary update",
    why: "the whole picture decays — readings past ~10d stop proving anything",
    sourceIds: ["terptalk-stage-tips"],
    evaluate: (s) => {
      if (s.daysSinceUpdate == null) return "unknown"
      if (s.daysSinceUpdate <= 3) return "satisfied"
      return "due"
    },
  },
  {
    id: "data-env",
    domain: "data",
    stages: LIVING,
    label: "environment data coverage",
    why: "updates without temp/RH/pH/EC can't feed the reasoning engine",
    sourceIds: ["terptalk-stage-tips"],
    evaluate: (s) =>
      s.updateCount === 0 ? "unknown" : s.envCoverage >= 0.5 ? "satisfied" : "watch",
  },
]

// ── Evaluation ──────────────────────────────────────────────────────

const STATE_RANK: Record<ChecklistState, number> = {
  concern: 0,
  due: 1,
  watch: 2,
  unknown: 3,
  satisfied: 4,
  not_applicable: 5,
}

const DOMAIN_ORDER: ChecklistDomain[] = [
  "environment", "rootzone", "nutrition", "light", "plant",
  "pest", "disease", "harvest", "postharvest", "data",
]

/** Evaluate the playbook against the snapshot. Deterministic: state
 *  rank → domain order → declaration order. Items for other stages and
 *  not_applicable items are still returned (the renderer decides what
 *  to show; tests can assert the full lifecycle). */
export function buildChecklist(snap: GrowIntelligenceSnapshot): ChecklistItem[] {
  return CHECKLIST.map((def) => {
    const state = !def.stages.includes(snap.stage)
      ? ("not_applicable" as const)
      : def.evaluate(snap)
    return { ...def, state }
  }).sort(
    (a, b) =>
      STATE_RANK[a.state] - STATE_RANK[b.state] ||
      DOMAIN_ORDER.indexOf(a.domain) - DOMAIN_ORDER.indexOf(b.domain)
  )
}

/** The applicable subset for the current stage — what /plan renders. */
export function activeChecklist(snap: GrowIntelligenceSnapshot): ChecklistItem[] {
  return buildChecklist(snap).filter((i) => i.state !== "not_applicable")
}
