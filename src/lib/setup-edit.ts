// GrowSetup editing — pure validation for PATCH /api/setups.
// Kept DB-free so the allowlist/field rules are directly testable; the
// route adds ownership, image-diff, and write logic on top of this result.
//
// Scope contract (mirrors Diary Update Editing):
// - Partial-update semantics: omitted keys are left unchanged.
// - `null` clears nullable spec fields; title is NOT NULL (non-empty),
//   description is NOT NULL (empty string allowed, matching creation).
// - `id` is the routing key — recognized, never written to `data`.
// - authorId, deleted, createdAt, updatedAt and any unknown key are
//   protected — any attempt → 400.
// - This endpoint never writes diary links or comments.

import { LIMITS } from "@/lib/security"
import { MAX_DATA_URI_LEN } from "@/lib/blob"

/** Keys a setup owner may PATCH. `id` is the routing key — it produces no
 *  data entry. keepImageIds/images drive the image diff, not scalar writes. */
export const SETUP_EDITABLE_FIELDS = new Set([
  "id",
  "title",
  "description",
  "space",
  "tent",
  "lighting",
  "ventilation",
  "fans",
  "containers",
  "medium",
  "nutrients",
  "controllers",
  "equipment",
  "strain",
  "keepImageIds",
  "images",
])

// Free-text spec fields — the creation route caps every one of these at 500.
export const SETUP_SPEC_FIELDS = [
  "space",
  "tent",
  "lighting",
  "ventilation",
  "fans",
  "containers",
  "medium",
  "nutrients",
  "controllers",
  "equipment",
  "strain",
] as const

export const SETUP_SPEC_MAX = 500
export const SETUP_MAX_IMAGES = 6

const DATA_URI_PREFIX = /^data:image\/(png|jpe?g|webp);base64,/

export type SetupPatchResult =
  | {
      ok: true
      /** Routing key — the setup to edit. Never part of `data`. */
      id: string | null
      data: Record<string, unknown>
      /** Existing image ids to keep, or undefined = keep all. */
      keepImageIds: string[] | undefined
      /** New data-URI images to append, or undefined = none. */
      newImages: string[] | undefined
    }
  | { ok: false; error: string }

const bad = (error: string): SetupPatchResult => ({ ok: false, error })

/**
 * Validates a PATCH body into a Prisma update payload plus image controls.
 * Unknown/protected keys reject the whole request — same mass-assignment
 * contract as parseDiaryPatch / parseUpdatePatch.
 */
export function parseSetupPatch(body: unknown): SetupPatchResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return bad("Invalid request body")
  }
  for (const key of Object.keys(body)) {
    if (!SETUP_EDITABLE_FIELDS.has(key)) return bad(`Field cannot be edited: ${key}`)
  }
  const b = body as Record<string, unknown>
  const data: Record<string, unknown> = {}

  const id = typeof b.id === "string" && b.id ? b.id : null
  if ("id" in b && id === null) return bad("Invalid setup id")

  // title — required non-empty when supplied (creation contract).
  if ("title" in b) {
    if (typeof b.title !== "string" || !b.title.trim()) return bad("Invalid title")
    if (b.title.length > LIMITS.TITLE_MAX) return bad("Content exceeds maximum length")
    data.title = b.title
  }
  // description is NOT NULL — null is not a valid value, empty string is
  // (creation accepts an empty description through the form).
  if ("description" in b) {
    if (typeof b.description !== "string") return bad("Invalid description")
    if (b.description.length > SETUP_SPEC_MAX) return bad("A field exceeds maximum length")
    data.description = b.description
  }
  // Nullable free-text specs — null clears, strings trim to null when empty.
  for (const key of SETUP_SPEC_FIELDS) {
    if (!(key in b)) continue
    const v = b[key]
    if (v !== null && typeof v !== "string") return bad(`Invalid ${key}`)
    if (typeof v === "string" && v.length > SETUP_SPEC_MAX) return bad("A field exceeds maximum length")
    data[key] = typeof v === "string" ? v.trim() || null : null
  }

  let keepImageIds: string[] | undefined
  if ("keepImageIds" in b) {
    if (
      !Array.isArray(b.keepImageIds) ||
      b.keepImageIds.length > 30 ||
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
      b.images.length > SETUP_MAX_IMAGES ||
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
 * Does this patch change `strain`? Strain pages count setups by free-text
 * match — that's the only setup field feeding a cached aggregate. Drives
 * the narrow "strains" bust; nothing else invalidates on a setup edit.
 */
export function setupPatchTouchesStrainStats(
  before: { strain: string | null },
  data: Record<string, unknown>
): boolean {
  return "strain" in data && before.strain !== data.strain
}
