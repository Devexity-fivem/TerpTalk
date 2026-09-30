// db-query-count.mts — manual dev measurement probe (NOT a master-tests
// suite; read-only, no fixtures). Wraps lib-level hot paths in
// withQueryCount() and prints query counts. Requires a reachable DATABASE_URL.
//
//   npx tsx scripts/db-query-count.mts
//
// Route-level paths (badge GET, message poll, diary-update mutation, thread
// reply) run inside the Next.js server process — measure them by wrapping
// the handler body with the same withQueryCount() in a local dev build, or
// by calling the underlying lib function here.
import "./db-guard.mjs"
import { withQueryCount } from "../src/lib/query-count"
import { prisma } from "../src/lib/prisma"
import { getGrowJourney } from "../src/lib/grow-journey"
import { getSiteStats, getCommunityGrowStats } from "../src/lib/community-stats"
import { getQuestProgress } from "../src/lib/quests"
import { drainPendingReversals } from "../src/lib/reputation-outbox"
import { drainPendingXpReversals } from "../src/lib/progression-outbox"

async function measure(label: string, fn: () => Promise<unknown>) {
  try {
    const { queries } = await withQueryCount(fn)
    console.log(`${label.padEnd(44)} queries=${queries}`)
  } catch (e) {
    console.log(`${label.padEnd(44)} ERROR ${String(e).slice(0, 120)}`)
  }
}

const diary = await prisma.growDiary.findFirst({
  where: { deleted: false },
  orderBy: { createdAt: "desc" },
  select: { id: true, authorId: true },
})
const user = await prisma.user.findFirst({ where: { banned: false }, select: { id: true } })

console.log("── hot path query counts (read-only probe) ──")
if (diary) await measure("getGrowJourney(latest diary)", () => getGrowJourney(diary.id))
await measure("getSiteStats (cold)", () => getSiteStats())
await measure("getSiteStats (warm — expect 0)", () => getSiteStats())
await measure("getCommunityGrowStats (cold)", () => getCommunityGrowStats())
await measure("getCommunityGrowStats (warm — expect 0)", () => getCommunityGrowStats())
if (user) await measure("getQuestProgress(user)", () => getQuestProgress(user.id))
await measure("drainPendingReversals(10)", () => drainPendingReversals(10))
await measure("drainPendingXpReversals(10)", () => drainPendingXpReversals(10))
await prisma.$disconnect()
