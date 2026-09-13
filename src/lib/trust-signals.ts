import { prisma } from "@/lib/prisma"
import { notifyMany } from "@/lib/notify"

// Trust & Safety signal detection + persistence.
//
// Detectors are deterministic queries over the reputation ledger — signals are
// evidence for human review, never proof of wrongdoing, and nothing here takes
// enforcement action. Hits are materialized into AbuseFlag rows keyed by a
// per-day dedupe token so re-scans are idempotent and each flag carries a
// frozen evidence snapshot that survives later reversals.

export const CASE_STATUSES = ["PENDING", "REVIEWING", "ESCALATED", "RESOLVED", "DISMISSED"] as const
export const TERMINAL_STATUSES = ["RESOLVED", "DISMISSED"] as const
export const CASE_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const

const PRIORITY_RANK: Record<string, number> = { URGENT: 3, HIGH: 2, NORMAL: 1, LOW: 0 }
export function priorityRank(p: string): number {
  return PRIORITY_RANK[p] ?? 1
}

// Reports derive priority from the reporter's chosen reason — deterministic
// and not user-manipulable beyond picking a reason that still has to hold up
// in review. Staff can override via the queue (logged).
export function reportPriority(reason: string): string {
  if (reason === "THREATS" || reason === "ILLEGAL_CONTENT") return "URGENT"
  if (reason === "HARASSMENT" || reason === "SCAM" || reason === "MALICIOUS_LINKS") return "HIGH"
  return "NORMAL"
}

export const SIGNAL_LABELS: Record<string, string> = {
  REP_VELOCITY: "Unusual reputation velocity",
  REP_RECIPROCAL_PAIR: "Reciprocal like pattern",
  REP_RECIPROCAL_ANSWERS: "Reciprocal accepted answers",
  REP_NEW_ACCOUNT_LIKES: "Likes from new accounts",
}

const SIGNAL_PRIORITY: Record<string, string> = {
  REP_VELOCITY: "HIGH",
  REP_RECIPROCAL_PAIR: "NORMAL",
  REP_RECIPROCAL_ANSWERS: "HIGH",
  REP_NEW_ACCOUNT_LIKES: "NORMAL",
}

export interface DetectedSignals {
  velocity: { userId: string; gained: number }[]
  reciprocal: { aId: string; bId: string; mutual: number }[]
  reciprocalAnswers: { aId: string; bId: string; mutual: number }[]
  newAccounts: { userId: string; freshLikes: number }[]
}

// Reputation-abuse detectors. Hits are raw signals for human review;
// materializeReputationFlags() turns them into reviewable records.
// The velocity detector excludes one-off high-value awards (contest wins,
// staff adjustments, referrals, challenge payouts) so a legitimate weekly
// winner doesn't trip it — it measures grinding velocity only.
export async function detectReputationSignals(days: number): Promise<DetectedSignals> {
  const window = Math.min(30, Math.max(1, days))

  const [velocity, reciprocal, reciprocalAnswers, newAccounts] = await Promise.all([
    prisma.$queryRaw<{ userId: string; gained: bigint }[]>`
      SELECT "userId", SUM("amount") AS gained
      FROM "ReputationEvent"
      WHERE "reversedAt" IS NULL AND "amount" > 0
        AND "type" NOT IN (
          'CONTEST_WEEKLY_WIN', 'CONTEST_MONTHLY_WIN',
          'STAFF_ADJUSTMENT', 'REFERRAL', 'CHALLENGE_WEEKLY',
          'LEGACY_MIGRATION', 'REINSTATE'
        )
        AND "createdAt" > NOW() - INTERVAL '24 hours'
      GROUP BY "userId"
      HAVING SUM("amount") > 150
      ORDER BY gained DESC
      LIMIT 20`,

    prisma.$queryRaw<{ actorId: string; userId: string; mutual: bigint }[]>`
      SELECT a."actorId", a."userId", COUNT(*) AS mutual
      FROM "ReputationEvent" a
      JOIN "ReputationEvent" b
        ON b."actorId" = a."userId" AND b."userId" = a."actorId"
       AND b."type" = 'LIKE_RECEIVED' AND b."reversedAt" IS NULL
      WHERE a."type" = 'LIKE_RECEIVED' AND a."reversedAt" IS NULL
        AND a."actorId" IS NOT NULL
        AND a."actorId" < a."userId"
        AND a."createdAt" > NOW() - make_interval(days => ${window}::int)
      GROUP BY a."actorId", a."userId"
      HAVING COUNT(*) >= 5
      ORDER BY mutual DESC
      LIMIT 20`,

    // Mutual accepted answers — the highest-value reciprocal farm (+30 each
    // way). Two members repeatedly accepting each other's replies.
    prisma.$queryRaw<{ actorId: string; userId: string; mutual: bigint }[]>`
      SELECT a."actorId", a."userId", COUNT(*) AS mutual
      FROM "ReputationEvent" a
      JOIN "ReputationEvent" b
        ON b."actorId" = a."userId" AND b."userId" = a."actorId"
       AND b."type" = 'HELPFUL_ANSWER' AND b."reversedAt" IS NULL
      WHERE a."type" = 'HELPFUL_ANSWER' AND a."reversedAt" IS NULL
        AND a."actorId" IS NOT NULL
        AND a."actorId" < a."userId"
        AND a."createdAt" > NOW() - make_interval(days => ${window}::int)
      GROUP BY a."actorId", a."userId"
      HAVING COUNT(*) >= 2
      ORDER BY mutual DESC
      LIMIT 20`,

    prisma.$queryRaw<{ userId: string; freshLikes: bigint }[]>`
      SELECT e."userId", COUNT(*) AS "freshLikes"
      FROM "ReputationEvent" e
      JOIN "User" u ON u.id = e."actorId"
      WHERE e."type" = 'LIKE_RECEIVED' AND e."reversedAt" IS NULL
        AND e."createdAt" > NOW() - make_interval(days => ${window}::int)
        AND u."createdAt" > NOW() - INTERVAL '48 hours'
      GROUP BY e."userId"
      HAVING COUNT(*) >= 5
      ORDER BY "freshLikes" DESC
      LIMIT 20`,
  ])

  return {
    velocity: velocity.map((v) => ({ userId: v.userId, gained: Number(v.gained) })),
    reciprocal: reciprocal.map((r) => ({ aId: r.actorId, bId: r.userId, mutual: Number(r.mutual) })),
    reciprocalAnswers: reciprocalAnswers.map((r) => ({ aId: r.actorId, bId: r.userId, mutual: Number(r.mutual) })),
    newAccounts: newAccounts.map((n) => ({ userId: n.userId, freshLikes: Number(n.freshLikes) })),
  }
}

// Turn detector hits into persisted AbuseFlag rows. Per-day keys mean a flag
// is created once per subject per day; resolving it keeps tomorrow's scan able
// to re-flag ongoing abuse. New flags notify moderators+admins (not TerpBot)
// — the same fan-out convention as member reports.
export async function materializeReputationFlags(days = 7): Promise<{ created: number }> {
  const signals = await detectReputationSignals(days)
  const today = new Date().toISOString().slice(0, 10)

  const candidates: {
    signal: string
    userId: string
    counterpartyId?: string
    key: string
    evidence: object
  }[] = []

  for (const v of signals.velocity) {
    candidates.push({
      signal: "REP_VELOCITY",
      userId: v.userId,
      key: `repvel:${v.userId}:${today}`,
      evidence: { gained: v.gained, window: "24h", threshold: 150 },
    })
  }
  for (const r of signals.reciprocal) {
    const [a, b] = [r.aId, r.bId].sort()
    candidates.push({
      signal: "REP_RECIPROCAL_PAIR",
      userId: a,
      counterpartyId: b,
      key: `reprec:${a}:${b}:${today}`,
      evidence: { mutual: r.mutual, windowDays: days, threshold: 5 },
    })
  }
  for (const r of signals.reciprocalAnswers) {
    const [a, b] = [r.aId, r.bId].sort()
    candidates.push({
      signal: "REP_RECIPROCAL_ANSWERS",
      userId: a,
      counterpartyId: b,
      key: `repans:${a}:${b}:${today}`,
      evidence: { mutual: r.mutual, windowDays: days, threshold: 2 },
    })
  }
  for (const n of signals.newAccounts) {
    candidates.push({
      signal: "REP_NEW_ACCOUNT_LIKES",
      userId: n.userId,
      key: `repnew:${n.userId}:${today}`,
      evidence: { freshLikes: n.freshLikes, windowDays: days, threshold: 5 },
    })
  }

  if (candidates.length === 0) return { created: 0 }

  const existing = await prisma.abuseFlag.findMany({
    where: { key: { in: candidates.map((c) => c.key) } },
    select: { key: true },
  })
  const have = new Set(existing.map((e) => e.key))
  const fresh = candidates.filter((c) => !have.has(c.key))
  if (fresh.length === 0) return { created: 0 }

  await prisma.abuseFlag.createMany({
    data: fresh.map((c) => ({
      signal: c.signal,
      userId: c.userId,
      counterpartyId: c.counterpartyId ?? null,
      key: c.key,
      evidence: c.evidence,
      priority: SIGNAL_PRIORITY[c.signal] ?? "NORMAL",
      updatedAt: new Date(),
    })),
  })

  const staff = await prisma.user.findMany({
    where: { role: { in: ["MODERATOR", "ADMINISTRATOR"] }, profile: { isNot: { username: "terpbot" } } },
    select: { id: true },
  })
  if (staff.length > 0) {
    await notifyMany(
      staff.map((s) => ({
        userId: s.id,
        type: "MODERATOR_ANNOUNCEMENT" as const,
        title: "New abuse signal",
        content: `${fresh.length} reputation-abuse signal${fresh.length === 1 ? "" : "s"} detected — review the moderation queue.`,
        link: "/moderation",
      }))
    ).catch(() => {})
  }

  return { created: fresh.length }
}
