// Reputation & Rewards 3.0 regression tests — pure unit tests for the grow
// journey, weekly windows, chat gating and quest config, plus DB tests with
// disposable __test_r3_ users (cascade-deleted at the end).
// Run: npx tsx scripts/rewards3-tests.mts
import "./db-guard.mjs"
import { strict as assert } from "node:assert"
import { prisma } from "@/lib/prisma"
import { computeGrowJourney, GROW_STAGES, evaluateGrowJourney } from "@/lib/grow-journey"
import { weekRange, resolveWeeklyRecognition, weeklyBoard, GROWER_OF_THE_WEEK_REP } from "@/lib/weekly-recognition"
import { canAccessRoom, roomAccessInfo, GROW_ROOM_REP, GROW_ROOM_SLUG } from "@/lib/chat-access"
import { getJourneyState, evaluateJourneys } from "@/lib/journeys"
import { DAILY_QUEST_COUNT } from "@/lib/quests"
import { getReputationTier, getTierByName } from "@/lib/reputation-config"
import { SITE_SETTINGS } from "@/lib/settings"

const T = `__test_r3_${Date.now()}`
const DAY = 86400000

// ─── helpers ────────────────────────────────────────────────────────────
const daysAgo = (n: number) => new Date(Date.now() - n * DAY)

function fakeDiary(over: Partial<Parameters<typeof computeGrowJourney>[0]> = {}) {
  return {
    id: "d1",
    authorId: "u1",
    stage: "VEGETATIVE",
    startDate: daysAgo(40),
    createdAt: daysAgo(40),
    harvested: false,
    harvestedAt: null,
    yieldAmount: null,
    deleted: false,
    ...over,
  }
}

function fakeUpdate(over: Partial<Parameters<typeof computeGrowJourney>[1][number]> = {}) {
  return {
    createdAt: new Date(),
    stage: "VEGETATIVE",
    content: "a meaningful update with plenty of detail",
    temperature: null,
    humidity: null,
    vpd: null,
    ph: null,
    ec: null,
    feeding: null,
    training: null,
    images: [] as { id: string }[],
    ...over,
  }
}

function updatesOnDays(days: number[], over = {}) {
  return days.map((d) => fakeUpdate({ createdAt: daysAgo(d), ...over }))
}

async function makeUser(suffix: string, rep = 0) {
  return prisma.user.create({
    data: {
      name: `${T}_${suffix}`,
      ageVerified: true,
      sessionVersion: 1,
      profile: { create: { username: `${T}_${suffix}`, reputation: rep } },
    },
    select: { id: true },
  })
}

async function main() {
  console.log("Rewards 3.0 tests\n")

  // ─── Grow journey: pure derivation ──────────────────────────────────
  {
    // One-day fake diary: 5 same-day updates never advance the stage.
    const sameDay = computeGrowJourney(fakeDiary({ createdAt: daysAgo(1) }), updatesOnDays([0, 0, 0, 0, 0]))
    assert.equal(sameDay.stage, "PLANTED", "same-day burst stays planted")
    assert.equal(sameDay.meaningfulDays, 1, "same-day updates count once")

    // 3 meaningful days but only 4 elapsed — time gate holds.
    const tooYoung = computeGrowJourney(fakeDiary({ createdAt: daysAgo(4) }), updatesOnDays([4, 2, 0]))
    assert.equal(tooYoung.stage, "PLANTED", "elapsed-day gate blocks established")

    // 3 meaningful days + 8 elapsed → ESTABLISHED.
    const est = computeGrowJourney(fakeDiary({ createdAt: daysAgo(8) }), updatesOnDays([8, 4, 0]))
    assert.equal(est.stage, "ESTABLISHED")

    // 10 meaningful days + 22 elapsed → VEGGING.
    const veg = computeGrowJourney(
      fakeDiary({ createdAt: daysAgo(22) }),
      updatesOnDays([22, 20, 18, 16, 14, 12, 10, 8, 6, 2])
    )
    assert.equal(veg.stage, "VEGGING")

    // Filler content doesn't count as meaningful.
    const filler = computeGrowJourney(
      fakeDiary({ createdAt: daysAgo(30) }),
      updatesOnDays([30, 25, 20, 15, 10, 5, 1], { content: "hi" })
    )
    assert.equal(filler.stage, "PLANTED", "sub-10-char updates are not meaningful")

    // Environmental-only update IS meaningful.
    const envOnly = computeGrowJourney(
      fakeDiary({ createdAt: daysAgo(8) }),
      [fakeUpdate({ createdAt: daysAgo(8), content: "", temperature: 24 }),
       fakeUpdate({ createdAt: daysAgo(4), content: "", humidity: 60 }),
       fakeUpdate({ createdAt: daysAgo(1), content: "", ph: 6.1 })]
    )
    assert.equal(envOnly.stage, "ESTABLISHED", "env readings count as meaningful")

    // Flowering needs the flower-stage gate: diary flipped to FLOWER with
    // 5 meaningful flower-stage days.
    const flower = computeGrowJourney(
      fakeDiary({ createdAt: daysAgo(30), stage: "FLOWER" }),
      updatesOnDays([30, 28, 26, 24, 22], { stage: "FLOWER" })
    )
    assert.equal(flower.stage, "FLOWERING")
    assert.equal(flower.flowerDays, 5)

    // Veg-stage updates on a flower-flipped diary don't open the gate —
    // they still legitimately reach ESTABLISHED but never FLOWERING.
    const notFlower = computeGrowJourney(
      fakeDiary({ createdAt: daysAgo(30), stage: "FLOWER" }),
      updatesOnDays([30, 28, 26, 24, 22])
    )
    assert.equal(notFlower.stage, "ESTABLISHED", "flower gate requires FLOWER-stage updates")

    // Harvested → HARVESTED; + yield + 30 elapsed days → COMPLETE.
    const harv = computeGrowJourney(fakeDiary({ harvested: true, harvestedAt: daysAgo(2) }), [])
    assert.equal(harv.stage, "HARVESTED")
    const done = computeGrowJourney(
      fakeDiary({ harvested: true, harvestedAt: daysAgo(2), yieldAmount: 420 }),
      []
    )
    assert.equal(done.stage, "COMPLETE")
    const noYield = computeGrowJourney(fakeDiary({ harvested: true, harvestedAt: daysAgo(2) }), [])
    assert.equal(noYield.stage, "HARVESTED", "no yield → not complete")

    // Back-dated startDate cannot skip the elapsed gates (createdAt rules).
    const backdated = computeGrowJourney(
      fakeDiary({ createdAt: daysAgo(1), startDate: daysAgo(90) }),
      updatesOnDays([0, 0, 0])
    )
    assert.equal(backdated.stage, "PLANTED", "startDate back-dating can't farm elapsed days")

    console.log("grow journey: pure derivation ok")
  }

  // ─── Weekly windows ─────────────────────────────────────────────────
  {
    const w1 = weekRange("2026-W01")!
    assert.equal(w1.start.toISOString().slice(0, 10), "2025-12-29", "ISO week 1 starts Monday")
    assert.equal(w1.end.getTime() - w1.start.getTime(), 7 * DAY)
    assert.equal(weekRange("2026-W54"), null)
    assert.equal(weekRange("garbage"), null)
    const w53 = weekRange("2026-W53")!
    assert.ok(w53.end.getTime() - w53.start.getTime() === 7 * DAY)
    console.log("weekly windows ok")
  }

  // ─── Config invariants ──────────────────────────────────────────────
  {
    assert.equal(DAILY_QUEST_COUNT, 2, "two daily quests")
    assert.equal(GROW_ROOM_REP, 3500, "grow room at Cultivator")
    assert.equal(getReputationTier(3500).name, "Cultivator")
    assert.equal(GROW_ROOM_SLUG, "grow-room")
    assert.ok(GROW_STAGES[GROW_STAGES.length - 1].key === "COMPLETE")
    console.log("config invariants ok")
  }

  // ─── DB: chat room access ───────────────────────────────────────────
  const member = await makeUser("member", 0)
  const cultivator = await makeUser("cultivator", GROW_ROOM_REP)
  const staff = await prisma.user.create({
    data: {
      name: `${T}_staff`,
      role: "MODERATOR",
      ageVerified: true,
      sessionVersion: 1,
      profile: { create: { username: `${T}_staff` } },
    },
    select: { id: true },
  })
  const flagRow = await prisma.setting.findUnique({ where: { key: SITE_SETTINGS.GROW_ROOM_ENABLED } })

  try {
    const open = { isPrivate: false, requiredRep: null }
    const priv = { isPrivate: true, requiredRep: null }
    const gated = { isPrivate: false, requiredRep: GROW_ROOM_REP }

    // Open room: everyone.
    assert.equal(await canAccessRoom(member.id, open), true)
    // Private room: staff only (existing semantic).
    assert.equal(await canAccessRoom(member.id, priv), false)
    assert.equal(await canAccessRoom(staff.id, priv), true)

    // Gated room with flag OFF: nobody but staff — room can't open early.
    await prisma.setting.upsert({
      where: { key: SITE_SETTINGS.GROW_ROOM_ENABLED },
      create: { key: SITE_SETTINGS.GROW_ROOM_ENABLED, value: "false" },
      update: { value: "false" },
    })
    assert.equal(await canAccessRoom(cultivator.id, gated), false, "flag off locks the room")
    assert.equal(await canAccessRoom(staff.id, gated), true, "staff always pass for moderation")

    // Flag ON: rep gate applies.
    await prisma.setting.update({ where: { key: SITE_SETTINGS.GROW_ROOM_ENABLED }, data: { value: "true" } })
    assert.equal(await canAccessRoom(member.id, gated), false, "under threshold denied")
    assert.equal(await canAccessRoom(cultivator.id, gated), true, "at threshold allowed")
    assert.equal((await roomAccessInfo(member.id, gated)).reason, "rep")
    assert.equal((await roomAccessInfo(cultivator.id, gated)).reason, "rep")

    console.log("chat room access ok")
  } finally {
    if (flagRow) {
      await prisma.setting.upsert({
        where: { key: SITE_SETTINGS.GROW_ROOM_ENABLED },
        create: { key: SITE_SETTINGS.GROW_ROOM_ENABLED, value: flagRow.value },
        update: { value: flagRow.value },
      })
    } else {
      await prisma.setting.delete({ where: { key: SITE_SETTINGS.GROW_ROOM_ENABLED } }).catch(() => {})
    }
  }

  // ─── DB: weekly board nets reversals ────────────────────────────────
  // Reversal rows are signed negative counter-entries — they must subtract
  // from the weekly sum. Uses a deep-past week no real member can contest.
  const wkNet = "2020-W11"
  const netRange = weekRange(wkNet)!
  const netAt = (d: number) => new Date(netRange.start.getTime() + d * DAY)
  const wUsers = {
    full: await makeUser("wfull", 0),
    partial: await makeUser("wpartial", 0),
    multi: await makeUser("wmulti", 0),
    excl: await makeUser("wexcl", 0),
    gross: await makeUser("wgross", 0),
    net: await makeUser("wnet", 0),
  }
  try {
    const ev = (userId: string, type: string, amount: number, key: string, day = 1) =>
      prisma.reputationEvent.create({
        data: { userId, type, amount, reason: "test", key: `${T}:${key}`, createdAt: netAt(day) },
      })
    // +100 then -100 reversal → net 0 (dropped from board entirely)
    await ev(wUsers.full.id, "POST_CREATED", 100, "f1")
    await ev(wUsers.full.id, "REVERSAL", -100, "f2", 2)
    // +100 then -40 reversal → net 60
    await ev(wUsers.partial.id, "POST_CREATED", 100, "p1")
    await ev(wUsers.partial.id, "REVERSAL", -40, "p2", 2)
    // +100 +50 -25 → net 125
    await ev(wUsers.multi.id, "POST_CREATED", 100, "m1")
    await ev(wUsers.multi.id, "POST_CREATED", 50, "m2")
    await ev(wUsers.multi.id, "REVERSAL", -25, "m3", 2)
    // Excluded types must not count: +100 earned + 1000 staff adj + milestone
    await ev(wUsers.excl.id, "POST_CREATED", 100, "e1")
    await ev(wUsers.excl.id, "STAFF_ADJUSTMENT", 1000, "e2")
    await ev(wUsers.excl.id, "MILESTONE", 0, "e3")
    // Winner check: gross 1000 reversed down to 300 loses to a clean 500
    await ev(wUsers.gross.id, "POST_CREATED", 1000, "g1")
    await ev(wUsers.gross.id, "REVERSAL", -700, "g2", 2)
    await ev(wUsers.net.id, "POST_CREATED", 500, "n1")

    const board = await weeklyBoard(netRange.start, netRange.end)
    const earned = (id: string) => board.find((r) => r.userId === id)?.earned
    assert.equal(earned(wUsers.full.id), undefined, "fully reversed user drops off board")
    assert.equal(earned(wUsers.partial.id), 60, "partial reversal nets")
    assert.equal(earned(wUsers.multi.id), 125, "multiple events net")
    assert.equal(earned(wUsers.excl.id), 100, "excluded types still excluded")
    assert.equal(earned(wUsers.gross.id), 300, "gross-vs-net ordering uses net")
    assert.equal(earned(wUsers.net.id), 500)

    const winner = await resolveWeeklyRecognition(wkNet)
    assert.equal(winner?.userId, wUsers.net.id, "winner is highest NET earner, not gross")
    console.log("weekly reversal netting ok")
  } finally {
    for (const u of Object.values(wUsers)) await prisma.user.delete({ where: { id: u.id } }).catch(() => {})
  }

  // ─── DB: weekly award idempotency ───────────────────────────────────
  const weeklyUser = await makeUser("weekly", 0)
  try {
    // Pick a deep-past week so no real member competes.
    const wk = "2020-W10"
    const range = weekRange(wk)!
    await prisma.reputationEvent.create({
      data: {
        userId: weeklyUser.id,
        type: "POST_CREATED",
        amount: 500,
        reason: "test weekly win",
        key: `${T}:weekly-seed`,
        createdAt: new Date(range.start.getTime() + DAY),
      },
    })
    const w1 = await resolveWeeklyRecognition(wk)
    assert.equal(w1?.userId, weeklyUser.id, "weekly winner resolved")
    const award = await prisma.reputationEvent.findUnique({
      where: { key: `weekly:gotw:${wk}:${weeklyUser.id}` },
    })
    assert.ok(award && award.amount === GROWER_OF_THE_WEEK_REP && !award.reversedAt, "weekly award paid")
    const badge = await prisma.userBadge.findFirst({
      where: { userId: weeklyUser.id, badge: { name: "Grower of the Week" } },
    })
    assert.ok(badge, "Grower of the Week badge granted")
    // Re-run: keyed award can't double-pay, badge can't duplicate.
    const w2 = await resolveWeeklyRecognition(wk)
    assert.equal(w2?.userId, weeklyUser.id)
    assert.equal(
      await prisma.reputationEvent.count({ where: { key: `weekly:gotw:${wk}:${weeklyUser.id}` } }),
      1,
      "weekly award idempotent"
    )
    assert.equal(
      await prisma.userBadge.count({ where: { userId: weeklyUser.id, badge: { name: "Grower of the Week" } } }),
      1,
      "badge idempotent"
    )
    console.log("weekly recognition ok")
  } finally {
    await prisma.user.delete({ where: { id: weeklyUser.id } }).catch(() => {})
  }

  // ─── DB: grow journey milestone awards + clawback ───────────────────
  const grower = await makeUser("grower", 0)
  let diaryId = ""
  try {
    const diary = await prisma.growDiary.create({
      data: {
        title: `${T} diary`,
        description: "test grow",
        growType: "INDOOR",
        startDate: daysAgo(8),
        authorId: grower.id,
        stage: "VEGETATIVE",
      },
      select: { id: true },
    })
    diaryId = diary.id
    // Back-date the diary row so the elapsed gate is satisfied.
    await prisma.growDiary.update({ where: { id: diaryId }, data: { createdAt: daysAgo(8) } })
    for (const d of [8, 4, 0]) {
      await prisma.diaryUpdate.create({
        data: {
          title: "update",
          content: "a meaningful update with plenty of detail",
          stage: "VEGETATIVE",
          diaryId,
          authorId: grower.id,
          createdAt: daysAgo(d),
        },
      })
    }
    await evaluateGrowJourney(diaryId)
    const ev1 = await prisma.reputationEvent.findUnique({
      where: { key: `growstage:${diaryId}:ESTABLISHED:${grower.id}` },
    })
    assert.ok(ev1 && ev1.amount === 10 && !ev1.reversedAt, "ESTABLISHED milestone paid")
    // Idempotent: second evaluation doesn't double-pay.
    await evaluateGrowJourney(diaryId)
    const count = await prisma.reputationEvent.count({
      where: { key: `growstage:${diaryId}:ESTABLISHED:${grower.id}` },
    })
    assert.equal(count, 1, "milestone keyed/idempotent")

    // Delete the updates → stage regresses → milestone clawed back.
    await prisma.diaryUpdate.deleteMany({ where: { diaryId } })
    await evaluateGrowJourney(diaryId)
    const ev2 = await prisma.reputationEvent.findUnique({
      where: { key: `growstage:${diaryId}:ESTABLISHED:${grower.id}` },
    })
    assert.ok(ev2!.reversedAt, "regressed milestone reversed")

    console.log("grow journey awards + clawback ok")
  } finally {
    if (diaryId) await prisma.growDiary.delete({ where: { id: diaryId } }).catch(() => {})
    await prisma.user.delete({ where: { id: grower.id } }).catch(() => {})
  }

  // ─── DB: Getting Rooted journey ─────────────────────────────────────
  const rookie = await makeUser("rookie", 0)
  try {
    const s0 = await getJourneyState(rookie.id)
    assert.ok(s0 && !s0.complete && s0.doneCount === 0, "fresh member at step 0")
    await evaluateJourneys(rookie.id, s0)
    assert.equal((await prisma.profile.findUnique({ where: { userId: rookie.id } }))!.reputation, 0, "no award before completion")

    // Walk every step: onboarding, thread, like, diary, update, Sprout rep.
    await prisma.user.update({ where: { id: rookie.id }, data: { onboardingCompletedAt: new Date() } })
    const cat = await prisma.category.findFirst({ select: { id: true } })
    if (cat) {
      await prisma.thread.create({
        data: {
          title: `${T} thread`,
          slug: `${T}-thread`,
          content: "hello forum, this is a real first post body",
          categoryId: cat.id,
          authorId: rookie.id,
        },
      })
    }
    const diary = await prisma.growDiary.create({
      data: {
        title: `${T} diary`,
        description: "test grow",
        growType: "INDOOR",
        startDate: new Date(),
        authorId: rookie.id,
      },
      select: { id: true },
    })
    await prisma.diaryUpdate.create({
      data: { title: "u", content: "first real update body", stage: "GERMINATION", diaryId: diary.id, authorId: rookie.id },
    })
    await prisma.reaction.create({ data: { userId: rookie.id, type: "LIKE", diaryId: diary.id } })
    // Seed Sprout-level rep through a real ledger row.
    const sprout = getTierByName("Sprout")!.threshold
    await prisma.reputationEvent.create({
      data: { userId: rookie.id, type: "STAFF_ADJUSTMENT", amount: sprout, reason: "test seed", key: `${T}:seed` },
    })
    await prisma.profile.update({ where: { userId: rookie.id }, data: { reputation: sprout } })

    const s1 = await getJourneyState(rookie.id)
    assert.ok(s1, "journey state derived")
    if (cat) assert.equal(s1!.complete, true, `all steps done (got ${s1!.doneCount}/${s1!.steps.length})`)
    await evaluateJourneys(rookie.id, s1)
    await evaluateJourneys(rookie.id, s1) // idempotent
    const journeyEvents = await prisma.reputationEvent.count({
      where: { key: `journey:getting-rooted:${rookie.id}` },
    })
    assert.equal(journeyEvents, 1, "journey completion keyed/idempotent")
    const journeyAward = await prisma.reputationEvent.findUnique({
      where: { key: `journey:getting-rooted:${rookie.id}` },
    })
    assert.equal(journeyAward!.amount, 25, "journey bundle paid once")

    console.log("getting rooted journey ok")
  } finally {
    await prisma.user.delete({ where: { id: rookie.id } }).catch(() => {})
  }

  // ─── cleanup ────────────────────────────────────────────────────────
  for (const id of [member.id, cultivator.id, staff.id]) {
    await prisma.user.delete({ where: { id } }).catch(() => {})
  }

  console.log("\nAll Rewards 3.0 tests passed.")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
