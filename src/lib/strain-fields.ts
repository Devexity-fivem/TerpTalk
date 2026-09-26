// Controlled vocabularies for structured Strain metadata.
// Mirrors grow-fields.ts: small, enumerable vocab sets so catalog
// filtering is real data — not free-text that can never aggregate.
// Everything here is optional on the model: a strain with no metadata
// simply doesn't appear under that facet, it is never guessed.

export const STRAIN_TYPES = ["SATIVA", "INDICA", "HYBRID", "AUTO_FLOWER", "CBD", "OTHER"] as const

// Reported effects — the standard dispensary taxonomy, kept to values a
// grower would actually filter by.
export const STRAIN_EFFECTS = [
  "RELAXED",
  "HAPPY",
  "EUPHORIC",
  "UPLIFTED",
  "ENERGETIC",
  "CREATIVE",
  "FOCUSED",
  "GIGGLY",
  "TALKATIVE",
  "HUNGRY",
  "SLEEPY",
  "CALM",
] as const

// Dominant flavor/aroma families.
export const STRAIN_FLAVORS = [
  "EARTHY",
  "SWEET",
  "CITRUS",
  "BERRY",
  "TROPICAL",
  "SOUR",
  "DIESEL",
  "PINE",
  "SKUNK",
  "SPICY",
  "HERBAL",
  "FLORAL",
  "WOODY",
  "CHEESE",
  "MINT",
  "NUTTY",
] as const

// Cultivation difficulty — deliberately the same vocabulary as
// harvestDifficulty so "Easy/Normal/Hard" means one thing site-wide.
export const STRAIN_DIFFICULTIES = ["EASY", "NORMAL", "HARD"] as const

export type StrainType = (typeof STRAIN_TYPES)[number]
export type StrainEffect = (typeof STRAIN_EFFECTS)[number]
export type StrainFlavor = (typeof STRAIN_FLAVORS)[number]
export type StrainDifficulty = (typeof STRAIN_DIFFICULTIES)[number]

export const STRAIN_EFFECT_LABELS: Record<StrainEffect, string> = {
  RELAXED: "Relaxed",
  HAPPY: "Happy",
  EUPHORIC: "Euphoric",
  UPLIFTED: "Uplifted",
  ENERGETIC: "Energetic",
  CREATIVE: "Creative",
  FOCUSED: "Focused",
  GIGGLY: "Giggly",
  TALKATIVE: "Talkative",
  HUNGRY: "Hungry",
  SLEEPY: "Sleepy",
  CALM: "Calm",
}

export const STRAIN_FLAVOR_LABELS: Record<StrainFlavor, string> = {
  EARTHY: "Earthy",
  SWEET: "Sweet",
  CITRUS: "Citrus",
  BERRY: "Berry",
  TROPICAL: "Tropical",
  SOUR: "Sour",
  DIESEL: "Diesel",
  PINE: "Pine",
  SKUNK: "Skunk",
  SPICY: "Spicy",
  HERBAL: "Herbal",
  FLORAL: "Floral",
  WOODY: "Woody",
  CHEESE: "Cheese",
  MINT: "Mint",
  NUTTY: "Nutty",
}

export const STRAIN_DIFFICULTY_LABELS: Record<StrainDifficulty, string> = {
  EASY: "Easy",
  NORMAL: "Normal",
  HARD: "Hard",
}

// Sane bounds — THC is a reported % and flowering an estimate in weeks.
export const THC_MIN = 0
export const THC_MAX = 45
export const FLOWERING_MIN_WEEKS = 4
export const FLOWERING_MAX_WEEKS = 20
// AUTO_FLOWER seed-to-harvest — a wider window than flowering because it
// covers the full lifecycle (real breeder range is roughly 7–16 weeks).
export const SEED_TO_HARVEST_MIN_WEEKS = 6
export const SEED_TO_HARVEST_MAX_WEEKS = 24

const inVocab = <T extends string>(vocab: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (vocab as readonly string[]).includes(v)

/** Filters an arbitrary array down to valid vocab entries (deduped).
 *  Returns null when the input isn't an array so callers can tell
 *  "not sent" from "sent empty". */
export function parseStrainEffects(v: unknown): StrainEffect[] | null {
  if (!Array.isArray(v)) return null
  return [...new Set(v.filter((x): x is StrainEffect => inVocab(STRAIN_EFFECTS, x)))]
}

export function parseStrainFlavors(v: unknown): StrainFlavor[] | null {
  if (!Array.isArray(v)) return null
  return [...new Set(v.filter((x): x is StrainFlavor => inVocab(STRAIN_FLAVORS, x)))]
}

export function parseStrainDifficulty(v: unknown): StrainDifficulty | null {
  return inVocab(STRAIN_DIFFICULTIES, v) ? v : null
}

/** Finite number within THC bounds, else null. */
export function parseThc(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN
  return Number.isFinite(n) && n >= THC_MIN && n <= THC_MAX ? Math.round(n * 10) / 10 : null
}

/** Whole-week estimate within bounds, else null. */
export function parseFloweringWeeks(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN
  return Number.isFinite(n) && n >= FLOWERING_MIN_WEEKS && n <= FLOWERING_MAX_WEEKS ? Math.round(n) : null
}

/** AUTO_FLOWER whole-week seed-to-harvest estimate within bounds, else null. */
export function parseSeedToHarvestWeeks(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN
  return Number.isFinite(n) && n >= SEED_TO_HARVEST_MIN_WEEKS && n <= SEED_TO_HARVEST_MAX_WEEKS ? Math.round(n) : null
}
