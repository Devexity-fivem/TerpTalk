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
} from "@/lib/progression"
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

// Actor sweeps may only claw back grants — the ACTOR_GRANTED_TYPES list in
// progression.ts — mirrored here for the fixpoint proof.
const FIXPOINT_ACTOR_TYPES = [
  "ACCEPTED_ANSWER",
  "NEWCOMER_ACCEPT_BONUS",
  "REFERRAL",
  "CONTEST_WEEKLY_WIN",
  "CONTEST_MONTHLY_WIN",
]

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
        type: { in: FIXPOINT_ACTOR_TYPES },
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
      await reverseProgressionByKey(row.eventKey, row.reason, row.requestedBy ?? undefined)
    } else if (row.kind === "ACTOR" && row.actorId) {
      await reverseProgressionByActor(row.actorId, row.reason, { before: row.enqueuedAt })
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
