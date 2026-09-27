// Reputation & progression regression tests — consolidated suite covering:
//   • pure config math: tier ladder, stage rungs, crossedRungs, cosmetics,
//     economy caps, daily-quest determinism, trust standings, badge registry
//   • DB ledger behaviour: keyed awards, duplicates, self/bot/suspended
//     skips, reversals/reinstatement, caps, milestone markers, streaks
//   • DB progression: keyed QUEST_DAILY payouts, trust-score filtering,
//     quest progress/evaluation, payout-reconciliation clawback sweeps
//   • DB velocity detector: member-driven-only abuse detection (T1–T13)
//   • global drift check: Profile.reputation == SUM(ReputationEvent.amount)
//     across ALL profiles (absorbed from check-drift.mts)
// Disposable __test_rep_ / __test_prog_ / __test_vel_ fixtures are all
// cascade-deleted before exit. (Absorbs progression-tests.mts,
// velocity-detector-tests.mts and check-drift.mts.)
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
  BADGE_BONUS,
  TRUST_EVENT_TYPES,
  TRUST_STANDINGS,
  getReputationTier,
  getNextTier,
  getTierProgress,
  getRepStage,
  getRepLevel,
  getStageProgress,
  getTrustStanding,
  getNextTrustStanding,
  publicRepLabel,
  crossedRungs,
} from "@/lib/reputation-config"
import { AVATAR_FRAMES, PROFILE_TITLES, PROFILE_THEMES, canEquip, unlockedCosmetics, nextLockedCosmetic, cosmeticsUnlockedBetween } from "@/lib/cosmetics"
import { WEEKLY_CHALLENGES, reconcileChallengePayouts, currentWeekKey } from "@/lib/challenges"
import {
  applyReputationAward,
  awardReputation,
  reverseReputationEvent,
  reverseReputationByKey,
  reverseReputationBySource,
  findReputationDrift,
  getTrustScore,
  BADGE_RULES,
} from "@/lib/reputation"
import { BADGE_REGISTRY, BOT_BADGE_REGISTRY, isBotBadge, getBadgeByName, STAFF_AWARDED_BADGES } from "@/lib/badge-registry"
import { getCheckinStreak, evaluateStreaks } from "@/lib/streaks"
import { DAILY_QUESTS, DAILY_QUEST_COUNT, PERFECT_DAY_BONUS, dailyQuestsFor, currentDayKey, getQuestProgress, evaluateQuests, reconcileQuestPayouts } from "@/lib/quests"
import {
  detectReputationSignals,
  materializeReputationFlags,
  isMemberDrivenReputationEvent,
  MEMBER_DRIVEN_REP_TYPES,
} from "@/lib/trust-signals"
import { TERPBOT_USERNAME } from "@/lib/terpbot-constants"

const RUN_TAG = Date.now().toString(36)
const TEST_USERNAME = `__test_rep_${RUN_TAG}`
const PROG_USERNAME = `__test_prog_${RUN_TAG}`
const VEL_PREFIX = `__test_vel_${RUN_TAG}`

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

// ── Shared fixture helpers ─────────────────────────────────────────
// One helper set for every DB section; callers pass a fully-prefixed
// username so fixtures stay distinguishable per section (__test_rep_,
// __test_prog_, __test_vel_) and never cross-contaminate.
async function mkTestUser(username: string) {
  return prisma.user.create({
    data: {
      name: username,
      ageVerified: true,
      sessionVersion: 1,
      profile: { create: { username } },
    },
    select: { id: true },
  })
}

// Ledger row + profile credit in one tx — mirrors applyReputationAward's
// invariant so a fixture never produces ledger-vs-balance drift.
async function mkEvent(userId: string, over: Record<string, unknown>) {
  const amount = (over.amount as number | undefined) ?? 5
  return prisma.$transaction(async (tx) => {
    const ev = await tx.reputationEvent.create({
      data: { userId, type: "POST_CREATED", amount, reason: "test fixture", ...over } as never,
    })
    await tx.profile.update({ where: { userId }, data: { reputation: { increment: amount } } })
    return ev
  })
}

// Bare ledger-row fixture for the velocity detector — the detector reads
// ReputationEvent rows only, so no Profile.reputation write is needed.
// These rows (and their users) are deleted before the global drift check.
async function mkLedgerEvent(
  userId: string,
  type: string,
  amount: number,
  opts: { actorId?: string; reversedAt?: Date; key?: string } = {},
) {
  return prisma.reputationEvent.create({
    data: {
      userId, type, amount,
      reason: `__test_vel_${type}`,
      key: opts.key ?? `__test_vel:${type}:${userId}:${RUN_TAG}:${Math.random().toString(36).slice(2)}`,
      actorId: opts.actorId ?? null,
      reversedAt: opts.reversedAt ?? null,
    },
  })
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

  // ── Pure: daily quest selection ──────────────────────────────────
  // Deterministic: same user + day → same selection, every call.
  const u1a = dailyQuestsFor("user-1", "2026-04-20")
  const u1b = dailyQuestsFor("user-1", "2026-04-20")
  assert.deepEqual(u1a.map((q) => q.slug), u1b.map((q) => q.slug))
  assert.equal(u1a.length, DAILY_QUEST_COUNT)

  // Different users typically see different mixes — and every pick is a
  // real quest. (Not asserting full coverage across all users — the hash
  // only needs to vary, not be uniform.)
  const u2 = dailyQuestsFor("user-2", "2026-04-20")
  assert.equal(u2.length, DAILY_QUEST_COUNT)
  for (const q of [...u1a, ...u2]) {
    assert.ok(DAILY_QUESTS.some((d) => d.slug === q.slug), `unknown quest ${q.slug}`)
  }
  // Different day → different hash order (selection MAY coincide, but at
  // least across a few days the set should change for most users).
  const allSame = ["user-1", "user-2", "user-3", "user-4", "user-5"].every((u) => {
    const a = dailyQuestsFor(u, "2026-04-20").map((q) => q.slug).join(",")
    const b = dailyQuestsFor(u, "2026-04-21").map((q) => q.slug).join(",")
    return a === b
  })
  assert.equal(allSame, false, "quest selection never rotates")

  // Every quest definition is sane: positive reward, achievable target,
  // unique slugs, no raw-volume quests ("post N replies" is banned by design).
  const questSlugs = new Set(DAILY_QUESTS.map((q) => q.slug))
  assert.equal(questSlugs.size, DAILY_QUESTS.length, "duplicate quest slugs")
  for (const q of DAILY_QUESTS) {
    assert.ok(q.reward > 0 && q.reward <= 15, `quest ${q.slug} reward out of band`)
    assert.ok(q.target >= 1 && q.target <= 3, `quest ${q.slug} target too grindy`)
    assert.ok(!/posts?$/i.test(q.description), `quest ${q.slug} looks like volume farming`)
  }
  // Daily income ceiling stays far under the velocity flag.
  const maxDaily = DAILY_QUEST_COUNT * Math.max(...DAILY_QUESTS.map((q) => q.reward)) + PERFECT_DAY_BONUS
  assert.ok(maxDaily <= 50, `daily quest ceiling ${maxDaily} too high`)

  // ── Pure: trust standing ─────────────────────────────────────────
  assert.equal(getTrustStanding(0).name, "Unrooted")
  assert.equal(getTrustStanding(24).name, "Unrooted")
  assert.equal(getTrustStanding(25).name, "Known")
  assert.equal(getTrustStanding(100).name, "Trusted")
  assert.equal(getTrustStanding(300).name, "Respected")
  assert.equal(getTrustStanding(800).name, "Pillar")
  assert.equal(getTrustStanding(2000).name, "Legend")
  assert.equal(getTrustStanding(99999).name, "Legend")
  assert.equal(getNextTrustStanding(0)?.name, "Known")
  assert.equal(getNextTrustStanding(2000), null)

  // Standings strictly ascend.
  for (let i = 1; i < TRUST_STANDINGS.length; i++) {
    assert.ok(TRUST_STANDINGS[i].min > TRUST_STANDINGS[i - 1].min)
  }

  // Trust events are exactly the peer-validated types — no self-driven
  // source (posts, diaries, quests, check-ins) may appear.
  for (const selfDriven of ["THREAD_CREATED", "POST_CREATED", "DIARY_CREATED", "DIARY_UPDATE", "SETUP_CREATED", "STRAIN_CREATED", "QUEST_DAILY", "CHALLENGE_WEEKLY", "DAILY_LOGIN", "ONBOARDING_COMPLETE", "HARVEST_LOGGED"]) {
    assert.ok(!TRUST_EVENT_TYPES.has(selfDriven), `${selfDriven} must not count toward standing`)
  }
  for (const t of TRUST_EVENT_TYPES) {
    assert.notEqual(publicRepLabel(t), "Reputation change", `${t} needs a public label`)
  }

  // ── Pure: badge registry ↔ rules consistency ─────────────────────
  const registryNames = new Set(BADGE_REGISTRY.map((b) => b.name))
  for (const ruleName of Object.keys(BADGE_RULES)) {
    assert.ok(registryNames.has(ruleName), `rule "${ruleName}" has a registry entry`)
    assert.ok(!isBotBadge(ruleName), `rule "${ruleName}" is not a bot badge`)
  }
  const seenBadgeNames = new Set<string>()
  for (const b of BADGE_REGISTRY) {
    assert.ok(!seenBadgeNames.has(b.name), `duplicate badge ${b.name}`)
    seenBadgeNames.add(b.name)
    assert.ok(
      BADGE_RULES[b.name] || NON_RULE_BADGES.has(b.name),
      `badge "${b.name}" has an earning path (rule or documented external grant)`
    )
    assert.ok(b.description && b.requirement && b.icon, `badge "${b.name}" fully described`)
    assert.ok(BADGE_BONUS[b.rarity] != null, `badge ${b.name} has unknown rarity ${b.rarity}`)
    // Progress-bars only on badges with a rule or a deliberately hidden path.
    if (b.progress) assert.ok(BADGE_RULES[b.name] || b.hidden, `progress badge ${b.name} has no rule`)
    // getBadgeByName resolves every registry entry.
    assert.equal(getBadgeByName(b.name)?.name, b.name)
  }
  // Hidden badges exist and stay secret-shaped.
  const hidden = BADGE_REGISTRY.filter((b) => b.hidden)
  assert.ok(hidden.length >= 3, "expected a small set of hidden discovery badges")
  for (const b of hidden) {
    assert.equal(b.requirement, "???", `hidden badge ${b.name} leaks its requirement`)
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

    // TerpBot can never earn rep. The lib gates on
    // `profile.username === TERPBOT_USERNAME`, so the fixture is
    // deterministic: use the real bot account when it exists in this
    // database, otherwise stand up a throwaway user carrying that
    // username (deleted in the finally). The assertion always runs.
    const existingBot = await prisma.profile.findUnique({
      where: { username: TERPBOT_USERNAME },
      select: { userId: true },
    })
    let botUserId = existingBot?.userId
    let createdBot = false
    if (!botUserId) {
      const botFixture = await prisma.user.create({
        data: {
          name: `${TEST_USERNAME}_bot`,
          ageVerified: true,
          sessionVersion: 1,
          // Username must literally be the bot name — that's the signal
          // applyReputationAward checks before writing any ledger row.
          profile: { create: { username: TERPBOT_USERNAME } },
        },
        select: { id: true },
      })
      botUserId = botFixture.id
      createdBot = true
    }
    try {
      const r = await applyReputationAward(botUserId!, "POST_CREATED", 2, "bot award", { key: "test:bot:1" })
      assert.equal(r.awarded, false)
      assert.equal(r.skippedReason, "bot")
      const botEvents = await prisma.reputationEvent.count({ where: { key: "test:bot:1" } })
      assert.equal(botEvents, 0, "no ledger row written for bot")
    } finally {
      if (createdBot) await prisma.user.delete({ where: { id: botUserId! } }).catch(() => {})
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

    // ── DB: reversal-cycle ledger — no double-deduction ────────────
    // award(+10 keyed, source POST:x) → unlike (reverse) → re-like
    // (reinstate) → source deleted (reverse by source). Final balance
    // must equal SUM(ledger) and reflect exactly one deduction.
    const cycUser = await prisma.user.create({
      data: { name: `${TEST_USERNAME}_cyc`, ageVerified: true, sessionVersion: 1, profile: { create: { username: `${TEST_USERNAME}_cyc` } } },
      select: { id: true },
    })
    const cycActor = await prisma.user.create({
      data: { name: `${TEST_USERNAME}_cyca`, ageVerified: true, sessionVersion: 1, profile: { create: { username: `${TEST_USERNAME}_cyca` } } },
      select: { id: true },
    })
    const cycStaff = await prisma.user.create({
      data: { name: `${TEST_USERNAME}_cym`, ageVerified: true, sessionVersion: 1, role: "MODERATOR", profile: { create: { username: `${TEST_USERNAME}_cym` } } },
      select: { id: true },
    })
    try {
      const srcId = `post_test_${TEST_USERNAME}`
      const key = `like:${cycActor.id}:post:${srcId}`
      const a1 = await applyReputationAward(cycUser.id, "LIKE_RECEIVED", 10, "t", {
        key, actorId: cycActor.id, sourceType: "POST", sourceId: srcId,
      })
      assert.equal(a1.awarded, true)
      assert.equal(await repOf(cycUser.id), 10)

      const ev = await prisma.reputationEvent.findUnique({ where: { key }, select: { id: true } })
      assert.ok(ev)
      const r1 = await reverseReputationEvent(ev!.id, "unlike", cycActor.id)
      assert.equal(r1.reversed, true)
      assert.equal(await repOf(cycUser.id), 0)

      // Re-like reinstates the original (restore == -sum(counter-entries)).
      const a2 = await applyReputationAward(cycUser.id, "LIKE_RECEIVED", 10, "t", {
        key, actorId: cycActor.id, sourceType: "POST", sourceId: srcId,
      })
      assert.equal(a2.awarded, true)
      assert.equal(a2.reinstated, true)
      assert.equal(await repOf(cycUser.id), 10)

      // Post deleted — must deduct exactly once even though a REINSTATE row
      // shares the sourceType/sourceId.
      const n = await reverseReputationBySource("POST", srcId, "content removed")
      assert.equal(n, 1, "only the root award may be reversed")
      assert.equal(await repOf(cycUser.id), 0)
      assert.equal(await ledgerSum(cycUser.id), 0, "balance must equal SUM(ledger)")

      // Final staff reversal blocks organic re-trigger.
      const srcId2 = `post_test2_${TEST_USERNAME}`
      const key2 = `like:${cycActor.id}:post:${srcId2}`
      await applyReputationAward(cycUser.id, "LIKE_RECEIVED", 10, "t", {
        key: key2, actorId: cycActor.id, sourceType: "POST", sourceId: srcId2,
      })
      const ev2 = await prisma.reputationEvent.findUnique({ where: { key: key2 }, select: { id: true } })
      await reverseReputationEvent(ev2!.id, "staff reversal", cycStaff.id, { final: true })
      assert.equal(await repOf(cycUser.id), 0)
      const a3 = await applyReputationAward(cycUser.id, "LIKE_RECEIVED", 10, "t", {
        key: key2, actorId: cycActor.id, sourceType: "POST", sourceId: srcId2,
      })
      assert.equal(a3.awarded, false)
      assert.equal(a3.skippedReason, "locked", "final reversal must refuse reinstatement")
      assert.equal(await repOf(cycUser.id), 0)
    } finally {
      for (const u of [cycUser, cycActor, cycStaff]) {
        await prisma.user.delete({ where: { id: u.id } }).catch(() => {})
      }
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

  // ── DB: keyed quest payouts + trust filtering ────────────────────
  const progUser = await mkTestUser(PROG_USERNAME)
  try {
    const dayKey = currentDayKey()

    // Keyed quest payout: award once, second call is a no-op. (Other
    // awards may fire as side-effects — e.g. the Early Supporter badge
    // bonus — so we assert on the specific event, not the total.)
    const key = `quest:${dayKey}:lend-a-hand:${progUser.id}`
    const a1 = await awardReputation(progUser.id, "QUEST_DAILY", 8, "Daily quest: Lend a Hand", { key })
    const a2 = await awardReputation(progUser.id, "QUEST_DAILY", 8, "Daily quest: Lend a Hand", { key })
    assert.equal(a1.awarded, true)
    assert.equal(a2.awarded, false)
    const questEvents = await prisma.reputationEvent.count({ where: { userId: progUser.id, key } })
    assert.equal(questEvents, 1, "duplicate keyed quest payout")

    // Self-driven events advance progression but NOT trust standing.
    assert.equal(await getTrustScore(progUser.id), 0)

    // Peer-validated events DO count.
    await awardReputation(progUser.id, "LIKE_RECEIVED", 2, "test like", {
      key: `test:like:${progUser.id}`,
      actorId: "someone-else",
    })
    assert.equal(await getTrustScore(progUser.id), 2)
    assert.equal(getTrustStanding(2).name, "Unrooted")

    // Quest progress is server-derived — a fresh user has zero progress and
    // nothing paid. evaluateQuests on zero progress pays nothing.
    const progress = await getQuestProgress(progUser.id)
    assert.equal(progress.length, DAILY_QUEST_COUNT)
    for (const q of progress) {
      // green-thumb legitimately ticks from the LIKE_RECEIVED awarded above —
      // every other quest's inputs are still untouched.
      assert.equal(q.progress, q.slug === "green-thumb" ? 1 : 0)
      assert.equal(q.done, false)
      // lend-a-hand may or may not be selected; paid only when selected+paid.
      if (q.slug === "lend-a-hand") assert.equal(q.paid, true)
    }
    const paid = await evaluateQuests(progUser.id)
    assert.deepEqual(paid, [], "no quests should pay with zero qualifying activity")

    // PUBLIC_REP_TYPES covers quest payouts so they show on the public
    // history with a safe label (not the raw reason string).
    assert.ok(PUBLIC_REP_TYPES.has("QUEST_DAILY"))
    assert.equal(publicRepLabel("QUEST_DAILY"), "Daily quest completed")

    // ── Sticky payout reconciliation ──────────────────────────────
    // Payouts whose qualifying content disappears must be clawed back by
    // the sweep; payouts still backed by real activity must survive.
    {
      const stickyUser = await mkTestUser(`${PROG_USERNAME}_sticky`)
      const earnedUser = await mkTestUser(`${PROG_USERNAME}_earned`)
      const chalUser = await mkTestUser(`${PROG_USERNAME}_chal`)
      let stickyDiaryId = ""
      try {
        const dayKey = new Date().toISOString().slice(0, 10)
        const ev = await mkEvent(stickyUser.id, {
          type: "QUEST_DAILY", key: `quest:${dayKey}:tend-the-garden:${stickyUser.id}`, amount: 15,
        })
        const res = await reconcileQuestPayouts()
        const after = await prisma.reputationEvent.findUnique({ where: { id: ev.id }, select: { reversedAt: true } })
        assert.ok(after?.reversedAt, `unearned quest payout must be reversed (checked=${res.checked} reversed=${res.reversed})`)

        // tend-the-garden counts live DIARY_UPDATE reputation events today.
        const dr = await prisma.growDiary.create({
          data: { title: `${PROG_USERNAME}_qd`, description: "", growType: "INDOOR", startDate: new Date(), authorId: earnedUser.id },
          select: { id: true },
        })
        stickyDiaryId = dr.id
        await mkEvent(earnedUser.id, { type: "DIARY_UPDATE", sourceType: "DIARY", sourceId: dr.id })
        const ev2 = await mkEvent(earnedUser.id, {
          type: "QUEST_DAILY", key: `quest:${dayKey}:tend-the-garden:${earnedUser.id}`, amount: 15,
        })
        await reconcileQuestPayouts()
        const after2 = await prisma.reputationEvent.findUnique({ where: { id: ev2.id }, select: { reversedAt: true } })
        assert.equal(after2?.reversedAt, null, "earned payout must not be reversed")

        const ev3 = await mkEvent(chalUser.id, {
          type: "CHALLENGE_WEEKLY", key: `challenge:${currentWeekKey()}:tend-the-diary:${chalUser.id}`, amount: 50,
        })
        await reconcileChallengePayouts()
        const after3 = await prisma.reputationEvent.findUnique({ where: { id: ev3.id }, select: { reversedAt: true } })
        assert.ok(after3?.reversedAt, "unearned challenge payout must be reversed")
      } finally {
        if (stickyDiaryId) {
          await prisma.diaryUpdate.deleteMany({ where: { diaryId: stickyDiaryId } }).catch(() => {})
          await prisma.growDiary.delete({ where: { id: stickyDiaryId } }).catch(() => {})
        }
        for (const u of [stickyUser, earnedUser, chalUser]) {
          await prisma.user.delete({ where: { id: u.id } }).catch(() => {})
        }
      }
    }
  } finally {
    await prisma.user.delete({ where: { id: progUser.id } }).catch(() => {})
  }

  // ── DB: velocity detector — member-driven events only ────────────
  // The abuse detector must count member-driven reputation only and ignore
  // system-generated payouts (BADGE_BONUS, WEEKLY_AWARD, MILESTONE,
  // ONBOARDING_COMPLETE, quests, journeys, staff/migration bookkeeping).
  // Fixtures are bare ledger rows — the detector reads events, not
  // balances — and are all deleted in the finally, before the drift check.
  {
    const velUsers: { id: string }[] = []
    const velEventIds: string[] = []
    const flagKeysBefore = new Set(
      (await prisma.abuseFlag.findMany({ select: { key: true } })).map((f) => f.key)
    )
    const flaggedIds = async () =>
      new Set((await detectReputationSignals(7)).velocity.map((v) => v.userId))
    const expectFlagged = async (id: string, msg: string) =>
      assert.ok((await flaggedIds()).has(id), msg)
    const expectClean = async (id: string, msg: string) =>
      assert.ok(!(await flaggedIds()).has(id), msg)

    try {
      // T1 — BADGE_BONUS alone must not flag
      {
        const u = await mkTestUser(`${VEL_PREFIX}_badge`); velUsers.push(u)
        velEventIds.push((await mkLedgerEvent(u.id, "BADGE_BONUS", 200)).id)
        await expectClean(u.id, "T1: +200 BADGE_BONUS in 24h → no velocity flag")
      }

      // T2 — WEEKLY_AWARD alone must not flag
      {
        const u = await mkTestUser(`${VEL_PREFIX}_weekly`); velUsers.push(u)
        velEventIds.push((await mkLedgerEvent(u.id, "WEEKLY_AWARD", 200)).id)
        await expectClean(u.id, "T2: +200 WEEKLY_AWARD in 24h → no velocity flag")
      }

      // T3 — MILESTONE / system rewards must not flag
      {
        const u = await mkTestUser(`${VEL_PREFIX}_sys`); velUsers.push(u)
        velEventIds.push((await mkLedgerEvent(u.id, "MILESTONE", 100)).id)
        velEventIds.push((await mkLedgerEvent(u.id, "GROW_MILESTONE", 60)).id)
        velEventIds.push((await mkLedgerEvent(u.id, "JOURNEY_COMPLETE", 40)).id)
        await expectClean(u.id, "T3: +200 MILESTONE/GROW_MILESTONE/JOURNEY_COMPLETE → no flag")
      }

      // T4 — ONBOARDING_COMPLETE must not flag
      {
        const u = await mkTestUser(`${VEL_PREFIX}_onb`); velUsers.push(u)
        velEventIds.push((await mkLedgerEvent(u.id, "ONBOARDING_COMPLETE", 200)).id)
        await expectClean(u.id, "T4: +200 ONBOARDING_COMPLETE → no flag")
      }

      // T5 — genuine member-driven velocity flags HIGH
      {
        const u = await mkTestUser(`${VEL_PREFIX}_grind`); velUsers.push(u)
        const actor = await mkTestUser(`${VEL_PREFIX}_actor`); velUsers.push(actor)
        for (let i = 0; i < 6; i++) {
          velEventIds.push((await mkLedgerEvent(u.id, "HELPFUL_ANSWER", 30, { actorId: actor.id })).id)
        }
        velEventIds.push((await mkLedgerEvent(u.id, "DAILY_LOGIN", 1)).id) // 181 member-driven
        await expectFlagged(u.id, "T5: +181 member-driven in 24h → flagged")
        const { created } = await materializeReputationFlags(7)
        const flag = await prisma.abuseFlag.findFirst({
          where: { userId: u.id, signal: "REP_VELOCITY", key: { notIn: [...flagKeysBefore] } },
        })
        assert.ok(flag && flag.priority === "HIGH", `T5b: materialized flag is HIGH (created=${created})`)
      }

      // T6 — exactly +150 does not flag (boundary preserved)
      {
        const u = await mkTestUser(`${VEL_PREFIX}_edge`); velUsers.push(u)
        for (let i = 0; i < 15; i++) {
          velEventIds.push((await mkLedgerEvent(u.id, "THREAD_CREATED", 10)).id)
        }
        await expectClean(u.id, "T6: exactly +150 member-driven → no flag (>150 required)")
      }

      // T7 — system + member-driven mix below threshold → no flag
      {
        const u = await mkTestUser(`${VEL_PREFIX}_mix`); velUsers.push(u)
        velEventIds.push((await mkLedgerEvent(u.id, "BADGE_BONUS", 250)).id)
        velEventIds.push((await mkLedgerEvent(u.id, "WEEKLY_AWARD", 50)).id)
        velEventIds.push((await mkLedgerEvent(u.id, "THREAD_CREATED", 10)).id)
        velEventIds.push((await mkLedgerEvent(u.id, "LIKE_RECEIVED", 2)).id)
        await expectClean(u.id, "T7: +300 system + +12 member-driven → no flag")
      }

      // T8 — reversed events don't contribute
      {
        const u = await mkTestUser(`${VEL_PREFIX}_rev`); velUsers.push(u)
        velEventIds.push((await mkLedgerEvent(u.id, "HELPFUL_ANSWER", 200, { reversedAt: new Date() })).id)
        await expectClean(u.id, "T8: +200 member-driven but reversed → no flag")
      }

      // T9 — legacy exclusions still excluded
      {
        const u = await mkTestUser(`${VEL_PREFIX}_excl`); velUsers.push(u)
        for (const t of ["STAFF_ADJUSTMENT", "REFERRAL", "CHALLENGE_WEEKLY", "LEGACY_MIGRATION", "REINSTATE", "CONTEST_WEEKLY_WIN", "CONTEST_MONTHLY_WIN"]) {
          velEventIds.push((await mkLedgerEvent(u.id, t, 50)).id) // 350 total excluded
        }
        await expectClean(u.id, "T9: +350 across legacy-excluded types → no flag")
      }

      // T10 — badge cascade burst doesn't flag
      {
        const u = await mkTestUser(`${VEL_PREFIX}_cascade`); velUsers.push(u)
        for (let i = 0; i < 10; i++) {
          velEventIds.push((await mkLedgerEvent(u.id, "BADGE_BONUS", 40)).id) // 400 burst
        }
        await expectClean(u.id, "T10: 10× BADGE_BONUS cascade (+400) → no flag")
      }

      // T11 — cron self-award (WEEKLY_AWARD + BADGE_BONUS same run) doesn't flag
      {
        const u = await mkTestUser(`${VEL_PREFIX}_gotw`); velUsers.push(u)
        velEventIds.push((await mkLedgerEvent(u.id, "BADGE_BONUS", 100, { key: `badgebonus:Grower of the Week:${u.id}` })).id)
        velEventIds.push((await mkLedgerEvent(u.id, "WEEKLY_AWARD", 50, { key: `weekly:gotw:2099-W01:${u.id}` })).id)
        const { created } = await materializeReputationFlags(7)
        const flag = await prisma.abuseFlag.findFirst({
          where: { userId: u.id, key: { notIn: [...flagKeysBefore] } },
        })
        assert.ok(!flag, `T11: GOTW award + detection same run → no self-generated flag (created=${created})`)
      }

      // T13 — sanity: the allowlist classifies every known event type
      {
        const memberTypes = ["THREAD_CREATED", "POST_CREATED", "DIARY_CREATED", "DIARY_UPDATE", "STRAIN_CREATED", "STRAIN_PHOTO", "SETUP_CREATED", "LIKE_RECEIVED", "HELPFUL_ANSWER", "ACCEPT_MARKED", "HARVEST_LOGGED", "DAILY_LOGIN"]
        const systemTypes = ["BADGE_BONUS", "WEEKLY_AWARD", "MILESTONE", "ONBOARDING_COMPLETE", "QUEST_DAILY", "GROW_MILESTONE", "JOURNEY_COMPLETE", "CHALLENGE_WEEKLY", "STAFF_ADJUSTMENT", "REFERRAL", "LEGACY_MIGRATION", "REINSTATE", "CONTEST_WEEKLY_WIN", "CONTEST_MONTHLY_WIN", "REVERSAL", "BOT_MESSAGE"]
        const badMember = memberTypes.filter((t) => !isMemberDrivenReputationEvent(t))
        const badSystem = systemTypes.filter((t) => isMemberDrivenReputationEvent(t))
        assert.deepEqual([...MEMBER_DRIVEN_REP_TYPES].sort(), [...memberTypes].sort())
        assert.deepEqual(badMember, [], "T13: every member-driven type classified")
        assert.deepEqual(badSystem, [], "T13: every system type excluded")
      }
    } finally {
      // Cleanup — flags are bare-keyed (no cascade), events cascade with users
      await prisma.abuseFlag.deleteMany({ where: { key: { notIn: [...flagKeysBefore] } } }).catch(() => {})
      await prisma.reputationEvent.deleteMany({ where: { id: { in: velEventIds } } }).catch(() => {})
      await prisma.user.deleteMany({ where: { id: { in: velUsers.map((u) => u.id) } } }).catch(() => {})
    }
  }

  // ── DB: global ledger drift check ────────────────────────────────
  // Profile.reputation == SUM(ReputationEvent.amount) for EVERY profile,
  // not just test fixtures — all fixtures above are deleted by now.
  const drift = await findReputationDrift()
  for (const d of drift) {
    console.error(`  drift ${d.userId}: balance=${d.reputation} ledger=${d.ledger} (${d.reputation - d.ledger > 0 ? "+" : ""}${d.reputation - d.ledger})`)
  }
  assert.equal(drift.length, 0, `${drift.length} profile(s) out of sync — deltas above`)
  console.log("No drift — every profile balance matches its ledger.")

  await prisma.$disconnect()
  console.log("All Reputation & progression tests passed.")
}

run().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect().catch(() => {})
  process.exit(1)
})
