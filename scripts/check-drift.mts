// Balance/ledger drift check — verifies `profile.reputation == SUM(
// ReputationEvent.amount)` for every member. Run: npx tsx scripts/check-drift.mts
// Exits 1 if any member's cached balance disagrees with the ledger.
import { prisma } from "@/lib/prisma"
import { findReputationDrift } from "@/lib/reputation"

const drift = await findReputationDrift()
if (drift.length === 0) {
  console.log("No drift — every profile balance matches its ledger.")
} else {
  console.error(`${drift.length} profile(s) out of sync:`)
  for (const d of drift) {
    console.error(`  ${d.userId}: balance=${d.reputation} ledger=${d.ledger} (${d.reputation - d.ledger > 0 ? "+" : ""}${d.reputation - d.ledger})`)
  }
}
await prisma.$disconnect()
process.exit(drift.length === 0 ? 0 : 1)
