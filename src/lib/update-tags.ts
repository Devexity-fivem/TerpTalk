// Structured grower tags for DiaryUpdate — dependency-free so both the
// client forms and the API routes can import the same allowlists.
// Fixed taxonomies keep updates comparable across the community — free
// text lives in feeding/training/content; these carry the queryable bits.

/** Cultivation actions taken during this update. */
export const UPDATE_EVENT_TAGS = new Set([
  "WATERED",
  "FED",
  "TOPPED",
  "FIMMED",
  "LST",
  "DEFOLIATED",
  "LOLLIPOPPED",
  "SUPER_CROPPED",
  "SCROG",
  "TRANSPLANTED",
  "PRUNED",
  "FLUSHED",
  "FOLIAR_SPRAY",
  "PEST_TREATMENT",
  "LIGHT_FLIP",
])

export const UPDATE_EVENT_LABELS: Record<string, string> = {
  WATERED: "Watered",
  FED: "Fed",
  TOPPED: "Topped",
  FIMMED: "FIMmed",
  LST: "LST applied",
  DEFOLIATED: "Defoliated",
  LOLLIPOPPED: "Lollipopped",
  SUPER_CROPPED: "Super-cropped",
  SCROG: "ScrOG work",
  TRANSPLANTED: "Transplanted",
  PRUNED: "Pruned",
  FLUSHED: "Flushed",
  FOLIAR_SPRAY: "Foliar spray",
  PEST_TREATMENT: "Pest treatment",
  LIGHT_FLIP: "Flipped to 12/12",
}

/** Problems observed — displayed as warning chips, feed "needs help"
 *  surfaces later. */
export const UPDATE_ISSUE_TAGS = new Set([
  "DEFICIENCY",
  "NUTRIENT_BURN",
  "PESTS",
  "MOLD_MILDEW",
  "HEAT_STRESS",
  "LIGHT_BURN",
  "OVERWATERED",
  "UNDERWATERED",
  "HERMI",
  "DAMPING_OFF",
  "PH_ISSUE",
  "ROOT_BOUND",
  "WIND_DAMAGE",
])

export const UPDATE_ISSUE_LABELS: Record<string, string> = {
  DEFICIENCY: "Deficiency",
  NUTRIENT_BURN: "Nutrient burn",
  PESTS: "Pests",
  MOLD_MILDEW: "Mold / mildew",
  HEAT_STRESS: "Heat stress",
  LIGHT_BURN: "Light burn",
  OVERWATERED: "Overwatered",
  UNDERWATERED: "Underwatered",
  HERMI: "Hermi signs",
  DAMPING_OFF: "Damping off",
  PH_ISSUE: "pH issue",
  ROOT_BOUND: "Root bound",
  WIND_DAMAGE: "Wind damage",
}

export const UPDATE_PLANT_HEALTH = new Set([
  "THRIVING",
  "HEALTHY",
  "STRESSED",
  "RECOVERING",
])

export const UPDATE_PLANT_HEALTH_LABELS: Record<string, string> = {
  THRIVING: "Thriving",
  HEALTHY: "Healthy",
  STRESSED: "Stressed",
  RECOVERING: "Recovering",
}

export const UPDATE_TRICHOME_STATES = new Set([
  "CLEAR",
  "MOSTLY_CLEAR",
  "CLOUDY",
  "MOSTLY_AMBER",
  "MIXED",
])

export const UPDATE_TRICHOME_LABELS: Record<string, string> = {
  CLEAR: "Clear",
  MOSTLY_CLEAR: "Mostly clear",
  CLOUDY: "Cloudy",
  MOSTLY_AMBER: "Mostly amber",
  MIXED: "Mixed clear/amber",
}

export const UPDATE_MAX_EVENTS = 12
export const UPDATE_MAX_ISSUES = 10
export const AROMA_RANGE = [1, 5] as const

/** Allowlist-validated string-array field — rejects non-arrays, unknown
 *  tags, and over-cap lists; dedupes case-insensitively. Omission is the
 *  caller's concern (undefined = untouched). */
export function parseUpdateTagList(
  input: unknown,
  allowed: Set<string>,
  max: number
): { ok: true; tags: string[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: "Invalid tags" }
  if (input.length > max) return { ok: false, error: "Too many tags" }
  const seen = new Set<string>()
  const tags: string[] = []
  for (const item of input) {
    if (typeof item !== "string") return { ok: false, error: "Invalid tag" }
    const tag = item.trim().toUpperCase()
    if (!allowed.has(tag)) return { ok: false, error: `Unknown tag: ${item.slice(0, 30)}` }
    if (seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
  }
  return { ok: true, tags }
}
