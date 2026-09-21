// Durable reputation-reversal outbox.
//
// The problem this solves: every delete/un-like/moderation path used to run
// its reversal AFTER the primary mutation committed and swallow failures
// with `.catch(() => 0)` — a crashed or timed-out reversal left "phantom
// reputation": content gone, points kept, and the balance-vs-ledger drift
// check can't see it because the ledger and balance still agree.
//
// The mechanism: the intent row is written INSIDE the same transaction as
// the triggering delete (one tiny insert — always fits). A post-commit
// drainOne preserves today's immediate-reversal UX; cron + /api/ping drains
// guarantee eventual completion. The underlying reversal functions are all
// idempotent (CAS + keyed counter-entries), so retry-until-fixpoint is safe.
//
// Completion is proven by a fixpoint check against the ledger, not the
// executor's return value — reverseReputationBySource/ByActor swallow
// per-event errors internally, so "returned without throwing" is not proof.
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import {
  reverseReputationBySource,
  reverseReputationByKey,
  reverseReputationByActor,
} from "@/lib/reputation"
import { logSecurityEvent } from "@/lib/security"

type Db = Prisma.TransactionClient | typeof prisma

export interface ReversalIntent {
  kind: "SOURCE" | "KEY" | "ACTOR"
  eventKey?: string    // KEY — ledger key to reverse
  sourceType?: string  // SOURCE
  sourceId?: string    // SOURCE
  actorId?: string     // ACTOR
  reason: string
  requestedBy?: string
}

// Write the durable intent inside the caller's transaction. Returns the row
// id for the post-commit drainOne attempt.
export async function enqueueReversal(db: Db, intent: ReversalIntent): Promise<string> {
  const row = await db.pendingReversal.create({
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

// Fixpoint proofs — the intent is complete iff NO eligible event remains
// active, regardless of what the executor reported.
async function reversalComplete(row: {
  kind: string
  eventKey: string | null
  sourceType: string | null
  sourceId: string | null
  actorId: string | null
  enqueuedAt: Date
}): Promise<boolean> {
  if (row.kind === "SOURCE" && row.sourceType && row.sourceId) {
    const remaining = await prisma.reputationEvent.count({
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
    const remaining = await prisma.reputationEvent.count({
      where: {
        actorId: row.actorId,
        reversedAt: null,
        reversalOfId: null,
        type: { in: ["LIKE_RECEIVED", "HELPFUL_ANSWER", "REFERRAL"] },
        createdAt: { lte: row.enqueuedAt },
      },
    })
    return remaining === 0
  }
  if (row.kind === "KEY" && row.eventKey) {
    const ev = await prisma.reputationEvent.findUnique({
      where: { key: row.eventKey },
      select: { id: true, reversedAt: true },
    }).catch(() => null)
    // Event absent or already reversed → intent satisfied.
    if (!ev || ev.reversedAt) return true
    // Any prior reversal/reinstate descendant means this intent was already
    // consumed once — a re-grant after that is a NEW action outside this
    // intent's scope (unlike → enqueue → re-like must not claw back).
    const descendants = await prisma.reputationEvent.count({
      where: { reversalOfId: ev.id },
    })
    return descendants > 0
  }
  // Malformed intent — mark dead rather than retry forever.
  return true
}

const CLAIM_STALE_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 10

// Claim + execute + verify one intent. Returns true when the row was
// resolved (deleted). Safe to call repeatedly and concurrently — the CAS
// claim means only one worker ever runs a given row.
export async function drainOne(id: string): Promise<boolean> {
  const staleBefore = new Date(Date.now() - CLAIM_STALE_MS)
  const claimed = await prisma.pendingReversal.updateMany({
    where: {
      id,
      OR: [
        { status: "PENDING" },
        { status: "RUNNING", claimedAt: { lt: staleBefore } },
      ],
    },
    data: { status: "RUNNING", claimedAt: new Date() },
  })
  if (claimed.count === 0) return false // someone else owns it, or it's DEAD

  const row = await prisma.pendingReversal.findUnique({ where: { id } })
  if (!row) return false

  try {
    if (row.kind === "SOURCE" && row.sourceType && row.sourceId) {
      await reverseReputationBySource(row.sourceType, row.sourceId, row.reason, row.requestedBy ?? undefined)
    } else if (row.kind === "KEY" && row.eventKey) {
      await reverseReputationByKey(row.eventKey, row.reason, row.requestedBy ?? undefined)
    } else if (row.kind === "ACTOR" && row.actorId) {
      // enqueuedAt bound: a deferred retry must not sweep grants the user
      // made AFTER the ban/delete was issued.
      await reverseReputationByActor(row.actorId, row.reason, { before: row.enqueuedAt })
    }
  } catch (error) {
    // Executor threw — record and leave for the next drain.
    await prisma.pendingReversal.update({
      where: { id },
      data: {
        status: "PENDING",
        attempts: { increment: 1 },
        lastError: String(error).slice(0, 500),
      },
    }).catch(() => {})
    return false
  }

  // Executor returned — but bySource/byActor swallow per-event errors, so
  // prove completion against the ledger before deleting the row.
  if (await reversalComplete(row).catch(() => false)) {
    await prisma.pendingReversal.delete({ where: { id } }).catch(() => {})
    return true
  }

  const attempts = row.attempts + 1
  await prisma.pendingReversal.update({
    where: { id },
    data: {
      status: attempts >= MAX_ATTEMPTS ? "DEAD" : "PENDING",
      attempts: { increment: 1 },
      lastError: "executor incomplete — events still active",
    },
  }).catch(() => {})
  if (attempts >= MAX_ATTEMPTS) {
    console.error("[reputation-outbox] reversal exhausted retries:", id, row.kind, row.sourceType ?? row.eventKey ?? row.actorId)
    await logSecurityEvent("SUSPICIOUS_ACTIVITY", {
      metadata: { reputationOutbox: "dead", id, kind: row.kind, key: row.eventKey, sourceType: row.sourceType, sourceId: row.sourceId, actorId: row.actorId },
    }).catch(() => {})
  }
  return false
}

// Durable reversal entry points for call sites whose triggering mutation
// is already committed (or wrapped mutation+enqueue in their own tx).
// The intent row is written first, then drained immediately — preserving
// today's instant-reversal UX while making every failure retryable.
export async function reverseKeyDurable(key: string, reason: string, requestedBy?: string): Promise<void> {
  const id = await enqueueReversal(prisma, { kind: "KEY", eventKey: key, reason, requestedBy })
  await drainOne(id).catch(() => false)
}

export async function reverseSourceDurable(sourceType: string, sourceId: string, reason: string, requestedBy?: string): Promise<void> {
  const id = await enqueueReversal(prisma, { kind: "SOURCE", sourceType, sourceId, reason, requestedBy })
  await drainOne(id).catch(() => false)
}

export async function reverseActorDurable(actorId: string, reason: string, requestedBy?: string): Promise<void> {
  const id = await enqueueReversal(prisma, { kind: "ACTOR", actorId, reason, requestedBy })
  await drainOne(id).catch(() => false)
}

// Drain up to `limit` pending intents, oldest first. Each row's work is
// internally bounded — the per-event loops inside the reversal functions
// batch their own concurrency.
export async function drainPendingReversals(limit = 25): Promise<{ drained: number; failed: number }> {
  const staleBefore = new Date(Date.now() - CLAIM_STALE_MS)
  const rows = await prisma.pendingReversal.findMany({
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
    if (await drainOne(r.id).catch(() => false)) drained++
    else failed++
  }
  return { drained, failed }
}
