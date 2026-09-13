import { prisma } from "../src/lib/prisma"

const drift = await prisma.$queryRawUnsafe<Array<{ userId: string; reputation: number; total: bigint | null }>>(`
  SELECT p."userId", p.reputation, s.total
  FROM "Profile" p LEFT JOIN (
    SELECT "userId", SUM(amount) AS total FROM "ReputationEvent" GROUP BY "userId"
  ) s ON s."userId" = p."userId"
  WHERE p.reputation <> COALESCE(s.total, 0)`)
console.log("drift rows:", drift.length, drift.slice(0, 3))
const mig = await prisma.reputationEvent.count({ where: { type: "LEGACY_MIGRATION" } })
console.log("legacy migration rows:", mig)
await prisma.$disconnect()
