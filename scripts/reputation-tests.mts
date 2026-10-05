// Reputation & progression regression tests — consolidated suite covering:
//   • pure config math: tier ladder, stage rungs, crossedRungs, deal gating,
//     economy caps, daily-quest determinism, trust standings, badge registry
//   • DB ledger behaviour: keyed awards, duplicates, self/bot/suspended
//     skips, reversals/reinstatement, caps, milestone markers, streaks
//   • DB progression: keyed QUEST_DAILY payouts, trust-score filtering,
//     quest progress/evaluation, payout-reconciliation clawback sweeps
//   • DB velocity detector: member-driven-only abuse detection (T1–T13)
//   • Progression V2 engine: rank/mastery thresholds, quality bands,
//     simhash duplicate tiers, keyed idempotency, reinstate/final-lock
//     reversals, mastery soft caps, standing controls (grantor age/floor,
//     reciprocal, per-grantor lifetime, cluster flag, weekly cap),
//     unlock layers A/B/C, diversity-floor banking, outbox drain, drift
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
import { canSeeDeal } from "@/lib/deals-access"
import { getGrowerSpotlight } from "@/lib/spotlight"
import {
  nextRankUnlock,
  UNLOCK_BY_ID,
  STANDING_POLL_VOTE,
  STANDING_POLL_CREATE,
  STANDING_SLOWMODE_EXEMPT,
  pollCreationAllowed,
} from "@/lib/progression-config"
import { WEEKLY_CHALLENGES, reconcileChallengePayouts, currentWeekKey } from "@/lib/challenges"
import {
  applyReputationAward,
  awardReputation,
  reverseReputationEvent,
  reverseReputationByKey,
  reverseReputationBySource,
  findReputationDrift,
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
import {
  awardProgression,
  reverseProgressionByKey,
  reverseProgressionEvent,
  checkDuplicateContent,
  updateBand,
  getMasteryMap,
  effectiveRank,
  hasUnlock,
  meetsUnlockSpec,
  profileSectionLimit,
  statSlotLimit,
  savedSearchLimit,
  progressionPerksFrom,
  masteryLevelFromXp,
  rankFromXp,
  REP_RANKS,
  DIVERSITY_FLOORS,
  MASTERY_LEVELS,
  XP_TABLE,
  UNLOCKS,
  STANDING_WEEKLY_CAP,
  QUALITY_BANDS,
} from "@/lib/progression"
import {
  MASTER_EXTRA_FLOOR,
  STANDING_PER_GRANTOR_LIFETIME,
  DUP_WITHHOLD_PCT,
  DUP_REDUCE_PCT,
  MASTERY_WEEKLY_FULL,
  MASTERY_WEEKLY_MID,
  PUBLIC_XP_TYPES,
  publicXpLabel,
} from "@/lib/progression-config"
import { drainPendingXpReversals, reverseXpSourceDurable } from "@/lib/progression-outbox"

const RUN_TAG = Date.now().toString(36)
const TEST_USERNAME = `__test_rep_${RUN_TAG}`
const PROG_USERNAME = `__test_prog_${RUN_TAG}`
const VEL_PREFIX = `__test_vel_${RUN_TAG}`
const PV2_PREFIX = `__test_pv2_${RUN_TAG}`

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

// V2 equivalent of mkEvent — ProgressionEvent row + profile.xp credit in
// one tx so fixtures never produce xp-vs-ledger drift.
async function mkXpEvent(userId: string, over: Record<string, unknown>) {
  const xp = (over.xp as number | undefined) ?? 5
  return prisma.$transaction(async (tx) => {
    const ev = await tx.progressionEvent.create({
      data: { userId, type: "POST_CREATED", xp, reason: "test fixture", ...over } as never,
    })
    await tx.profile.update({ where: { userId }, data: { xp: { increment: xp } } })
    return ev
  })
}

// Bare ProgressionEvent fixture for the velocity detector — it reads
// member-driven XP rows only; no profile write needed. These rows (and
// their users) are deleted before the global drift check.
async function mkXpLedgerEvent(
  userId: string,
  type: string,
  xp: number,
  opts: { actorId?: string; reversedAt?: Date; key?: string } = {},
) {
  return prisma.progressionEvent.create({
    data: {
      userId, type, xp,
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

  // ── Pure: next-rank unlock helper ───────────────────────────────
  // Powers every "next unlock" surface — first rank-gated UNLOCK above xp.
  const nu0 = nextRankUnlock(0)
  assert.ok(nu0, "a next unlock exists at 0 XP")
  // Progression 2.1: the first *live* rank-gated unlock is now the extra
  // profile section at Germinated — early ranks grant real capacity, not
  // roadmap promises.
  const germRank = REP_RANKS.find((r) => r.name === "Germinated")!
  assert.equal(nu0!.xpNeeded, germRank.threshold, "first live unlock lands at Germinated")
  assert.equal(nu0!.id, "profile-sections-3", "first live unlock is the 3rd profile section")
  assert.equal(nextRankUnlock(23000), null, "nothing locked past max XP")
  const nu100 = nextRankUnlock(100)
  assert.ok(nu100 && nu100.xpNeeded > 100, "next unlock always above current xp")

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

  // ── Pure: Garden Perks — members-only deal gating ───────────────
  // canSeeDeal(product, viewer, now): minRank gates on viewer XP,
  // publicAt hides unreleased deals except for early-access members,
  // and unlockFrozen suspends every progression-gated deal (public
  // deals stay open — the kill-switch only pulls the perks).
  const rankAt = (name: string) => REP_RANKS.find((r) => r.name === name)!.threshold
  const rooted = rankAt("Rooted")
  const future = new Date(Date.now() + 86400000)
  assert.equal(canSeeDeal({ minRank: "Rooted", publicAt: null }, null), false, "guest vs minRank")
  assert.equal(canSeeDeal({ minRank: "Rooted", publicAt: null }, { xp: rooted - 1, earlyAccess: false, unlockFrozen: false }), false, "xp below threshold")
  assert.equal(canSeeDeal({ minRank: "Rooted", publicAt: null }, { xp: rooted, earlyAccess: false, unlockFrozen: false }), true, "xp exactly at threshold")
  assert.equal(canSeeDeal({ minRank: "Rooted", publicAt: null }, { xp: rooted, earlyAccess: false, unlockFrozen: true }), false, "unlockFrozen denies rank-gated deals (M-03)")
  assert.equal(canSeeDeal({ minRank: null, publicAt: null }, { xp: rooted, earlyAccess: true, unlockFrozen: true }), true, "frozen member keeps fully public deals")
  assert.equal(canSeeDeal({ minRank: null, publicAt: future }, { xp: 50000, earlyAccess: false, unlockFrozen: false }), false, "future publicAt hidden without early access")
  assert.equal(canSeeDeal({ minRank: null, publicAt: future }, { xp: 0, earlyAccess: true, unlockFrozen: false }), true, "future publicAt visible with early access")
  assert.equal(canSeeDeal({ minRank: null, publicAt: null }, null), true, "null/null visible to all including guests")
  assert.equal(canSeeDeal({ minRank: null, publicAt: new Date(Date.now() - 1000) }, null), true, "past publicAt visible to all")

  // ── DB: Garden Perks — spotlight + streak-gated unlocks ─────────
  // hasUnlock's streak alternate: a streak:100:<uid> marker row grants
  // grower-spotlight even below Cured rank. The fixture diaries are dated
  // inside a future freshness window, so getGrowerSpotlight(futureNow)
  // sees ONLY the fixtures — the pick is deterministic without mirroring
  // the query.
  const futureNow = new Date(Date.now() + 30 * 86400000)
  const mkSpUser = async (suffix: string) =>
    prisma.user.create({
      data: {
        name: `${PV2_PREFIX}${suffix}`,
        profile: { create: { username: `${PV2_PREFIX}${suffix}`, standing: 0 } },
      },
    })
  const spLow = await mkSpUser("splow")
  const spElig = await mkSpUser("spelig")
  const mkSpDiary = (authorId: string, suffix: string) =>
    prisma.growDiary.create({
      data: {
        authorId,
        title: `${PV2_PREFIX} ${suffix} grow`,
        description: "fixture",
        growType: "INDOOR",
        startDate: new Date(),
        visibility: "PUBLIC",
        updatedAt: futureNow,
      },
    })
  const lowDiary = await mkSpDiary(spLow.id, "splow")
  const eligDiary = await mkSpDiary(spElig.id, "spelig")

  // Below both gates → excluded: the only diaries in the window belong to
  // ineligible fixtures, so the pick must be empty.
  const before = await getGrowerSpotlight(futureNow)
  assert.equal(before, null, "no eligible member → no spotlight")

  // streak:100 marker (0 XP — keeps xp == SUM(ledger)) → unlock granted.
  await prisma.progressionEvent.create({
    data: {
      userId: spElig.id,
      type: "STREAK_MILESTONE",
      key: `streak:100:${spElig.id}`,
      xp: 0,
      standing: 0,
      reason: "test marker",
    },
  })
  assert.equal(await hasUnlock(spElig.id, "grower-spotlight"), true, "streak:100 marker grants grower-spotlight")
  assert.equal(await hasUnlock(spLow.id, "grower-spotlight"), false, "no marker stays locked")

  // Now the eligible fixture is the only valid candidate in the window.
  const spot = await getGrowerSpotlight(futureNow)
  assert.equal(spot?.author.id, spElig.id, "streak-gated member wins the spotlight")
  assert.equal(spot?.diary.id, eligDiary.id)
  // Deterministic: same week key → same pick.
  const spotAgain = await getGrowerSpotlight(futureNow)
  assert.equal(spotAgain?.diary.id, spot!.diary.id, "spotlight pick is deterministic within the week")
  assert.equal(spotAgain?.weekKey, spot!.weekKey)

  await prisma.progressionEvent.deleteMany({ where: { userId: { in: [spLow.id, spElig.id] } } })
  await prisma.growDiary.deleteMany({ where: { id: { in: [lowDiary.id, eligDiary.id] } } })
  await prisma.profile.deleteMany({ where: { userId: { in: [spLow.id, spElig.id] } } })
  await prisma.user.deleteMany({ where: { id: { in: [spLow.id, spElig.id] } } })

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
    // Streak derives from DAILY_LOGIN marker days; milestones are once-ever
    // 0-XP marker rows (utility anchors, not currency).
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
        await prisma.progressionEvent.create({
          data: {
            userId: streakUser.id, type: "DAILY_LOGIN", xp: 0,
            reason: "Daily check-in", key: `daily:${streakUser.id}:${d.toISOString().slice(0, 10)}`,
            createdAt: d,
          },
        })
      }
      assert.equal(await getCheckinStreak(streakUser.id), 4, "4-day streak")
      // 3-day milestone records a marker; 7-day doesn't yet.
      const paid = await evaluateStreaks(streakUser.id)
      assert.deepEqual(paid, [3], "only the 3-day milestone recorded")
      const streakRow = await prisma.progressionEvent.findUnique({ where: { key: `streak:3:${streakUser.id}` } })
      assert.ok(streakRow && streakRow.xp === 0 && streakRow.type === "STREAK_MILESTONE", "streak marker row exists")
      // Idempotent — second evaluation records nothing.
      assert.deepEqual(await evaluateStreaks(streakUser.id), [], "no double-record")
      const streakProf = await prisma.profile.findUnique({ where: { userId: streakUser.id }, select: { xp: true } })
      assert.equal(streakProf?.xp ?? -1, 0, "streak markers pay no XP")
      // A missed day breaks the run: a user whose last check-in was 2 days
      // ago has no live streak.
      const gapUser = await prisma.user.create({
        data: { name: `${TEST_USERNAME}_gap`, ageVerified: true, sessionVersion: 1, profile: { create: { username: `${TEST_USERNAME}_gap` } } },
        select: { id: true },
      })
      try {
        const d = new Date(today.getTime() - 2 * dayMs)
        await prisma.progressionEvent.create({
          data: {
            userId: gapUser.id, type: "DAILY_LOGIN", xp: 0,
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

    // Keyed quest payout: award once via the V2 engine, second call is a
    // no-op. Assert on the specific keyed event, not the total.
    const key = `quest:${dayKey}:lend-a-hand:${progUser.id}`
    const a1 = await awardProgression(progUser.id, "QUEST_DAILY", "Daily quest: Lend a Hand", { key, xp: 8, mastery: "COMMUNITY" })
    const a2 = await awardProgression(progUser.id, "QUEST_DAILY", "Daily quest: Lend a Hand", { key, xp: 8, mastery: "COMMUNITY" })
    assert.equal(a1.awarded, true)
    assert.equal(a2.awarded, false)
    const questEvents = await prisma.progressionEvent.count({ where: { userId: progUser.id, key } })
    assert.equal(questEvents, 1, "duplicate keyed quest payout")

    // Self-driven events advance XP but NOT standing.
    const standingOf = async (uid: string) =>
      (await prisma.profile.findUnique({ where: { userId: uid }, select: { standing: true } }))?.standing ?? -1
    assert.equal(await standingOf(progUser.id), 0)

    // Peer-validated events DO count — a standing-bearing award from a
    // different actor lands on the standing axis.
    await awardProgression(progUser.id, "ACCEPTED_ANSWER", "test accept", {
      key: `test:accept:${progUser.id}`,
      actorId: "someone-else",
    })
    assert.equal(await standingOf(progUser.id), 10)

    // Quest progress is server-derived — a fresh user has zero progress and
    // nothing paid. evaluateQuests on zero progress pays nothing.
    const progress = await getQuestProgress(progUser.id)
    assert.equal(progress.length, DAILY_QUEST_COUNT)
    for (const q of progress) {
      assert.equal(q.progress, 0)
      assert.equal(q.done, false)
      // lend-a-hand may or may not be selected; paid only when selected+paid.
      if (q.slug === "lend-a-hand") assert.equal(q.paid, true)
    }
    const paid = await evaluateQuests(progUser.id)
    assert.deepEqual(paid, [], "no quests should pay with zero qualifying activity")

    // PUBLIC_XP_TYPES covers quest payouts so they show on the public
    // history with a safe label (not the raw reason string).
    assert.ok(PUBLIC_XP_TYPES.has("QUEST_DAILY"))
    assert.equal(publicXpLabel("QUEST_DAILY"), "Daily quest")

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
        const ev = await mkXpEvent(stickyUser.id, {
          type: "QUEST_DAILY", key: `quest:${dayKey}:tend-the-garden:${stickyUser.id}`, xp: 15,
        })
        const res = await reconcileQuestPayouts()
        const after = await prisma.progressionEvent.findUnique({ where: { id: ev.id }, select: { reversedAt: true } })
        assert.ok(after?.reversedAt, `unearned quest payout must be reversed (checked=${res.checked} reversed=${res.reversed})`)

        // tend-the-garden counts live DiaryUpdate rows today.
        const dr = await prisma.growDiary.create({
          data: { title: `${PROG_USERNAME}_qd`, description: "", growType: "INDOOR", startDate: new Date(), authorId: earnedUser.id },
          select: { id: true },
        })
        stickyDiaryId = dr.id
        await prisma.diaryUpdate.create({
          data: { title: "u", content: "x", stage: "VEGETATIVE", diaryId: dr.id, authorId: earnedUser.id },
        })
        const ev2 = await mkXpEvent(earnedUser.id, {
          type: "QUEST_DAILY", key: `quest:${dayKey}:tend-the-garden:${earnedUser.id}`, xp: 15,
        })
        await reconcileQuestPayouts()
        const after2 = await prisma.progressionEvent.findUnique({ where: { id: ev2.id }, select: { reversedAt: true } })
        assert.equal(after2?.reversedAt, null, "earned payout must not be reversed")

        const ev3 = await mkXpEvent(chalUser.id, {
          type: "CHALLENGE_WEEKLY", key: `challenge:${currentWeekKey()}:tend-the-diary:${chalUser.id}`, xp: 50,
        })
        await reconcileChallengePayouts()
        const after3 = await prisma.progressionEvent.findUnique({ where: { id: ev3.id }, select: { reversedAt: true } })
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

    // ── answer-the-call — first live reply in a question category ────
    // The recruitment quest measures the earliest live Post in a
    // QUESTION_RE category thread: first-answer payouts survive
    // reconciliation, later-reply and self-answer payouts reverse.
    {
      const acqUser = await mkTestUser(`${PROG_USERNAME}_acq`)
      const acqOp = await mkTestUser(`${PROG_USERNAME}_acqop`)
      const acqLate = await mkTestUser(`${PROG_USERNAME}_acqlate`)
      const acqCat = await prisma.category.create({
        data: { name: `${PROG_USERNAME} Questions`, slug: `${PROG_USERNAME}-questions`, order: 999, description: "t" },
      })
      const acqThread = await prisma.thread.create({
        data: { title: `${PROG_USERNAME}_qt`, slug: `${PROG_USERNAME}-qt`, content: "x", authorId: acqOp.id, categoryId: acqCat.id },
      })
      try {
        const first = await prisma.post.create({
          data: { content: "first answer", threadId: acqThread.id, authorId: acqUser.id },
        })
        const late = await prisma.post.create({
          data: { content: "later answer", threadId: acqThread.id, authorId: acqLate.id },
        })
        // Distinct timestamps — "first" is decided by MIN(createdAt).
        await prisma.post.update({
          where: { id: late.id },
          data: { createdAt: new Date(first.createdAt.getTime() + 1000) },
        })
        // Self-answer — backdated EARLIEST so only the self-exclusion
        // (not the MIN check) can disqualify it.
        const self = await prisma.post.create({
          data: { content: "self", threadId: acqThread.id, authorId: acqOp.id },
        })
        await prisma.post.update({
          where: { id: self.id },
          data: { createdAt: new Date(first.createdAt.getTime() - 500) },
        })
        const evA = await mkXpEvent(acqUser.id, {
          type: "QUEST_DAILY", key: `quest:${dayKey}:answer-the-call:${acqUser.id}`, xp: 10,
        })
        const evB = await mkXpEvent(acqLate.id, {
          type: "QUEST_DAILY", key: `quest:${dayKey}:answer-the-call:${acqLate.id}`, xp: 10,
        })
        const evC = await mkXpEvent(acqOp.id, {
          type: "QUEST_DAILY", key: `quest:${dayKey}:answer-the-call:${acqOp.id}`, xp: 10,
        })
        await reconcileQuestPayouts()
        const [a, b, c] = await Promise.all(
          [evA, evB, evC].map((e) =>
            prisma.progressionEvent.findUnique({ where: { id: e.id }, select: { reversedAt: true } })
          )
        )
        assert.equal(a?.reversedAt, null, "first-answer payout survives reconciliation")
        assert.ok(b?.reversedAt, "non-first reply payout reverses")
        assert.ok(c?.reversedAt, "self-answer payout reverses")
      } finally {
        await prisma.post.deleteMany({ where: { threadId: acqThread.id } }).catch(() => {})
        await prisma.thread.delete({ where: { id: acqThread.id } }).catch(() => {})
        await prisma.category.delete({ where: { id: acqCat.id } }).catch(() => {})
        for (const u of [acqUser, acqOp, acqLate]) {
          await prisma.user.delete({ where: { id: u.id } }).catch(() => {})
        }
      }
    }
  } finally {
    await prisma.user.delete({ where: { id: progUser.id } }).catch(() => {})
  }

  // ── DB: velocity detector — member-driven events only ────────────
  // The abuse detector must count member-driven XP only and ignore
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
        velEventIds.push((await mkXpLedgerEvent(u.id, "BADGE_BONUS", 200)).id)
        await expectClean(u.id, "T1: +200 BADGE_BONUS in 24h → no velocity flag")
      }

      // T2 — WEEKLY_AWARD alone must not flag
      {
        const u = await mkTestUser(`${VEL_PREFIX}_weekly`); velUsers.push(u)
        velEventIds.push((await mkXpLedgerEvent(u.id, "WEEKLY_AWARD", 200)).id)
        await expectClean(u.id, "T2: +200 WEEKLY_AWARD in 24h → no velocity flag")
      }

      // T3 — MILESTONE / system rewards must not flag
      {
        const u = await mkTestUser(`${VEL_PREFIX}_sys`); velUsers.push(u)
        velEventIds.push((await mkXpLedgerEvent(u.id, "MILESTONE", 100)).id)
        velEventIds.push((await mkXpLedgerEvent(u.id, "GROW_MILESTONE", 60)).id)
        velEventIds.push((await mkXpLedgerEvent(u.id, "JOURNEY_COMPLETE", 40)).id)
        await expectClean(u.id, "T3: +200 MILESTONE/GROW_MILESTONE/JOURNEY_COMPLETE → no flag")
      }

      // T4 — ONBOARDING_COMPLETE must not flag
      {
        const u = await mkTestUser(`${VEL_PREFIX}_onb`); velUsers.push(u)
        velEventIds.push((await mkXpLedgerEvent(u.id, "ONBOARDING_COMPLETE", 200)).id)
        await expectClean(u.id, "T4: +200 ONBOARDING_COMPLETE → no flag")
      }

      // T5 — genuine member-driven velocity flags HIGH
      {
        const u = await mkTestUser(`${VEL_PREFIX}_grind`); velUsers.push(u)
        const actor = await mkTestUser(`${VEL_PREFIX}_actor`); velUsers.push(actor)
        for (let i = 0; i < 6; i++) {
          velEventIds.push((await mkXpLedgerEvent(u.id, "ACCEPTED_ANSWER", 30, { actorId: actor.id })).id)
        }
        velEventIds.push((await mkXpLedgerEvent(u.id, "THREAD_STARTED", 5)).id) // 185 member-driven
        await expectFlagged(u.id, "T5: +185 member-driven in 24h → flagged")
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
          velEventIds.push((await mkXpLedgerEvent(u.id, "THREAD_STARTED", 10)).id)
        }
        await expectClean(u.id, "T6: exactly +150 member-driven → no flag (>150 required)")
      }

      // T7 — system + member-driven mix below threshold → no flag
      {
        const u = await mkTestUser(`${VEL_PREFIX}_mix`); velUsers.push(u)
        velEventIds.push((await mkXpLedgerEvent(u.id, "BADGE_BONUS", 250)).id)
        velEventIds.push((await mkXpLedgerEvent(u.id, "WEEKLY_AWARD", 50)).id)
        velEventIds.push((await mkXpLedgerEvent(u.id, "THREAD_STARTED", 10)).id)
        velEventIds.push((await mkXpLedgerEvent(u.id, "REPLY", 2)).id)
        await expectClean(u.id, "T7: +300 system + +12 member-driven → no flag")
      }

      // T8 — reversed events don't contribute
      {
        const u = await mkTestUser(`${VEL_PREFIX}_rev`); velUsers.push(u)
        velEventIds.push((await mkXpLedgerEvent(u.id, "ACCEPTED_ANSWER", 200, { reversedAt: new Date() })).id)
        await expectClean(u.id, "T8: +200 member-driven but reversed → no flag")
      }

      // T9 — legacy exclusions still excluded
      {
        const u = await mkTestUser(`${VEL_PREFIX}_excl`); velUsers.push(u)
        for (const t of ["STAFF_ADJUSTMENT", "REFERRAL", "CHALLENGE_WEEKLY", "LEGACY_MIGRATION", "REINSTATE", "CONTEST_WEEKLY_WIN", "CONTEST_MONTHLY_WIN"]) {
          velEventIds.push((await mkXpLedgerEvent(u.id, t, 50)).id) // 350 total excluded
        }
        await expectClean(u.id, "T9: +350 across legacy-excluded types → no flag")
      }

      // T10 — badge cascade burst doesn't flag
      {
        const u = await mkTestUser(`${VEL_PREFIX}_cascade`); velUsers.push(u)
        for (let i = 0; i < 10; i++) {
          velEventIds.push((await mkXpLedgerEvent(u.id, "BADGE_BONUS", 40)).id) // 400 burst
        }
        await expectClean(u.id, "T10: 10× BADGE_BONUS cascade (+400) → no flag")
      }

      // T11 — cron self-award (WEEKLY_AWARD + BADGE_BONUS same run) doesn't flag
      {
        const u = await mkTestUser(`${VEL_PREFIX}_gotw`); velUsers.push(u)
        velEventIds.push((await mkXpLedgerEvent(u.id, "BADGE_BONUS", 100, { key: `badgebonus:Grower of the Week:${u.id}` })).id)
        velEventIds.push((await mkXpLedgerEvent(u.id, "WEEKLY_AWARD", 50, { key: `weekly:gotw:2099-W01:${u.id}` })).id)
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
      await prisma.progressionEvent.deleteMany({ where: { id: { in: velEventIds } } }).catch(() => {})
      await prisma.user.deleteMany({ where: { id: { in: velUsers.map((u) => u.id) } } }).catch(() => {})
    }
  }

  // ── Progression V2: pure config invariants ─────────────────────
  // Locked rank thresholds (design rev 3) — Harvested 7,500 / MC 23,000.
  const rankBounds: [number, string][] = [
    [0, "Seed"], [59, "Seed"], [60, "Germinated"], [179, "Germinated"],
    [180, "Seedling"], [419, "Seedling"], [420, "Rooted"], [899, "Rooted"],
    [900, "Vegged"], [1599, "Vegged"], [1600, "Trained"], [2599, "Trained"],
    [2600, "Preflower"], [3999, "Preflower"], [4000, "Flowering"],
    [5799, "Flowering"], [5800, "Ripening"], [7499, "Ripening"],
    [7500, "Harvested"], [11999, "Harvested"], [12000, "Cured"],
    [16999, "Cured"], [17000, "Cultivator"], [22999, "Cultivator"],
    [23000, "Master Cultivator"], [99999999, "Master Cultivator"],
  ]
  for (const [xp, name] of rankBounds) {
    assert.equal(rankFromXp(xp).name, name, `xp ${xp} → ${name}`)
  }
  for (let i = 1; i < REP_RANKS.length; i++) {
    assert.ok(REP_RANKS[i].threshold > REP_RANKS[i - 1].threshold, `rank ${i} threshold increases`)
  }
  // Mastery levels + diversity floors present for the gated ranks.
  assert.equal(masteryLevelFromXp(0), 0)
  assert.equal(masteryLevelFromXp(49), 0)
  assert.equal(masteryLevelFromXp(50), 1)
  assert.equal(masteryLevelFromXp(24000), 10)
  assert.equal(masteryLevelFromXp(999999), 10)
  for (const r of ["Flowering", "Ripening", "Harvested", "Cultivator", "Master Cultivator"]) {
    assert.ok(DIVERSITY_FLOORS[r], `${r} has a diversity floor`)
  }
  assert.equal(MASTER_EXTRA_FLOOR.level, 6)
  // Unlock registry: unique ids, valid rank names, valid mastery paths.
  const seenUnlock = new Set<string>()
  for (const u of UNLOCKS) {
    assert.ok(!seenUnlock.has(u.id), `duplicate unlock id ${u.id}`)
    seenUnlock.add(u.id)
    if (u.rank) assert.ok(REP_RANKS.some((r) => r.name === u.rank), `${u.id} rank ${u.rank} exists`)
    if (u.mastery) {
      assert.ok(u.mastery.level >= 1 && u.mastery.level <= MASTERY_LEVELS.length, `${u.id} mastery level valid`)
    }
    if (u.layer === "C") assert.ok(u.standing, `layer C unlock ${u.id} requires standing`)
  }
  // Locked economy: no XP source can be a like or a login. DAILY_LOGIN
  // exists only as a 0-XP day marker feeding streaks/quests.
  for (const t of ["LIKE_RECEIVED", "REACTION", "LOGIN_STREAK"]) {
    assert.ok(!XP_TABLE[t], `${t} must not be an XP type`)
  }
  assert.equal(XP_TABLE.DAILY_LOGIN?.xp ?? 0, 0, "DAILY_LOGIN pays no XP")
  assert.equal(XP_TABLE.DAILY_LOGIN?.standing ?? 0, 0, "DAILY_LOGIN pays no standing")
  assert.equal(XP_TABLE.STREAK_MILESTONE?.xp ?? 0, 0, "STREAK_MILESTONE is a marker, not a payout")
  assert.equal(XP_TABLE.FAILURE_DOCUMENTED.xp, 8, "documented failure = +8 XP")
  assert.equal(STANDING_WEEKLY_CAP, 40)
  assert.equal(MASTERY_WEEKLY_FULL, 250)
  assert.equal(MASTERY_WEEKLY_MID, 500)
  assert.equal(DUP_WITHHOLD_PCT, 95)
  assert.equal(DUP_REDUCE_PCT, 85)
  // Quality bands.
  assert.equal(updateBand({ chars: 0, structuredCategories: 0, hasNumericMetric: false, hasPhoto: false }), 0)
  assert.equal(updateBand({ chars: 20, structuredCategories: 0, hasNumericMetric: false, hasPhoto: false }), 1)
  assert.equal(updateBand({ chars: QUALITY_BANDS.RICH_MIN_CHARS, structuredCategories: 1, hasNumericMetric: false, hasPhoto: false }), 2)
  assert.equal(updateBand({ chars: 10, structuredCategories: QUALITY_BANDS.RICH_MIN_CATEGORIES, hasNumericMetric: false, hasPhoto: false }), 2)
  assert.equal(updateBand({
    chars: QUALITY_BANDS.EXCEPTIONAL_MIN_CHARS,
    structuredCategories: QUALITY_BANDS.EXCEPTIONAL_MIN_CATEGORIES,
    hasNumericMetric: true,
    hasPhoto: true,
  }), 3)
  // Band 3 must fail without the photo.
  assert.equal(updateBand({
    chars: QUALITY_BANDS.EXCEPTIONAL_MIN_CHARS,
    structuredCategories: QUALITY_BANDS.EXCEPTIONAL_MIN_CATEGORIES,
    hasNumericMetric: true,
    hasPhoto: false,
  }), 2)

  // Simhash tiers (deterministic, prose-only).
  const prose1 = "Week 4 of the grow and the canopy is finally even. Raised the light to 45cm, PPFD sitting around 650, leaf temps steady at 76°F through the afternoon stretch."
  const prose2 = "Totally different topic — harvested the tomatoes this weekend and started planning the outdoor beds for spring."
  const dup = await checkDuplicateContent("n/a", prose1, { priorTexts: [prose1] })
  assert.equal(dup.verdict, "withheld", "identical prose → withheld")
  assert.ok(dup.similarity >= 95, `identical prose similarity ${dup.similarity}`)
  const near = await checkDuplicateContent("n/a", prose1.slice(0, -20) + " through the late stretch.", { priorTexts: [prose1] })
  assert.ok(["reduced", "withheld"].includes(near.verdict), `near-identical prose → reduced/withheld (got ${near.verdict} @ ${near.similarity}%)`)
  const clean = await checkDuplicateContent("n/a", prose2, { priorTexts: [prose1] })
  assert.equal(clean.verdict, "clean", "different prose → clean")
  // Structured-data exception: reduced verdict clears when metrics changed.
  if (near.verdict === "reduced") {
    const rescued = await checkDuplicateContent("n/a", prose1.slice(0, -20) + " through the late stretch.", { priorTexts: [prose1], structuredChanged: true })
    assert.equal(rescued.verdict, "clean", "structured change rescues the 85–94% band")
  }

  // ── Progression V2: DB engine behavior ───────────────────────
  const pv2: string[] = []
  let achFixtureExisted = true
  const mkPv2 = async (tag: string, createdDaysAgo = 0) => {
    const u = await mkTestUser(`${PV2_PREFIX}_${tag}`)
    pv2.push(u.id)
    if (createdDaysAgo > 0) {
      await prisma.user.update({
        where: { id: u.id },
        data: { createdAt: new Date(Date.now() - createdDaysAgo * 86400000) },
      })
    }
    return u.id
  }
  const pv2Profile = async (userId: string) =>
    prisma.profile.findUnique({ where: { userId }, select: { xp: true, standing: true } })
  // Fixture seed that keeps Profile.xp/standing == Σ(ProgressionEvent) —
  // direct profile.update writes would create ledger-vs-balance drift.
  const seedProgression = async (userId: string, xpDelta: number, standingDelta = 0) => {
    if (!xpDelta && !standingDelta) return
    await prisma.$transaction(async (tx) => {
      await tx.progressionEvent.create({
        data: {
          userId, type: "LEGACY_STANDING", xp: xpDelta, standing: standingDelta,
          reason: "pv2 fixture seed", key: `pv2:seed:${RUN_TAG}:${userId}:${xpDelta}:${standingDelta}:${Math.random().toString(36).slice(2)}`,
        },
      })
      await tx.profile.update({
        where: { userId },
        data: { xp: { increment: xpDelta }, standing: { increment: standingDelta } },
      })
    })
  }

  try {
    // XP award + keyed idempotency + mastery crediting.
    const u1 = await mkPv2("award")
    const a1 = await awardProgression(u1, "THREAD_STARTED", "first thread", { key: `pv2:thread:${RUN_TAG}:1` })
    assert.ok(a1.awarded && a1.xp === XP_TABLE.THREAD_STARTED.xp, "thread XP awarded")
    const a1dup = await awardProgression(u1, "THREAD_STARTED", "first thread", { key: `pv2:thread:${RUN_TAG}:1` })
    assert.ok(!a1dup.awarded && a1dup.skippedReason === "duplicate", "same key is idempotent")
    assert.equal((await pv2Profile(u1))!.xp, XP_TABLE.THREAD_STARTED.xp, "no double credit")
    const m1 = await getMasteryMap(u1)
    assert.equal(m1.COMMUNITY, XP_TABLE.THREAD_STARTED.xp, "mastery credited")
    assert.equal(m1.CULTIVATION, 0, "no cross-path bleed")

    // Self-award rejected.
    const self = await awardProgression(u1, "ACCEPTED_ANSWER", "self", { actorId: u1 })
    assert.ok(!self.awarded && self.skippedReason === "self", "self-grant rejected")

    // Mastery soft cap: 6× HARVEST_LOGGED (50 XP) → 250 full + 50@50% = 275.
    const u2 = await mkPv2("softcap")
    for (let i = 0; i < 6; i++) {
      await awardProgression(u2, "HARVEST_LOGGED", `h${i}`, { key: `pv2:h:${RUN_TAG}:${i}` })
    }
    const m2 = await getMasteryMap(u2)
    assert.equal(m2.CULTIVATION, 275, `soft cap: 6×50 → 275 (got ${m2.CULTIVATION})`)
    assert.equal((await pv2Profile(u2))!.xp, 275, "global XP matches mastery sum")

    // Keyed reversal → clawback, reinstate on re-award, final locks.
    const u3 = await mkPv2("rev")
    // Fixture type is HARVEST_REPORT — live, uncapped, no standing component.
    // (Was GUIDE_PUBLISHED, which Phase I deferred: awardProgression refuses it.)
    await awardProgression(u3, "HARVEST_REPORT", "harvest writeup", { key: `pv2:guide:${RUN_TAG}` })
    const rev = await reverseProgressionByKey(`pv2:guide:${RUN_TAG}`, "mod retract")
    assert.ok(rev.reversed, "keyed reversal succeeds")
    assert.equal((await pv2Profile(u3))!.xp, 0, "XP clawed back")
    const re = await awardProgression(u3, "HARVEST_REPORT", "harvest writeup", { key: `pv2:guide:${RUN_TAG}` })
    assert.ok(re.awarded && re.reinstated, "re-award reinstates")
    assert.equal((await pv2Profile(u3))!.xp, XP_TABLE.HARVEST_REPORT.xp, "reinstated XP restored")
    await reverseProgressionByKey(`pv2:guide:${RUN_TAG}`, "retract again")
    const re2 = await awardProgression(u3, "HARVEST_REPORT", "harvest writeup", { key: `pv2:guide:${RUN_TAG}` })
    assert.ok(re2.awarded && re2.reinstated, "non-final reversal still reinstates")
    // Final (staff-permanent) reversal locks the key against re-grant.
    const guideEvent = await prisma.progressionEvent.findUnique({
      where: { key: `pv2:guide:${RUN_TAG}` }, select: { id: true },
    })
    await reverseProgressionEvent(guideEvent!.id, "final retract", undefined, { final: true })
    const lockedRes = await awardProgression(u3, "HARVEST_REPORT", "harvest writeup", { key: `pv2:guide:${RUN_TAG}` })
    assert.ok(!lockedRes.awarded && lockedRes.skippedReason === "locked", "final reversal locks the key")

    // Standing: young grantor → 0 standing, XP still lands.
    const grantee = await mkPv2("grantee")
    const youngGrantor = await mkPv2("young", 0)
    const gYoung = await awardProgression(grantee, "ACCEPTED_ANSWER", "ans", {
      key: `pv2:acc:${RUN_TAG}:young`, actorId: youngGrantor,
    })
    assert.ok(gYoung.awarded, "young grantor award lands")
    assert.equal(gYoung.standing, 0, "young grantor pays 0 standing")
    assert.equal(gYoung.xp, XP_TABLE.ACCEPTED_ANSWER.xp, "XP unaffected by grantor age")

    // Aged grantor with sub-Trusted standing → floor halves the grant.
    const floorGrantor = await mkPv2("floor", 30)
    const gFloor = await awardProgression(grantee, "ACCEPTED_ANSWER", "ans2", {
      key: `pv2:acc:${RUN_TAG}:floor`, actorId: floorGrantor,
    })
    assert.equal(gFloor.standing, 5, `sub-Trusted grantor pays half (got ${gFloor.standing})`)

    // Reciprocal: grantee grants grantor first → grantor's award pays 0 standing.
    const recipA = await mkPv2("ra", 30)
    const recipB = await mkPv2("rb", 30)
    await seedProgression(recipB, 0, 150)
    await awardProgression(recipB, "ACCEPTED_ANSWER", "back", {
      key: `pv2:rec:${RUN_TAG}:1`, actorId: recipA,
    }) // A grants B (B is now Trusted→ pays full... wait actorId is grantor)
    const gRecip = await awardProgression(recipA, "ACCEPTED_ANSWER", "fwd", {
      key: `pv2:rec:${RUN_TAG}:2`, actorId: recipB,
    })
    assert.equal(gRecip.standing, 0, "reciprocal grant pays 0 standing")
    assert.equal(gRecip.xp, XP_TABLE.ACCEPTED_ANSWER.xp, "reciprocal XP still lands")

    // Second grantor diversifies grantee's standing so floorGrantor's share
    // stays under the 60% cluster threshold for the diminishing test.
    const otherGrantor = await mkPv2("other", 30)
    await seedProgression(otherGrantor, 0, 150)
    // Standing-economy fixtures use HARVEST_REPORT + explicit standing:10 —
    // a live, uncapped source type (CONTEST_* carries a per-source weekly cap;
    // GUIDE_PUBLISHED is deferred and refuses awards since Phase I).
    const gOther = await awardProgression(grantee, "HARVEST_REPORT", "o1", {
      key: `pv2:other:${RUN_TAG}:1`, actorId: otherGrantor, standing: 10,
    })
    assert.equal(gOther.standing, 10, "Trusted grantor pays full")

    // Per-grantor diminishing: repeat grant from the same grantor halves.
    // (HARVEST_REPORT — no caps — after ACCEPTED_ANSWER's 2/day limit.)
    const gDim1 = await awardProgression(grantee, "HARVEST_REPORT", "d1", {
      key: `pv2:dim:${RUN_TAG}:1`, actorId: floorGrantor, standing: 10,
    })
    assert.equal(gDim1.standing, 2, `repeat grant halves again (10/2 floor→5/2→2, got ${gDim1.standing})`)

    // Standing reversal mirrors XP (delete → clawback).
    const stRev = await reverseProgressionByKey(`pv2:acc:${RUN_TAG}:floor`, "retract")
    assert.ok(stRev.reversed, "standing reversal succeeds")
    assert.equal(
      (await pv2Profile(grantee))!.standing,
      gYoung.standing! + gFloor.standing! + gOther.standing! + gDim1.standing! - gFloor.standing!,
      "standing ledger consistent",
    )

    // Weekly cap: staff grants exempt; member income stops at 40.
    const capped = await mkPv2("cap")
    await awardProgression(capped, "STAFF_ADJUSTMENT", "staff grant", { xp: 0, standing: 100, force: true })
    const grantors: string[] = []
    for (let i = 0; i < 5; i++) {
      const gr = await mkPv2(`gc${i}`, 30)
      grantors.push(gr)
      await seedProgression(gr, 0, 150)
    }
    for (let i = 0; i < 5; i++) {
      const r = await awardProgression(capped, "HARVEST_REPORT", `cap${i}`, {
        key: `pv2:cap:${RUN_TAG}:${i}`, actorId: grantors[i], standing: 10,
      })
      if (i < 4) assert.equal(r.standing, 10, `grant ${i} pays full`)
      else assert.equal(r.standing, 0, "grant 5 exceeds weekly cap → 0")
    }
    assert.equal((await pv2Profile(capped))!.standing, 140, "100 staff + 40 member-driven")

    // Per-grantor lifetime cap: seed 30 standing from whale 8 days ago
    // (inside the 90d window, outside this week) → a fresh grant is capped.
    const lone = await mkPv2("lone")
    const whale = await mkPv2("whale", 30)
    await seedProgression(whale, 0, 150)
    const eightDaysAgo = new Date(Date.now() - 8 * 86400000)
    for (let i = 0; i < 3; i++) {
      await prisma.progressionEvent.create({
        data: {
          userId: lone, type: "ACCEPTED_ANSWER", xp: 30, standing: 10,
          reason: "seeded lifetime grant", actorId: whale,
          key: `pv2:whaleseed:${RUN_TAG}:${i}`, createdAt: eightDaysAgo,
        },
      })
    }
    await prisma.profile.update({ where: { userId: lone }, data: { xp: { increment: 90 }, standing: { increment: 30 } } }) // seeded ledger rows above keep this consistent
    const lif = await awardProgression(lone, "ACCEPTED_ANSWER", "over cap", {
      key: `pv2:whalecap:${RUN_TAG}`, actorId: whale,
    })
    assert.equal(lif.standing, 0, `grantor lifetime ${STANDING_PER_GRANTOR_LIFETIME} reached → 0 (got ${lif.standing})`)

    // Cluster discount: whale2 is lone2's only grantor — after the first
    // grant lands (share hits 100% ≥ 60%), further in-cluster grants pay 0
    // and write a STANDING_CLUSTER AbuseFlag.
    const lone2 = await mkPv2("lone2")
    const whale2 = await mkPv2("whale2", 30)
    await seedProgression(whale2, 0, 150)
    const clust1 = await awardProgression(lone2, "HARVEST_REPORT", "w0", {
      key: `pv2:whale2:${RUN_TAG}:0`, actorId: whale2, standing: 10,
    })
    assert.equal(clust1.standing, 10, "first grant pays before concentration")
    const clust2 = await awardProgression(lone2, "HARVEST_REPORT", "w1", {
      key: `pv2:whale2:${RUN_TAG}:1`, actorId: whale2, standing: 10,
    })
    assert.equal(clust2.standing, 0, "≥60% share → in-cluster grant pays 0")
    const flag = await prisma.abuseFlag.findFirst({
      where: { signal: "STANDING_CLUSTER", userId: lone2, counterpartyId: whale2 },
    })
    assert.ok(flag, "cluster flag written for review")

    // Suspended subject skipped (force bypasses — staff adjustments).
    const susp = await mkPv2("susp")
    await prisma.user.update({ where: { id: susp }, data: { suspendedUntil: new Date(Date.now() + 86400000) } })
    const sRes = await awardProgression(susp, "THREAD_STARTED", "x", { key: `pv2:susp:${RUN_TAG}` })
    assert.ok(!sRes.awarded && sRes.skippedReason === "suspended", "suspended user skipped")

    // Unlock gates — Layer A (rank only). Fixture is quest-slot-4 @ Rooted
    // (420): comparison-basic was removed in Phase I (basic comparison was
    // already free — the unlock promised nothing real).
    const gate = await mkPv2("gate")
    assert.equal(await hasUnlock(gate, "quest-slot-4"), false, "Seed user locked out of Rooted unlock")
    await seedProgression(gate, 200)
    assert.equal(await hasUnlock(gate, "quest-slot-4"), false, "Seedling still below Rooted gate")
    await seedProgression(gate, 300)
    assert.equal(await hasUnlock(gate, "quest-slot-4"), true, "Rooted unlock opens")
    // Layer B (rank + mastery): env-analytics needs Vegged + Records M2 (150).
    await seedProgression(gate, 800)
    assert.equal(await hasUnlock(gate, "env-analytics"), false, "rank alone insufficient for layer B")
    await prisma.masteryProgress.upsert({
      where: { userId_mastery: { userId: gate, mastery: "RECORDS" } },
      create: { userId: gate, mastery: "RECORDS", xp: 150 },
      update: { xp: 150 },
    })
    assert.equal(await hasUnlock(gate, "env-analytics"), true, "rank + mastery opens layer B")
    // Layer C (rank + mastery + standing): grow-room needs Cultivator + Trusted(100).
    await seedProgression(gate, 17000, 50)
    assert.equal(await hasUnlock(gate, "grow-room"), false, "standing insufficient for layer C")
    await seedProgression(gate, 0, 100)
    assert.equal(await hasUnlock(gate, "grow-room"), true, "layer C opens at Trusted")
    // unlockFrozen blocks everything.
    await prisma.profile.update({ where: { userId: gate }, data: { unlockFrozen: true } })
    assert.equal(await hasUnlock(gate, "quest-slot-4"), false, "unlockFrozen denies all")
    await prisma.profile.update({ where: { userId: gate }, data: { unlockFrozen: false } })

    // Progression 2.2 boundary coverage — every rank grants a real bump
    // on an existing gated axis. Below/at/above on each.
    const cap22 = await mkPv2("cap22")
    // profileSectionLimit: 2 base → 3 @Germinated(60) → 4 @Rooted(420) →
    // 6 @Harvested(7500) → 8 @Cured(12000).
    assert.equal(await profileSectionLimit(cap22), 2, "Seed base = 2 sections")
    await seedProgression(cap22, 59)
    assert.equal(await profileSectionLimit(cap22), 2, "59 XP still 2 sections")
    await seedProgression(cap22, 1)
    assert.equal(await profileSectionLimit(cap22), 3, "Germinated grants 3rd section")
    await seedProgression(cap22, 360) // 420 → Rooted
    assert.equal(await profileSectionLimit(cap22), 4, "Rooted grants 4 sections")
    await seedProgression(cap22, 7080) // 7500 → Harvested
    assert.equal(await profileSectionLimit(cap22), 6, "Harvested grants 6 sections")
    await seedProgression(cap22, 4500) // 12000 → Cured
    assert.equal(await profileSectionLimit(cap22), 8, "Cured grants 8 sections")
    // statSlotLimit: 4 base → 6 @Vegged(900) → 7 @Flowering(4000) →
    // 8 @Harvested(7500).
    const capStats = await mkPv2("capStats")
    assert.equal(await statSlotLimit(capStats), 4, "Seed base = 4 stats")
    await seedProgression(capStats, 3999)
    assert.equal(await statSlotLimit(capStats), 6, "below Flowering stays 6 (Vegged passed at 900)")
    await seedProgression(capStats, 1) // 4000 → Flowering
    assert.equal(await statSlotLimit(capStats), 7, "Flowering grants 7th stat slot")
    await seedProgression(capStats, 3500) // 7500 → Harvested
    assert.equal(await statSlotLimit(capStats), 8, "Harvested grants 8 stat slots")
    // savedSearchLimit: 3 base → 6 @Germinated(60) → 10 @Trained(1600).
    const capSaved = await mkPv2("capSaved")
    assert.equal(await savedSearchLimit(capSaved), 3, "Seed base = 3 saved searches")
    await seedProgression(capSaved, 59)
    assert.equal(await savedSearchLimit(capSaved), 3, "59 XP still 3 searches")
    await seedProgression(capSaved, 1) // 60 → Germinated
    assert.equal(await savedSearchLimit(capSaved), 6, "Germinated grants 6 saved searches")
    await seedProgression(capSaved, 1540) // 1600 → Trained
    assert.equal(await savedSearchLimit(capSaved), 10, "Trained grants 10 saved searches")
    // imagesPerPost: undefined(4) → 5 @Seedling(180) → 6 @Flowering
    // → 8 @Harvested → 10 @Cultivator. Pure form exercises the same
    // ladder the post route consumes.
    assert.equal(progressionPerksFrom(179, 0, false).imagesPerPost, undefined, "below Seedling keeps base 4")
    assert.equal(progressionPerksFrom(180, 0, false).imagesPerPost, 5, "Seedling grants 5 photos")
    assert.equal(progressionPerksFrom(4000, 0, false).imagesPerPost, 6, "Flowering grants 6 photos")
    assert.equal(progressionPerksFrom(180, 0, true).imagesPerPost, undefined, "frozen member loses the bump")
    // maxThreadTags: undefined(5) → 7 @Ripening(5800). Consumed by
    // /api/forum/threads as a MAX_TAGS override.
    assert.equal(progressionPerksFrom(5799, 0, false).maxThreadTags, undefined, "below Ripening keeps base 5 tags")
    assert.equal(progressionPerksFrom(5800, 0, false).maxThreadTags, 7, "Ripening grants 7 tags")
    assert.equal(progressionPerksFrom(5800, 0, true).maxThreadTags, undefined, "frozen member loses the tag bump")
    // showcaseSlots registry↔perk agreement: every live showcase row must
    // open exactly when progressionPerksFrom crosses the ladder rung.
    for (const [id, xp, slots] of [
      ["showcase-slots-4", 1600, 4], ["showcase-slots-5", 2600, 5],
      ["showcase-slots-6", 5800, 6], ["showcase-slots-8", 7500, 8],
      ["showcase-slots-10", 12000, 10], ["showcase-slots-12", 17000, 12],
      ["showcase-slots-14", 23000, 14],
    ] as const) {
      const spec = UNLOCK_BY_ID.get(id)!
      const rank = REP_RANKS.find((r) => r.name === spec.rank)!
      assert.equal(rank.threshold, xp, `${id} documents its perk rung`)
      assert.equal(progressionPerksFrom(xp - 1, 0, false).showcaseSlots < slots, true, `${id} one XP below = fewer slots`)
      assert.equal(progressionPerksFrom(xp, 0, false).showcaseSlots >= slots, true, `${id} at rung = slot count`)
      const sc = await mkPv2(`sc${slots}`)
      assert.equal(await hasUnlock(sc, id), false, `${id} locked at Seed`)
      await seedProgression(sc, xp - 1)
      assert.equal(await hasUnlock(sc, id), false, `${id} locked one XP below its rung`)
      await seedProgression(sc, 1)
      assert.equal(await hasUnlock(sc, id), true, `${id} opens at its rank threshold`)
    }
    // Deferred capabilities stay inaccessible even at max XP + standing.
    const maxed = await mkPv2("maxed")
    await seedProgression(maxed, 50000, 1000)
    for (const fut of UNLOCKS.filter((u) => u.status === "future")) {
      assert.equal(await hasUnlock(maxed, fut.id), false, `future row ${fut.id} can never activate`)
    }

    // Standing-only registry rows (M-01): these perks ship live through
    // progressionPerksFrom — the catalog rows must evaluate identically
    // through hasUnlock so display and enforcement share one truth.
    const st = await mkPv2("standing")
    assert.equal(await hasUnlock(st, "poll-vote"), false, "standing 0 locked out of polls")
    assert.equal(await hasUnlock(st, "trusted-links"), false, "standing 0 blocks external links")
    await seedProgression(st, 0, STANDING_POLL_VOTE)
    assert.equal(await hasUnlock(st, "poll-vote"), true, "Known standing opens poll voting")
    assert.equal(await hasUnlock(st, "trusted-links"), true, "Known standing registers trusted links")
    assert.equal(await hasUnlock(st, "poll-create"), false, "Known cannot create polls yet")
    await seedProgression(st, 0, STANDING_POLL_CREATE - STANDING_POLL_VOTE)
    assert.equal(await hasUnlock(st, "poll-create"), true, "Trusted opens poll creation")
    assert.equal(await hasUnlock(st, "slowmode-exempt"), false, "Trusted still slowmoded")
    await seedProgression(st, 0, STANDING_SLOWMODE_EXEMPT - STANDING_POLL_CREATE)
    assert.equal(await hasUnlock(st, "slowmode-exempt"), true, "Pillar exempt from slowmode")
    // Frozen member loses standing-gated perks too (kill-switch parity).
    await prisma.profile.update({ where: { userId: st }, data: { unlockFrozen: true } })
    assert.equal(await hasUnlock(st, "slowmode-exempt"), false, "frozen member loses standing perks")
    await prisma.profile.update({ where: { userId: st }, data: { unlockFrozen: false } })

    // Session-derived poll hint (Batch K): share-composer and /forum/new
    // read standing/unlockFrozen off session.user and call this helper —
    // it must agree exactly with the server-side perk map.
    assert.equal(pollCreationAllowed(STANDING_POLL_CREATE - 1, false), false, "below Trusted cannot create polls")
    assert.equal(pollCreationAllowed(STANDING_POLL_CREATE, false), true, "Trusted opens poll creation")
    assert.equal(pollCreationAllowed(STANDING_POLL_CREATE + 1, false), true, "above threshold stays open")
    assert.equal(pollCreationAllowed(STANDING_POLL_CREATE, true), false, "frozen at threshold still locked")
    assert.equal(pollCreationAllowed(undefined, undefined), false, "missing session fields fail closed")
    for (const s of [0, STANDING_POLL_CREATE - 1, STANDING_POLL_CREATE, STANDING_POLL_CREATE + 500]) {
      for (const f of [false, true]) {
        assert.equal(
          progressionPerksFrom(0, s, f).pollCreation, pollCreationAllowed(s, f),
          `hint agrees with perk map at standing=${s} frozen=${f}`)
      }
    }

    // tags-7 row ↔ perk agreement: registry gate must flip at the same XP
    // the maxThreadTags ladder does (5800 = Ripening).
    const tg = await mkPv2("tags")
    assert.equal(await hasUnlock(tg, "tags-7"), false, "tags-7 locked at Seed")
    await seedProgression(tg, 5799)
    assert.equal(await hasUnlock(tg, "tags-7"), false, "tags-7 locked below Ripening")
    await seedProgression(tg, 1)
    assert.equal(await hasUnlock(tg, "tags-7"), true, "tags-7 opens at Ripening")
    await prisma.profile.update({ where: { userId: tg }, data: { unlockFrozen: true } })
    assert.equal(await hasUnlock(tg, "tags-7"), false, "frozen member loses tags-7")
    await prisma.profile.update({ where: { userId: tg }, data: { unlockFrozen: false } })

    // Achievement route (M-02): the unlock gate reads UserAchievement — the
    // V2 grant table — and status:"future" rows can never activate even when
    // the member holds the achievement. mentoring-tools is the future spec:
    // anyOf Ripening+Knowledge M3+Trusted OR achievement greenlight.
    const achSpec = UNLOCK_BY_ID.get("mentoring-tools")!
    assert.equal(achSpec.status, "future", "fixture spec stays a future row")
    const achUser = await mkPv2("ach")
    // Standing at Trusted satisfies the standing clause so ONLY the
    // achievement-vs-core branch decides the result.
    await seedProgression(achUser, 0, STANDING_POLL_CREATE)
    assert.equal(await meetsUnlockSpec(achUser, achSpec), false, "no achievement, no rank → spec unmet")
    achFixtureExisted = !!(await prisma.achievement.findUnique({ where: { key: "greenlight" } }))
    const achRow = await prisma.achievement.upsert({
      where: { key: "greenlight" },
      create: { key: "greenlight", family: "helping", name: "Greenlight", description: "Reputational trust marker" },
      update: {},
    })
    await prisma.userAchievement.create({
      data: { userId: achUser, achievementId: achRow.id },
    })
    assert.equal(await meetsUnlockSpec(achUser, achSpec), true, "V2 achievement grant satisfies the route")
    assert.equal(await hasUnlock(achUser, "mentoring-tools"), false, "status:future can never activate (M-02 boundary)")

    // Diversity floor: 18k XP but zero breadth → Cultivator floor (3×M4)
    // unmet → banked at Cured (no floor on Cured per locked §5.4).
    const narrow = await mkPv2("narrow")
    await seedProgression(narrow, 18000)
    const er1 = await effectiveRank(narrow)
    assert.equal(er1.xpRank.name, "Cultivator", "XP rank is Cultivator")
    assert.equal(er1.rank.name, "Cured", "diversity floor banks at Cured")
    assert.ok(er1.blockedBy && er1.blockedBy.rank === "Cultivator", "blockedBy reports the gated rank")
    // Seed breadth → promotion unlocks.
    for (const m of ["CULTIVATION", "RECORDS", "KNOWLEDGE"] as const) {
      await prisma.masteryProgress.upsert({
        where: { userId_mastery: { userId: narrow, mastery: m } },
        create: { userId: narrow, mastery: m, xp: 800 },
        update: { xp: 800 },
      })
    }
    const er2 = await effectiveRank(narrow)
    assert.equal(er2.rank.name, "Cultivator", "floor satisfied → promoted")

    // Mid-ladder floor: Flowering XP but no paths ≥ M2 → banks at Preflower.
    const banked = await mkPv2("banked")
    await seedProgression(banked, 4500)
    const er3 = await effectiveRank(banked)
    assert.equal(er3.xpRank.name, "Flowering")
    assert.equal(er3.rank.name, "Preflower", "Flowering floor banks at Preflower")
    await prisma.masteryProgress.upsert({
      where: { userId_mastery: { userId: banked, mastery: "CULTIVATION" } },
      create: { userId: banked, mastery: "CULTIVATION", xp: 150 },
      update: { xp: 150 },
    })
    await prisma.masteryProgress.upsert({
      where: { userId_mastery: { userId: banked, mastery: "RECORDS" } },
      create: { userId: banked, mastery: "RECORDS", xp: 150 },
      update: { xp: 150 },
    })
    const er4 = await effectiveRank(banked)
    assert.equal(er4.rank.name, "Flowering", "2×M2 clears the Flowering floor")

    // Durable outbox: source reversal drains end-to-end.
    const src = await mkPv2("src")
    await awardProgression(src, "UPDATE_DAY", "upd", {
      key: `pv2:src:${RUN_TAG}:1`, sourceType: "DIARY_UPDATE", sourceId: `pv2-src-${RUN_TAG}`,
    })
    await reverseXpSourceDurable("DIARY_UPDATE", `pv2-src-${RUN_TAG}`, "content deleted")
    assert.equal((await pv2Profile(src))!.xp, 0, "outbox reversal clawed XP")
    const drain = await drainPendingXpReversals()
    assert.ok(drain.drained >= 0, "outbox drain runs clean")

    // Zero-value events write nothing.
    const zero = await mkPv2("zero")
    const z = await awardProgression(zero, "DAILY_LOGIN", "login", { key: `pv2:login:${RUN_TAG}` })
    assert.ok(!z.awarded, "login pays nothing")
    const zRows = await prisma.progressionEvent.count({ where: { userId: zero } })
    assert.equal(zRows, 0, "no ledger row for a 0-value event")

    // Marker rows never pay and never consume a cap slot (withheld/
    // reduced audit rows + check-in markers must not block real awards).
    const mkUser = await mkPv2("marker")
    for (let i = 0; i < XP_TABLE.THREAD_STARTED.dailyCap!; i++) {
      const m = await awardProgression(mkUser, "THREAD_STARTED", "withheld", {
        key: `pv2:marker:${RUN_TAG}:w${i}`, xp: 0, marker: true,
      })
      assert.ok(m.awarded && m.xp === 0, "marker writes a 0-XP audit row")
    }
    assert.equal((await pv2Profile(mkUser))!.xp, 0, "markers pay nothing")
    const real = await awardProgression(mkUser, "THREAD_STARTED", "real", { key: `pv2:marker:${RUN_TAG}:r` })
    assert.ok(real.awarded && real.xp === XP_TABLE.THREAD_STARTED.xp, "markers don't consume the daily cap")

    // Milestone markers: first crossing notifies once (marker row is the
    // once-ever claim); reversal + re-earn does not re-fire.
    const ms = await mkPv2("milestone")
    const rung = 60 // lowest progression rung (Seed → Germinated sub-level)
    const cross = await awardProgression(ms, "STAFF_ADJUSTMENT", "seed to rung", {
      xp: rung, force: true, key: `pv2:ms:${RUN_TAG}:1`,
    })
    assert.ok(cross.awarded && cross.rungsCrossed!.some((r) => r.xp === rung), "first crossing reports rung")
    const msMarker = await prisma.progressionEvent.findUnique({ where: { key: `milestone:${ms}:${rung}` } })
    assert.ok(msMarker && msMarker.type === "MILESTONE" && msMarker.xp === 0, "once-ever marker written")
    const msNotifs = async () =>
      prisma.notification.count({ where: { userId: ms, type: "REPUTATION", metadata: { path: ["kind"], equals: "tier" } } })
    assert.equal(await msNotifs(), 1, "rank-up notification fired once")
    // Reverse back below the rung, then re-earn — marker persists, so no
    // second notification and no second marker row.
    await reverseProgressionByKey(`pv2:ms:${RUN_TAG}:1`, "retract")
    assert.equal((await pv2Profile(ms))!.xp, 0, "XP clawed below rung")
    const cross2 = await awardProgression(ms, "STAFF_ADJUSTMENT", "re-earn", {
      xp: rung, force: true, key: `pv2:ms:${RUN_TAG}:2`,
    })
    assert.ok(cross2.awarded, "re-earn pays")
    assert.equal(await msNotifs(), 1, "re-crossing does not re-notify")
    const msMarkerCount = await prisma.progressionEvent.count({ where: { key: `milestone:${ms}:${rung}` } })
    assert.equal(msMarkerCount, 1, "marker row stays unique")

    // ── awardProgressionBatch — diary-update award pipeline ─────────
    // The batch path must produce byte-identical progression outcomes to
    // sequential awardProgression calls: same events, caps, mastery
    // accumulation, milestone markers, and ledger-vs-balance integrity.
    const { awardProgressionBatch } = await import("../src/lib/progression")

    // Single award lands; event row + profile + mastery all consistent.
    {
      const u = await mkPv2("batch1")
      const r = await awardProgressionBatch(u, [
        { type: "THREAD_STARTED", reason: "t1", key: `pv2:batch:${RUN_TAG}:s1` },
      ])
      assert.ok(r[0].awarded && r[0].xp === XP_TABLE.THREAD_STARTED.xp, "batch: single award pays")
      assert.equal((await pv2Profile(u))!.xp, XP_TABLE.THREAD_STARTED.xp)
      assert.equal((await getMasteryMap(u)).COMMUNITY, XP_TABLE.THREAD_STARTED.xp, "batch: mastery credited")
    }

    // Multiple independent awards in one batch — all pay, ledger sums match.
    {
      const u = await mkPv2("batchN")
      const r = await awardProgressionBatch(u, [
        { type: "UPDATE_DAY", reason: "day", key: `pv2:batch:${RUN_TAG}:m1`, sourceType: "DIARY", sourceId: "d1" },
        { type: "UPDATE_RICH", reason: "rich", key: `pv2:batch:${RUN_TAG}:m2`, sourceType: "DIARY_UPDATE", sourceId: "u1" },
        { type: "STRUCTURED_CATEGORY", reason: "cat", key: `pv2:batch:${RUN_TAG}:m3`, sourceType: "DIARY_UPDATE", sourceId: "u1" },
        { type: "METRIC_FIRST", reason: "first temp", key: `pv2:batch:${RUN_TAG}:m4`, sourceType: "DIARY_UPDATE", sourceId: "u1" },
      ])
      assert.ok(r.every((x) => x.awarded), "batch: all four candidates pay")
      const expect = XP_TABLE.UPDATE_DAY.xp + XP_TABLE.UPDATE_RICH.xp + XP_TABLE.STRUCTURED_CATEGORY.xp + XP_TABLE.METRIC_FIRST.xp
      assert.equal((await pv2Profile(u))!.xp, expect, "batch: profile xp == summed awards")
      const agg = await prisma.progressionEvent.aggregate({ where: { userId: u }, _sum: { xp: true } })
      assert.equal(agg._sum.xp, expect, "batch: ledger == profile")
    }

    // Duplicate request — same keys resubmitted: all resolve to "duplicate",
    // nothing pays twice.
    {
      const u = await mkPv2("batchdup")
      const cands = [
        { type: "UPDATE_DAY", reason: "day", key: `pv2:batch:${RUN_TAG}:d1` },
        { type: "UPDATE_RICH", reason: "rich", key: `pv2:batch:${RUN_TAG}:d2` },
      ]
      const first = await awardProgressionBatch(u, cands)
      const xpAfter = (await pv2Profile(u))!.xp
      const second = await awardProgressionBatch(u, cands)
      assert.ok(first.every((x) => x.awarded) && second.every((x) => x.skippedReason === "duplicate"), "batch: resubmit all-duplicate")
      assert.equal((await pv2Profile(u))!.xp, xpAfter, "batch: resubmit pays nothing")
      assert.equal(await prisma.progressionEvent.count({ where: { userId: u, key: `pv2:batch:${RUN_TAG}:d1` } }), 1)
    }

    // Concurrent identical batches — unique-key protection must leave
    // exactly one award paying, on both the batch and fallback paths.
    {
      const u = await mkPv2("batchcc")
      const cands = () => [
        { type: "UPDATE_DAY", reason: "day", key: `pv2:batch:${RUN_TAG}:c1` },
        { type: "UPDATE_RICH", reason: "rich", key: `pv2:batch:${RUN_TAG}:c2` },
      ]
      const [ra, rb] = await Promise.all([
        awardProgressionBatch(u, cands()),
        awardProgressionBatch(u, cands()),
      ])
      const all = [...ra, ...rb]
      assert.equal(all.filter((x) => x.awarded).length, 2, "concurrent batches: exactly one copy pays")
      assert.equal(all.filter((x) => x.skippedReason === "duplicate").length, 2)
      assert.equal(
        (await pv2Profile(u))!.xp,
        XP_TABLE.UPDATE_DAY.xp + XP_TABLE.UPDATE_RICH.xp,
        "concurrent batches: no double credit",
      )
    }

    // Weekly mastery soft cap accumulates WITHIN the batch: 6× HARVEST_LOGGED
    // (50 XP each, CULTIVATION) must land 250 full + 50@50% = 275 — the
    // in-memory weekUsed accumulator must mirror sequential aggregates.
    {
      const u = await mkPv2("batchcap")
      const r = await awardProgressionBatch(
        u,
        [0, 1, 2, 3, 4, 5].map((i) => ({ type: "HARVEST_LOGGED", reason: `h${i}`, key: `pv2:batch:${RUN_TAG}:h${i}` })),
      )
      assert.equal(r.filter((x) => x.awarded).length, 6, "softcap batch: all six pay something")
      assert.equal((await pv2Profile(u))!.xp, 275, "softcap batch: 6×50 → 275")
      assert.equal((await getMasteryMap(u)).CULTIVATION, 275)
      // Sequential parity: the same awards run one-at-a-time give 275.
      const uSeq = await mkPv2("batchcapseq")
      for (let i = 0; i < 6; i++) {
        await awardProgression(uSeq, "HARVEST_LOGGED", `h${i}`, { key: `pv2:batchseq:${RUN_TAG}:${i}` })
      }
      assert.equal((await pv2Profile(uSeq))!.xp, 275, "sequential parity check")
    }

    // UPDATE_DAY daily cap — marker rows do not consume the slot, a second
    // paying candidate of the capped type inside one batch counts the first.
    {
      const u = await mkPv2("batchdaycap")
      const dayCap = XP_TABLE.UPDATE_DAY.dailyCap ?? 1
      const markers = Array.from({ length: 3 }, (_, i) => ({
        type: "UPDATE_DAY", reason: "withheld", key: `pv2:batch:${RUN_TAG}:w${i}`, xp: 0, marker: true,
      }))
      const payers = Array.from({ length: dayCap + 1 }, (_, i) => ({
        type: "UPDATE_DAY", reason: `d${i}`, key: `pv2:batch:${RUN_TAG}:p${i}`,
      }))
      const r = await awardProgressionBatch(u, [...markers, ...payers])
      const paid = r.filter((x) => x.awarded && (x.xp ?? 0) > 0).length
      assert.equal(paid, dayCap, "batch: daily cap enforced across in-batch candidates")
      assert.ok(r.filter((x) => x.skippedReason === "capped").length >= 1, "batch: overflow candidate capped")
      const markerRows = await prisma.progressionEvent.count({ where: { userId: u, xp: 0, standing: 0 } })
      assert.equal(markerRows, 3, "batch: markers write rows without paying")
    }

    // Multi-rung XP jump — one batch crossing several progression rungs
    // writes each milestone marker once and reports the rungs per candidate.
    {
      const u = await mkPv2("batchrung")
      const rung = 60
      const r = await awardProgressionBatch(u, [
        { type: "STAFF_ADJUSTMENT", reason: "jump", key: `pv2:batch:${RUN_TAG}:r1`, xp: rung, force: true },
        { type: "STAFF_ADJUSTMENT", reason: "jump2", key: `pv2:batch:${RUN_TAG}:r2`, xp: 40, force: true },
      ])
      assert.ok(r[0].awarded && r[1].awarded)
      // Snapshot semantics: both candidates see oldXp=0, so rung 60's marker
      // is written once (by the first candidate); the second dedupes in-tx.
      const markers = await prisma.progressionEvent.count({ where: { userId: u, key: `milestone:${u}:${rung}` } })
      assert.equal(markers, 1, "batch: rung marker written exactly once")
      assert.equal((await pv2Profile(u))!.xp, rung + 40)
      const tierNotifs = await prisma.notification.count({
        where: { userId: u, type: "REPUTATION", metadata: { path: ["kind"], equals: "tier" } },
      })
      assert.equal(tierNotifs, 1, "batch: one rank-up notification for the crossed rung")
    }

    // Reversed (non-final) keys reinstate through the per-award path while
    // fresh keys still batch — mixed batch handles both correctly.
    {
      const u = await mkPv2("batchrein")
      await awardProgression(u, "HARVEST_REPORT", "orig", { key: `pv2:batch:${RUN_TAG}:rev` })
      await reverseProgressionByKey(`pv2:batch:${RUN_TAG}:rev`, "retract")
      const xpBefore = (await pv2Profile(u))!.xp
      assert.equal(xpBefore, 0, "reversed pre-batch")
      const r = await awardProgressionBatch(u, [
        { type: "HARVEST_REPORT", reason: "re-earn", key: `pv2:batch:${RUN_TAG}:rev` },
        { type: "UPDATE_RICH", reason: "fresh", key: `pv2:batch:${RUN_TAG}:fresh` },
      ])
      assert.ok(r[0].awarded && r[0].reinstated, "batch: reversed key reinstates")
      assert.ok(r[1].awarded, "batch: fresh key pays")
      assert.equal((await pv2Profile(u))!.xp, XP_TABLE.HARVEST_REPORT.xp + XP_TABLE.UPDATE_RICH.xp)
    }

    // Transaction failure mid-batch → fallback path; earlier candidates pay
    // exactly once, the bad candidate errors, ledger stays consistent.
    {
      const u = await mkPv2("batchfail")
      // Non-serializable meta throws inside the tx on event create; the same
      // candidate fails identically on the sequential fallback path.
      const circular: Record<string, unknown> = {}
      circular.self = circular
      const r = await awardProgressionBatch(u, [
        { type: "UPDATE_RICH", reason: "good", key: `pv2:batch:${RUN_TAG}:ok` },
        { type: "UPDATE_RICH", reason: "bad", key: `pv2:batch:${RUN_TAG}:bad`, meta: circular },
        { type: "UPDATE_DAY", reason: "good2", key: `pv2:batch:${RUN_TAG}:ok2` },
      ])
      assert.ok(r[0].awarded, "fallback: good candidate before failure pays")
      assert.ok(r[2].awarded, "fallback: good candidate after failure pays")
      assert.ok(!r[1].awarded, "fallback: bad candidate does not pay")
      assert.equal((await pv2Profile(u))!.xp, XP_TABLE.UPDATE_RICH.xp + XP_TABLE.UPDATE_DAY.xp, "fallback: ledger consistent")
      const rows = await prisma.progressionEvent.findMany({ where: { userId: u, reversedAt: null }, select: { key: true } })
      const keys = rows.map((x) => x.key).sort()
      assert.equal(new Set(keys).size, keys.length, "fallback: no duplicate keys")
    }

    // Progression drift invariant on fixtures: xp == Σ ledger.
    for (const uid of pv2) {
      const p = await prisma.profile.findUnique({ where: { userId: uid }, select: { xp: true, standing: true } })
      const agg = await prisma.progressionEvent.aggregate({
        where: { userId: uid },
        _sum: { xp: true, standing: true },
      })
      assert.equal(p!.xp, agg._sum.xp ?? 0, `xp drift on ${uid}`)
      assert.equal(p!.standing, agg._sum.standing ?? 0, `standing drift on ${uid}`)
      const mastery = await prisma.masteryProgress.findMany({ where: { userId: uid } })
      const mSum = mastery.reduce((s, r) => s + r.xp, 0)
      assert.ok(mSum <= p!.xp + XP_TABLE.HARVEST_REPORT.xp + 50, `mastery sum sane on ${uid}`)
    }
    console.log("Progression V2 engine tests passed.")
  } finally {
    // AbuseFlag.userId is a bare string — no cascade, clean explicitly.
    await prisma.abuseFlag.deleteMany({
      where: { OR: [{ userId: { in: pv2 } }, { counterpartyId: { in: pv2 } }] },
    }).catch(() => {})
    await prisma.userAchievement.deleteMany({ where: { userId: { in: pv2 } } }).catch(() => {})
    await prisma.user.deleteMany({ where: { id: { in: pv2 } } }).catch(() => {})
    // Fixture achievement row — only remove if the test created it.
    if (!achFixtureExisted) await prisma.achievement.deleteMany({ where: { key: "greenlight" } }).catch(() => {})
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
