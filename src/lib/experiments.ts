/**
 * Grow experiments — "I changed X because I observed Y, and I want to
 * see what happens."
 *
 * Pure module: vocabulary, validation, and the deterministic follow-up
 * rule. No Prisma imports — safe for client components (composer,
 * experiment card) and for the API routes.
 *
 * Honesty contract:
 * - outcome labels (WORKED / DID_NOT_WORK / INCONCLUSIVE) are only ever
 *   set by the grower — the platform never derives success from data.
 * - follow-up state is an explicit deterministic rule (below), not a
 *   manufactured reminder.
 * - renderers describe evidence ("observed after change") and never
 *   assert causality.
 */

// ── Vocabulary ──────────────────────────────────────────────────────

export const EXPERIMENT_CATEGORIES = [
  "ENVIRONMENT",
  "FEEDING",
  "TRAINING",
  "WATERING",
  "LIGHTING",
  "TECHNIQUE",
  "ISSUE_RESPONSE",
  "SETUP",
  "OTHER",
] as const
export type ExperimentCategory = (typeof EXPERIMENT_CATEGORIES)[number]

export const EXPERIMENT_CATEGORY_LABELS: Record<ExperimentCategory, string> = {
  ENVIRONMENT: "Environmental target",
  FEEDING: "Feeding approach",
  TRAINING: "Training method",
  WATERING: "Watering schedule",
  LIGHTING: "Light intensity / schedule",
  TECHNIQUE: "Technique",
  ISSUE_RESPONSE: "Issue response",
  SETUP: "Setup change",
  OTHER: "Other change",
}

export const EXPERIMENT_STATUSES = [
  "PLANNED",
  "ACTIVE",
  "OBSERVING",
  "COMPLETED",
  "ABANDONED",
] as const
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number]

export const EXPERIMENT_STATUS_LABELS: Record<ExperimentStatus, string> = {
  PLANNED: "Planned",
  ACTIVE: "Active",
  OBSERVING: "Observing",
  COMPLETED: "Completed",
  ABANDONED: "Abandoned",
}

/** Grower-stated outcomes only — never auto-derived. */
export const EXPERIMENT_OUTCOMES = ["WORKED", "DID_NOT_WORK", "INCONCLUSIVE"] as const
export type ExperimentOutcome = (typeof EXPERIMENT_OUTCOMES)[number]

export const EXPERIMENT_OUTCOME_LABELS: Record<ExperimentOutcome, string> = {
  WORKED: "Worked for me",
  DID_NOT_WORK: "Did not work",
  INCONCLUSIVE: "Inconclusive",
}

/** Terminal states — an ended experiment records endedAt. */
const ENDED: ReadonlySet<string> = new Set(["COMPLETED", "ABANDONED"])

// ── Follow-up rule ──────────────────────────────────────────────────
// Deterministic and documented — surfaced as "needs follow-up" only when
// one of these holds:
//   ACTIVE    && zero linked updates since the change started
//             → the grower declared a change but recorded nothing after it
//   OBSERVING && the most recent linked update is ≥3 days old
//             → observation started but has gone quiet (same 3-day signal
//               the product already uses for stale diaries)
// Everything else returns null — no manufactured urgency.

export const EXPERIMENT_FOLLOW_UP_DAYS = 3

export type ExperimentFollowUp = "awaiting_first_observation" | "awaiting_follow_up"

export function experimentFollowUp(input: {
  status: string
  observationCount: number
  lastObservationAt: Date | null
  now?: Date
}): ExperimentFollowUp | null {
  if (input.status === "ACTIVE" && input.observationCount === 0) {
    return "awaiting_first_observation"
  }
  if (input.status === "OBSERVING" && input.observationCount > 0 && input.lastObservationAt) {
    const days = Math.floor(
      ((input.now ?? new Date()).getTime() - input.lastObservationAt.getTime()) / 86400000
    )
    if (days >= EXPERIMENT_FOLLOW_UP_DAYS) return "awaiting_follow_up"
  }
  return null
}

export const EXPERIMENT_FOLLOW_UP_LABELS: Record<ExperimentFollowUp, string> = {
  awaiting_first_observation: "no observation recorded yet",
  awaiting_follow_up: "no follow-up in a while",
}

/** Canonical experiment lines — shared by the intel API (owner scope)
 *  and any other deterministic surface. Descriptive, never advisory. */
export function renderExperimentLines(
  experiments: { title: string; status: string; followUp: ExperimentFollowUp | null; observationCount: number }[]
): string[] {
  if (!experiments.length) {
    return ["No experiments documented on this grow — log a change you're watching to start one."]
  }
  const lines = experiments.slice(0, 6).map((e) => {
    const state = EXPERIMENT_STATUS_LABELS[e.status as ExperimentStatus] ?? e.status.toLowerCase()
    const obs = e.observationCount
    const tail = e.followUp ? ` — ${EXPERIMENT_FOLLOW_UP_LABELS[e.followUp]}` : ""
    return `• "${e.title}" — ${state} · ${obs} observation${obs === 1 ? "" : "s"}${tail}`
  })
  return [`Experiments on this grow (${experiments.length}):`, ...lines]
}

// ── Validation ──────────────────────────────────────────────────────

const TITLE_MAX = 120
const TEXT_MAX = 600

export type ExperimentParse =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string }

const bad = (error: string): ExperimentParse => ({ ok: false, error })

function cleanStr(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  if (!t || t.length > max) return null
  return t
}

/** Create payload: title + change required; everything else optional. */
export function parseExperimentCreate(body: unknown): ExperimentParse {
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("Invalid request body")
  const b = body as Record<string, unknown>
  const allowed = new Set([
    "title", "change", "reason", "expected", "category", "baseline", "status", "startedAt",
  ])
  for (const key of Object.keys(b)) {
    if (!allowed.has(key)) return bad(`Unknown field: ${key}`)
  }

  const title = cleanStr(b.title, TITLE_MAX)
  if (!title) return bad("Title is required")
  const change = cleanStr(b.change, TEXT_MAX)
  if (!change) return bad("Describe what changed")

  const data: Record<string, unknown> = { title, change }

  for (const key of ["reason", "expected", "baseline"] as const) {
    if (b[key] === undefined || b[key] === null) continue
    const v = cleanStr(b[key], TEXT_MAX)
    if (v === null) return bad(`Invalid ${key}`)
    data[key] = v
  }

  if (b.category !== undefined) {
    if (typeof b.category !== "string" || !EXPERIMENT_CATEGORIES.includes(b.category as ExperimentCategory)) {
      return bad("Invalid category")
    }
    data.category = b.category
  }
  // Only PLANNED or ACTIVE at creation — OBSERVING/COMPLETED are reached
  // through recorded evidence or explicit transitions.
  if (b.status !== undefined) {
    if (b.status !== "PLANNED" && b.status !== "ACTIVE") return bad("Invalid status")
    data.status = b.status
  }
  if (b.startedAt !== undefined) {
    const d = new Date(b.startedAt as string)
    if (Number.isNaN(d.getTime()) || d.getTime() > Date.now() + 86400000) return bad("Invalid start date")
    data.startedAt = d
  }
  return { ok: true, data }
}

/** Patch payload: owner edits fields and moves the lifecycle. */
export function parseExperimentPatch(body: unknown): ExperimentParse {
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("Invalid request body")
  const b = body as Record<string, unknown>
  const allowed = new Set([
    "title", "change", "reason", "expected", "category", "baseline",
    "status", "outcome", "conclusion", "startedAt",
  ])
  for (const key of Object.keys(b)) {
    if (!allowed.has(key)) return bad(`Unknown field: ${key}`)
  }
  const data: Record<string, unknown> = {}

  if ("title" in b) {
    const v = cleanStr(b.title, TITLE_MAX)
    if (!v) return bad("Invalid title")
    data.title = v
  }
  if ("change" in b) {
    const v = cleanStr(b.change, TEXT_MAX)
    if (!v) return bad("Invalid change")
    data.change = v
  }
  for (const key of ["reason", "expected", "baseline", "conclusion"] as const) {
    if (!(key in b)) continue
    if (b[key] === null) { data[key] = null; continue }
    const v = cleanStr(b[key], TEXT_MAX)
    if (v === null) return bad(`Invalid ${key}`)
    data[key] = v
  }
  if ("category" in b) {
    if (typeof b.category !== "string" || !EXPERIMENT_CATEGORIES.includes(b.category as ExperimentCategory)) {
      return bad("Invalid category")
    }
    data.category = b.category
  }
  if ("status" in b) {
    if (typeof b.status !== "string" || !EXPERIMENT_STATUSES.includes(b.status as ExperimentStatus)) {
      return bad("Invalid status")
    }
    data.status = b.status
    // Ending states stamp endedAt; re-opening clears it.
    data.endedAt = ENDED.has(b.status) ? new Date() : null
  }
  if ("outcome" in b) {
    if (b.outcome === null) { data.outcome = null }
    else if (typeof b.outcome !== "string" || !EXPERIMENT_OUTCOMES.includes(b.outcome as ExperimentOutcome)) {
      return bad("Invalid outcome")
    } else {
      data.outcome = b.outcome
    }
  }
  if ("startedAt" in b) {
    const d = new Date(b.startedAt as string)
    if (Number.isNaN(d.getTime()) || d.getTime() > Date.now() + 86400000) return bad("Invalid start date")
    data.startedAt = d
  }
  return { ok: true, data }
}

// ── Diary lessons (JSON column on GrowDiary) ────────────────────────
// Structured grower-recorded lessons — their own conclusions, never
// generated. Fixed key set so the UI and aggregates stay predictable.

export const LESSON_KEYS = [
  "worked",
  "change",
  "repeat",
  "avoid",
  "surprised",
  "learned",
] as const
export type LessonKey = (typeof LESSON_KEYS)[number]

export const LESSON_LABELS: Record<LessonKey, string> = {
  worked: "What worked for me",
  change: "What I would change",
  repeat: "What I want to repeat",
  avoid: "What I would avoid",
  surprised: "What surprised me",
  learned: "What I learned",
}

export type GrowLessons = Partial<Record<LessonKey, string>>

/** Validate an arbitrary JSON value into a GrowLessons map (or null to clear). */
export function parseLessons(value: unknown): { ok: true; lessons: GrowLessons | null } | { ok: false; error: string } {
  if (value === null) return { ok: true, lessons: null }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Invalid lessons" }
  }
  const out: GrowLessons = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!LESSON_KEYS.includes(k as LessonKey)) return { ok: false, error: `Unknown lesson key: ${k}` }
    if (v === null || v === undefined) continue
    if (typeof v !== "string" || !v.trim() || v.length > TEXT_MAX) {
      return { ok: false, error: `Invalid lesson: ${k}` }
    }
    out[k as LessonKey] = v.trim()
  }
  return { ok: true, lessons: Object.keys(out).length ? out : null }
}

/** Read a diary's lessons JSON column safely. */
export function readLessons(value: unknown): GrowLessons {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const out: GrowLessons = {}
  for (const k of LESSON_KEYS) {
    const v = (value as Record<string, unknown>)[k]
    if (typeof v === "string" && v.trim()) out[k] = v
  }
  return out
}

// ── Serialization ───────────────────────────────────────────────────

export interface ExperimentView {
  id: string
  diaryId: string
  title: string
  change: string
  reason: string | null
  expected: string | null
  category: ExperimentCategory
  status: ExperimentStatus
  outcome: ExperimentOutcome | null
  conclusion: string | null
  baseline: string | null
  startedAt: string
  endedAt: string | null
  createdAt: string
  observationCount: number
  lastObservationAt: string | null
  followUp: ExperimentFollowUp | null
}

type ExperimentRow = {
  id: string
  diaryId: string
  title: string
  change: string
  reason: string | null
  expected: string | null
  category: string
  status: string
  outcome: string | null
  conclusion: string | null
  baseline: string | null
  startedAt: Date
  endedAt: Date | null
  createdAt: Date
  updates: { createdAt: Date }[]
}

export function serializeExperiment(row: ExperimentRow, now = new Date(), observationCount?: number): ExperimentView {
  const observations = row.updates
  // `updates` is a bounded include (latest few, for lastObservationAt) —
  // the true linked count comes from _count when the caller fetched it.
  const obsCount = observationCount ?? observations.length
  const lastObs = observations.length
    ? observations.reduce((a, b) => (a.createdAt > b.createdAt ? a : b)).createdAt
    : null
  return {
    id: row.id,
    diaryId: row.diaryId,
    title: row.title,
    change: row.change,
    reason: row.reason,
    expected: row.expected,
    category: (EXPERIMENT_CATEGORIES.includes(row.category as ExperimentCategory)
      ? row.category
      : "OTHER") as ExperimentCategory,
    status: (EXPERIMENT_STATUSES.includes(row.status as ExperimentStatus)
      ? row.status
      : "ACTIVE") as ExperimentStatus,
    outcome: EXPERIMENT_OUTCOMES.includes(row.outcome as ExperimentOutcome)
      ? (row.outcome as ExperimentOutcome)
      : null,
    conclusion: row.conclusion,
    baseline: row.baseline,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    observationCount: obsCount,
    lastObservationAt: lastObs?.toISOString() ?? null,
    followUp: experimentFollowUp({
      status: row.status,
      observationCount: obsCount,
      lastObservationAt: lastObs,
      now,
    }),
  }
}
