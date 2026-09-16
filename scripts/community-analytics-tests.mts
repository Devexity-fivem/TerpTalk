// Community / Aggregate Grow Analytics V1 tests — median math,
// distributions, suppression thresholds, stage-duration medians,
// Plant Doctor outcome stats, privacy shape, and the production
// visibility filters exercised against the dev database.
// Run: npx tsx scripts/community-analytics-tests.mts   (dev DB only — guarded)
import "./db-guard.mjs"
import { strict as assert } from "node:assert"
import { prisma } from "@/lib/prisma"
import { median, medianStageDurations, STAGE_ORDER } from "@/lib/diary-weeks"
import {
  summarizeCommunityDiaries,
  summarizeSymptomThreads,
  LABEL_MIN,
  type CommunityDiaryRow,
  type SymptomThreadRow,
} from "@/lib/community-stats"
import { activeAuthor } from "@/lib/security"
import { escapeLike, strainFieldMatches } from "@/lib/strain-stats"

const tag = Date.now().toString(36)
const results: [string, string][] = []
const pass = (n: string) => { results.push(["PASS", n]); console.log(`  ✓ ${n}`) }
const fail = (n: string, i: unknown) => { results.push(["FAIL", n]); console.log(`  ✗ ${n} — ${JSON.stringify(i)?.slice(0, 300)}`) }
const check = (n: string, fn: () => Promise<void> | void) =>
  Promise.resolve()
    .then(fn)
    .then(() => pass(n))
    .catch((e) => fail(n, e instanceof Error ? e.message : e))

const cleanup = {
  userIds: [] as string[],
  diaryIds: [] as string[],
  threadIds: [] as string[],
  strainIds: [] as string[],
  categoryIds: [] as string[],
}

async function mkUser(name: string, extra: Record<string, unknown> = {}) {
  const u = await prisma.user.create({
    data: {
      name: `__test_ca_${name}_${tag}`,
      ageVerified: true,
      password: "x",
      sessionVersion: 1,
      ...extra,
      profile: { create: { username: `__test_ca_${name}_${tag}` } },
    },
  })
  cleanup.userIds.push(u.id)
  return u
}

const DAY = 86400000
const base = new Date("2026-01-01T00:00:00Z").getTime()
const d = (days: number, h = 0) => new Date(base + days * DAY + h * 3600000)

/** Minimal diary row factory for the pure summarizer. */
function diaryRow(over: Partial<CommunityDiaryRow> = {}): CommunityDiaryRow {
  return {
    authorId: `a${Math.random().toString(36).slice(2, 8)}`,
    startDate: d(0),
    harvested: false,
    harvestedAt: null,
    yieldAmount: null,
    yieldUnit: null,
    harvestRating: null,
    harvestDifficulty: null,
    mediumType: null,
    lightType: null,
    growType: "INDOOR",
    techniques: [],
    ...over,
  }
}

function threadRow(over: Partial<SymptomThreadRow> = {}): SymptomThreadRow {
  return { wizardResultId: null, createdAt: d(0), acceptedAnswer: null, ...over }
}

// ─── median ──────────────────────────────────────────────────────────
await check("median: odd / even / empty", () => {
  assert.equal(median([3, 1, 5]), 3)
  assert.equal(median([4, 1, 3, 2]), 2.5)
  assert.equal(median([]), null)
})

// ─── Community methods distributions ─────────────────────────────────
await check("methods: medium/light/growType/technique distributions", () => {
  const diaries = [
    diaryRow({ mediumType: "SOIL", lightType: "LED", techniques: ["LST", "TOPPING"] }),
    diaryRow({ mediumType: "SOIL", lightType: "LED", techniques: ["LST"] }),
    diaryRow({ mediumType: "COCO", lightType: "HPS", techniques: ["LST", "SCROG"] }),
    diaryRow({ mediumType: "SOIL", lightType: "LED", growType: "OUTDOOR" }),
    diaryRow({ lightType: "LED" }),
  ]
  const s = summarizeCommunityDiaries(diaries, 5)
  assert.equal(s.growCount, 5)
  assert.equal(s.growerCount, 5)

  const mediums = s.methods.mediums
  assert.equal(mediums.n, 4)
  assert.equal(mediums.suppressed, false)
  assert.deepEqual(
    mediums.rows.map((r) => [r.label, r.count]),
    [["Soil", 3], ["Coco coir", 1]].filter(([, c]) => (c as number) >= LABEL_MIN),
    "rows below LABEL_MIN are dropped"
  )
  assert.equal(mediums.rows[0].pct, 75)

  const lights = s.methods.lights
  assert.equal(lights.n, 5)
  assert.equal(lights.rows[0].label, "LED")
  assert.equal(lights.rows[0].count, 4)
  assert.ok(lights.rows.every((r) => r.count >= LABEL_MIN), "HPS (n=1) suppressed")

  const techs = s.methods.techniques
  assert.equal(techs.n, 3, "3 diaries have ≥1 technique")
  assert.deepEqual(techs.rows.map((r) => r.value), ["LST"], "only LST reaches 3")

  const gts = s.methods.growTypes
  assert.equal(gts.n, 5)
  assert.equal(gts.rows[0].count, 4) // INDOOR
})

await check("methods: empty + thin datasets suppress", () => {
  const empty = summarizeCommunityDiaries([], 0)
  assert.equal(empty.tier, "none")
  assert.equal(empty.label, "")
  assert.ok(empty.methods.mediums.suppressed)

  const thin = summarizeCommunityDiaries([diaryRow({ mediumType: "SOIL" }), diaryRow({ mediumType: "COCO" })], 2)
  assert.equal(thin.tier, "minimal")
  assert.ok(thin.methods.mediums.suppressed, "n=2 < LABEL_MIN")
  assert.equal(thin.methods.mediums.rows.length, 0)
})

// ─── Community harvest ───────────────────────────────────────────────
await check("harvest: median yield, mixed units, missing yield excluded", () => {
  const mk = (amount: number | null, unit: string | null, extra: Partial<CommunityDiaryRow> = {}) =>
    diaryRow({ harvested: true, harvestedAt: d(90), yieldAmount: amount, yieldUnit: unit, ...extra })
  const diaries = [
    mk(100, "g"),       // ~3.5 oz
    mk(2, "oz"),        // 2 oz
    mk(0.5, "kg"),      // ~17.6 oz
    mk(4, "oz"),        // 4 oz
    mk(1, "lb"),        // ~16 oz
    mk(null, null),     // harvested, no yield — excluded from yield stats
    diaryRow({ yieldAmount: 10, yieldUnit: "oz" }), // NOT harvested — excluded
  ]
  const s = summarizeCommunityDiaries(diaries, 7)
  assert.equal(s.harvestedCount, 6)
  const y = s.harvest.medianYieldOz
  assert.equal(y.n, 5, "null yield and non-harvested excluded")
  assert.equal(y.suppressed, false)
  // sorted oz: [2, 3.5, 4, 16, 17.6] → median 4
  assert.equal(y.value, 4)
})

await check("harvest: median even sample + suppression below 5", () => {
  const mk = (oz: number) =>
    diaryRow({ harvested: true, harvestedAt: d(90), yieldAmount: oz, yieldUnit: "oz" })
  const four = summarizeCommunityDiaries([mk(1), mk(2), mk(3), mk(4)], 4)
  assert.equal(four.harvest.medianYieldOz.n, 4)
  assert.equal(four.harvest.medianYieldOz.suppressed, true)
  assert.equal(four.harvest.medianYieldOz.value, null, "suppressed is null, not zero")

  const six = summarizeCommunityDiaries([mk(1), mk(2), mk(3), mk(4), mk(5), mk(6)], 6)
  assert.equal(six.harvest.medianYieldOz.value, 3.5)
})

await check("harvest: yield buckets + rating + difficulty distributions", () => {
  const mk = (oz: number, rating: number, diff: string) =>
    diaryRow({
      harvested: true, harvestedAt: d(90),
      yieldAmount: oz, yieldUnit: "oz",
      harvestRating: rating, harvestDifficulty: diff,
    })
  const diaries = [
    mk(0.5, 7, "EASY"), mk(1.5, 7, "EASY"), mk(3, 8, "NORMAL"),
    mk(5, 8, "NORMAL"), mk(9, 9, "HARD"),
  ]
  const s = summarizeCommunityDiaries(diaries, 5)
  assert.equal(s.harvest.yieldBuckets.suppressed, false)
  // Fixed-band histogram: all nonzero bands shown once n ≥ NUMERIC_MIN.
  const bandLabels = s.harvest.yieldBuckets.rows.map((r) => r.label)
  assert.deepEqual(bandLabels, ["under 1 oz", "1–2 oz", "2–4 oz", "4–8 oz", "8+ oz"])

  assert.equal(s.harvest.ratings.n, 5)
  const r7 = s.harvest.ratings.rows.find((r) => r.value === "7")
  assert.equal(r7?.count, 2)
  assert.equal(s.harvest.ratings.rows.find((r) => r.value === "9")?.count, 1)

  assert.equal(s.harvest.difficulty.total, 5)
  assert.equal(s.harvest.difficulty.suppressed, false)
  assert.deepEqual(
    [s.harvest.difficulty.easy, s.harvest.difficulty.normal, s.harvest.difficulty.hard],
    [2, 2, 1]
  )
})

await check("harvest: median seed→harvest days, sanity bounds", () => {
  const mk = (startDays: number, harvestDays: number) =>
    diaryRow({ startDate: d(startDays), harvested: true, harvestedAt: d(harvestDays) })
  const diaries = [
    mk(0, 60), mk(0, 70), mk(0, 80), mk(0, 90), mk(0, 100),
    mk(0, 2000), // >1000d — outlier dropped
    diaryRow({ harvested: true, harvestedAt: null }), // flagged, no date — excluded
  ]
  const s = summarizeCommunityDiaries(diaries, 7)
  assert.equal(s.harvestedCount, 6, "harvested without harvestedAt is not counted")
  assert.equal(s.harvest.medianTotalDays.n, 5)
  assert.equal(s.harvest.medianTotalDays.value, 80)
})

// ─── Per-strain stage-duration medians ───────────────────────────────
await check("stageDurations medians: closed runs only, open run dropped", () => {
  const mkActive = () => ({
    diary: { startDate: d(0), harvested: false, stage: "FLOWER" },
    updates: [
      { createdAt: d(1), stage: "SEEDLING" },
      { createdAt: d(10), stage: "VEGETATIVE" },
      { createdAt: d(40), stage: "FLOWER" },
    ],
  })
  // 5 identical active grows: SEEDLING 9d, VEG 30d closed; FLOWER open → dropped
  const res = medianStageDurations(Array.from({ length: 5 }, mkActive), d(80))
  const veg = res.find((r) => r.stage === "VEGETATIVE")
  assert.equal(veg?.medianDays, 30)
  assert.equal(veg?.n, 5)
  assert.equal(res.find((r) => r.stage === "FLOWER"), undefined, "open final run excluded")
})

await check("stageDurations medians: harvested diaries close the last run", () => {
  const mk = () => ({
    diary: { startDate: d(0), harvested: true, harvestedAt: d(40), stage: "HARVEST" },
    updates: [
      { createdAt: d(1), stage: "SEEDLING" },
      { createdAt: d(10), stage: "VEGETATIVE" },
    ],
  })
  const res = medianStageDurations(Array.from({ length: 5 }, mk), d(80))
  const veg = res.find((r) => r.stage === "VEGETATIVE")
  assert.equal(veg?.medianDays, 31, "VEG runs to harvest day, not `now`")
})

await check("stageDurations medians: suppression + stage ordering + re-entry sum", () => {
  const entries = [
    // 4 diaries only — below NUMERIC_MIN → suppressed
    ...Array.from({ length: 4 }, () => ({
      diary: { startDate: d(0), harvested: true, harvestedAt: d(50), stage: "HARVEST" },
      updates: [
        { createdAt: d(1), stage: "SEEDLING" },
        { createdAt: d(10), stage: "VEGETATIVE" },
        { createdAt: d(30), stage: "FLOWER" },
        { createdAt: d(35), stage: "VEGETATIVE" }, // re-veg
      ],
    })),
  ]
  const res = medianStageDurations(entries, d(80))
  const veg = res.find((r) => r.stage === "VEGETATIVE")
  assert.equal(veg?.n, 4)
  assert.equal(veg?.medianDays, null, "n=4 < 5 → suppressed")
  // stage order follows STAGE_ORDER regardless of insertion
  const idx = res.map((r) => STAGE_ORDER.indexOf(r.stage as (typeof STAGE_ORDER)[number]))
  assert.deepEqual(idx, [...idx].sort((a, b) => a - b))
})

await check("stageDurations medians: re-veg sums closed runs per diary", () => {
  const mk = () => ({
    diary: { startDate: d(0), harvested: true, harvestedAt: d(70), stage: "HARVEST" },
    updates: [
      { createdAt: d(1), stage: "VEGETATIVE" },
      { createdAt: d(20), stage: "FLOWER" },
      { createdAt: d(30), stage: "VEGETATIVE" }, // re-veg, closed by harvest
    ],
  })
  const res = medianStageDurations(Array.from({ length: 5 }, mk), d(80))
  const veg = res.find((r) => r.stage === "VEGETATIVE")
  // VEG run 1: day2→day21 = 19; re-veg run: day31→harvest+1(day72)=41 → total 60
  assert.equal(veg?.medianDays, 60)
})

// ─── Plant Doctor outcome stats ──────────────────────────────────────
await check("symptom stats: grouping, solved, deleted answers excluded", () => {
  const solvedAt = (h: number) => ({ deleted: false, createdAt: d(0, h) })
  const threads = [
    threadRow({ wizardResultId: "nitrogen_def", acceptedAnswer: solvedAt(12) }),
    threadRow({ wizardResultId: "nitrogen_def", acceptedAnswer: solvedAt(24) }),
    threadRow({ wizardResultId: "nitrogen_def" }),
    threadRow({ wizardResultId: "overwater", acceptedAnswer: { deleted: true, createdAt: d(0, 6) } }),
    threadRow({ wizardResultId: "overwater" }),
    threadRow({ wizardResultId: "bogus_result_id" }), // unmapped — skipped
  ]
  const s = summarizeSymptomThreads(threads)
  assert.equal(s.threadCount, 5, "unmapped result IDs don't count")
  assert.equal(s.solvedCount, 2, "deleted accepted answer is not solved")
  assert.equal(s.solvedPct, 40)
  const def = s.topTags.find((t) => t.slug === "nutrient-deficiency")
  assert.equal(def?.threads, 3)
  assert.equal(def?.solved, 2)
  const water = s.topTags.find((t) => t.slug === "watering-problems")
  assert.equal(water?.solved, 0, "deleted accepted answer → unsolved")
})

await check("symptom stats: median hours to answer + suppression", () => {
  const mk = (h: number) =>
    threadRow({ wizardResultId: "nitrogen_def", acceptedAnswer: { deleted: false, createdAt: d(0, h) } })
  const few = summarizeSymptomThreads([mk(5), mk(10), mk(15), mk(20)])
  assert.equal(few.medianHoursToAnswer, null)
  assert.equal(few.answerN, 4)
  const six = summarizeSymptomThreads([mk(5), mk(10), mk(15), mk(20), mk(25), mk(30)])
  assert.equal(six.medianHoursToAnswer, 18) // median(5,10,15,20,25,30)=17.5 → 18
  assert.equal(six.answerN, 6)
})

await check("symptom stats: empty input", () => {
  const s = summarizeSymptomThreads([])
  assert.equal(s.threadCount, 0)
  assert.equal(s.solvedCount, 0)
  assert.equal(s.solvedPct, null)
  assert.equal(s.topTags.length, 0)
})

// ─── Privacy shape ───────────────────────────────────────────────────
await check("privacy: aggregate outputs contain no IDs, dates, or free text", () => {
  const diaries = Array.from({ length: 6 }, (_, i) =>
    diaryRow({
      authorId: `secret-user-${i}`,
      harvested: true, harvestedAt: d(90),
      yieldAmount: i + 1, yieldUnit: "oz",
      mediumType: "SOIL", lightType: "LED", techniques: ["LST"],
    })
  )
  const s = summarizeCommunityDiaries(diaries, 6)
  const json = JSON.stringify(s)
  assert.ok(!json.includes("secret-user"), "no author IDs")
  assert.ok(!json.includes("2026-01"), "no exact dates")
  assert.ok(!/"id"\s*:/.test(json) && !/Id["']?\s*:/.test(json), "no *Id keys in output")
  for (const banned of ["authorId", "username", "startDate", "harvestedAt", "createdAt"]) {
    assert.ok(!(banned in s), `${banned} must not appear in output`)
  }
})

// ─── DB: production visibility filters ───────────────────────────────
await check("db: deleted diaries and banned/suspended authors excluded", async () => {
  const active = await mkUser("active")
  const banned = await mkUser("banned", { banned: true })
  const suspended = await mkUser("susp", { suspendedUntil: new Date(Date.now() + DAY) })

  const mk = async (authorId: string, deleted = false) => {
    const dr = await prisma.growDiary.create({
      data: {
        title: `__test_ca_d_${tag}`, description: "", growType: "INDOOR",
        startDate: d(0), authorId, deleted, mediumType: "SOIL",
      },
    })
    cleanup.diaryIds.push(dr.id)
    return dr
  }
  await mk(active.id)
  await mk(active.id, true) // soft-deleted
  await mk(banned.id)
  await mk(suspended.id)

  // Replica of the production where clause — unstable_cache can't run
  // outside the Next runtime, so the same filter is exercised directly.
  const rows = await prisma.growDiary.findMany({
    where: { deleted: false, author: activeAuthor(), title: `__test_ca_d_${tag}` },
    select: { id: true },
  })
  assert.equal(rows.length, 1, "only the active-author live diary counts")
})

await check("db: strain union + stage-duration updates over real rows", async () => {
  const u = await mkUser("strain")
  const s = await prisma.strain.create({ data: { name: `__test_ca_Strain ${tag}` } })
  cleanup.strainIds.push(s.id)

  // 5 harvested grows: 3 linked by strainId, 2 legacy text — union matches all.
  const ids: string[] = []
  for (let i = 0; i < 5; i++) {
    const linked = i < 3
    const dr = await prisma.growDiary.create({
      data: {
        title: `__test_ca_sd_${tag}_${i}`, description: "", growType: "INDOOR",
        startDate: d(0), authorId: u.id,
        strain: linked ? s.name : `__test_ca_strain ${tag}`, // legacy text normalizes the same
        strainId: linked ? s.id : null,
        harvested: true, harvestedAt: d(40), stage: "HARVEST",
      },
    })
    cleanup.diaryIds.push(dr.id)
    ids.push(dr.id)
    await prisma.diaryUpdate.createMany({
      data: [
        { diaryId: dr.id, authorId: u.id, title: "u", content: "x".repeat(12), stage: "SEEDLING", createdAt: d(1) },
        { diaryId: dr.id, authorId: u.id, title: "u", content: "x".repeat(12), stage: "VEGETATIVE", createdAt: d(10) },
      ],
    })
  }

  // Union match — replica of strain-stats membership (no double counting).
  const raw = await prisma.growDiary.findMany({
    where: {
      deleted: false, author: activeAuthor(),
      OR: [{ strainId: s.id }, { strain: { contains: escapeLike(s.name), mode: "insensitive" } }],
      id: { in: ids },
    },
    select: { id: true, startDate: true, harvested: true, harvestedAt: true, stage: true, strain: true, strainId: true },
  })
  const diaries = raw.filter((x) => x.strainId === s.id || strainFieldMatches(x.strain, s.name))
  assert.equal(diaries.length, 5, "linked + legacy match once each")

  const updates = await prisma.diaryUpdate.findMany({
    where: { diaryId: { in: diaries.map((x) => x.id) } },
    select: { diaryId: true, stage: true, createdAt: true },
    orderBy: [{ diaryId: "asc" }, { createdAt: "asc" }],
  })
  const byDiary = new Map<string, { stage: string; createdAt: Date }[]>()
  for (const up of updates) {
    const arr = byDiary.get(up.diaryId) ?? []
    arr.push(up)
    byDiary.set(up.diaryId, arr)
  }
  const med = medianStageDurations(diaries.map((x) => ({ diary: x, updates: byDiary.get(x.id) ?? [] })))
  const veg = med.find((r) => r.stage === "VEGETATIVE")
  assert.equal(veg?.n, 5)
  assert.equal(veg?.medianDays, 31)
})

await check("db: symptom threads — deleted/banned filtered, deleted answer unsolved", async () => {
  const active = await mkUser("pd")
  const banned = await mkUser("pdban", { banned: true })
  let cat = await prisma.category.findFirst({ where: { slug: "plant-problems" } })
  if (!cat) {
    cat = await prisma.category.create({
      data: { name: "Plant Problems", slug: "plant-problems", description: "t", order: 99 },
    })
    cleanup.categoryIds.push(cat.id)
  }
  const mkThread = async (authorId: string, wizardResultId: string | null, deleted = false) => {
    const t = await prisma.thread.create({
      data: {
        title: `__test_ca_th_${tag}`, slug: `__test_ca_th_${tag}_${Math.random().toString(36).slice(2, 8)}`,
        content: "x", categoryId: cat!.id, authorId, wizardResultId, deleted,
      },
    })
    cleanup.threadIds.push(t.id)
    return t
  }
  const live = await mkThread(active.id, "nitrogen_def")
  await mkThread(active.id, "nitrogen_def", true) // deleted
  await mkThread(banned.id, "nitrogen_def")
  await mkThread(active.id, null) // no wizard link — not counted

  // Accepted answer on the live thread.
  const post = await prisma.post.create({
    data: { content: "answer", threadId: live.id, authorId: active.id },
  })
  await prisma.thread.update({ where: { id: live.id }, data: { acceptedAnswerId: post.id } })

  const rows = await prisma.thread.findMany({
    where: {
      deleted: false, author: activeAuthor(),
      category: { slug: "plant-problems" },
      wizardResultId: { not: null },
      title: `__test_ca_th_${tag}`,
    },
    select: {
      wizardResultId: true, createdAt: true,
      acceptedAnswer: { select: { deleted: true, createdAt: true } },
    },
  })
  assert.equal(rows.length, 1, "deleted + banned + non-wizard threads excluded")
  const s = summarizeSymptomThreads(rows)
  assert.equal(s.threadCount, 1)
  assert.equal(s.solvedCount, 1)
})

// ─── Cleanup + summary ───────────────────────────────────────────────
try {
  if (cleanup.threadIds.length) {
    await prisma.post.deleteMany({ where: { threadId: { in: cleanup.threadIds } } })
    await prisma.thread.deleteMany({ where: { id: { in: cleanup.threadIds } } })
  }
  if (cleanup.diaryIds.length) {
    await prisma.diaryUpdate.deleteMany({ where: { diaryId: { in: cleanup.diaryIds } } })
    await prisma.growDiary.deleteMany({ where: { id: { in: cleanup.diaryIds } } })
  }
  if (cleanup.categoryIds.length) await prisma.category.deleteMany({ where: { id: { in: cleanup.categoryIds } } })
  if (cleanup.strainIds.length) await prisma.strain.deleteMany({ where: { id: { in: cleanup.strainIds } } })
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
