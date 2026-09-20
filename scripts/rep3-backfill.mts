// Reputation 3.0 backfill — aligns existing members with the new 13-rank
// ladder ("Path to Master Gardener"). Idempotent: every write is keyed or
// conditional, so re-running is a no-op.
//
// What it does, per member:
//   1. Repairs balance drift — profile.reputation := SUM(ledger.amount),
//      documented by a zero-amount audit marker (keeps balance == SUM).
//   2. Pre-claims milestone markers for every ladder rung at/below the
//      member's balance — so a later reversal+re-earn can't re-fire
//      celebrations for rungs they passed under the old ladder.
//   3. Runs the post-award pipeline with oldRep == newRep (no rung
//      crossings → no celebration spam): autoVerify promotions,
//      checkBadges grants, referral payouts all evaluate for real.
//   4. Post-demotion effects — prunes equipped cosmetics now above the
//      member's tier and showcase pins beyond their slot count; demotes
//      VERIFIED_MEMBERs who no longer meet the threshold.
//   5. Garden streaks — pays once-ever STREAK_BONUS milestones for the
//      member's live check-in streak (skipped for banned members).
//
// Usage:
//   npx tsx scripts/rep3-backfill.mts                  (dev DB)
//   ALLOW_PRODUCTION_DB_TESTS=1 DATABASE_URL=<prod> npx tsx scripts/rep3-backfill.mts
import "./db-guard.mjs"
import { prisma } from "@/lib/prisma"
import { REP_LADDER, REP_TIERS, REP_EVENT_TYPES } from "@/lib/reputation-config"
import { findReputationDrift, runPostAwardEffects, postDemotionEffects } from "@/lib/reputation"
import { evaluateStreaks } from "@/lib/streaks"

const TIER_RUNGS = new Set(REP_TIERS.map((t) => t.threshold))

async function main() {
  console.log("Reputation 3.0 backfill")
  console.log(`  ladder: ${REP_TIERS.length} ranks, ${REP_LADDER.length} rungs\n`)

  // ── 1. Drift repair ────────────────────────────────────────────────
  const drift = await findReputationDrift()
  if (drift.length === 0) {
    console.log("drift: none — every balance matches its ledger")
  } else {
    console.log(`drift: repairing ${drift.length} profile(s)`)
    for (const d of drift) {
      // Zero-amount audit row: records the correction without moving the
      // ledger sum (every row's amount counts toward the balance).
      await prisma.reputationEvent.upsert({
        where: { key: `rep3:driftfix:${d.userId}` },
        create: {
          userId: d.userId,
          type: REP_EVENT_TYPES.MILESTONE,
          amount: 0,
          reason: `Rep 3.0 drift repair: balance ${d.reputation} → ${d.ledger}`,
          key: `rep3:driftfix:${d.userId}`,
        },
        update: {},
      })
      await prisma.profile.update({
        where: { userId: d.userId },
        data: { reputation: d.ledger },
      })
      console.log(`  ${d.userId}: ${d.reputation} → ${d.ledger}`)
    }
  }

  // ── 2–5. Per-member pass ───────────────────────────────────────────
  const users = await prisma.user.findMany({
    select: {
      id: true,
      role: true,
      banned: true,
      profile: { select: { reputation: true } },
    },
    orderBy: { createdAt: "asc" },
  })
  console.log(`\nprocessing ${users.length} member(s)...`)

  let markersClaimed = 0
  let streaksPaid = 0

  for (const u of users) {
    const rep = u.profile?.reputation ?? 0

    // 2. Claim every rung the member already sits at or above — silently,
    //    keyed rows so this is once-ever.
    if (rep > 0) {
      const rows = REP_LADDER.filter((r) => r <= rep).map((r) => ({
        userId: u.id,
        type: REP_EVENT_TYPES.MILESTONE,
        amount: 0,
        reason: "Milestone marker",
        key: `milestone:${TIER_RUNGS.has(r) ? "tier" : "stage"}:${u.id}:${r}`,
      }))
      const res = await prisma.reputationEvent.createMany({ data: rows, skipDuplicates: true })
      markersClaimed += res.count
    }

    // 3. Full side-effect pipeline with no rep delta: real badge grants,
    //    VERIFIED_MEMBER promotions, referral payouts — zero celebrations.
    await runPostAwardEffects(u.id, rep, rep).catch((e) =>
      console.error(`  effects failed for ${u.id}:`, e)
    )

    // 4. Cosmetic/showcase pruning + verified demotion if below threshold.
    await postDemotionEffects(u.id).catch((e) =>
      console.error(`  demotion effects failed for ${u.id}:`, e)
    )

    // 5. Streak milestones for live check-in streaks (banned members skip).
    if (!u.banned) {
      const paid = await evaluateStreaks(u.id).catch(() => [] as number[])
      if (paid.length > 0) streaksPaid++
    }
  }

  // Final invariant check — the script must leave zero drift.
  const after = await findReputationDrift()
  console.log(`\ndone. markers claimed: ${markersClaimed}, streak milestones paid for ${streaksPaid} member(s)`)
  console.log(after.length === 0 ? "final drift: none" : `final drift: ${after.length} profile(s) — INVESTIGATE`)
  if (after.length > 0) process.exitCode = 1
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
