// Controlled vocabularies for structured diary fields.
// Kept deliberately small — enough structure for aggregation and
// "grows like mine" discovery without building a GrowDiaries-style
// equipment/nutrient catalog. The free-text fields stay as fallbacks.

export const GROW_TYPES = ["INDOOR", "OUTDOOR", "GREENHOUSE", "HYDROPONIC", "OTHER"] as const
export const MEDIUM_TYPES = ["SOIL", "COCO", "HYDRO", "DWC", "LIVING_SOIL", "OTHER"] as const
export const LIGHT_TYPES = ["LED", "HPS", "CMH", "FLUORESCENT", "SUN", "OTHER"] as const
export const TECHNIQUES = ["LST", "HST", "TOPPING", "FIM", "SCROG", "SOG", "DEFOLIATION", "MAINLINING"] as const
export const HARVEST_DIFFICULTIES = ["EASY", "NORMAL", "HARD"] as const

export type MediumType = (typeof MEDIUM_TYPES)[number]
export type LightType = (typeof LIGHT_TYPES)[number]
export type Technique = (typeof TECHNIQUES)[number]
export type HarvestDifficulty = (typeof HARVEST_DIFFICULTIES)[number]

export const MEDIUM_LABELS: Record<MediumType, string> = {
  SOIL: "Soil",
  COCO: "Coco coir",
  HYDRO: "Hydroponics",
  DWC: "DWC",
  LIVING_SOIL: "Living soil",
  OTHER: "Other",
}

export const LIGHT_LABELS: Record<LightType, string> = {
  LED: "LED",
  HPS: "HPS",
  CMH: "CMH / LEC",
  FLUORESCENT: "Fluorescent",
  SUN: "Sunlight",
  OTHER: "Other",
}

export const TECHNIQUE_LABELS: Record<Technique, string> = {
  LST: "LST",
  HST: "HST",
  TOPPING: "Topping",
  FIM: "FIM",
  SCROG: "ScrOG",
  SOG: "SoG",
  DEFOLIATION: "Defoliation",
  MAINLINING: "Main-lining",
}

export const GROW_TYPE_LABELS: Record<string, string> = {
  INDOOR: "Indoor",
  OUTDOOR: "Outdoor",
  GREENHOUSE: "Greenhouse",
  HYDROPONIC: "Hydroponic",
  OTHER: "Other",
}

export const DIFFICULTY_LABELS: Record<HarvestDifficulty, string> = {
  EASY: "Easy",
  NORMAL: "Normal",
  HARD: "Hard",
}

/** Returns the value if it's in the vocabulary, else null. */
export function parseMediumType(v: unknown): MediumType | null {
  return typeof v === "string" && (MEDIUM_TYPES as readonly string[]).includes(v) ? (v as MediumType) : null
}

export function parseLightType(v: unknown): LightType | null {
  return typeof v === "string" && (LIGHT_TYPES as readonly string[]).includes(v) ? (v as LightType) : null
}

export function parseHarvestDifficulty(v: unknown): HarvestDifficulty | null {
  return typeof v === "string" && (HARVEST_DIFFICULTIES as readonly string[]).includes(v) ? (v as HarvestDifficulty) : null
}

/** Filters an arbitrary array down to valid techniques. Returns null when
 *  the input isn't an array so callers can distinguish "not sent" from "sent empty". */
export function parseTechniques(v: unknown): Technique[] | null {
  if (!Array.isArray(v)) return null
  return v.filter((t): t is Technique => typeof t === "string" && (TECHNIQUES as readonly string[]).includes(t as Technique))
}
