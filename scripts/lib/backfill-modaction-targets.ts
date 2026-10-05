// Guarded correlation + write logic for the one-time ModerationAction
// target backfill. See scripts/backfill-modaction-targets.mts (CLI).
//
// Safety rules (hard requirements, never relaxed):
//   - only rows with targetId IS NULL AND targetType IS NULL
//   - only action types that carry a content target (CONTENT_DELETION,
//     MOVE_THREAD)
//   - exactly ONE candidate SecurityEvent — zero or multiple => skip
//   - candidate metadata must name the same action type and carry
//     targetId (targetType may be implied for MOVE_THREAD — see below)
//   - existing target fields are never overwritten
import type { PrismaClient } from "@prisma/client"

const CONTENT_ACTION_TYPES = new Set(["CONTENT_DELETION", "MOVE_THREAD"])
// Correlation window — the SecurityEvent is written immediately after the
// action transaction (observed pairs: 4–105ms). 500ms keeps same-actor
// bursts of separate deletions (>4s apart in practice) from colliding;
// anything outside simply stays skipped rather than mis-assigned.
const WINDOW_MS = 500

type Db = Pick<PrismaClient, "moderationAction" | "securityEvent">

interface Candidate {
  securityEventId: string
  targetType: string
  targetId: string
  deltaMs: number
}

export interface BackfillRow {
  actionId: string
  actionType: string
  createdAt: Date
  status: "eligible" | "skipped-zero-candidates" | "skipped-ambiguous" | "skipped-malformed"
  candidate?: Candidate
  candidates?: Candidate[]
}

function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const m = JSON.parse(raw)
    return m && typeof m === "object" ? (m as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export async function collectBackfillRows(db: Db): Promise<BackfillRow[]> {
  const actions = await db.moderationAction.findMany({
    where: { targetId: null, targetType: null, type: { in: [...CONTENT_ACTION_TYPES] } },
    select: { id: true, type: true, moderatorId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  })

  const rows: BackfillRow[] = []
  for (const a of actions) {
    const events = await db.securityEvent.findMany({
      where: {
        type: "SUSPICIOUS_ACTIVITY",
        userId: a.moderatorId,
        createdAt: { gte: new Date(a.createdAt.getTime() - WINDOW_MS), lte: new Date(a.createdAt.getTime() + WINDOW_MS) },
        metadata: { contains: `"moderationAction":"${a.type}"` },
      },
      select: { id: true, metadata: true, createdAt: true },
    })

    const candidates: Candidate[] = []
    let malformed = false
    for (const e of events) {
      const m = parseMetadata(e.metadata)
      if (!m || m.moderationAction !== a.type) continue
      // Older MOVE_THREAD events omit targetType — the action type only
      // ever targets threads, so the type is implied, not guessed.
      const targetType =
        typeof m.targetType === "string" && m.targetType ? m.targetType : a.type === "MOVE_THREAD" ? "THREAD" : null
      const targetId = typeof m.targetId === "string" && m.targetId ? m.targetId : null
      if (!targetType || !targetId) {
        malformed = true
        continue
      }
      candidates.push({
        securityEventId: e.id,
        targetType,
        targetId,
        deltaMs: Math.abs(e.createdAt.getTime() - a.createdAt.getTime()),
      })
    }

    if (candidates.length === 1) {
      rows.push({ actionId: a.id, actionType: a.type, createdAt: a.createdAt, status: "eligible", candidate: candidates[0] })
    } else if (candidates.length > 1) {
      rows.push({ actionId: a.id, actionType: a.type, createdAt: a.createdAt, status: "skipped-ambiguous", candidates })
    } else if (malformed) {
      rows.push({ actionId: a.id, actionType: a.type, createdAt: a.createdAt, status: "skipped-malformed" })
    } else {
      rows.push({ actionId: a.id, actionType: a.type, createdAt: a.createdAt, status: "skipped-zero-candidates" })
    }
  }
  return rows
}

export async function applyBackfill(db: Db, rows: BackfillRow[]) {
  const eligible = rows.filter((r) => r.status === "eligible")
  const written: string[] = []
  for (const r of eligible) {
    // Double-guard at write time: only fill rows that are still NULL so a
    // concurrent write can never be overwritten.
    const res = await db.moderationAction.updateMany({
      where: { id: r.actionId, targetId: null, targetType: null },
      data: { targetId: r.candidate!.targetId, targetType: r.candidate!.targetType },
    })
    if (res.count === 1) written.push(r.actionId)
  }
  return { written }
}

export { CONTENT_ACTION_TYPES }
