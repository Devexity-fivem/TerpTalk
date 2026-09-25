// DiaryUpdate editing — pure validation for PATCH /api/diaries/updates.
// Kept DB-free so the allowlist/field rules are directly testable; the
// route adds ownership, image-diff, and write logic on top of this result.
//
// Scope contract (see planning pass):
// - Partial-update semantics: omitted keys are left unchanged.
// - `null` clears nullable fields; title/content/stage are NOT NULL.
// - `id` is the routing key — recognized, never written to `data`.
// - diaryId, authorId, createdAt, updatedAt, dayNumber, weekNumber and
//   any unknown key are protected — any attempt → 400.
// - createdAt is authoritative chronology for every analytic; it is never
//   editable. A stage edit legitimately rewrites that update's stage label;
//   it must not touch the parent diary's current stage (handled by the
//   route simply never writing GrowDiary).

import { LIMITS } from "@/lib/security"
import { MAX_DATA_URI_LEN } from "@/lib/blob"

/** Keys a diary owner may PATCH. `id` is the routing key — it produces no
 *  data entry. keepImageIds/images drive the image diff, not scalar writes. */
export const UPDATE_EDITABLE_FIELDS = new Set([
  "id",
  "title",
  "content",
  "stage",
  "temperature",
  "humidity",
  "vpd",
  "ph",
  "ec",
  "heightCm",
  "nightTemperature",
  "substrateTemperature",
  "co2Ppm",
  "wateringLiters",
  "ppfd",
  "photoperiodHours",
  "runoffPh",
  "runoffEc",
  "lampDistanceCm",
  "feeding",
  "training",
  "nutrients",
  "keepImageIds",
  "images",
])

// Single source of truth for update validation — the creation route imports
// these rather than keeping a second inline copy.
export const UPDATE_STAGES = new Set([
  "GERMINATION",
  "SEEDLING",
  "VEGETATIVE",
  "FLOWER",
  "HARVEST",
  "DRYING",
  "CURING",
  "COMPLETED",
])

/** [field, min, max] sanity bounds — identical to creation.
 *  Temperatures are °F (the product's stored unit), distances cm,
 *  EC mS/cm, VPD kPa, watering liters, photoperiod hours. */
export const UPDATE_NUMERIC_RANGES = [
  ["temperature", -40, 140],
  ["humidity", 0, 100],
  ["vpd", 0, 6],
  ["ph", 0, 14],
  ["ec", 0, 15],
  ["heightCm", 0.1, 500],
  // Approved band 0–50°C expressed in the stored unit (°F): 32–122°F.
  ["nightTemperature", 32, 122],
  ["substrateTemperature", 32, 122],
  ["co2Ppm", 300, 2500],
  ["wateringLiters", 0, 50],
  ["ppfd", 0, 2500],
  ["photoperiodHours", 0, 24],
  ["runoffPh", 3, 10],
  ["runoffEc", 0, 10],
  ["lampDistanceCm", 5, 300],
  ["dayNumber", 0, 1000],
  ["weekNumber", 0, 150],
] as const

export const UPDATE_MAX_IMAGES = 4

/** Structured nutrient rows — Slice B. Bounds on the child collection, not
 *  on DiaryUpdate scalars. */
export const UPDATE_MAX_NUTRIENTS = 20
export const NUTRIENT_NAME_MAX = 100
export const NUTRIENT_DOSE_RANGE = [0, 100] as const // mL/L

export interface NutrientRow {
  productName: string
  doseMlPerL: number | null
}

/** Display form: trim + collapse internal whitespace. The comparison key
 *  lowercases on top so "Bloom" / " bloom " / "BLOOM" collide — duplicates
 *  are rejected, never silently merged. */
const normalizeNutrientName = (v: string) => v.trim().replace(/\s+/g, " ")
const nutrientKey = (v: string) => normalizeNutrientName(v).toLowerCase()

/**
 * Validates a supplied `nutrients` collection into rows for a nested
 * create / replace write. Omission is handled by the caller (`undefined` =
 * untouched) — this helper only sees supplied values, so `null`, non-arrays,
 * malformed rows and normalized duplicates are all hard rejections.
 */
export function parseNutrientRows(input: unknown): { ok: true; rows: NutrientRow[] } | { ok: false; error: string } {
  if (input === null) return { ok: false, error: "Invalid nutrients" }
  if (!Array.isArray(input)) return { ok: false, error: "Invalid nutrients" }
  if (input.length > UPDATE_MAX_NUTRIENTS) return { ok: false, error: "Too many nutrients" }
  const rows: NutrientRow[] = []
  const seen = new Set<string>()
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, error: "Invalid nutrient row" }
    }
    for (const key of Object.keys(item)) {
      if (key !== "productName" && key !== "doseMlPerL") {
        return { ok: false, error: `Unknown nutrient field: ${key}` }
      }
    }
    const raw = (item as Record<string, unknown>).productName
    if (typeof raw !== "string") return { ok: false, error: "Invalid nutrient name" }
    const productName = normalizeNutrientName(raw)
    if (!productName || productName.length > NUTRIENT_NAME_MAX) {
      return { ok: false, error: "Invalid nutrient name" }
    }
    const dose = (item as Record<string, unknown>).doseMlPerL
    let doseMlPerL: number | null = null
    if (dose !== undefined && dose !== null) {
      if (typeof dose !== "number" || !Number.isFinite(dose)) {
        return { ok: false, error: "Invalid nutrient dose" }
      }
      if (dose < NUTRIENT_DOSE_RANGE[0] || dose > NUTRIENT_DOSE_RANGE[1]) {
        return { ok: false, error: "Nutrient dose out of range" }
      }
      doseMlPerL = dose
    }
    const key = nutrientKey(raw)
    if (seen.has(key)) return { ok: false, error: "Duplicate nutrient name" }
    seen.add(key)
    rows.push({ productName, doseMlPerL })
  }
  return { ok: true, rows }
}

const DATA_URI_PREFIX = /^data:image\/(png|jpe?g|webp);base64,/

export const cleanUpdateString = (v: unknown, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) || null : null

export type UpdatePatchResult =
  | {
      ok: true
      /** Routing key — the update to edit. Never part of `data`. */
      id: string | null
      data: Record<string, unknown>
      /** Existing image ids to keep, or undefined = keep all. */
      keepImageIds: string[] | undefined
      /** New data-URI images to append, or undefined = none. */
      newImages: string[] | undefined
      /** Validated nutrient rows — undefined = key omitted, leave rows
       *  untouched; [] = clear all; [...] = replace the collection. */
      nutrients: NutrientRow[] | undefined
    }
  | { ok: false; error: string }

const bad = (error: string): UpdatePatchResult => ({ ok: false, error })

/**
 * Validates a PATCH body into a Prisma update payload plus image controls.
 * Unknown/protected keys reject the whole request — same mass-assignment
 * contract as parseDiaryPatch.
 */
export function parseUpdatePatch(body: unknown): UpdatePatchResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return bad("Invalid request body")
  }
  for (const key of Object.keys(body)) {
    if (!UPDATE_EDITABLE_FIELDS.has(key)) return bad(`Field cannot be edited: ${key}`)
  }
  const b = body as Record<string, unknown>
  const data: Record<string, unknown> = {}

  const id = typeof b.id === "string" && b.id ? b.id : null
  if ("id" in b && id === null) return bad("Invalid update id")

  if ("title" in b) {
    if (typeof b.title !== "string" || !b.title.trim()) return bad("Invalid title")
    if (b.title.length > LIMITS.DIARY_TITLE_MAX) return bad("Content exceeds maximum length")
    data.title = b.title
  }
  if ("content" in b) {
    if (typeof b.content !== "string" || !b.content.trim()) return bad("Invalid content")
    if (b.content.length > LIMITS.POST_CONTENT_MAX) return bad("Content exceeds maximum length")
    data.content = b.content
  }
  // stage is NOT NULL — null is not a valid value here.
  if ("stage" in b) {
    if (typeof b.stage !== "string" || !UPDATE_STAGES.has(b.stage)) return bad("Invalid stage")
    data.stage = b.stage
  }
  // Nullable environment/measurement fields — number or null (clears).
  for (const [field, lo, hi] of UPDATE_NUMERIC_RANGES) {
    if (field === "dayNumber" || field === "weekNumber") continue // derived, never editable
    if (!(field in b)) continue
    const v = b[field]
    if (v !== null && (typeof v !== "number" || !Number.isFinite(v))) return bad(`${field} must be a number`)
    if (typeof v === "number" && Number.isFinite(v) && (v < lo || v > hi)) return bad(`${field} is out of range`)
    data[field] = v
  }
  // Nullable free-text notes — same ≤300 cleanup as creation.
  for (const key of ["feeding", "training"] as const) {
    if (!(key in b)) continue
    const v = b[key]
    if (v !== null && typeof v !== "string") return bad(`Invalid ${key}`)
    data[key] = cleanUpdateString(v, 300)
  }

  let keepImageIds: string[] | undefined
  if ("keepImageIds" in b) {
    if (
      !Array.isArray(b.keepImageIds) ||
      b.keepImageIds.length > 20 ||
      !b.keepImageIds.every((i: unknown) => typeof i === "string" && i)
    ) {
      return bad("Invalid keepImageIds")
    }
    keepImageIds = b.keepImageIds as string[]
  }

  let newImages: string[] | undefined
  if ("images" in b) {
    if (
      !Array.isArray(b.images) ||
      b.images.length > UPDATE_MAX_IMAGES ||
      !b.images.every(
        (i: unknown) => typeof i === "string" && DATA_URI_PREFIX.test(i) && i.length <= MAX_DATA_URI_LEN
      )
    ) {
      return bad("Invalid images")
    }
    newImages = b.images as string[]
  }

  let nutrients: NutrientRow[] | undefined
  if ("nutrients" in b) {
    const parsed = parseNutrientRows(b.nutrients)
    if (!parsed.ok) return bad(parsed.error)
    nutrients = parsed.rows
  }

  return { ok: true, id, data, keepImageIds, newImages, nutrients }
}

/**
 * Pure image diff: which existing images survive a keep-list. Foreign ids in
 * keepImageIds are ignored — only rows on this update can be kept or removed.
 */
export function diffUpdateImages<T extends { id: string }>(
  existing: T[],
  keepImageIds: string[] | undefined
): { kept: T[]; removed: T[] } {
  if (keepImageIds === undefined) return { kept: existing, removed: [] }
  const keep = new Set(keepImageIds)
  return {
    kept: existing.filter((i) => keep.has(i.id)),
    removed: existing.filter((i) => !keep.has(i.id)),
  }
}

const STRAIN_STAT_UPDATE_FIELDS = ["stage", "temperature", "humidity", "vpd", "ph", "ec"] as const

/**
 * Does this patch change a field strain statistics aggregate on (stage
 * medians, flower onset, env averages)? Drives the narrow "strains" bust —
 * a title/image/height-only edit must not invalidate strain pages.
 * The "analytics" tag is deliberately not covered: community aggregates
 * never read DiaryUpdate.
 */
export function updatePatchTouchesStrainStats(
  before: {
    stage: string
    temperature: number | null
    humidity: number | null
    vpd: number | null
    ph: number | null
    ec: number | null
  },
  data: Record<string, unknown>
): boolean {
  return STRAIN_STAT_UPDATE_FIELDS.some((f) => f in data && before[f] !== data[f])
}
