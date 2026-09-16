// Growth Analytics v1 regression tests — growthSummary, stageDurations,
// lean height-series query, and privacy boundaries.
// Run: npx tsx scripts/growth-analytics-tests.mts   (dev DB only — guarded)
import "./db-guard.mjs"
import { strict as assert } from "node:assert"
import { prisma } from "@/lib/prisma"
import { growthSummary, stageDurations } from "@/lib/diary-weeks"

const tag = Date.now().toString(36)
const results: [string, string][] = []
const pass = (n: string) => { results.push(["PASS", n]); console.log(`  ✓ ${n}`) }
const fail = (n: string, i: unknown) => { results.push(["FAIL", n]); console.log(`  ✗ ${n} — ${JSON.stringify(i)?.slice(0, 300)}`) }
const check = (n: string, fn: () => Promise<void> | void) =>
  Promise.resolve()
    .then(fn)
    .then(() => pass(n))
    .catch((e) => fail(n, e instanceof Error ? e.message : e))

const cleanup = { userIds: [] as string[], diaryIds: [] as string[] }

async function mkUser(name: string) {
  const u = await prisma.user.create({
    data: {
      name: `__test_ga_${name}_${tag}`,
      ageVerified: true,
      password: "x",
      sessionVersion: 1,
      profile: { create: { username: `__test_ga_${name}_${tag}` } },
    },
  })
  cleanup.userIds.push(u.id)
  return u
}

const DAY = 86400000
const base = new Date("2026-01-01T00:00:00Z").getTime()
const d = (days: number, h = 0) => new Date(base + days * DAY + h * 3600000)
const upd = (days: number, stage = "VEGETATIVE", heightCm: number | null = null, h = 0) =>
  ({ createdAt: d(days, h), stage, heightCm })
const diary = { startDate: d(0), harvested: false }
const NOW = d(30)

// ─── growthSummary ───────────────────────────────────────────────────
await check("growthSummary: zero measurements", () => {
  const s = growthSummary(diary, [], NOW)
  assert.equal(s.measurements, 0)
  assert.equal(s.currentHeight, null)
  assert.equal(s.delta, null)
  assert.equal(s.latestAt, null)
  assert.equal(s.totalDays, 31)
})

await check("growthSummary: one measurement — height + day, no delta", () => {
  const s = growthSummary(diary, [upd(10, "VEGETATIVE", 20)], NOW)
  assert.equal(s.measurements, 1)
  assert.equal(s.currentHeight, 20)
  assert.equal(s.previousHeight, null)
  assert.equal(s.delta, null)
  assert.equal(s.deltaDays, null)
  assert.equal(s.latestDay, 11) // day 0 = day 1
  assert.equal(s.latestWeek, 2)
})

await check("growthSummary: two measurements — delta + days between", () => {
  const s = growthSummary(diary, [upd(20, "FLOWER", 55), upd(10, "VEGETATIVE", 20)], NOW)
  assert.equal(s.measurements, 2)
  assert.equal(s.currentHeight, 55, "latest by createdAt, not array order")
  assert.equal(s.previousHeight, 20)
  assert.equal(s.delta, 35)
  assert.equal(s.deltaDays, 10)
  assert.equal(s.latestDay, 21)
})

await check("growthSummary: null heights are excluded", () => {
  const s = growthSummary(diary, [upd(5, "VEGETATIVE", null), upd(10, "VEGETATIVE", 20), upd(15, "VEGETATIVE", null)], NOW)
  assert.equal(s.measurements, 1)
  assert.equal(s.currentHeight, 20)
  assert.equal(s.latestDay, 11)
})

await check("growthSummary: same-day measurements → deltaDays 0, no rate invented", () => {
  const s = growthSummary(diary, [upd(10, "VEGETATIVE", 20, 9), upd(10, "VEGETATIVE", 23, 15)], NOW)
  assert.equal(s.measurements, 2)
  assert.equal(s.delta, 3)
  assert.equal(s.deltaDays, 0)
})

await check("growthSummary: harvested grow caps totalDays at harvest day", () => {
  const harvested = { startDate: d(0), harvested: true, harvestedAt: d(25) }
  const s = growthSummary(harvested, [upd(10, "FLOWER", 40)], d(90))
  assert.equal(s.totalDays, 26, "harvest day 25 = day 26; now (day 90) ignored")
})

await check("growthSummary: negative delta is reported honestly", () => {
  const s = growthSummary(diary, [upd(10, "VEGETATIVE", 50), upd(15, "VEGETATIVE", 45)], NOW)
  assert.equal(s.delta, -5)
})

// ─── stageDurations ──────────────────────────────────────────────────
await check("stageDurations: no updates → empty", () => {
  assert.deepEqual(stageDurations(diary, [], NOW), [])
})

await check("stageDurations: single stage extends through now", () => {
  const runs = stageDurations(diary, [upd(5, "VEGETATIVE", null)], NOW)
  assert.deepEqual(runs, [{ stage: "VEGETATIVE", days: 26 }]) // day 6 → day 31 inclusive
})

await check("stageDurations: transition splits days correctly", () => {
  const runs = stageDurations(diary, [upd(0, "GERMINATION"), upd(7, "VEGETATIVE"), upd(21, "FLOWER")], NOW)
  assert.deepEqual(runs, [
    { stage: "GERMINATION", days: 7 },   // day 1 → day 7
    { stage: "VEGETATIVE", days: 14 },   // day 8 → day 21
    { stage: "FLOWER", days: 10 },       // day 22 → day 31
  ])
  assert.equal(runs.reduce((a, r) => a + r.days, 0), 31, "no double-counted days")
})

await check("stageDurations: same-day stage switch omits the zero-day stage", () => {
  const runs = stageDurations(diary, [upd(5, "VEGETATIVE", null, 9), upd(5, "FLOWER", null, 15)], NOW)
  assert.deepEqual(runs, [{ stage: "FLOWER", days: 26 }], "VEGETATIVE got <1 day → omitted")
})

await check("stageDurations: re-entered stage produces separate segments", () => {
  const runs = stageDurations(diary, [upd(0, "VEGETATIVE"), upd(7, "FLOWER"), upd(14, "VEGETATIVE")], NOW)
  assert.deepEqual(runs.map((r) => r.stage), ["VEGETATIVE", "FLOWER", "VEGETATIVE"])
  assert.equal(runs[0].days, 7)
  assert.equal(runs[2].days, 17)
})

await check("stageDurations: harvested grow ends at harvest day", () => {
  const harvested = { startDate: d(0), harvested: true, harvestedAt: d(20) }
  const runs = stageDurations(harvested, [upd(0, "VEGETATIVE"), upd(10, "FLOWER")], d(90))
  assert.deepEqual(runs, [
    { stage: "VEGETATIVE", days: 10 },
    { stage: "FLOWER", days: 11 }, // day 11 → day 21 (harvest day inclusive)
  ])
})

await check("stageDurations: irregular spacing and out-of-order input handled", () => {
  const runs = stageDurations(diary, [upd(25, "FLOWER"), upd(2, "VEGETATIVE")], NOW)
  assert.deepEqual(runs, [
    { stage: "VEGETATIVE", days: 23 }, // day 3 → day 25
    { stage: "FLOWER", days: 6 },
  ])
})

await check("stageDurations: no negative or duplicated durations", () => {
  const runs = stageDurations(diary, [upd(1, "SEEDLING"), upd(1, "SEEDLING"), upd(1, "VEGETATIVE", null, 3)], NOW)
  assert.ok(runs.every((r) => r.days > 0), "all runs positive")
  assert.deepEqual(runs.map((r) => r.stage), ["VEGETATIVE"], "same-day SEEDLING blip omitted")
})

// ─── Lean height-series query (DB) ───────────────────────────────────
await check("lean height query: null heights excluded, createdAt ordering, minimal fields", async () => {
  const u = await mkUser("lean")
  const dr = await prisma.growDiary.create({
    data: { title: `__test_ga_d_${tag}`, description: "", growType: "INDOOR", startDate: d(0), authorId: u.id },
  })
  cleanup.diaryIds.push(dr.id)
  await prisma.diaryUpdate.createMany({
    data: [
      { diaryId: dr.id, authorId: u.id, title: "a", content: "x".repeat(12), stage: "VEGETATIVE", createdAt: d(5), heightCm: null },
      { diaryId: dr.id, authorId: u.id, title: "b", content: "x".repeat(12), stage: "VEGETATIVE", createdAt: d(12), heightCm: 30, dayNumber: 999 }, // wrong dayNumber must not matter
      { diaryId: dr.id, authorId: u.id, title: "c", content: "x".repeat(12), stage: "FLOWER", createdAt: d(20), heightCm: 55 },
      { diaryId: dr.id, authorId: u.id, title: "d", content: "x".repeat(12), stage: "FLOWER", createdAt: d(8), heightCm: 22 },
    ],
  })
  // Replica of the page's lean query.
  const rows = await prisma.diaryUpdate.findMany({
    where: { diaryId: dr.id },
    select: { id: true, createdAt: true, stage: true, heightCm: true },
    orderBy: { createdAt: "asc" },
    take: 500,
  })
  const heights = rows.filter((r) => r.heightCm != null)
  assert.deepEqual(heights.map((r) => r.heightCm), [22, 30, 55], "createdAt order, not dayNumber")
  assert.ok(!("content" in rows[0]) && !("images" in rows[0]), "minimal fields only")
  const s = growthSummary(dr, rows, NOW)
  assert.equal(s.currentHeight, 55)
  assert.equal(s.latestDay, 21, "diaryDay derived from createdAt vs startDate")
})

await check("lean height query: long grows exceed the 100-update timeline cap", async () => {
  const u = await mkUser("long")
  const dr = await prisma.growDiary.create({
    data: { title: `__test_ga_l_${tag}`, description: "", growType: "INDOOR", startDate: d(0), authorId: u.id },
  })
  cleanup.diaryIds.push(dr.id)
  // 105 updates; only the first carries a height — the take:100 timeline
  // payload would miss it entirely.
  await prisma.diaryUpdate.createMany({
    data: [
      { diaryId: dr.id, authorId: u.id, title: "h", content: "x".repeat(12), stage: "SEEDLING", createdAt: d(1), heightCm: 5 },
      ...Array.from({ length: 104 }, (_, i) => ({
        diaryId: dr.id, authorId: u.id, title: `u${i}`, content: "x".repeat(12),
        stage: "VEGETATIVE", createdAt: d(2 + Math.floor(i / 3), (i % 3) * 8),
      })),
    ],
  })
  const capped = await prisma.diaryUpdate.findMany({
    where: { diaryId: dr.id }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, heightCm: true },
  })
  assert.equal(capped.length, 100)
  assert.ok(!capped.some((r) => r.heightCm != null), "the take:100 payload misses the early height")
  const lean = await prisma.diaryUpdate.findMany({
    where: { diaryId: dr.id }, select: { id: true, createdAt: true, stage: true, heightCm: true },
    orderBy: { createdAt: "asc" }, take: 500,
  })
  assert.ok(lean.some((r) => r.heightCm === 5), "lean query still sees the early measurement")
})

// ─── Privacy / lifecycle ─────────────────────────────────────────────
await check("deleted diary rows stay out of page semantics; deleted updates vanish", async () => {
  const u = await mkUser("priv")
  const dr = await prisma.growDiary.create({
    data: { title: `__test_ga_p_${tag}`, description: "", growType: "INDOOR", startDate: d(0), authorId: u.id },
  })
  cleanup.diaryIds.push(dr.id)
  const up = await prisma.diaryUpdate.create({
    data: { diaryId: dr.id, authorId: u.id, title: "h", content: "x".repeat(12), stage: "VEGETATIVE", createdAt: d(3), heightCm: 12 },
  })
  // Mirror getDiaryData's guard.
  const loaded = await prisma.growDiary.findUnique({ where: { id: dr.id }, select: { deleted: true } })
  assert.equal(loaded?.deleted, false)
  await prisma.growDiary.update({ where: { id: dr.id }, data: { deleted: true } })
  const gone = await prisma.growDiary.findFirst({ where: { id: dr.id, deleted: false } })
  assert.equal(gone, null, "deleted diary must 404 — analytics unreachable")
  await prisma.diaryUpdate.delete({ where: { id: up.id } })
  const remaining = await prisma.diaryUpdate.count({ where: { diaryId: dr.id } })
  assert.equal(remaining, 0, "hard-deleted update leaves no analytics residue")
})

await check("analytics never combine two diaries' updates", async () => {
  const u = await mkUser("cross")
  const a = await prisma.growDiary.create({ data: { title: `__test_ga_a_${tag}`, description: "", growType: "INDOOR", startDate: d(0), authorId: u.id } })
  const b = await prisma.growDiary.create({ data: { title: `__test_ga_b_${tag}`, description: "", growType: "INDOOR", startDate: d(0), authorId: u.id } })
  cleanup.diaryIds.push(a.id, b.id)
  await prisma.diaryUpdate.createMany({
    data: [
      { diaryId: a.id, authorId: u.id, title: "a", content: "x".repeat(12), stage: "VEGETATIVE", createdAt: d(4), heightCm: 10 },
      { diaryId: b.id, authorId: u.id, title: "b", content: "x".repeat(12), stage: "VEGETATIVE", createdAt: d(4), heightCm: 99 },
    ],
  })
  const rows = await prisma.diaryUpdate.findMany({ where: { diaryId: a.id, heightCm: { not: null } }, select: { heightCm: true } })
  assert.deepEqual(rows.map((r) => r.heightCm), [10], "other diary's data never leaks into the series")
})

// ─── Cleanup + summary ───────────────────────────────────────────────
try {
  if (cleanup.diaryIds.length) {
    await prisma.diaryUpdate.deleteMany({ where: { diaryId: { in: cleanup.diaryIds } } })
    await prisma.growDiary.deleteMany({ where: { id: { in: cleanup.diaryIds } } })
  }
  if (cleanup.userIds.length) {
    await prisma.profile.deleteMany({ where: { userId: { in: cleanup.userIds } } })
    await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } })
  }
} catch (e) {
  console.error("cleanup error:", e)
}

const failed = results.filter(([s]) => s === "FAIL")
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
