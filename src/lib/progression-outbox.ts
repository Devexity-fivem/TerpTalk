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
  awardProgression,
  ACTOR_GRANTED_TYPES,
} from "@/lib/progression"
import { keyedInteractionActive, keyedAwardSpec } from "@/lib/interaction-state"
import { runKeyedTx } from "@/lib/interaction-lifecycle"
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

// ─── Keyed intent reconcile (authoritative, lock-serialized) ────────
// One Serializable transaction: take the per-key advisory lock, read
// live interaction state through the SAME client, then ensure the
// ledger matches it and delete the intent — all atomically. Because
// every add/remove path for the key takes the same lock, the state we
// read cannot change before we commit.
//
//   active === true  → ensure the grant is active (awardProgression on
//                      the tx client handles duplicate / reinstate /
//                      first-grant under the same caps and gates), then
//                      complete the intent.
//   active === false → reverse the keyed grant inside the tx, verify
//                      completion, delete the intent.
//   active === null  → unresolvable key type: legacy reverse-by-key,
//                      completion-checked, intent deleted when done.
//
// Returns "completed" | "incomplete". Throws propagate to drainXpOne's
// catch → intent requeues PENDING (never completes on uncertain state).
async function reconcileKeyedIntent(
  id: string,
  row: { eventKey: string; reason: string; requestedBy: string | null }
): Promise<"completed" | "incomplete"> {
  const key = row.eventKey
  return runKeyedTx(key, async (tx) => {
    const active = await keyedInteractionActive(key, tx)
    if (active === true) {
      const spec = await keyedAwardSpec(key, tx)
      if (spec) {
        // Ensure-award: duplicate→no-op, reversed→reinstate, missing→
        // first grant — all under the same caps/gates, in this tx.
        await awardProgression(spec.userId, spec.type, spec.reason, {
          key,
          actorId: spec.actorId,
          sourceType: spec.sourceType,
          sourceId: spec.sourceId,
          meta: spec.meta,
          db: tx,
        })
      } else {
        // Resolvable interaction but no derivable award spec — reinstate
        // only (covers keys whose award shape we can't reconstruct).
        const { reinstateProgressionByKey } = await import("@/lib/progression")
        await reinstateProgressionByKey(key)
      }
      await tx.pendingXpReversal.delete({ where: { id } })
      return "completed" as const
    }

    // active === false | null → reverse inside this tx.
    await reverseProgressionByKey(key, row.reason, row.requestedBy ?? undefined, tx)

    // Completion proof inside the same tx — a KEY intent completes once
    // the keyed event is reversed/missing or has reversal descendants.
    const ev = await tx.progressionEvent.findUnique({
      where: { key },
      select: { id: true, reversedAt: true },
    })
    const complete =
      !ev ||
      !!ev.reversedAt ||
      (await tx.progressionEvent.count({ where: { reversalOfId: ev.id } })) > 0
    if (!complete) return "incomplete" as const
    await tx.pendingXpReversal.delete({ where: { id } })
    return "completed" as const
  })
}

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
      // Authoritative reconcile: the per-key advisory lock serializes
      // this drain against every add/remove transaction for the same
      // logical interaction. Inside the lock we read live state through
      // the same tx client that mutates the ledger, so the decision and
      // its effect commit atomically — no add/remove can overtake the
      // gap between check and write. Resolvers cover follow/react/
      // repost/comment; unknown key types keep legacy reverse-by-key.
      const outcome = await reconcileKeyedIntent(id, {
        eventKey: row.eventKey,
        reason: row.reason,
        requestedBy: row.requestedBy,
      })
      if (outcome === "completed") return true
      // "incomplete" — executor ran but the grant is still live with no
      // reversal descendants; fall through to attempts/DEAD escalation.
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
