#!/usr/bin/env tsx
/**
 * Progression V3/V4 — production data reset.
 *
 * Wipes ALL progress-derived state so members restart under the current
 * economy. Run AFTER scripts/backup-progression.mts has written AND
 * verified a restore point, and ONLY against the intended database.
 *
 * Usage:
 *   DATABASE_URL=<conn> CONFIRM_RESET=yes RESET_TARGET=<target> \
 *     npx tsx scripts/reset-progression-v3.mts
 *
 * <target> is the identifier printed by backup-progression.mts —
 * "supabase:<projectRef>" for Supabase URLs, else "<host>/<db>". The
 * script derives it from DATABASE_URL and refuses on mismatch, so a
 * prod reset cannot fire against the dev project (or vice versa) by
 * accident.
 *
 * What it does, in one transaction:
 *   - deletes ProgressionEvent, ReputationEvent, MasteryProgress rows
 *   - deletes UserBadge + UserAchievement grants (definitions survive)
 *   - zeroes Profile.xp / standing / reputation / legacyVerified /
 *     unlockFrozen for every profile
 *
 * PendingReversal / PendingXpReversal outbox rows are intentionally NOT
 * touched: every pending intent references pre-reset state, finds zero
 * matching events after the wipe, and completes on the next drain —
 * deleting them would lose the audit trail of in-flight reversals.
 *
 * Invariants preserved: xp == SUM(ledger) and standing == SUM(ledger)
 * both hold vacuously at 0; reputation (frozen legacy) zeroes alongside.
 */
import { PrismaClient } from "@prisma/client"

/** Canonical target id for a DATABASE_URL — never includes credentials.
 *  Supabase: project ref lives in the username (postgres.<ref>) or the
 *  direct host (db.<ref>.supabase.co). Fallback: host + database name. */
function deriveTarget(raw: string): string | null {
  try {
    const u = new URL(raw)
    const user = decodeURIComponent(u.username)
    const host = u.hostname
    const fromUser = user.includes(".") ? user.split(".").pop() ?? null : null
    const fromHost = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i)?.[1] ?? null
    const ref = fromUser ?? fromHost
    if (ref) return `supabase:${ref}`
    return `${host}/${u.pathname.replace(/^\//, "") || "postgres"}`
  } catch {
    return null
  }
}

const rawUrl = process.env.DATABASE_URL
if (process.env.CONFIRM_RESET !== "yes") {
  console.error("Refusing: set CONFIRM_RESET=yes. Run scripts/backup-progression.mts first.")
  process.exit(1)
}
if (!rawUrl) {
  console.error("Refusing: DATABASE_URL not set.")
  process.exit(1)
}
const target = deriveTarget(rawUrl)
if (!target) {
  console.error("Refusing: DATABASE_URL is not parseable.")
  process.exit(1)
}
if (process.env.RESET_TARGET !== target) {
  console.error(`Refusing: RESET_TARGET mismatch.`)
  console.error(`  DATABASE_URL resolves to: ${target}`)
  console.error(`  RESET_TARGET was:        ${process.env.RESET_TARGET ?? "(unset)"}`)
  console.error("Set RESET_TARGET to the exact string above to confirm this database.")
  process.exit(1)
}

const prisma = new PrismaClient()

async function main() {
  console.log(`Progression reset — target ${target}`)

  // Surface in-flight reversal work before wiping — these rows survive
  // the reset and self-drain afterwards; operators should know they exist.
  const [pendingRep, pendingXp] = await Promise.all([
    prisma.pendingReversal.count({ where: { status: { in: ["PENDING", "RUNNING", "DEAD"] } } }),
    prisma.pendingXpReversal.count({ where: { status: { in: ["PENDING", "RUNNING", "DEAD"] } } }),
  ])
  if (pendingRep + pendingXp > 0) {
    console.log(`  note: ${pendingRep + pendingXp} pending/dead reversal intents will self-drain post-reset`)
  }

  console.log("Wiping progress state...")
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

  // Post-check EVERY affected table — a reset that leaves any progress
  // residue is a failure, not a partial success.
  const [sums, peLeft, reLeft, mpLeft, ubLeft, uaLeft] = await Promise.all([
    prisma.profile.aggregate({ _sum: { xp: true, standing: true, reputation: true } }),
    prisma.progressionEvent.count(),
    prisma.reputationEvent.count(),
    prisma.masteryProgress.count(),
    prisma.userBadge.count(),
    prisma.userAchievement.count(),
  ])
  const frozenLeft = await prisma.profile.count({
    where: { OR: [{ xp: { not: 0 } }, { standing: { not: 0 } }, { reputation: { not: 0 } }, { legacyVerified: true }, { unlockFrozen: true }] },
  })
  const ok =
    (sums._sum.xp ?? 0) === 0 &&
    (sums._sum.standing ?? 0) === 0 &&
    (sums._sum.reputation ?? 0) === 0 &&
    peLeft === 0 && reLeft === 0 && mpLeft === 0 && ubLeft === 0 && uaLeft === 0 &&
    frozenLeft === 0
  console.log(ok ? "✓ Reset verified — all progress state at zero." : "✗ VERIFICATION FAILED — inspect before proceeding")
  if (!ok) {
    console.error(`  residue: pe=${peLeft} re=${reLeft} mp=${mpLeft} ub=${ubLeft} ua=${uaLeft} non-zero-profiles=${frozenLeft}`)
    process.exit(2)
  }
}

main().finally(() => prisma.$disconnect())
