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
  "feeding",
  "training",
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

/** [field, min, max] sanity bounds — identical to creation. */
export const UPDATE_NUMERIC_RANGES = [
  ["temperature", -40, 140],
  ["humidity", 0, 100],
  ["vpd", 0, 6],
  ["ph", 0, 14],
  ["ec", 0, 15],
  ["heightCm", 0.1, 500],
  ["dayNumber", 0, 1000],
  ["weekNumber", 0, 150],
] as const

export const UPDATE_MAX_IMAGES = 4

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
    if (v !== null && typeof v !== "number") return bad(`${field} must be a number`)
    if (typeof v === "number" && (v < lo || v > hi)) return bad(`${field} is out of range`)
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

  return { ok: true, id, data, keepImageIds, newImages }
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
