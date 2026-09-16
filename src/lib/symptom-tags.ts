// Symptom tag taxonomy for Plant Problems threads.
// Reuses the existing Tag/ThreadTag infrastructure — these are ordinary
// tags, just drawn from a controlled vocabulary that maps 1:1 onto the
// Plant Doctor wizard's deterministic result IDs. Small on purpose:
// ~11 groups cover the whole wizard without inventing a second ontology.

import { WIZARD_RESULTS } from "@/lib/problem-wizard"

export interface SymptomTag {
  slug: string
  name: string
  /** Wizard result IDs that map onto this tag. */
  resultIds: string[]
}

export const SYMPTOM_TAGS: SymptomTag[] = [
  {
    slug: "nutrient-deficiency",
    name: "nutrient deficiency",
    resultIds: ["nitrogen_def", "magnesium_def", "iron_def", "potassium_def", "phosphorus_def", "sulfur_def", "zinc_boron", "cal_mag", "cold_phosphorus"],
  },
  {
    slug: "overfeeding",
    name: "overfeeding / nutrient burn",
    resultIds: ["nutrient_burn", "nitrogen_tox", "salt_buildup", "bud_nutrient", "seedling_chem", "seedling_burn"],
  },
  {
    slug: "watering",
    name: "watering problems",
    resultIds: ["overwater", "underwater", "overwater_burst"],
  },
  {
    slug: "root-problems",
    name: "root problems",
    resultIds: ["root_rot", "root_bound"],
  },
  {
    slug: "pests",
    name: "pests",
    resultIds: ["pests", "spider_mites", "fungus_gnats", "aphids", "slugs_snails", "caterpillars", "whiteflies", "thrips"],
  },
  {
    slug: "mold-mildew",
    name: "mold & mildew",
    resultIds: ["pm", "bud_rot"],
  },
  {
    slug: "heat-light-stress",
    name: "heat & light stress",
    resultIds: ["heat_stress", "light_burn", "wind_or_dry", "insufficient_light", "seedling_light"],
  },
  {
    slug: "environment",
    name: "environment / pH",
    resultIds: ["humidity_high", "humidity_low", "ph_drift"],
  },
  {
    slug: "plant-structure",
    name: "growth & structure",
    resultIds: ["stretch", "weak_stem", "stem_rot", "stunt", "hermie"],
  },
  {
    slug: "seedling-germination",
    name: "seedling & germination",
    resultIds: ["bad_germ", "air_pruning", "damping_off", "seedling_stretch"],
  },
  {
    slug: "harvest-timing",
    name: "harvest timing",
    resultIds: ["early_harvest"],
  },
]

const RESULT_TO_TAG = new Map<string, SymptomTag>()
for (const tag of SYMPTOM_TAGS) {
  for (const id of tag.resultIds) RESULT_TO_TAG.set(id, tag)
}

/** Maps a Plant Doctor result ID to its symptom tag, or null. */
export function wizardResultToTag(resultId: string | null | undefined): SymptomTag | null {
  if (!resultId) return null
  return RESULT_TO_TAG.get(resultId) ?? null
}

/** Validates a client-supplied wizardResultId — must be a real wizard result. */
export function isValidWizardResultId(v: unknown): v is string {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(WIZARD_RESULTS, v)
}
