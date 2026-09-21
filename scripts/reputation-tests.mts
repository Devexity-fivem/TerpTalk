// Reputation 2.0 regression tests — pure unit tests for the config/tier/badge
// rules, plus ledger behaviour exercised against the real database with a
// disposable __test_rep_ user (cascade-deleted at the end).
// Run: npm run test:reputation
import "./db-guard.mjs"
import { strict as assert } from "node:assert"
import { prisma } from "@/lib/prisma"
import {
  REP_POINTS,
  REP_CAPS,
  REP_TIERS,
  REP_EVENT_TYPES,
  PUBLIC_REP_TYPES,
  REP_LADDER,
  EARLY_SUPPORTER_LIMIT,
  LIKE_MIN_ACTOR_AGE_HOURS,
  VERIFIED_MIN_REPUTATION,
  getReputationTier,
  getNextTier,
  getTierProgress,
  getRepStage,
  getRepLevel,
  getStageProgress,
  publicRepLabel,
  crossedRungs,
} from "@/lib/reputation-config"
import { AVATAR_FRAMES, PROFILE_TITLES, PROFILE_THEMES, canEquip, unlockedCosmetics, nextLockedCosmetic, cosmeticsUnlockedBetween } from "@/lib/cosmetics"
import { WEEKLY_CHALLENGES } from "@/lib/challenges"
import {
  applyReputationAward,
  awardReputation,
  reverseReputationEvent,
  reverseReputationByKey,
  reverseReputationBySource,
  findReputationDrift,
  BADGE_RULES,
} from "@/lib/reputation"
import { BADGE_REGISTRY, BOT_BADGE_REGISTRY, isBotBadge, STAFF_AWARDED_BADGES } from "@/lib/badge-registry"
import { getCheckinStreak, evaluateStreaks } from "@/lib/streaks"
import { TERPBOT_USERNAME } from "@/lib/terpbot-constants"

const TEST_USERNAME = `__test_rep_${Date.now()}`

// Badges granted outside checkBadges() — each must have a real code path:
//   Settled In         — onboarding-complete award
//   Weekly Winner / Diary of the Month / Contest Finalist — contest-awards.ts
//   Beta Tester        — admin beta toggle
//   Verified YouTuber  — admin/youtubers approval
//   Moderator / Staff  — role-change grants in /api/admin/users
//   Trusted Member     — whitelisted admin grant (STAFF_AWARDED_BADGES)
//   Hidden discovery badges — dedicated checks in reputation.ts / harvest route
//   Legacy Member       — one-time 3.0 migration sweep script
//   Grower of the Week  — weekly recognition resolver (lib/weekly-awards.ts)
const NON_RULE_BADGES = new Set([
  "Settled In",
  "Weekly Winner",
  "Diary of the Month",
  "Contest Finalist",
  "Beta Tester",
  "Verified YouTuber",
  "Moderator",
  "Staff",
  "Legacy Member",
  "Grower of the Week",
  "Comeback",
  "Deep Roots",
  "Photoperiod",
  "Four Twenty",
  "Secret Stash",
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

  // ── Pure: tier math (3.0 ladder) ─────────────────────────────────
  // Full boundary sweep — every threshold edge lands in the right tier.
  const boundaryExpectations: [number, string][] = [
    [0, "Seed"], [49, "Seed"],
    [50, "Germinated"], [149, "Germinated"],
    [150, "Sprout"], [299, "Sprout"],
    [300, "Seedling"], [499, "Seedling"],
    [500, "Rooted"], [999, "Rooted"],
    [1000, "Veg Grower"], [1499, "Veg Grower"],
    [1500, "Grower"], [2499, "Grower"],
    [2500, "Bloom"], [3499, "Bloom"],
    [3500, "Cultivator"], [6999, "Cultivator"],
    [7000, "Master Grower"], [14999, "Master Grower"],
    [15000, "Head Grower"], [29999, "Head Grower"],
    [30000, "Grandmaster"], [49999, "Grandmaster"],
    [50000, "Master Gardener"], [100000, "Master Gardener"],
    [999999999, "Master Gardener"],
  ]
  for (const [rep, expected] of boundaryExpectations) {
    assert.equal(getReputationTier(rep).name, expected, `rep ${rep} → ${expected}`)
  }

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

  assert.equal(getNextTier(0)?.name, "Germinated")
  assert.equal(getNextTier(50000), null)
  const prog = getTierProgress(400) // halfway Seedling (300) → Rooted (500)
  assert.equal(prog.percent, 50)
  assert.equal(getTierProgress(0).percent, 0)
  assert.equal(getTierProgress(50000).percent, 100)
  assert.equal(getTierProgress(999999999).percent, 100)

  // ── Pure: grow-stage ladder ───────────────────────────────────────
  // Ladder is sorted, starts at 0, and contains every tier threshold.
  for (let i = 1; i < REP_LADDER.length; i++) {
    assert.ok(REP_LADDER[i] > REP_LADDER[i - 1], `ladder rung ${i} increases`)
  }
  for (const t of REP_TIERS) {
    assert.ok(REP_LADDER.includes(t.threshold), `ladder contains ${t.name} threshold`)
  }
  // Stage boundaries: rep just below a rung stays in the lower stage.
  assert.equal(getRepStage(0).level, 1)
  assert.equal(getRepStage(0).tier.name, "Seed")
  assert.equal(getRepStage(149).level, 3) // Germinated's 100 checkpoint
  assert.equal(getRepStage(150).level, 4) // Sprout threshold = rung 4
  assert.equal(getRepStage(150).tier.name, "Sprout")
  assert.equal(getRepStage(999).stageName, "Harvest", "999 = Rooted Harvest stage")
  assert.equal(getRepStage(700).stageName, "Flower", "700 = Rooted Flower stage")
  assert.equal(getRepStage(1000).stageName, "Veg", "1000 = Veg Grower first stage")
  // Top of the ladder: percent 100, no remaining.
  assert.equal(getStageProgress(50000).percent, 100)
  assert.equal(getStageProgress(50000).remaining, 0)
  // Mid-stage progress.
  const sp = getStageProgress(1000) // Rooted stage at 1000, next rung 1250
  assert.equal(sp.next, 250)
  assert.equal(sp.current, 0)
  assert.equal(sp.percent, 0)
  assert.equal(getRepLevel(0), 1)
  assert.equal(getRepLevel(REP_LADDER[REP_LADDER.length - 1]), REP_LADDER.length)

  // Checkpoint integrity (3.0 re-map): every rung strictly inside a valid
  // stage range — guards against checkpoints exceeding the next tier's
  // threshold (the old Hash Maker map ran to 90k past the 50k summit).
  const lastRung = REP_LADDER[REP_LADDER.length - 1]
  for (const rung of REP_LADDER) {
    const stage = getRepStage(rung)
    assert.equal(stage.stageStart, rung, `rung ${rung} starts a stage`)
    assert.ok(stage.stageEnd >= stage.stageStart, `rung ${rung} end >= start`)
    const atRung = getStageProgress(rung)
    if (rung === lastRung) {
      assert.equal(atRung.percent, 100, "top rung complete")
    } else {
      assert.equal(atRung.percent, 0, `rung ${rung} starts at 0%`)
      assert.ok(atRung.next > 0, `rung ${rung} has a positive range`)
    }
    const below = getStageProgress(rung - 1)
    assert.ok(below.percent >= 0 && below.percent <= 100, `rep ${rung - 1} percent in [0,100]`)
    assert.ok(below.remaining >= 0, `rep ${rung - 1} remaining >= 0`)
  }
  // Every rung's stageEnd is exactly the next rung (or itself at the
  // summit) — a checkpoint above the next tier threshold would produce a
  // stageEnd below stageStart's stage or skip the tier boundary.
  for (let i = 0; i < REP_LADDER.length; i++) {
    const stage = getRepStage(REP_LADDER[i])
    const expectedEnd = REP_LADDER[i + 1] ?? REP_LADDER[i]
    assert.equal(stage.stageEnd, expectedEnd, `rung ${REP_LADDER[i]} ends at ${expectedEnd}`)
  }
  // And no rep below a tier threshold may report that tier as current.
  for (const t of REP_TIERS) {
    if (t.threshold === 0) continue
    assert.notEqual(getRepStage(t.threshold - 1).tier.name, t.name, `rep ${t.threshold - 1} not ${t.name}`)
  }

  // ── Pure: rung crossings (2.2 celebration detection) ─────────────
  assert.deepEqual(crossedRungs(0, 0), [])
  assert.deepEqual(crossedRungs(500, 500), [], "no gain = no crossing")
  assert.deepEqual(crossedRungs(600, 400), [], "demotion never crosses upward")
  // 149 -> 150 crosses exactly the Sprout tier rung.
  assert.deepEqual(
    crossedRungs(149, 150).map((c) => [c.rung, c.kind, c.level]),
    [[150, "tier", 4]]
  )
  // A single award can cross several rungs; each is classified.
  assert.deepEqual(
    crossedRungs(140, 760).map((c) => [c.rung, c.kind]),
    [[150, "tier"], [200, "stage"], [250, "stage"], [300, "tier"], [400, "stage"], [500, "tier"], [650, "stage"]]
  )
  // Crossing a stage rung lands on the matching Grow Level.
  const lvl250 = crossedRungs(249, 250)[0]
  assert.equal(lvl250.kind, "stage")
  assert.equal(lvl250.level, getRepLevel(250))
  // 30k→50k progression: crossing the Master Gardener threshold is a tier rung.
  const lvlApex = crossedRungs(49999, 50000)[0]
  assert.equal(lvlApex.kind, "tier")
  assert.equal(getRepStage(40000).tier.name, "Grandmaster")
  assert.equal(getRepStage(45000).tier.name, "Grandmaster")
  // Rung 0 (the start) can never be "crossed" — rep is never negative.
  assert.ok(crossedRungs(0, 1).every((c) => c.rung > 0))

  // ── Pure: unlock diff helpers ────────────────────────────────────
  assert.equal(nextLockedCosmetic(0)?.unlockedAt, 50)
  assert.equal(nextLockedCosmetic(50000), null, "nothing locked past max rep")
  assert.ok(
    cosmeticsUnlockedBetween(149, 150).length > 0,
    "crossing 150 unlocks the first cosmetics"
  )
  assert.deepEqual(cosmeticsUnlockedBetween(500, 600), [], "no cosmetics mid-gap")
  for (const c of cosmeticsUnlockedBetween(0, 50000)) {
    assert.ok(c.unlockedAt > 0 && c.unlockedAt <= 50000)
    assert.ok(["frame", "title", "theme"].includes(c.kind))
  }

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
  assert.ok(
    VERIFIED_MIN_REPUTATION === REP_TIERS.find((t) => t.perks.verifiedMember)?.threshold,
    "verified threshold == first verifiedMember tier (Grower)"
  )
  assert.equal(VERIFIED_MIN_REPUTATION, 1500)
  for (const t of PUBLIC_REP_TYPES) {
    assert.ok(
      t in REP_POINTS
        || t === REP_EVENT_TYPES.REVERSAL
        || t === REP_EVENT_TYPES.REINSTATE
        || t === REP_EVENT_TYPES.LEGACY_MIGRATION
        || t === REP_EVENT_TYPES.CHALLENGE_WEEKLY
        || t === REP_EVENT_TYPES.QUEST_DAILY
        || t === REP_EVENT_TYPES.BADGE_BONUS
        || t === REP_EVENT_TYPES.GROW_MILESTONE
        || t === REP_EVENT_TYPES.JOURNEY_COMPLETE
        || t === REP_EVENT_TYPES.WEEKLY_AWARD
        || t === REP_EVENT_TYPES.STREAK_BONUS,
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
  // Milestone markers are internal bookkeeping — never public history.
  assert.ok(REP_EVENT_TYPES.MILESTONE === "MILESTONE")
  assert.ok(!PUBLIC_REP_TYPES.has(REP_EVENT_TYPES.MILESTONE), "MILESTONE stays off public history")

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

  // ── Pure: cosmetics registry ──────────────────────────────────────
  // Every cosmetic unlocks exactly at a tier threshold, and keys are unique.
  const tierThresholds = new Set(REP_TIERS.map((t) => t.threshold))
  const allCosmetics = [...AVATAR_FRAMES, ...PROFILE_TITLES, ...PROFILE_THEMES]
  const keys = new Set(allCosmetics.map((c) => c.key))
  assert.equal(keys.size, allCosmetics.length, "cosmetic keys unique")
  for (const c of allCosmetics) {
    assert.ok(tierThresholds.has(c.unlockedAt), `${c.key} unlocks at a tier threshold`)
    assert.ok(c.name && c.description, `${c.key} fully described`)
  }
  // canEquip: locked above tier, equippable at/after, null always clears.
  assert.equal(canEquip(0, "frames", "sprout-ring"), false)
  assert.equal(canEquip(150, "frames", "sprout-ring"), true)
  assert.equal(canEquip(149, "frames", "sprout-ring"), false)
  assert.equal(canEquip(0, "frames", null), true)
  assert.equal(canEquip(50000, "frames", "northern-lights"), true)
  assert.equal(canEquip(49999, "frames", "northern-lights"), false)
  assert.ok(unlockedCosmetics(0).frames.length === 0)
  assert.ok(unlockedCosmetics(100000).frames.length === AVATAR_FRAMES.length)

  // ── Pure: weekly challenges ───────────────────────────────────────
  // Fixed roster, unique slugs, sane rewards, small weekly ceiling.
  const slugs = new Set(WEEKLY_CHALLENGES.map((c) => c.slug))
  assert.equal(slugs.size, WEEKLY_CHALLENGES.length, "challenge slugs unique")
  const weeklyMax = WEEKLY_CHALLENGES.reduce((s, c) => s + c.reward, 0)
  assert.ok(weeklyMax <= 150, `weekly challenge payout (${weeklyMax}) stays under the velocity flag threshold`)
  for (const c of WEEKLY_CHALLENGES) {
    assert.ok(c.reward > 0 && c.target > 0 && c.title && c.description, `challenge ${c.slug} well-formed`)
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
    // And the counter-entry was voided. (Filter to REVERSAL — the REINSTATE
    // row also carries reversalOfId and legitimately has reversedAt null.)
    const voided = await prisma.reputationEvent.findFirst({
      where: { reversalOfId: ev!.id, type: REP_EVENT_TYPES.REVERSAL },
    })
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

    // ── DB: milestone markers (2.2 once-ever celebrations) ─────────
    // awardReputation runs the full side-effect funnel (inline outside a
    // request scope). Crossing 150 claims the Sprout tier milestone once.
    const repBeforeMilestone = await repOf(uid)
    const bump = 150 - repBeforeMilestone
    await awardReputation(uid, REP_EVENT_TYPES.STAFF_ADJUSTMENT, bump, "test milestone bump", { force: true })
    // Crossing 150 also fires milestone badges (Sprout etc.) whose rep
    // bonuses land in the same balance — assert the floor, not the total.
    const repAt150 = await repOf(uid)
    assert.ok(repAt150 >= 150, `expected >=150 after bump, got ${repAt150}`)
    const tierMarker = await prisma.reputationEvent.findUnique({
      where: { key: `milestone:tier:${uid}:150` },
    })
    assert.ok(tierMarker, "tier milestone marker exists")
    assert.equal(tierMarker!.amount, 0, "marker is zero-amount")
    assert.equal(tierMarker!.type, "MILESTONE")
    const tierNotifs = await prisma.notification.findMany({
      where: { userId: uid, type: "REPUTATION" },
    })
    assert.ok(
      tierNotifs.some((n) => (n.metadata as { kind?: string } | null)?.kind === "tier"),
      "tier notification carries celebration metadata"
    )

    // Bump to 300 — Seedling is a TIER rung in the new ladder (crossing it
    // also passes the stage rungs at 200 and 250).
    await awardReputation(uid, REP_EVENT_TYPES.STAFF_ADJUSTMENT, 300 - repAt150, "test tier bump", { force: true })
    const repAt300 = await repOf(uid)
    assert.ok(repAt300 >= 300, `expected >=300 after bump, got ${repAt300}`)
    const seedlingMarker = await prisma.reputationEvent.findUnique({
      where: { key: `milestone:tier:${uid}:300` },
    })
    assert.ok(seedlingMarker, "Seedling tier milestone marker exists")

    // Crossing 400 is a pure STAGE crossing (Seedling's only checkpoint) —
    // exactly one new stage celebration fires.
    const stageCountBefore = (await prisma.notification.findMany({
      where: { userId: uid, type: "REPUTATION" },
    })).filter((n) => (n.metadata as { kind?: string } | null)?.kind === "stage").length
    await awardReputation(uid, REP_EVENT_TYPES.STAFF_ADJUSTMENT, 400 - repAt300, "test stage bump", { force: true })
    const repAt400 = await repOf(uid)
    assert.ok(repAt400 >= 400, `expected >=400 after bump, got ${repAt400}`)
    const stageMarker = await prisma.reputationEvent.findUnique({
      where: { key: `milestone:stage:${uid}:400` },
    })
    assert.ok(stageMarker, "stage milestone marker exists")
    const stageNotifs = await prisma.notification.findMany({
      where: { userId: uid, type: "REPUTATION" },
    })
    const stageCount = stageNotifs.filter(
      (n) => (n.metadata as { kind?: string } | null)?.kind === "stage"
    ).length
    assert.equal(stageCount, stageCountBefore + 1, "exactly one new stage celebration fired")

    // Once-ever: reversing below the rung then re-earning it must NOT
    // re-fire the celebration (marker is claimed; P2002 = already fired).
    const bump2 = await prisma.reputationEvent.findFirst({
      where: { userId: uid, type: REP_EVENT_TYPES.STAFF_ADJUSTMENT, reason: "test stage bump" },
      orderBy: { createdAt: "desc" },
      select: { id: true, amount: true },
    })
    await reverseReputationEvent(bump2!.id, "test reverse")
    const repAfterReverse = await repOf(uid)
    assert.ok(repAfterReverse < 400, `reversal should drop below 400, got ${repAfterReverse}`)
    const reEarn = 400 - repAfterReverse
    await awardReputation(uid, REP_EVENT_TYPES.STAFF_ADJUSTMENT, reEarn, "re-earn", { force: true, key: "test:milestone:re-earn" })
    assert.ok((await repOf(uid)) >= 400, "re-earn lands back at/above the rung")
    const markers400 = await prisma.reputationEvent.count({
      where: { key: `milestone:stage:${uid}:400` },
    })
    assert.equal(markers400, 1, "marker claimed exactly once")
    const stageNotifs2 = await prisma.notification.findMany({
      where: { userId: uid, type: "REPUTATION" },
    })
    assert.equal(
      stageNotifs2.filter((n) => (n.metadata as { kind?: string } | null)?.kind === "stage").length,
      stageCount,
      "no duplicate stage celebration after re-earning"
    )
    // ── DB: garden streaks ─────────────────────────────────────────
    // Streak derives from DAILY_LOGIN ledger days; milestones pay once.
    const streakUser = await prisma.user.create({
      data: { name: `${TEST_USERNAME}_streak`, ageVerified: true, sessionVersion: 1, profile: { create: { username: `${TEST_USERNAME}_streak` } } },
      select: { id: true },
    })
    try {
      const today = new Date()
      const dayMs = 86_400_000
      // Four consecutive check-in days ending today → 4-day streak.
      for (let i = 0; i < 4; i++) {
        const d = new Date(today.getTime() - i * dayMs)
        await prisma.reputationEvent.create({
          data: {
            userId: streakUser.id, type: "DAILY_LOGIN", amount: 1,
            reason: "Daily check-in", key: `daily:${streakUser.id}:${d.toISOString().slice(0, 10)}`,
            createdAt: d,
          },
        })
        await prisma.profile.update({ where: { userId: streakUser.id }, data: { reputation: { increment: 1 } } })
      }
      assert.equal(await getCheckinStreak(streakUser.id), 4, "4-day streak")
      // 3-day milestone pays (+10); 7-day doesn't yet.
      const paid = await evaluateStreaks(streakUser.id)
      assert.deepEqual(paid, [3], "only the 3-day milestone paid")
      const streakRow = await prisma.reputationEvent.findUnique({ where: { key: `streak:3:${streakUser.id}` } })
      assert.ok(streakRow && streakRow.amount === 10, "streak bonus row exists")
      // Idempotent — second evaluation pays nothing.
      assert.deepEqual(await evaluateStreaks(streakUser.id), [], "no double-pay")
      assert.equal(await repOf(streakUser.id), await ledgerSum(streakUser.id), "streak balance == ledger")
      // A missed day breaks the run: a user whose last check-in was 2 days
      // ago has no live streak.
      const gapUser = await prisma.user.create({
        data: { name: `${TEST_USERNAME}_gap`, ageVerified: true, sessionVersion: 1, profile: { create: { username: `${TEST_USERNAME}_gap` } } },
        select: { id: true },
      })
      try {
        const d = new Date(today.getTime() - 2 * dayMs)
        await prisma.reputationEvent.create({
          data: {
            userId: gapUser.id, type: "DAILY_LOGIN", amount: 1,
            reason: "Daily check-in", key: `daily:${gapUser.id}:${d.toISOString().slice(0, 10)}`,
            createdAt: d,
          },
        })
        assert.equal(await getCheckinStreak(gapUser.id), 0, "missed yesterday ends the streak")
      } finally {
        await prisma.user.delete({ where: { id: gapUser.id } }).catch(() => {})
      }
    } finally {
      await prisma.user.delete({ where: { id: streakUser.id } }).catch(() => {})
    }

    // Markers never move the balance.
    assert.equal(await repOf(uid), await ledgerSum(uid), "markers keep balance == ledger")

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
