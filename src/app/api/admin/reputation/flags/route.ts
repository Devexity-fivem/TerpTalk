import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { forbidden } from "@/lib/security"
import { requireAdmin } from "@/lib/require-staff"
import { rateLimit } from "@/lib/rate-limit"

// GET — reputation-abuse signals for staff review. Detection only: nothing
// here auto-punishes; every flag links to the member for manual inspection.
export async function GET(request: Request) {
  const admin = await requireAdmin()
  if (!admin) return forbidden()

  const rl = await rateLimit(`admin-rep-flags:${admin.id}`, 20, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const { searchParams } = new URL(request.url)
  const days = Math.min(30, Math.max(1, Number(searchParams.get("days")) || 7))

  const [velocity, reciprocal, newAccounts, staffActions] = await Promise.all([
    // Unusual reward velocity: >150 rep gained in the last 24h.
    prisma.$queryRaw<{ userId: string; gained: bigint }[]>`
      SELECT "userId", SUM("amount") AS gained
      FROM "ReputationEvent"
      WHERE "reversedAt" IS NULL AND "amount" > 0
        AND "createdAt" > NOW() - INTERVAL '24 hours'
      GROUP BY "userId"
      HAVING SUM("amount") > 150
      ORDER BY gained DESC
      LIMIT 20`,

    // Reciprocal like pairs: A likes B AND B likes A, 5+ mutual events.
    prisma.$queryRaw<{ actorId: string; userId: string; mutual: bigint }[]>`
      SELECT a."actorId", a."userId", COUNT(*) AS mutual
      FROM "ReputationEvent" a
      JOIN "ReputationEvent" b
        ON b."actorId" = a."userId" AND b."userId" = a."actorId"
       AND b."type" = 'LIKE_RECEIVED' AND b."reversedAt" IS NULL
      WHERE a."type" = 'LIKE_RECEIVED' AND a."reversedAt" IS NULL
        AND a."actorId" IS NOT NULL
        AND a."actorId" < a."userId"
        AND a."createdAt" > NOW() - make_interval(days => ${days})
      GROUP BY a."actorId", a."userId"
      HAVING COUNT(*) >= 5
      ORDER BY mutual DESC
      LIMIT 20`,

    // Likes granted by very new accounts (<48h), grouped by recipient.
    prisma.$queryRaw<{ userId: string; freshLikes: bigint }[]>`
      SELECT e."userId", COUNT(*) AS "freshLikes"
      FROM "ReputationEvent" e
      JOIN "User" u ON u.id = e."actorId"
      WHERE e."type" = 'LIKE_RECEIVED' AND e."reversedAt" IS NULL
        AND e."createdAt" > NOW() - make_interval(days => ${days})
        AND u."createdAt" > NOW() - INTERVAL '48 hours'
      GROUP BY e."userId"
      HAVING COUNT(*) >= 5
      ORDER BY "freshLikes" DESC
      LIMIT 20`,

    // Recent staff rep actions for the audit feed.
    prisma.reputationEvent.findMany({
      where: {
        OR: [
          { type: "STAFF_ADJUSTMENT" },
          { type: "REVERSAL", actorId: { not: null } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true, type: true, userId: true, actorId: true, amount: true,
        reason: true, createdAt: true,
      },
    }),
  ])

  // Resolve usernames for every flagged id in one query.
  const ids = new Set<string>()
  for (const v of velocity) ids.add(v.userId)
  for (const r of reciprocal) { ids.add(r.actorId); ids.add(r.userId) }
  for (const n of newAccounts) ids.add(n.userId)
  for (const s of staffActions) { ids.add(s.userId); if (s.actorId) ids.add(s.actorId) }
  const users = ids.size
    ? await prisma.user.findMany({
        where: { id: { in: [...ids] } },
        select: { id: true, profile: { select: { username: true } } },
      })
    : []
  const name = new Map(users.map((u) => [u.id, u.profile?.username ?? "?"]))

  return NextResponse.json({
    velocity: velocity.map((v) => ({ username: name.get(v.userId), userId: v.userId, gained: Number(v.gained) })),
    reciprocalPairs: reciprocal.map((r) => ({
      a: name.get(r.actorId), b: name.get(r.userId), mutual: Number(r.mutual),
    })),
    newAccountLikes: newAccounts.map((n) => ({ username: name.get(n.userId), userId: n.userId, freshLikes: Number(n.freshLikes) })),
    staffActions: staffActions.map((s) => ({
      id: s.id, type: s.type, amount: s.amount, reason: s.reason, createdAt: s.createdAt,
      user: name.get(s.userId), staff: s.actorId ? name.get(s.actorId) : null,
    })),
  })
}
