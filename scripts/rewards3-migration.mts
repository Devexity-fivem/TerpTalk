// Reputation & Rewards 3.0 migration sweep — dry-run by default, --apply to execute.
//
// What it does:
//   1. Reports tier movement under the new thresholds (promoted / unchanged /
//      demoted — demotions MUST be zero; thresholds only ever went down).
//   2. Fires the once-ever tier-up celebration for promoted members through the
//      same keyed MILESTONE marker + notify pipeline as live awards, so it is
//      idempotent and can never double-fire.
//   3. Grants the "Legacy Member" badge to accounts created before the 3.0
//      cutoff. The cutoff is recorded in Setting on first --apply so reruns
//      and later signups never receive it. Unique(userId,badgeId) + P2002
//      makes re-runs no-ops.
//   4. Reports findReputationDrift() — must be empty before/after.
//
// Run:   npx tsx scripts/rewards3-migration.mts          (dry-run report)
//        npx tsx scripts/rewards3-migration.mts --apply  (execute)
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { REP_EVENT_TYPES, REP_TIERS, getReputationTier, getRepStage } from "@/lib/reputation-config"
import { cosmeticsUnlockedBetween } from "@/lib/cosmetics"
import { notify } from "@/lib/notify"
import { announceTierUp } from "@/lib/terpbot"
import { grantBadge, findReputationDrift } from "@/lib/reputation"

const APPLY = process.argv.includes("--apply")
const CUTOFF_SETTING = "rep3_deployed_at"
const LEGACY_BADGE = "Legacy Member"

// Historical thresholds, kept for the before/after comparison only.
const OLD_TIERS = [
  { threshold: 0, name: "Seed" },
  { threshold: 250, name: "Sprout" },
  { threshold: 750, name: "Rooted" },
  { threshold: 1500, name: "Grower" },
  { threshold: 3500, name: "Cultivator" },
  { threshold: 7000, name: "Master Grower" },
  { threshold: 15000, name: "Head Grower" },
  { threshold: 40000, name: "Hash Maker" },
  { threshold: 100000, name: "Cannabis Deity" },
]

function oldTier(rep: number) {
  let t = OLD_TIERS[0]
  for (const tier of OLD_TIERS) if (rep >= tier.threshold) t = tier
  return t
}

// Same keyed-marker convention as reputation.ts claimMilestone — amount=0,
// unique key, P2002 = already celebrated. Replicated here because the live
// helper is intentionally private to the award engine.
async function claimTierMilestone(userId: string, threshold: number): Promise<boolean> {
  try {
    await prisma.reputationEvent.create({
      data: {
        userId,
        type: REP_EVENT_TYPES.MILESTONE,
        amount: 0,
        reason: "Milestone marker",
        key: `milestone:tier:${userId}:${threshold}`,
      },
    })
    return true
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false
    throw error
  }
}

async function main() {
  console.log(`\n=== Reputation & Rewards 3.0 migration sweep (${APPLY ? "APPLY" : "DRY-RUN"}) ===\n`)

  // Cutoff: recorded once on first apply so reruns stay consistent.
  const stored = await prisma.setting.findUnique({ where: { key: CUTOFF_SETTING } })
  const cutoff = stored ? new Date(stored.value) : new Date()
  if (!stored && APPLY) {
    await prisma.setting.create({ data: { key: CUTOFF_SETTING, value: cutoff.toISOString() } })
    console.log(`Recorded 3.0 cutoff: ${cutoff.toISOString()}`)
  } else {
    console.log(`3.0 cutoff: ${stored ? cutoff.toISOString() : `${cutoff.toISOString()} (would be recorded on --apply)`}`)
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      createdAt: true,
      banned: true,
      suspendedUntil: true,
      profile: { select: { reputation: true, username: true, publicMilestoneOptOut: true } },
    },
  })
  console.log(`Total active users: ${users.length}`)

  let promoted = 0, unchanged = 0, demoted = 0, legacyEligible = 0, legacyGranted = 0, notified = 0
  const demotions: string[] = []
  const now = Date.now()

  for (const user of users) {
    const rep = user.profile?.reputation ?? 0
    const before = oldTier(rep)
    const after = getReputationTier(rep)

    if (after.threshold > before.threshold) promoted++
    else if (after.threshold < before.threshold) {
      demoted++
      demotions.push(`${user.profile?.username ?? user.id}: ${rep} rep ${before.name} -> ${after.name}`)
    } else unchanged++

    // Legacy Member — accounts predating the 3.0 cutoff.
    if (user.createdAt < cutoff) {
      legacyEligible++
      if (APPLY && (await grantBadge(user.id, LEGACY_BADGE, { notifyUser: true }))) legacyGranted++
    }

    // Tier-up celebration for promotions — suspended/banned users keep the
    // promotion (it's their real rep) but get no notification or announce.
    const inactive = user.banned || (user.suspendedUntil != null && user.suspendedUntil.getTime() > now)
    if (APPLY && after.threshold > before.threshold && !inactive) {
      if (await claimTierMilestone(user.id, after.threshold)) {
        const stage = getRepStage(rep)
        const unlocks = cosmeticsUnlockedBetween(before.threshold, rep)
        await notify({
          userId: user.id,
          type: "REPUTATION",
          title: `Tier up: ${after.name}`,
          content: `The rewards update promoted you to ${after.name}. ${after.benefit}`,
          link: "/reputation",
          metadata: {
            kind: "tier",
            level: stage.level,
            stageName: stage.stageName,
            rep,
            tier: { name: after.name, icon: after.icon, color: after.color, bg: after.bg },
            unlocks: unlocks.map((u) => ({ kind: u.kind, key: u.key, name: u.name })),
          },
        }).catch(() => null)
        if (user.profile?.username && !user.profile.publicMilestoneOptOut) {
          await announceTierUp(user.profile.username, after.name, rep, unlocks.map((u) => u.name)).catch(() => null)
        }
        notified++
      }
    }
  }

  console.log(`\nTier movement:`)
  console.log(`  promoted:  ${promoted}`)
  console.log(`  unchanged: ${unchanged}`)
  console.log(`  demoted:   ${demoted}${demoted ? "  <-- UNEXPECTED, abort recommended" : ""}`)
  for (const d of demotions) console.log(`    ${d}`)

  console.log(`\nLegacy Member:`)
  console.log(`  eligible:  ${legacyEligible}`)
  console.log(`  ${APPLY ? `granted this run: ${legacyGranted}` : "would be granted on --apply"}`)

  console.log(`\nTier-up notifications: ${APPLY ? notified : "would fire on --apply (skipped: suspended/banned + already-claimed)"}`)

  const drift = await findReputationDrift()
  console.log(`\nReputation drift: ${drift.length}`)
  for (const d of drift.slice(0, 10)) console.log(`  ${d.userId}: profile=${d.reputation} ledger=${d.ledger}`)

  console.log(`\nNew tier ladder:`)
  for (const t of REP_TIERS) console.log(`  ${t.name.padEnd(15)} ${t.threshold.toLocaleString()}`)

  if (!APPLY) console.log(`\nDry-run complete — rerun with --apply to execute.\n`)
  else console.log(`\nSweep complete.\n`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
