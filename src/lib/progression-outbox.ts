// Durable ProgressionEvent reversal outbox — field-for-field port of the
// legacy reputation outbox onto PendingXpReversal. Same guarantees: intent
// written inside the mutating transaction, CAS-claimed drains, fixpoint
// completion proofs, DEAD escalation after MAX_ATTEMPTS.
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import {
  reverseProgressionBySource,
  reverseProgressionByKey,
  reverseProgressionByActor,
  reinstateProgressionByKey,
  ACTOR_GRANTED_TYPES,
} from "@/lib/progression"
import { keyedInteractionActive } from "@/lib/interaction-state"
import { logSecurityEvent } from "@/lib/security"

type Db = Prisma.TransactionClient | typeof prisma

export interface XpReversalIntent {
  kind: "SOURCE" | "KEY" | "ACTOR"
  eventKey?: string
  sourceType?: string
  sourceId?: string
  actorId?: string
  reason: string
  requestedBy?: string
}

export async function enqueueXpReversal(db: Db, intent: XpReversalIntent): Promise<string> {
  const row = await db.pendingXpReversal.create({
    data: {
      kind: intent.kind,
      eventKey: intent.eventKey ?? null,
      sourceType: intent.sourceType ?? null,
      sourceId: intent.sourceId ?? null,
      actorId: intent.actorId ?? null,
      reason: intent.reason,
      requestedBy: intent.requestedBy ?? null,
    },
    select: { id: true },
  })
  return row.id
}

/** Batch form — one INSERT for N intents; ids in input order. */
export async function enqueueXpReversals(db: Db, intents: XpReversalIntent[]): Promise<string[]> {
  if (intents.length === 0) return []
  const rows = await db.pendingXpReversal.createManyAndReturn({
    data: intents.map((intent) => ({
      kind: intent.kind,
      eventKey: intent.eventKey ?? null,
      sourceType: intent.sourceType ?? null,
      sourceId: intent.sourceId ?? null,
      actorId: intent.actorId ?? null,
      reason: intent.reason,
      requestedBy: intent.requestedBy ?? null,
    })),
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

/** Concurrent post-commit drains — drainXpOne's CAS claim owns each row. */
export async function drainXpMany(ids: string[]): Promise<void> {
  await Promise.allSettled(ids.map((id) => drainXpOne(id)))
}

// Actor sweeps may only claw back grants — ACTOR_GRANTED_TYPES in
// progression.ts is the single source of truth, imported above so the
// fixpoint proof can never drift from the executor's population.
const FIXPOINT_ACTOR_TYPES = ACTOR_GRANTED_TYPES

async function reversalComplete(row: {
  kind: string
  eventKey: string | null
  sourceType: string | null
  sourceId: string | null
  actorId: string | null
  enqueuedAt: Date
}): Promise<boolean> {
  if (row.kind === "SOURCE" && row.sourceType && row.sourceId) {
    const remaining = await prisma.progressionEvent.count({
      where: {
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        reversedAt: null,
        reversalOfId: null,
        type: { not: "REVERSAL" },
      },
    })
    return remaining === 0
  }
  if (row.kind === "ACTOR" && row.actorId) {
    const remaining = await prisma.progressionEvent.count({
      where: {
        actorId: row.actorId,
        reversedAt: null,
        reversalOfId: null,
        type: { in: [...FIXPOINT_ACTOR_TYPES] },
        createdAt: { lte: row.enqueuedAt },
      },
    })
    return remaining === 0
  }
  if (row.kind === "KEY" && row.eventKey) {
    const ev = await prisma.progressionEvent.findUnique({
      where: { key: row.eventKey },
      select: { id: true, reversedAt: true },
    }).catch(() => null)
    if (!ev || ev.reversedAt) return true
    const descendants = await prisma.progressionEvent.count({
      where: { reversalOfId: ev.id },
    })
    return descendants > 0
  }
  return true // malformed intent — mark dead rather than retry forever
}

const CLAIM_STALE_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 10

export async function drainXpOne(id: string): Promise<boolean> {
  const staleBefore = new Date(Date.now() - CLAIM_STALE_MS)
  const claimed = await prisma.pendingXpReversal.updateMany({
    where: {
      id,
      OR: [
        { status: "PENDING" },
        { status: "RUNNING", claimedAt: { lt: staleBefore } },
      ],
    },
    data: { status: "RUNNING", claimedAt: new Date() },
  })
  if (claimed.count === 0) return false

  const row = await prisma.pendingXpReversal.findUnique({ where: { id } })
  if (!row) return false

  try {
    if (row.kind === "SOURCE" && row.sourceType && row.sourceId) {
      await reverseProgressionBySource(row.sourceType, row.sourceId, row.reason, row.requestedBy ?? undefined)
    } else if (row.kind === "KEY" && row.eventKey) {
      // Live-state reconciliation — the only authoritative answer to
      // "is this interaction still active?" is the interaction row
      // itself, never a timestamp written by a possibly-stale award
      // request. Resolvers cover the re-creatable social keys
      // (follow / react / repost / comment); unknown key types keep the
      // legacy reverse-by-key path.
      const active = await keyedInteractionActive(row.eventKey)
      if (active === true) {
        // The interaction is live, so this reversal is stale. Completing
        // the intent without reversing is correct — and
        // reinstateProgressionByKey also heals a reversal that committed
        // before a crash or re-creation (no-op when already active), so
        // a live interaction can never be left without its grant.
        await reinstateProgressionByKey(row.eventKey)
        await prisma.pendingXpReversal.delete({ where: { id } }).catch(() => {})
        return true
      }
      await reverseProgressionByKey(row.eventKey, row.reason, row.requestedBy ?? undefined)
      // The interaction may have been re-created while the reversal was
      // in flight — re-check LIVE state and repair if so. A resolver
      // error propagates to the outer catch so the intent requeues
      // rather than mutating on uncertain state.
      if (active === false && (await keyedInteractionActive(row.eventKey)) === true) {
        await reinstateProgressionByKey(row.eventKey)
      }
    } else if (row.kind === "ACTOR" && row.actorId) {
      await reverseProgressionByActor(row.actorId, row.reason, { before: row.enqueuedAt, requestedBy: row.requestedBy ?? undefined })
    }
  } catch (error) {
    await prisma.pendingXpReversal.update({
      where: { id },
      data: {
        status: "PENDING",
        attempts: { increment: 1 },
        lastError: String(error).slice(0, 500),
      },
    }).catch(() => {})
    return false
  }

  if (await reversalComplete(row).catch(() => false)) {
    await prisma.pendingXpReversal.delete({ where: { id } }).catch(() => {})
    return true
  }

  const attempts = row.attempts + 1
  await prisma.pendingXpReversal.update({
    where: { id },
    data: {
      status: attempts >= MAX_ATTEMPTS ? "DEAD" : "PENDING",
      attempts: { increment: 1 },
      lastError: "executor incomplete — events still active",
    },
  }).catch(() => {})
  if (attempts >= MAX_ATTEMPTS) {
    console.error("[progression-outbox] reversal exhausted retries:", id, row.kind, row.sourceType ?? row.eventKey ?? row.actorId)
    await logSecurityEvent("SUSPICIOUS_ACTIVITY", {
      metadata: { progressionOutbox: "dead", id, kind: row.kind, key: row.eventKey, sourceType: row.sourceType, sourceId: row.sourceId, actorId: row.actorId },
    }).catch(() => {})
  }
  return false
}

// Durable entry points for call sites whose mutation is already committed.
export async function reverseXpKeyDurable(key: string, reason: string, requestedBy?: string): Promise<void> {
  const id = await enqueueXpReversal(prisma, { kind: "KEY", eventKey: key, reason, requestedBy })
  await drainXpOne(id).catch(() => false)
}

export async function reverseXpSourceDurable(sourceType: string, sourceId: string, reason: string, requestedBy?: string): Promise<void> {
  const id = await enqueueXpReversal(prisma, { kind: "SOURCE", sourceType, sourceId, reason, requestedBy })
  await drainXpOne(id).catch(() => false)
}

export async function reverseXpActorDurable(actorId: string, reason: string, requestedBy?: string): Promise<void> {
  const id = await enqueueXpReversal(prisma, { kind: "ACTOR", actorId, reason, requestedBy })
  await drainXpOne(id).catch(() => false)
}

export async function drainPendingXpReversals(limit = 25): Promise<{ drained: number; failed: number }> {
  const staleBefore = new Date(Date.now() - CLAIM_STALE_MS)
  const rows = await prisma.pendingXpReversal.findMany({
    where: {
      OR: [
        { status: "PENDING" },
        { status: "RUNNING", claimedAt: { lt: staleBefore } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  })
  let drained = 0
  let failed = 0
  for (const r of rows) {
    if (await drainXpOne(r.id).catch(() => false)) drained++
    else failed++
  }
  return { drained, failed }
}
