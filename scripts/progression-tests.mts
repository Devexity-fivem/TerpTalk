// Progression 2.0 tests — daily quest determinism/selection, trust standing
// math, badge registry integrity (hidden badges, bonuses), and DB-backed
// checks for keyed quest payouts + trust-score filtering against a
// disposable __test_prog_ user (cascade-deleted at the end).
// Run: npx tsx scripts/progression-tests.mts
import { strict as assert } from "node:assert"
import { prisma } from "@/lib/prisma"
import {
  REP_POINTS,
  BADGE_BONUS,
  TRUST_EVENT_TYPES,
  TRUST_STANDINGS,
  PUBLIC_REP_TYPES,
  getTrustStanding,
  getNextTrustStanding,
  publicRepLabel,
} from "@/lib/reputation-config"
import { DAILY_QUESTS, DAILY_QUEST_COUNT, PERFECT_DAY_BONUS, dailyQuestsFor, currentDayKey, getQuestProgress, evaluateQuests } from "@/lib/quests"
import { BADGE_REGISTRY, getBadgeByName, STAFF_AWARDED_BADGES } from "@/lib/badge-registry"
import { awardReputation, getTrustScore } from "@/lib/reputation"
import { WEEKLY_CHALLENGES } from "@/lib/challenges"

const TEST_USERNAME = `__test_prog_${Date.now()}`

async function run() {
  console.log("── quest selection ──")

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
  const slugs = new Set(DAILY_QUESTS.map((q) => q.slug))
  assert.equal(slugs.size, DAILY_QUESTS.length, "duplicate quest slugs")
  for (const q of DAILY_QUESTS) {
    assert.ok(q.reward > 0 && q.reward <= 15, `quest ${q.slug} reward out of band`)
    assert.ok(q.target >= 1 && q.target <= 3, `quest ${q.slug} target too grindy`)
    assert.ok(!/posts?$/i.test(q.description), `quest ${q.slug} looks like volume farming`)
  }
  // Daily income ceiling stays far under the velocity flag.
  const maxDaily = DAILY_QUEST_COUNT * Math.max(...DAILY_QUESTS.map((q) => q.reward)) + PERFECT_DAY_BONUS
  assert.ok(maxDaily <= 50, `daily quest ceiling ${maxDaily} too high`)

  console.log("── trust standing ──")

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

  console.log("── badge registry integrity ──")

  const names = new Set<string>()
  for (const b of BADGE_REGISTRY) {
    assert.ok(!names.has(b.name), `duplicate badge ${b.name}`)
    names.add(b.name)
    assert.ok(b.description.length > 0 && b.requirement.length > 0, `badge ${b.name} missing copy`)
    assert.ok(BADGE_BONUS[b.rarity] != null, `badge ${b.name} has unknown rarity ${b.rarity}`)
  }
  // Hidden badges exist and stay secret-shaped.
  const hidden = BADGE_REGISTRY.filter((b) => b.hidden)
  assert.ok(hidden.length >= 3, "expected a small set of hidden discovery badges")
  for (const b of hidden) {
    assert.equal(b.requirement, "???", `hidden badge ${b.name} leaks its requirement`)
  }
  // Referenced stats keys exist on the UserStats shape used by getUserStats.
  const { BADGE_RULES } = await import("@/lib/reputation")
  for (const b of BADGE_REGISTRY) {
    if (b.progress) assert.ok(BADGE_RULES[b.name] || b.hidden, `progress badge ${b.name} has no rule`)
  }
  // getBadgeByName resolves every registry entry.
  for (const b of BADGE_REGISTRY) assert.equal(getBadgeByName(b.name)?.name, b.name)

  console.log("── challenges ──")
  const cslugs = new Set(WEEKLY_CHALLENGES.map((c) => c.slug))
  assert.equal(cslugs.size, WEEKLY_CHALLENGES.length, "duplicate challenge slugs")
  for (const c of WEEKLY_CHALLENGES) {
    assert.ok(c.reward > 0 && c.target >= 1, `challenge ${c.slug} malformed`)
  }

  console.log("── DB: keyed quest payouts + trust filtering ──")

  // Fixture user. Production-safe: __test_ prefix, fully cascade-deleted.
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
    const dayKey = currentDayKey()

    // Keyed quest payout: award once, second call is a no-op. (Other
    // awards may fire as side-effects — e.g. the Early Supporter badge
    // bonus — so we assert on the specific event, not the total.)
    const key = `quest:${dayKey}:lend-a-hand:${uid}`
    const a1 = await awardReputation(uid, "QUEST_DAILY", 8, "Daily quest: Lend a Hand", { key })
    const a2 = await awardReputation(uid, "QUEST_DAILY", 8, "Daily quest: Lend a Hand", { key })
    assert.equal(a1.awarded, true)
    assert.equal(a2.awarded, false)
    const questEvents = await prisma.reputationEvent.count({ where: { userId: uid, key } })
    assert.equal(questEvents, 1, "duplicate keyed quest payout")

    // Self-driven events advance progression but NOT trust standing.
    assert.equal(await getTrustScore(uid), 0)

    // Peer-validated events DO count.
    await awardReputation(uid, "LIKE_RECEIVED", 2, "test like", {
      key: `test:like:${uid}`,
      actorId: "someone-else",
    })
    assert.equal(await getTrustScore(uid), 2)
    assert.equal(getTrustStanding(2).name, "Unrooted")

    // Quest progress is server-derived — a fresh user has zero progress and
    // nothing paid. evaluateQuests on zero progress pays nothing.
    const progress = await getQuestProgress(uid)
    assert.equal(progress.length, DAILY_QUEST_COUNT)
    for (const q of progress) {
      // green-thumb legitimately ticks from the LIKE_RECEIVED awarded above —
      // every other quest's inputs are still untouched.
      assert.equal(q.progress, q.slug === "green-thumb" ? 1 : 0)
      assert.equal(q.done, false)
      // lend-a-hand may or may not be selected; paid only when selected+paid.
      if (q.slug === "lend-a-hand") assert.equal(q.paid, true)
    }
    const paid = await evaluateQuests(uid)
    assert.deepEqual(paid, [], "no quests should pay with zero qualifying activity")

    // PUBLIC_REP_TYPES covers quest payouts so they show on the public
    // history with a safe label (not the raw reason string).
    assert.ok(PUBLIC_REP_TYPES.has("QUEST_DAILY"))
    assert.equal(publicRepLabel("QUEST_DAILY"), "Daily quest completed")

    console.log("── all progression tests passed ──")
  } finally {
    await prisma.user.delete({ where: { id: uid } }).catch(() => {})
    await prisma.$disconnect()
  }
}

run().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect().catch(() => {})
  process.exit(1)
})
