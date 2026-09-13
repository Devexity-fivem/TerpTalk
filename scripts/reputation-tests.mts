// Reputation 2.0 regression tests — pure unit tests for the config/tier/badge
// rules, plus ledger behaviour exercised against the real database with a
// disposable __test_rep_ user (cascade-deleted at the end).
// Run: npm run test:reputation
import { strict as assert } from "node:assert"
import { prisma } from "@/lib/prisma"
import {
  REP_POINTS,
  REP_CAPS,
  REP_TIERS,
  REP_EVENT_TYPES,
  PUBLIC_REP_TYPES,
  EARLY_SUPPORTER_LIMIT,
  LIKE_MIN_ACTOR_AGE_HOURS,
  VERIFIED_MIN_REPUTATION,
  getReputationTier,
  getNextTier,
  getTierProgress,
  publicRepLabel,
} from "@/lib/reputation-config"
import {
  applyReputationAward,
  reverseReputationEvent,
  reverseReputationByKey,
  reverseReputationBySource,
  findReputationDrift,
  BADGE_RULES,
} from "@/lib/reputation"
import { BADGE_REGISTRY, BOT_BADGE_REGISTRY, isBotBadge, STAFF_AWARDED_BADGES } from "@/lib/badge-registry"
import { TERPBOT_USERNAME } from "@/lib/terpbot-constants"

const TEST_USERNAME = `__test_rep_${Date.now()}`

// Badges granted outside checkBadges() — each must have a real code path:
//   Dedicated Grower   — diary-updates streak award (grantBadge)
//   Weekly Winner / Diary of the Month / Contest Finalist — contest-awards.ts
//   Beta Tester        — admin beta toggle
//   Verified YouTuber  — admin/youtubers approval
//   Moderator / Staff  — role-change grants in /api/admin/users
//   Trusted Member     — whitelisted admin grant (STAFF_AWARDED_BADGES)
const NON_RULE_BADGES = new Set([
  "Dedicated Grower",
  "Weekly Winner",
  "Diary of the Month",
  "Contest Finalist",
  "Beta Tester",
  "Verified YouTuber",
  "Moderator",
  "Staff",
  ...STAFF_AWARDED_BADGES,
])

async function repOf(userId: string) {
  const p = await prisma.profile.findUnique({ where: { userId }, select: { reputation: true } })
  return p?.reputation ?? -1
}

async function ledgerSum(userId: string) {
  const agg = await prisma.reputationEvent.aggregate({
    where: { userId },
    _sum: { amount: true },
  })
  return agg._sum.amount ?? 0
}

async function run() {
  console.log("Starting Reputation 2.0 tests...")

  // ── Pure: tier math ───────────────────────────────────────────────
  assert.equal(getReputationTier(0).name, "Seed")
  assert.equal(getReputationTier(249).name, "Seed")
  assert.equal(getReputationTier(250).name, "Sprout")
  assert.equal(getReputationTier(749).name, "Sprout")
  assert.equal(getReputationTier(750).name, "Seedling")
  assert.equal(getReputationTier(100000).name, "Cannabis Deity")
  assert.equal(getReputationTier(999999999).name, "Cannabis Deity")

  // Thresholds strictly increasing, every tier has a benefit + perks object.
  for (let i = 0; i < REP_TIERS.length; i++) {
    const t = REP_TIERS[i]
    assert.ok(t.benefit.length > 0, `${t.name} has a benefit description`)
    assert.ok(t.perks && typeof t.perks === "object", `${t.name} has a perks object`)
    assert.ok(t.icon.length > 0, `${t.name} has an icon`)
    if (i > 0) assert.ok(t.threshold > REP_TIERS[i - 1].threshold, `${t.name} threshold increases`)
  }
  // Perk monotonicity: a perk granted at a lower tier must persist upward.
  for (const key of ["trustedLinks", "pollVoting", "verifiedMember"] as const) {
    let seen = false
    for (const t of REP_TIERS) {
      if (t.perks[key]) seen = true
      if (seen) assert.ok(t.perks[key], `${key} must persist once unlocked (${t.name})`)
    }
  }

  assert.equal(getNextTier(0)?.name, "Sprout")
  assert.equal(getNextTier(100000), null)
  const prog = getTierProgress(375) // halfway Seedling (750) - Sprout (250)
  assert.equal(prog.percent, 25)
  assert.equal(getTierProgress(0).percent, 0)
  assert.equal(getTierProgress(100000).percent, 100)

  // ── Pure: economy config sanity ───────────────────────────────────
  for (const k of Object.keys(REP_CAPS)) {
    assert.ok(k in REP_POINTS, `cap ${k} maps to a known source`)
    assert.ok(REP_CAPS[k as keyof typeof REP_CAPS]! > 0, `cap ${k} positive`)
  }
  for (const k of Object.keys(REP_POINTS)) {
    assert.ok(REP_POINTS[k as keyof typeof REP_POINTS] > 0, `${k} positive`)
    assert.notEqual(publicRepLabel(k), "Reputation change", `${k} has a public label`)
  }
  assert.ok(LIKE_MIN_ACTOR_AGE_HOURS > 0)
  assert.ok(EARLY_SUPPORTER_LIMIT > 0)
  assert.ok(VERIFIED_MIN_REPUTATION === REP_TIERS[3].threshold, "verified threshold == Grower tier")
  for (const t of PUBLIC_REP_TYPES) {
    assert.ok(
      t in REP_POINTS
        || t === REP_EVENT_TYPES.REVERSAL
        || t === REP_EVENT_TYPES.REINSTATE
        || t === REP_EVENT_TYPES.LEGACY_MIGRATION,
      `public type ${t} is a known award or REVERSAL`
    )
    assert.notEqual(publicRepLabel(t), "Reputation change", `public type ${t} labelled`)
  }
  // Sensitive types stay off public history. LEGACY_MIGRATION IS public: if a
  // carried-forward row ever exists, hiding it would leave an unexplained gap
  // between the balance and the visible history.
  assert.ok(PUBLIC_REP_TYPES.has(REP_EVENT_TYPES.LEGACY_MIGRATION))
  assert.ok(!PUBLIC_REP_TYPES.has(REP_EVENT_TYPES.STAFF_ADJUSTMENT))
  assert.ok(!PUBLIC_REP_TYPES.has("DAILY_LOGIN"))

  // ── Pure: badge registry ↔ rules consistency ─────────────────────
  const registryNames = new Set(BADGE_REGISTRY.map((b) => b.name))
  for (const ruleName of Object.keys(BADGE_RULES)) {
    assert.ok(registryNames.has(ruleName), `rule "${ruleName}" has a registry entry`)
    assert.ok(!isBotBadge(ruleName), `rule "${ruleName}" is not a bot badge`)
  }
  for (const b of BADGE_REGISTRY) {
    assert.ok(
      BADGE_RULES[b.name] || NON_RULE_BADGES.has(b.name),
      `badge "${b.name}" has an earning path (rule or documented external grant)`
    )
    assert.ok(b.description && b.requirement && b.icon, `badge "${b.name}" fully described`)
  }
  for (const s of STAFF_AWARDED_BADGES) {
    assert.ok(registryNames.has(s), `staff-awarded badge "${s}" exists in registry`)
  }
  // Bot achievements are fully disjoint from human badges.
  for (const b of BOT_BADGE_REGISTRY) {
    assert.ok(!registryNames.has(b.name), `bot badge "${b.name}" not in human registry`)
    assert.ok(isBotBadge(b.name), `isBotBadge("${b.name}")`)
  }

  // ── DB: ledger behaviour with a disposable user ──────────────────
  const user = await prisma.user.create({
    data: {
      name: TEST_USERNAME,
      ageVerified: true,
      sessionVersion: 1,
      profile: { create: { username: TEST_USERNAME } },
    },
    select: { id: true },
  })
  const uid = user.id

  try {
    // Basic keyed award.
    const a1 = await applyReputationAward(uid, "POST_CREATED", REP_POINTS.POST_CREATED, "test post", {
      key: `test:post:1`,
      sourceType: "POST",
      sourceId: "test-post-1",
      actorId: "someone-else",
    })
    assert.equal(a1.awarded, true)
    assert.equal(a1.newRep, REP_POINTS.POST_CREATED)
    assert.equal(await repOf(uid), REP_POINTS.POST_CREATED)
    assert.equal(await ledgerSum(uid), REP_POINTS.POST_CREATED)

    // Duplicate key → no-op.
    const dup = await applyReputationAward(uid, "POST_CREATED", REP_POINTS.POST_CREATED, "retry", {
      key: `test:post:1`, sourceType: "POST", sourceId: "test-post-1", actorId: "someone-else",
    })
    assert.equal(dup.awarded, false)
    assert.equal(dup.skippedReason, "duplicate")
    assert.equal(await repOf(uid), REP_POINTS.POST_CREATED)

    // Self-award blocked.
    const self = await applyReputationAward(uid, "LIKE_RECEIVED", REP_POINTS.LIKE_RECEIVED, "self like", {
      key: `test:self:1`, actorId: uid,
    })
    assert.equal(self.awarded, false)
    assert.equal(self.skippedReason, "self")

    // Reversal → counter-entry, balance drops, original marked.
    const ev = await prisma.reputationEvent.findUnique({ where: { key: "test:post:1" }, select: { id: true } })
    const r1 = await reverseReputationEvent(ev!.id, "content removed")
    assert.equal(r1.reversed, true)
    assert.equal(r1.newRep, 0)
    assert.equal(await repOf(uid), 0)
    const orig = await prisma.reputationEvent.findUnique({ where: { key: "test:post:1" } })
    assert.ok(orig!.reversedAt, "original marked reversed")
    const counter = await prisma.reputationEvent.findFirst({
      where: { reversalOfId: ev!.id, type: REP_EVENT_TYPES.REVERSAL },
    })
    assert.ok(counter, "counter-entry exists")
    assert.equal(counter!.amount, -REP_POINTS.POST_CREATED)

    // Idempotent double-reversal.
    const r2 = await reverseReputationEvent(ev!.id, "again")
    assert.equal(r2.reversed, false)
    const r3 = await reverseReputationByKey("test:post:1", "by key")
    assert.equal(r3.reversed, false)
    assert.equal(await repOf(uid), 0)

    // Re-award a reversed key → reinstates the original, no duplicate row.
    const a2 = await applyReputationAward(uid, "POST_CREATED", REP_POINTS.POST_CREATED, "restore", {
      key: `test:post:1`, sourceType: "POST", sourceId: "test-post-1",
    })
    assert.equal(a2.awarded, true)
    assert.equal(a2.reinstated, true)
    assert.equal(await repOf(uid), REP_POINTS.POST_CREATED)
    const rows = await prisma.reputationEvent.count({ where: { key: "test:post:1" } })
    assert.equal(rows, 1, "reinstatement reuses the original row")
    // And the counter-entry was voided.
    const voided = await prisma.reputationEvent.findFirst({ where: { reversalOfId: ev!.id } })
    assert.ok(voided!.reversedAt, "counter-entry voided on reinstatement")

    // Second re-award → duplicate no-op.
    const a3 = await applyReputationAward(uid, "POST_CREATED", REP_POINTS.POST_CREATED, "again", {
      key: `test:post:1`,
    })
    assert.equal(a3.awarded, false)
    assert.equal(a3.skippedReason, "duplicate")

    // Source reversal: two events on one source, both reversed.
    await applyReputationAward(uid, "LIKE_RECEIVED", 2, "like a", { key: "test:src:a", sourceType: "POST", sourceId: "shared", actorId: "x" })
    await applyReputationAward(uid, "LIKE_RECEIVED", 2, "like b", { key: "test:src:b", sourceType: "POST", sourceId: "shared", actorId: "y" })
    const before = await repOf(uid)
    const n = await reverseReputationBySource("POST", "shared", "post deleted")
    assert.equal(n, 2)
    assert.equal(await repOf(uid), before - 4)

    // Banned recipient: skipped unless forced.
    await prisma.user.update({ where: { id: uid }, data: { banned: true } })
    const banned = await applyReputationAward(uid, "POST_CREATED", 2, "while banned", { key: "test:banned:1" })
    assert.equal(banned.awarded, false)
    assert.equal(banned.skippedReason, "suspended")
    const forced = await applyReputationAward(uid, REP_EVENT_TYPES.STAFF_ADJUSTMENT, 5, "staff grant", { force: true })
    assert.equal(forced.awarded, true)
    await prisma.user.update({ where: { id: uid }, data: { banned: false } })

    // Negative clamp: the ledger records the actually-applied delta, so a
    // huge deduction lands at exactly 0 and balance == SUM(active) still holds.
    const repBeforeNeg = await repOf(uid)
    const neg = await applyReputationAward(uid, REP_EVENT_TYPES.STAFF_ADJUSTMENT, -9999, "staff reset", { force: true })
    assert.equal(neg.awarded, true)
    assert.equal(neg.amount, -repBeforeNeg, "applied delta clamped to current balance")
    assert.equal(await repOf(uid), 0, "balance clamps at 0")
    assert.equal(await repOf(uid), await ledgerSum(uid), "no drift after clamped adjustment")

    // Daily cap: THREAD_CREATED pays 3/day.
    let paid = 0
    for (let i = 0; i < 5; i++) {
      const r = await applyReputationAward(uid, "THREAD_CREATED", REP_POINTS.THREAD_CREATED, `t${i}`, { key: `test:cap:${i}` })
      if (r.awarded) paid++
    }
    assert.equal(paid, REP_CAPS.THREAD_CREATED, "thread cap enforced")

    // No-drift on a clean user (fresh user, all events accounted).
    const clean = await prisma.user.create({
      data: { name: `${TEST_USERNAME}_b`, ageVerified: true, sessionVersion: 1, profile: { create: { username: `${TEST_USERNAME}_b` } } },
      select: { id: true },
    })
    try {
      await applyReputationAward(clean.id, "POST_CREATED", 2, "p", { key: "test:clean:1" })
      await applyReputationAward(clean.id, "POST_CREATED", 2, "p2", { key: "test:clean:2" })
      const drift = await findReputationDrift()
      assert.ok(!drift.some((d) => d.userId === clean.id), "no drift after normal awards")
      assert.equal(await repOf(clean.id), await ledgerSum(clean.id), "balance == ledger")
    } finally {
      await prisma.user.delete({ where: { id: clean.id } }).catch(() => {})
    }

    // TerpBot can never earn rep.
    const bot = await prisma.profile.findUnique({ where: { username: TERPBOT_USERNAME }, select: { userId: true } })
    if (bot) {
      const r = await applyReputationAward(bot.userId, "POST_CREATED", 2, "bot award", { key: "test:bot:1" })
      assert.equal(r.awarded, false)
      assert.equal(r.skippedReason, "bot")
      const botEvents = await prisma.reputationEvent.count({ where: { key: "test:bot:1" } })
      assert.equal(botEvents, 0, "no ledger row written for bot")
    } else {
      console.log("  (terpbot user not present in this database — bot-exclusion test skipped)")
    }

    // Final invariant: after every op above, balance == ledger sum.
    assert.equal(await repOf(uid), await ledgerSum(uid), "final balance == ledger")
    const driftAll = await findReputationDrift()
    assert.ok(!driftAll.some((d) => d.userId === uid), "test user shows no drift")
  } finally {
    await prisma.user.delete({ where: { id: uid } }).catch(() => {})
  }

  console.log("All Reputation 2.0 tests passed.")
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
