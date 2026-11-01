#!/usr/bin/env tsx
/**
 * Progression V3 — production data reset.
 *
 * Wipes ALL progress-derived state so every member starts at zero under
 * the V3 economy. Run AFTER scripts/backup-progression.mts has written a
 * restore point, and ONLY against the intended database.
 *
 * Usage:
 *   DATABASE_URL=<conn> CONFIRM_RESET=yes npx tsx scripts/reset-progression-v3.mts
 *
 * What it does, in one transaction:
 *   - deletes ProgressionEvent, ReputationEvent, MasteryProgress rows
 *   - deletes UserBadge + UserAchievement grants (definitions survive)
 *   - zeroes Profile.xp / standing / reputation for every profile
 *
 * Invariants preserved: xp == SUM(ledger) and standing == SUM(ledger)
 * both hold vacuously at 0; reputation (frozen legacy) zeroes alongside.
 */
import { PrismaClient } from "@prisma/client"

if (process.env.CONFIRM_RESET !== "yes") {
  console.error("Refusing: set CONFIRM_RESET=yes. Run scripts/backup-progression.mts first.")
  process.exit(1)
}
if (!process.env.DATABASE_URL) {
  console.error("Refusing: DATABASE_URL not set.")
  process.exit(1)
}

const prisma = new PrismaClient()

async function main() {
  console.log("Progression V3 reset — wiping progress state...")
  const res = await prisma.$transaction([
    prisma.progressionEvent.deleteMany(),
    prisma.reputationEvent.deleteMany(),
    prisma.masteryProgress.deleteMany(),
    prisma.userBadge.deleteMany(),
    prisma.userAchievement.deleteMany(),
    prisma.profile.updateMany({
      data: { xp: 0, standing: 0, reputation: 0, legacyVerified: false, unlockFrozen: false },
    }),
  ])
  const [pe, re, mp, ub, ua, prof] = res
  console.log(`  ProgressionEvent: ${pe.count} deleted`)
  console.log(`  ReputationEvent:  ${re.count} deleted`)
  console.log(`  MasteryProgress:  ${mp.count} deleted`)
  console.log(`  UserBadge:        ${ub.count} grants deleted`)
  console.log(`  UserAchievement:  ${ua.count} grants deleted`)
  console.log(`  Profile:          ${prof.count} balances zeroed`)

  // Post-check: invariants hold vacuously at zero.
  const [xpSum, repSum, events] = await Promise.all([
    prisma.profile.aggregate({ _sum: { xp: true, standing: true, reputation: true } }),
    prisma.reputationEvent.count(),
    prisma.progressionEvent.count(),
  ])
  const ok =
    (xpSum._sum.xp ?? 0) === 0 &&
    (xpSum._sum.standing ?? 0) === 0 &&
    (xpSum._sum.reputation ?? 0) === 0 &&
    repSum === 0 &&
    events === 0
  console.log(ok ? "✓ Reset verified — all balances at zero." : "✗ VERIFICATION FAILED — inspect before proceeding")
  if (!ok) process.exit(2)
}

main().finally(() => prisma.$disconnect())
