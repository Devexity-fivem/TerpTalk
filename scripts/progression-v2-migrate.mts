// progression-v2-migrate.mts — Legacy Reputation → Progression V2 migration.
//
// Implements implementation-plan Phase 2. Runs ONLY against non-production
// until Phase 16 approves prod. What it does, all idempotent:
//
//   --standing      seed Profile.standing from the legacy trust-sum
//                   (SUM of TRUST_EVENT_TYPES ReputationEvent.amount) as a
//                   keyed LEGACY_STANDING ProgressionEvent per user
//   --verified      set Profile.legacyVerified on existing VERIFIED_MEMBERs
//   --badges        archive Badge/UserBadge into LEGACY Achievement/
//                   UserAchievement rows (display continuity, no re-grants)
//   --freeze        mark the legacy ledger frozen (Setting rep_v1_frozen_at)
//   --reconcile     verify all post-migration invariants
//   --all           all of the above, in order
//   --dry-run       print planned writes, touch nothing
//
// Usage: npx tsx scripts/progression-v2-migrate.mts --all [--dry-run]

import "./db-guard.mjs"
import { PrismaClient } from "@prisma/client"
import { TRUST_EVENT_TYPES } from "../src/lib/reputation-config"

const prisma = new PrismaClient()
const args = new Set(process.argv.slice(2))
const DRY = args.has("--dry-run")
const ALL = args.has("--all")
const run = (f: string) => ALL || args.has(`--${f}`)

function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - day + 3)
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / 604800000)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`
}

// ── Standing seed ────────────────────────────────────────────────────
// Per locked design D1: seed from the legacy TRUST_EVENT_TYPES sum —
// the old trust axis, frozen as a baseline. Likes were a legitimate input
// to that sum under the old model; they earn nothing new under V2.
async function migrateStanding() {
  const sums = await prisma.reputationEvent.groupBy({
    by: ["userId"],
    where: { type: { in: [...TRUST_EVENT_TYPES] }, reversedAt: null },
    _sum: { amount: true },
  })
  const positive = sums.filter((s) => (s._sum.amount ?? 0) > 0)
  console.log(`standing: ${sums.length} users have trust history, ${positive.length} above zero`)

  let written = 0
  for (const s of positive) {
    const amount = Math.max(0, s._sum.amount ?? 0)
    const key = `standing:legacy:${s.userId}`
    if (DRY) {
      if (written < 5) console.log(`  [dry] ${s.userId} → standing ${amount}`)
      written++
      continue
    }
    await prisma.$transaction(async (tx) => {
      const existing = await tx.progressionEvent.findUnique({ where: { key } })
      if (!existing) {
        await tx.progressionEvent.create({
          data: {
            userId: s.userId,
            type: "LEGACY_STANDING",
            standing: amount,
            reason: "Standing carried over from TerpTalk's original trust system",
            key,
            meta: { seeded: true, trustSum: amount },
          },
        })
        await tx.profile.update({ where: { userId: s.userId }, data: { standing: amount } })
      }
    })
    written++
  }
  console.log(`standing: ${written} LEGACY_STANDING rows ${DRY ? "planned" : "written"}`)
}

// ── Legacy Verified ──────────────────────────────────────────────────
async function migrateVerified() {
  const verified = await prisma.user.findMany({
    where: { role: "VERIFIED_MEMBER" },
    select: { id: true },
  })
  console.log(`verified: ${verified.length} VERIFIED_MEMBER users`)
  if (DRY) return
  const res = await prisma.profile.updateMany({
    where: { userId: { in: verified.map((u) => u.id) }, legacyVerified: false },
    data: { legacyVerified: true },
  })
  console.log(`verified: ${res.count} profiles flagged legacyVerified`)
}

// ── Legacy badge archive ─────────────────────────────────────────────
// Every old Badge becomes a LEGACY-rarity Achievement; every UserBadge a
// UserAchievement preserving earnedAt/pinned. Display continuity only —
// no utility unlocks are re-granted.
async function archiveBadges() {
  const badges = await prisma.badge.findMany({ include: { userBadges: true } })
  console.log(`badges: ${badges.length} legacy badges to archive`)
  let achCreated = 0
  let uaCreated = 0
  for (const b of badges) {
    const key = `legacy:${b.id}`
    if (DRY) {
      achCreated++
      uaCreated += b.userBadges.length
      continue
    }
    const ach = await prisma.achievement.upsert({
      where: { key },
      update: {},
      create: {
        key,
        family: "LEGACY",
        name: b.name,
        description: b.description,
        icon: b.icon,
        rarity: "LEGACY",
        hidden: false,
      },
    })
    achCreated++
    for (const ub of b.userBadges) {
      const res = await prisma.userAchievement.upsert({
        where: { userId_achievementId: { userId: ub.userId, achievementId: ach.id } },
        update: { pinned: ub.pinned },
        create: { userId: ub.userId, achievementId: ach.id, pinned: ub.pinned, earnedAt: ub.earnedAt },
      })
      if (res) uaCreated++
    }
  }
  console.log(`badges: ${achCreated} achievements, ${uaCreated} user-achievements ${DRY ? "planned" : "written"}`)
}

// ── Freeze marker ────────────────────────────────────────────────────
async function markFreeze() {
  if (DRY) {
    console.log("freeze: would set rep_v1_frozen_at")
    return
  }
  await prisma.setting.upsert({
    where: { key: "rep_v1_frozen_at" },
    update: {},
    create: { key: "rep_v1_frozen_at", value: new Date().toISOString() },
  })
  console.log("freeze: rep_v1_frozen_at recorded")
}

// ── Reconciliation ───────────────────────────────────────────────────
async function reconcile() {
  let ok = true
  const profiles = await prisma.profile.findMany({ select: { userId: true, xp: true, standing: true } })
  const xpSums = await prisma.progressionEvent.groupBy({ by: ["userId"], _sum: { xp: true, standing: true } })
  const sumMap = new Map(xpSums.map((s) => [s.userId, { xp: s._sum.xp ?? 0, standing: s._sum.standing ?? 0 }]))
  let xpBad = 0
  let stBad = 0
  for (const p of profiles) {
    const s = sumMap.get(p.userId) ?? { xp: 0, standing: 0 }
    if (p.xp !== s.xp) xpBad++
    if (p.standing !== s.standing) stBad++
  }
  console.log(`reconcile: ${profiles.length} profiles — xp mismatches ${xpBad}, standing mismatches ${stBad}`)
  if (xpBad || stBad) ok = false

  const legacyCount = await prisma.progressionEvent.count({ where: { type: "LEGACY_STANDING" } })
  const verifiedCount = await prisma.profile.count({ where: { legacyVerified: true } })
  const legacyAch = await prisma.achievement.count({ where: { family: "LEGACY" } })
  const legacyUA = await prisma.userAchievement.count({ where: { achievement: { family: "LEGACY" } } })
  const badgeCount = await prisma.badge.count()
  const ubCount = await prisma.userBadge.count()
  console.log(`reconcile: ${legacyCount} standing seeds | ${verifiedCount} legacyVerified | ${legacyAch}/${badgeCount} legacy achievements | ${legacyUA}/${ubCount} legacy grants`)
  if (!DRY && (legacyAch !== badgeCount || legacyUA !== ubCount)) ok = false

  const frozenAt = await prisma.setting.findUnique({ where: { key: "rep_v1_frozen_at" } })
  console.log(`reconcile: legacy ledger ${frozenAt ? `frozen at ${frozenAt.value}` : "NOT marked frozen"}`)

  console.log(ok ? "reconcile: ALL INVARIANTS HOLD" : "reconcile: FAILURES FOUND")
  if (!ok) process.exitCode = 1
}

// ── Main ─────────────────────────────────────────────────────────────
const started = new Date()
console.log(`progression-v2 migrate ${DRY ? "(DRY RUN)" : ""} — ${isoWeekKey(started)}`)
try {
  if (run("standing")) await migrateStanding()
  if (run("verified")) await migrateVerified()
  if (run("badges")) await archiveBadges()
  if (run("freeze")) await markFreeze()
  if (run("reconcile") || ALL) await reconcile()
  if (!ALL && ![...args].some((a) => a.startsWith("--") && a !== "--dry-run"))
    console.log("no step selected — pass --all or individual flags")
} finally {
  await prisma.$disconnect()
}
