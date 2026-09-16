// Diary metadata editing — pure validation for PATCH /api/diaries/[id].
// Kept DB-free so the allowlist/field rules are directly testable; the
// route adds the async strain/setup lookups on top of this result.
//
// Scope contract (see planning pass):
// - Partial-update semantics: omitted keys are left unchanged.
// - `null` is accepted only where the column is nullable.
// - startDate, stage, harvest state, threadId, authorId, featured,
//   deleted and timestamps are protected — any attempt → 400.
// - Nothing here rewrites DiaryUpdate rows or discussion content.

import { LIMITS } from "@/lib/security"
import {
  GROW_TYPES,
  parseMediumType,
  parseLightType,
  parseTechniques,
} from "@/lib/grow-fields"

/** Keys a diary owner may PATCH — everything else is rejected. */
export const DIARY_EDITABLE_FIELDS = new Set([
  "title",
  "description",
  "strain",
  "strainId",
  "genetics",
  "growType",
  "medium",
  "mediumType",
  "containerSize",
  "lighting",
  "lightType",
  "nutrients",
  "equipment",
  "techniques",
  "spaceDimensions",
  "setupId",
])

const METADATA_MAX = 500 // matches the creation route's string-field cap

export type DiaryPatchResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string }

const bad = (error: string): DiaryPatchResult => ({ ok: false, error })

/**
 * Validates a PATCH body into a Prisma update payload. `strainId`/`setupId`
 * pass through shape-validated only — the route must still verify the
 * strain exists and the setup belongs to the caller.
 */
export function parseDiaryPatch(body: unknown): DiaryPatchResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return bad("Invalid request body")
  }
  for (const key of Object.keys(body)) {
    if (!DIARY_EDITABLE_FIELDS.has(key)) return bad(`Field cannot be edited: ${key}`)
  }
  const b = body as Record<string, unknown>
  const data: Record<string, unknown> = {}

  // title — required non-empty when supplied (creation contract).
  if ("title" in b) {
    if (typeof b.title !== "string" || !b.title.trim()) return bad("Invalid title")
    if (b.title.length > LIMITS.DIARY_TITLE_MAX) return bad("Content exceeds maximum length")
    data.title = b.title
  }
  // description is NOT NULL — null is not a valid value here.
  if ("description" in b) {
    if (typeof b.description !== "string") return bad("Invalid description")
    if (b.description.length > LIMITS.DESCRIPTION_MAX) return bad("Content exceeds maximum length")
    data.description = b.description
  }
  // Free-text strain — kept when the catalog link is removed; the route
  // overwrites it with the catalog name when a strainId is supplied.
  if ("strain" in b) {
    if (b.strain !== null && typeof b.strain !== "string") return bad("Invalid strain")
    if (typeof b.strain === "string" && b.strain.length > METADATA_MAX) return bad("A field exceeds maximum length")
    data.strain = typeof b.strain === "string" ? b.strain.trim() || null : null
  }
  // Catalog link — shape only; existence check happens in the route.
  if ("strainId" in b) {
    if (b.strainId !== null && typeof b.strainId !== "string") return bad("Invalid strain")
    data.strainId = typeof b.strainId === "string" && b.strainId.trim() ? b.strainId : null
  }
  // Remaining nullable free-text fields — same ≤500 cap as creation.
  for (const key of ["genetics", "medium", "containerSize", "lighting", "nutrients", "equipment", "spaceDimensions"] as const) {
    if (!(key in b)) continue
    const v = b[key]
    if (v !== null && typeof v !== "string") return bad(`Invalid ${key}`)
    if (typeof v === "string" && v.length > METADATA_MAX) return bad("A field exceeds maximum length")
    data[key] = typeof v === "string" ? v.trim() || null : null
  }

  if ("growType" in b) {
    if (typeof b.growType !== "string" || !(GROW_TYPES as readonly string[]).includes(b.growType)) {
      return bad("Invalid grow type")
    }
    data.growType = b.growType
  }
  if ("mediumType" in b) {
    const v = parseMediumType(b.mediumType)
    if (b.mediumType != null && !v) return bad("Invalid medium type")
    data.mediumType = v
  }
  if ("lightType" in b) {
    const v = parseLightType(b.lightType)
    if (b.lightType != null && !v) return bad("Invalid light type")
    data.lightType = v
  }
  // techniques is a non-nullable String[] — strict like creation: a
  // non-array, null, or any out-of-vocabulary value rejects the request.
  if ("techniques" in b) {
    const v = parseTechniques(b.techniques)
    if (!Array.isArray(b.techniques) || !v || v.length !== (b.techniques as unknown[]).length) {
      return bad("Invalid techniques")
    }
    data.techniques = v
  }
  // Setup link — shape only; the route verifies ownership.
  if ("setupId" in b) {
    if (b.setupId !== null && typeof b.setupId !== "string") return bad("Invalid setup")
    data.setupId = typeof b.setupId === "string" && b.setupId.trim() ? b.setupId : null
  }

  return { ok: true, data }
}

const STRAIN_STAT_FIELDS = ["strain", "strainId", "mediumType", "lightType", "techniques"] as const

/**
 * Does this patch change a field that strain statistics aggregate on?
 * Drives the narrow "strains" cache bust — a title-only edit must not
 * invalidate strain pages.
 */
export function patchTouchesStrainStats(
  before: { strain: string | null; strainId: string | null; mediumType: string | null; lightType: string | null; techniques: string[] },
  data: Record<string, unknown>
): boolean {
  return STRAIN_STAT_FIELDS.some((f) => {
    if (!(f in data)) return false
    if (f === "techniques") {
      const next = (data.techniques as string[]).slice().sort().join(",")
      return before.techniques.slice().sort().join(",") !== next
    }
    return before[f] !== data[f]
  })
}
