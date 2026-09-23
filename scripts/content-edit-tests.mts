// Content edit regression tests — the three patch parsers (diary, diary
// update, grow setup), image-diff scoping, strain-stats cache decisions,
// strain linking, and the route source contracts. DB checks write through
// plain Prisma updates; ownership/authorization is covered behaviorally at
// the HTTP boundary by diary-verify.
// Run: npx tsx scripts/content-edit-tests.mts   (dev DB only — guarded)
import "./db-guard.mjs"
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { prisma } from "@/lib/prisma"
import { parseDiaryPatch, patchTouchesStrainStats, DIARY_EDITABLE_FIELDS } from "@/lib/diary-edit"
import {
  parseUpdatePatch,
  diffUpdateImages,
  updatePatchTouchesStrainStats,
} from "@/lib/diary-update-edit"
import {
  parseSetupPatch,
  setupPatchTouchesStrainStats,
  SETUP_MAX_IMAGES,
  SETUP_SPEC_FIELDS,
} from "@/lib/setup-edit"
import { computeGrowJourney } from "@/lib/grow-journey"
import { stageDurations, growthSummary } from "@/lib/diary-weeks"
import { escapeLike, strainFieldMatches, suggestStrainLink } from "@/lib/strain-stats"
import { activeAuthor, LIMITS } from "@/lib/security"
import { localDateInputValue } from "@/lib/diary-weeks"

const tag = Date.now().toString(36)
const results: [string, string][] = []
const pass = (n: string) => { results.push(["PASS", n]); console.log(`  ✓ ${n}`) }
const fail = (n: string, i: unknown) => { results.push(["FAIL", n]); console.log(`  ✗ ${n} — ${JSON.stringify(i)?.slice(0, 300)}`) }
const check = (n: string, fn: () => Promise<void> | void) =>
  Promise.resolve()
    .then(fn)
    .then(() => pass(n))
    .catch((e) => fail(n, e instanceof Error ? e.message : e))

const cleanup = { userIds: [] as string[], diaryIds: [] as string[], setupIds: [] as string[], strainIds: [] as string[], threadIds: [] as string[], categoryIds: [] as string[] }
const DAY = 86400000
const base = new Date("2026-01-01T00:00:00Z").getTime()
const d = (days: number, h = 0) => new Date(base + days * DAY + h * 3600000)

async function mkUser(name: string, role = "MEMBER") {
  const u = await prisma.user.create({
    data: {
      name: `__test_ce_${name}_${tag}`,
      ageVerified: true,
      password: "x",
      sessionVersion: 1,
      role,
      profile: { create: { username: `__test_ce_${name}_${tag}` } },
    },
  })
  cleanup.userIds.push(u.id)
  return u
}

async function mkDiary(authorId: string, over: Record<string, unknown> = {}) {
  const dr = await prisma.growDiary.create({
    data: {
      title: `__test_ce_d_${tag}`,
      description: "",
      growType: "INDOOR",
      startDate: d(0),
      authorId,
      ...over,
    },
  })
  cleanup.diaryIds.push(dr.id)
  return dr
}

async function mkSetup(authorId: string, over: Record<string, unknown> = {}) {
  const s = await prisma.growSetup.create({
    data: {
      title: `__test_ce_s_${tag}`,
      description: "",
      authorId,
      ...over,
    },
  })
  cleanup.setupIds.push(s.id)
  return s
}

const before = {
  strain: "Old Name", strainId: null as string | null, mediumType: "SOIL" as string | null,
  lightType: "LED" as string | null, techniques: ["LST"],
}

// ─── Diary patch parser ──────────────────────────────────────────────
await check("diary parser: every editable field is accepted", () => {
  const r = parseDiaryPatch({
    title: "T", description: "d", strain: "s", strainId: null, genetics: "g",
    growType: "OUTDOOR", medium: "m", mediumType: "COCO", containerSize: "5g",
    lighting: "l", lightType: "HPS", nutrients: "n", equipment: "e",
    techniques: ["SCROG"], spaceDimensions: "4x4", setupId: null,
  })
  assert.ok(r.ok, "all 16 fields should parse")
  assert.equal(Object.keys(r.data).length, 16)
})

await check("diary parser: protected and unknown fields rejected", () => {
  for (const key of [
    "startDate", "stage", "harvested", "harvestedAt", "yieldAmount", "yieldUnit",
    "harvestRating", "harvestDifficulty", "harvestNotes", "threadId", "authorId",
    "featured", "deleted", "createdAt", "updatedAt", "id", "updates", "bogus",
  ]) {
    const r = parseDiaryPatch({ [key]: "x" })
    assert.ok(!r.ok, `${key} must be rejected`)
  }
})

await check("diary parser: omitted keys produce empty patch (leave unchanged)", () => {
  const r = parseDiaryPatch({})
  assert.ok(r.ok)
  assert.equal(Object.keys(r.data).length, 0)
})

await check("diary parser: malformed bodies rejected", () => {
  for (const body of [null, undefined, "x", 42, [1, 2]]) {
    assert.ok(!parseDiaryPatch(body).ok, `${JSON.stringify(body)} must reject`)
  }
})

await check("diary parser: title — non-string, empty, oversized rejected", () => {
  assert.ok(!parseDiaryPatch({ title: 42 }).ok)
  assert.ok(!parseDiaryPatch({ title: "   " }).ok)
  assert.ok(!parseDiaryPatch({ title: "x".repeat(101) }).ok)
  assert.ok(parseDiaryPatch({ title: "ok" }).ok)
})

await check("diary parser: description — null rejected (NOT NULL col), oversized rejected", () => {
  assert.ok(!parseDiaryPatch({ description: null }).ok)
  assert.ok(!parseDiaryPatch({ description: 7 }).ok)
  assert.ok(!parseDiaryPatch({ description: "x".repeat(2001) }).ok)
  assert.ok(parseDiaryPatch({ description: "" }).ok)
})

await check("diary parser: free-text fields — null allowed, oversized rejected", () => {
  for (const f of ["genetics", "medium", "containerSize", "lighting", "nutrients", "equipment", "spaceDimensions"]) {
    assert.ok(!parseDiaryPatch({ [f]: "x".repeat(501) }).ok, `${f} >500 must reject`)
    const r = parseDiaryPatch({ [f]: null })
    assert.ok(r.ok && r.data[f] === null, `${f}: null clears`)
  }
  assert.ok(!parseDiaryPatch({ strain: "x".repeat(501) }).ok)
})

await check("diary parser: growType enum", () => {
  assert.ok(!parseDiaryPatch({ growType: "BOGUS" }).ok)
  assert.ok(!parseDiaryPatch({ growType: null }).ok)
  const r = parseDiaryPatch({ growType: "GREENHOUSE" })
  assert.ok(r.ok && r.data.growType === "GREENHOUSE")
})

await check("diary parser: mediumType/lightType — invalid rejects, null clears", () => {
  assert.ok(!parseDiaryPatch({ mediumType: "BOGUS" }).ok)
  assert.ok(!parseDiaryPatch({ lightType: "BOGUS" }).ok)
  const r = parseDiaryPatch({ mediumType: null, lightType: null })
  assert.ok(r.ok && r.data.mediumType === null && r.data.lightType === null)
})

await check("diary parser: techniques — strict array semantics", () => {
  assert.ok(!parseDiaryPatch({ techniques: "LST" }).ok, "non-array rejects")
  assert.ok(!parseDiaryPatch({ techniques: null }).ok, "null rejects (non-nullable column)")
  assert.ok(!parseDiaryPatch({ techniques: ["LST", "BOGUS"] }).ok, "any invalid rejects")
  const r = parseDiaryPatch({ techniques: [] })
  assert.ok(r.ok && (r.data.techniques as string[]).length === 0, "empty array clears")
})

await check("diary parser: strainId/setupId shape — non-string rejects, blank → null", () => {
  assert.ok(!parseDiaryPatch({ strainId: 42 }).ok)
  assert.ok(!parseDiaryPatch({ setupId: {} }).ok)
  const r = parseDiaryPatch({ strainId: "  ", setupId: "" })
  assert.ok(r.ok && r.data.strainId === null && r.data.setupId === null)
})

await check("diary parser: editable-field allowlist matches schema", () => {
  // Guard against drift: every allowlisted key must be a real GrowDiary field.
  const fields = (prisma as unknown as { _runtimeDataModel: { models: { GrowDiary: { fields: { name: string }[] } } } })
    ._runtimeDataModel.models.GrowDiary.fields.map((f) => f.name)
  for (const k of DIARY_EDITABLE_FIELDS) assert.ok(fields.includes(k), `${k} not a GrowDiary field`)
})

await check("lib: localDateInputValue formats local YYYY-MM-DD with padding", () => {
  assert.equal(localDateInputValue(new Date(2026, 0, 5, 0, 30)), "2026-01-05")
  assert.equal(localDateInputValue(new Date(2026, 11, 31, 23, 59)), "2026-12-31")
  assert.equal(localDateInputValue(new Date(2026, 5, 7)), "2026-06-07")
  assert.match(localDateInputValue(), /^\d{4}-\d{2}-\d{2}$/)
})

// ─── Diary update patch parser + image diff ──────────────────────────
await check("update parser: every editable field + image controls accepted", () => {
  const r = parseUpdatePatch({
    id: "u1", title: "T", content: "c", stage: "FLOWER",
    temperature: 72, humidity: 55, vpd: 1.1, ph: 6.2, ec: 1.8, heightCm: 40,
    feeding: "f", training: "t", keepImageIds: ["i1"], images: [],
  })
  assert.ok(r.ok, "all fields should parse")
  assert.equal(r.id, "u1")
  assert.equal(Object.keys(r.data).length, 11, "id/keepImageIds/images never reach data")
  assert.deepEqual(r.keepImageIds, ["i1"])
  assert.deepEqual(r.newImages, [])
})

await check("update parser: protected and unknown fields rejected", () => {
  for (const key of [
    "authorId", "diaryId", "createdAt", "updatedAt", "dayNumber", "weekNumber",
    "deleted", "author", "diary", "bogus", "role",
  ]) {
    const r = parseUpdatePatch({ [key]: "x" })
    assert.ok(!r.ok, `${key} must be rejected`)
  }
})

await check("update parser: id alone produces empty patch; malformed bodies rejected", () => {
  const r = parseUpdatePatch({ id: "u1" })
  assert.ok(r.ok && r.id === "u1" && Object.keys(r.data).length === 0)
  assert.ok(!parseUpdatePatch({ id: "" }).ok, "empty id rejects")
  assert.ok(!parseUpdatePatch({ id: 42 }).ok, "non-string id rejects")
  for (const body of [null, undefined, "x", 42, [1, 2]]) {
    assert.ok(!parseUpdatePatch(body).ok, `${JSON.stringify(body)} must reject`)
  }
})

await check("update parser: title/content — non-empty, NOT NULL, length caps", () => {
  assert.ok(!parseUpdatePatch({ title: "   " }).ok)
  assert.ok(!parseUpdatePatch({ title: null }).ok)
  assert.ok(!parseUpdatePatch({ title: 42 }).ok)
  assert.ok(!parseUpdatePatch({ title: "x".repeat(101) }).ok)
  assert.ok(!parseUpdatePatch({ content: "  " }).ok)
  assert.ok(!parseUpdatePatch({ content: null }).ok)
  assert.ok(!parseUpdatePatch({ content: "x".repeat(10001) }).ok)
  assert.ok(parseUpdatePatch({ title: "ok", content: "ok" }).ok)
})

await check("update parser: stage enum — invalid and null rejected", () => {
  assert.ok(!parseUpdatePatch({ stage: "BOGUS" }).ok)
  assert.ok(!parseUpdatePatch({ stage: null }).ok)
  assert.ok(!parseUpdatePatch({ stage: 5 }).ok)
  const r = parseUpdatePatch({ stage: "VEGETATIVE" })
  assert.ok(r.ok && r.data.stage === "VEGETATIVE")
})

await check("update parser: numeric fields — ranges enforced, null clears", () => {
  const ranges: [string, number, number][] = [
    ["temperature", -40, 140], ["humidity", 0, 100], ["vpd", 0, 6],
    ["ph", 0, 14], ["ec", 0, 15], ["heightCm", 0.1, 500],
  ]
  for (const [f, lo, hi] of ranges) {
    assert.ok(!parseUpdatePatch({ [f]: "x" }).ok, `${f}: string rejects`)
    assert.ok(!parseUpdatePatch({ [f]: lo - 1 }).ok, `${f}: below range rejects`)
    assert.ok(!parseUpdatePatch({ [f]: hi + 1 }).ok, `${f}: above range rejects`)
    const r = parseUpdatePatch({ [f]: null })
    assert.ok(r.ok && r.data[f] === null, `${f}: null clears`)
    const ok = parseUpdatePatch({ [f]: (lo + hi) / 2 })
    assert.ok(ok.ok, `${f}: in-range accepted`)
  }
})

await check("update parser: feeding/training — trim, 300 cap, null clears", () => {
  const r = parseUpdatePatch({ feeding: "  nutes  ", training: null })
  assert.ok(r.ok && r.data.feeding === "nutes" && r.data.training === null)
  const long = parseUpdatePatch({ feeding: "x".repeat(400) })
  assert.ok(long.ok && (long.data.feeding as string).length === 300, "truncates at 300 like creation")
  assert.ok(!parseUpdatePatch({ feeding: 5 }).ok)
})

await check("update parser: images — shape, count, and data-URI validation", () => {
  assert.ok(!parseUpdatePatch({ keepImageIds: "i1" }).ok)
  assert.ok(!parseUpdatePatch({ keepImageIds: [1] }).ok)
  assert.ok(!parseUpdatePatch({ keepImageIds: Array.from({ length: 21 }, (_, i) => `i${i}`) }).ok)
  assert.ok(!parseUpdatePatch({ images: "x" }).ok)
  assert.ok(!parseUpdatePatch({ images: ["not-a-data-uri"] }).ok)
  assert.ok(!parseUpdatePatch({ images: ["data:image/gif;base64,AAAA"] }).ok, "gif rejected like creation")
  assert.ok(!parseUpdatePatch({ images: Array(5).fill("data:image/png;base64,AAAA") }).ok, ">4 rejects")
  const ok = parseUpdatePatch({ images: ["data:image/png;base64,iVBORw0KGgo="] })
  assert.ok(ok.ok && ok.newImages?.length === 1)
})

await check("diffUpdateImages: default keeps all; keep-list removes the rest", () => {
  const existing = [{ id: "a" }, { id: "b" }, { id: "c" }]
  assert.deepEqual(diffUpdateImages(existing, undefined), { kept: existing, removed: [] })
  const { kept, removed } = diffUpdateImages(existing, ["a", "c"])
  assert.deepEqual(kept.map((i) => i.id), ["a", "c"])
  assert.deepEqual(removed.map((i) => i.id), ["b"])
})

await check("diffUpdateImages: foreign ids are ignored, never kept", () => {
  const existing = [{ id: "a" }]
  const { kept } = diffUpdateImages(existing, ["a", "foreign-id"])
  assert.equal(kept.length, 1, "foreign id cannot resurrect into this update")
  // A keep-list of ONLY foreign ids removes everything on this update —
  // but can never touch another update's rows (route scopes the delete).
  const all = diffUpdateImages(existing, ["foreign-id"])
  assert.equal(all.removed.length, 1)
  assert.equal(all.kept.length, 0)
})

// ─── Setup patch parser + image diff ─────────────────────────────────
await check("setup parser: every editable field + image controls accepted", () => {
  const r = parseSetupPatch({
    id: "s1", title: "T", description: "d", space: "4x4", tent: "tent",
    lighting: "led", ventilation: "v", fans: "f", containers: "c",
    medium: "m", nutrients: "n", controllers: "ctl", equipment: "e",
    strain: "OG", keepImageIds: ["i1"], images: [],
  })
  assert.ok(r.ok, "all fields should parse")
  assert.equal(r.id, "s1")
  assert.equal(Object.keys(r.data).length, 13, "id/keepImageIds/images never reach data")
  assert.deepEqual(r.keepImageIds, ["i1"])
  assert.deepEqual(r.newImages, [])
})

await check("setup parser: protected and unknown fields rejected", () => {
  for (const key of [
    "authorId", "createdAt", "updatedAt", "deleted",
    "author", "diaries", "comments", "setupId", "bogus", "role",
  ]) {
    const r = parseSetupPatch({ [key]: "x" })
    assert.ok(!r.ok, `${key} must be rejected`)
  }
})

await check("setup parser: id alone produces empty patch; malformed bodies rejected", () => {
  const r = parseSetupPatch({ id: "s1" })
  assert.ok(r.ok && r.id === "s1" && Object.keys(r.data).length === 0)
  assert.ok(!parseSetupPatch({ id: "" }).ok, "empty id rejects")
  assert.ok(!parseSetupPatch({ id: 42 }).ok, "non-string id rejects")
  for (const body of [null, undefined, "x", 42, [1, 2]]) {
    assert.ok(!parseSetupPatch(body).ok, `${JSON.stringify(body)} must reject`)
  }
})

await check("setup parser: title — required non-empty, TITLE_MAX cap", () => {
  assert.ok(!parseSetupPatch({ title: "   " }).ok)
  assert.ok(!parseSetupPatch({ title: null }).ok)
  assert.ok(!parseSetupPatch({ title: 42 }).ok)
  assert.ok(!parseSetupPatch({ title: "x".repeat(LIMITS.TITLE_MAX + 1) }).ok)
  assert.ok(parseSetupPatch({ title: "ok" }).ok)
})

await check("setup parser: description — NOT NULL, empty string ok, 500 cap", () => {
  assert.ok(!parseSetupPatch({ description: null }).ok, "null rejected — column is NOT NULL")
  assert.ok(!parseSetupPatch({ description: 42 }).ok)
  assert.ok(!parseSetupPatch({ description: "x".repeat(501) }).ok)
  const r = parseSetupPatch({ description: "" })
  assert.ok(r.ok && r.data.description === "", "empty string accepted like creation")
})

await check("setup parser: spec fields — 500 cap, null clears, trim-to-null", () => {
  for (const f of SETUP_SPEC_FIELDS) {
    assert.ok(!parseSetupPatch({ [f]: 42 }).ok, `${f}: non-string rejects`)
    assert.ok(!parseSetupPatch({ [f]: "x".repeat(501) }).ok, `${f}: >500 rejects`)
    const nul = parseSetupPatch({ [f]: null })
    assert.ok(nul.ok && nul.data[f] === null, `${f}: null clears`)
    const r = parseSetupPatch({ [f]: "  value  " })
    assert.ok(r.ok && r.data[f] === "value", `${f}: trims`)
    const blank = parseSetupPatch({ [f]: "   " })
    assert.ok(blank.ok && blank.data[f] === null, `${f}: blank trims to null`)
  }
})

await check("setup parser: images — shape, count, and data-URI validation", () => {
  assert.ok(!parseSetupPatch({ keepImageIds: "i1" }).ok)
  assert.ok(!parseSetupPatch({ keepImageIds: [1] }).ok)
  assert.ok(!parseSetupPatch({ keepImageIds: Array.from({ length: 31 }, (_, i) => `i${i}`) }).ok)
  assert.ok(!parseSetupPatch({ images: "x" }).ok)
  assert.ok(!parseSetupPatch({ images: ["not-a-data-uri"] }).ok)
  assert.ok(!parseSetupPatch({ images: ["data:image/gif;base64,AAAA"] }).ok, "gif rejected like creation")
  assert.ok(!parseSetupPatch({ images: Array(SETUP_MAX_IMAGES + 1).fill("data:image/png;base64,AAAA") }).ok, ">6 rejects")
  const ok = parseSetupPatch({ images: Array(SETUP_MAX_IMAGES).fill("data:image/png;base64,iVBORw0KGgo=") })
  assert.ok(ok.ok && ok.newImages?.length === SETUP_MAX_IMAGES, "6 accepted")
})

// ─── Strain stats cache decisions ────────────────────────────────────
await check("patchTouchesStrainStats: cosmetic edits do not bust strains", () => {
  assert.equal(patchTouchesStrainStats(before, { title: "New" }), false)
  assert.equal(patchTouchesStrainStats(before, { description: "d" }), false)
  assert.equal(patchTouchesStrainStats(before, { genetics: "Hybrid" }), false)
  assert.equal(patchTouchesStrainStats(before, { medium: "FFOF details" }), false, "free text doesn't count")
  assert.equal(patchTouchesStrainStats(before, { setupId: "x" }), false)
})

await check("patchTouchesStrainStats: stat-bearing edits bust strains", () => {
  assert.equal(patchTouchesStrainStats(before, { strain: "New Name" }), true)
  assert.equal(patchTouchesStrainStats(before, { strainId: "someid" }), true)
  assert.equal(patchTouchesStrainStats(before, { mediumType: "COCO" }), true)
  assert.equal(patchTouchesStrainStats(before, { lightType: null }), true, "clearing a type is still a change")
  assert.equal(patchTouchesStrainStats(before, { techniques: ["LST", "SCROG"] }), true)
  assert.equal(patchTouchesStrainStats(before, { strain: "Old Name" }), false, "same value → no bust")
  assert.equal(patchTouchesStrainStats(before, { techniques: ["LST"] }), false)
})

await check("updatePatchTouchesStrainStats: stage/env fields trigger", () => {
  const beforeU = { stage: "VEGETATIVE", temperature: 75, humidity: 50, vpd: 1, ph: 6.5, ec: 1.5 }
  assert.ok(updatePatchTouchesStrainStats(beforeU, { stage: "FLOWER" }))
  assert.ok(updatePatchTouchesStrainStats(beforeU, { temperature: 80 }))
  assert.ok(updatePatchTouchesStrainStats(beforeU, { ph: null }))
  for (const f of ["humidity", "vpd", "ec"]) {
    assert.ok(updatePatchTouchesStrainStats(beforeU, { [f]: 9 }), f)
  }
})

await check("updatePatchTouchesStrainStats: non-stat edits stay cold", () => {
  const beforeU = { stage: "VEGETATIVE", temperature: 75, humidity: 50, vpd: 1, ph: 6.5, ec: 1.5 }
  for (const data of [
    { title: "new" },
    { content: "new body" },
    { feeding: "x" },
    { training: "x" },
    { heightCm: 99 },       // height chart reads live, not via strain stats
    {},                      // image-only edit produces no data keys
    { stage: "VEGETATIVE" }, // unchanged value → no bust
  ]) {
    assert.equal(updatePatchTouchesStrainStats(beforeU, data), false, JSON.stringify(data))
  }
})

await check("setupPatchTouchesStrainStats: strain change triggers, nothing else does", () => {
  const beforeS = { strain: "OG Kush" }
  assert.ok(setupPatchTouchesStrainStats(beforeS, { strain: "Blue Dream" }))
  assert.ok(setupPatchTouchesStrainStats(beforeS, { strain: null }), "clearing strain still changes it")
  for (const data of [
    { title: "new" },
    { description: "new" },
    { lighting: "1000W HPS" },
    { medium: "coco" },
    {},                       // image-only edit produces no data keys
    { strain: "OG Kush" },    // unchanged value → no bust
  ]) {
    assert.equal(setupPatchTouchesStrainStats(beforeS, data), false, JSON.stringify(data))
  }
})

// ─── DB: diary write path ────────────────────────────────────────────
await check("db: owner patch persists editable fields, leaves protected untouched", async () => {
  const u = await mkUser("own")
  const dr = await prisma.growDiary.create({
    data: {
      title: `__test_ce_d1_${tag}`, description: "orig", growType: "INDOOR",
      startDate: new Date("2026-01-01"), strain: "OrigStrain", mediumType: "SOIL",
      stage: "VEGETATIVE", harvested: false, authorId: u.id,
    },
  })
  cleanup.diaryIds.push(dr.id)
  const r = parseDiaryPatch({
    title: "Renamed", mediumType: "COCO", techniques: ["SCROG", "TOPPING"],
    genetics: "Hybrid", nutrients: "MegaCrop",
  })
  assert.ok(r.ok)
  await prisma.growDiary.update({ where: { id: dr.id }, data: r.data })
  const diary = await prisma.growDiary.findUnique({ where: { id: dr.id } })
  assert.equal(diary?.title, "Renamed")
  assert.equal(diary?.mediumType, "COCO")
  assert.deepEqual(diary?.techniques, ["SCROG", "TOPPING"])
  assert.equal(diary?.stage, "VEGETATIVE", "stage untouched")
  assert.equal(diary?.harvested, false)
  assert.equal(diary?.startDate.toISOString(), new Date("2026-01-01").toISOString(), "startDate immutable")
  assert.equal(diary?.authorId, u.id)
})

await check("db: edit leaves threadId and updates intact", async () => {
  const u = await mkUser("thread")
  const dr = await prisma.growDiary.create({
    data: { title: `__test_ce_d5_${tag}`, description: "", growType: "INDOOR", startDate: new Date(), authorId: u.id },
  })
  cleanup.diaryIds.push(dr.id)
  const up = await prisma.diaryUpdate.create({
    data: { diaryId: dr.id, authorId: u.id, title: "u", content: "x".repeat(12), stage: "VEGETATIVE", heightCm: 30 },
  })
  const cat = await prisma.category.upsert({
    where: { slug: `__test_ce_cat_${tag}` },
    create: { slug: `__test_ce_cat_${tag}`, name: "test", description: "test" },
    update: {},
  })
  cleanup.categoryIds.push(cat.id)
  const th = await prisma.thread.create({
    data: { title: "t", slug: `__test_ce_th_${tag}`, content: "x", categoryId: cat.id, authorId: u.id },
  })
  cleanup.threadIds.push(th.id)
  await prisma.growDiary.update({ where: { id: dr.id }, data: { threadId: th.id } })
  await prisma.growDiary.update({ where: { id: dr.id }, data: { title: "After", strain: "NewStrain" } })
  const diary = await prisma.growDiary.findUnique({ where: { id: dr.id }, select: { threadId: true } })
  assert.equal(diary?.threadId, th.id, "canonical discussion link unchanged")
  const still = await prisma.diaryUpdate.findUnique({ where: { id: up.id }, select: { heightCm: true } })
  assert.equal(still?.heightCm, 30, "historical update untouched")
})

await check("db: strain stats reflect edited membership", async () => {
  const u = await mkUser("stats")
  const s = await prisma.strain.create({ data: { name: `__test_ce_Stats_${tag}` } })
  cleanup.strainIds.push(s.id)
  const dr = await prisma.growDiary.create({
    data: { title: `__test_ce_d6_${tag}`, description: "", growType: "INDOOR", startDate: new Date(), authorId: u.id, strain: "unrelated" },
  })
  cleanup.diaryIds.push(dr.id)
  // Replica of strain-stats.ts union matching — unstable_cache can't run
  // outside the Next runtime, so assert the same membership semantics.
  const memberCount = async () => {
    const rows = await prisma.growDiary.findMany({
      where: {
        deleted: false,
        author: activeAuthor(),
        OR: [{ strainId: s.id }, { strain: { contains: escapeLike(s.name), mode: "insensitive" } }],
      },
      select: { id: true, strain: true, strainId: true },
    })
    return rows.filter((r) => r.strainId === s.id || strainFieldMatches(r.strain, s.name)).length
  }
  assert.equal(await memberCount(), 0, "not counted before link")
  await prisma.growDiary.update({ where: { id: dr.id }, data: { strainId: s.id, strain: s.name } })
  assert.equal(await memberCount(), 1, "counted after link")
  await prisma.growDiary.update({ where: { id: dr.id }, data: { strainId: null, strain: "unrelated" } })
  assert.equal(await memberCount(), 0, "uncounted after unlink")
})

// ─── DB: diary update write path ─────────────────────────────────────
const updOwner = await mkUser("updowner")
const updDiary = await mkDiary(updOwner.id, { stage: "VEGETATIVE" })

await check("db: update patch updates fields; protected fields + createdAt untouched", async () => {
  const u = await prisma.diaryUpdate.create({
    data: { diaryId: updDiary.id, authorId: updOwner.id, title: "orig", content: "original body text", stage: "VEGETATIVE", createdAt: d(5), dayNumber: 5, weekNumber: 1 },
  })
  const parsed = parseUpdatePatch({ id: u.id, title: "edited", content: "new body here", temperature: 72, feeding: null })
  assert.ok(parsed.ok)
  await prisma.diaryUpdate.update({ where: { id: u.id }, data: parsed.data })
  const after = await prisma.diaryUpdate.findUnique({ where: { id: u.id } })
  assert.equal(after?.title, "edited")
  assert.equal(after?.content, "new body here")
  assert.equal(after?.temperature, 72)
  assert.equal(after?.feeding, null)
  assert.equal(after?.authorId, updOwner.id)
  assert.equal(after?.diaryId, updDiary.id)
  assert.equal(after?.createdAt.getTime(), d(5).getTime(), "createdAt is authoritative chronology")
  assert.equal(after?.dayNumber, 5, "derived display fields untouched")
  assert.ok(after!.updatedAt.getTime() > after!.createdAt.getTime(), "updatedAt advances → edited marker")
  const diaryAfter = await prisma.growDiary.findUnique({ where: { id: updDiary.id } })
  assert.equal(diaryAfter?.stage, "VEGETATIVE", "update stage edits never move the diary's stage")
})

await check("db: guarded write — updateMany on missing row returns 0, no resurrection", async () => {
  const res = await prisma.diaryUpdate.updateMany({ where: { id: "missing-id" }, data: { title: "x" } })
  assert.equal(res.count, 0)
})

await check("db: stage edit flows into stage-duration inputs", async () => {
  const dr = await mkDiary(updOwner.id, { startDate: d(0), harvested: true, harvestedAt: d(40), stage: "HARVEST" })
  const u1 = await prisma.diaryUpdate.create({
    data: { diaryId: dr.id, authorId: updOwner.id, title: "a", content: "x".repeat(12), stage: "SEEDLING", createdAt: d(1) },
  })
  await prisma.diaryUpdate.create({
    data: { diaryId: dr.id, authorId: updOwner.id, title: "b", content: "x".repeat(12), stage: "VEGETATIVE", createdAt: d(10) },
  })

  const summarize = async () => {
    const updates = await prisma.diaryUpdate.findMany({
      where: { diaryId: dr.id }, select: { stage: true, createdAt: true }, orderBy: { createdAt: "asc" },
    })
    return stageDurations(dr, updates, d(80))
  }
  const pre = await summarize()
  assert.equal(pre.find((r) => r.stage === "SEEDLING")?.days, 9)
  assert.equal(pre.find((r) => r.stage === "VEGETATIVE")?.days, 31)

  const parsed = parseUpdatePatch({ id: u1.id, stage: "VEGETATIVE" })
  assert.ok(parsed.ok)
  await prisma.diaryUpdate.update({ where: { id: u1.id }, data: parsed.data })
  const post = await summarize()
  assert.equal(post.find((r) => r.stage === "SEEDLING"), undefined, "edited stage relabels history")
  // Both updates are now VEG — one merged run from day 2 through harvest.
  assert.equal(post.find((r) => r.stage === "VEGETATIVE")?.days, 40)
})

await check("db: height edit flows into the live growth series", async () => {
  const dr = await mkDiary(updOwner.id, { startDate: d(0) })
  const u = await prisma.diaryUpdate.create({
    data: { diaryId: dr.id, authorId: updOwner.id, title: "h", content: "x".repeat(12), stage: "VEGETATIVE", heightCm: 30, createdAt: d(10) },
  })
  const read = async () =>
    growthSummary(dr, await prisma.diaryUpdate.findMany({
      where: { diaryId: dr.id }, select: { id: true, createdAt: true, stage: true, heightCm: true }, orderBy: { createdAt: "asc" },
    }), d(80))
  assert.equal((await read()).currentHeight, 30)
  await prisma.diaryUpdate.update({ where: { id: u.id }, data: { heightCm: 45 } })
  assert.equal((await read()).currentHeight, 45, "height edit flows through the existing live read")
})

await check("db: update image add/remove/replace — scoping, order, 4-image cap", async () => {
  const dr = await mkDiary(updOwner.id, { startDate: d(0) })
  const u = await prisma.diaryUpdate.create({
    data: { diaryId: dr.id, authorId: updOwner.id, title: "i", content: "x".repeat(12), stage: "VEGETATIVE",
      images: { create: [{ url: "https://blob/1.webp", order: 0 }, { url: "https://blob/2.webp", order: 1 }] } },
  })
  const other = await prisma.diaryUpdate.create({
    data: { diaryId: dr.id, authorId: updOwner.id, title: "o", content: "x".repeat(12), stage: "VEGETATIVE",
      images: { create: [{ url: "https://blob/9.webp", order: 0 }] } },
  })

  // Replace: drop image 1, add a new one — new row appends after max order.
  const imgs = await prisma.diaryImage.findMany({ where: { updateId: u.id }, orderBy: { order: "asc" } })
  {
    const { kept, removed } = diffUpdateImages(imgs, [imgs[1].id])
    const nextOrder = kept.reduce((m, i) => Math.max(m, i.order), -1) + 1
    await prisma.$transaction([
      prisma.diaryImage.deleteMany({ where: { updateId: u.id, id: { in: removed.map((i) => i.id) } } }),
      prisma.diaryImage.createMany({ data: [{ updateId: u.id, url: "https://blob/3.webp", order: nextOrder }] }),
    ])
  }
  const after = await prisma.diaryImage.findMany({ where: { updateId: u.id }, orderBy: { order: "asc" } })
  assert.deepEqual(after.map((i) => i.url), ["https://blob/2.webp", "https://blob/3.webp"])
  assert.deepEqual(after.map((i) => i.order), [1, 2], "kept order preserved, new appends after max")

  // Cross-update protection: a keep-list naming the other update's image id
  // can never remove it — the delete is scoped to this updateId.
  const foreign = (await prisma.diaryImage.findFirst({ where: { updateId: other.id } }))!
  const mineNow = await prisma.diaryImage.findMany({ where: { updateId: u.id } })
  {
    const { removed } = diffUpdateImages(mineNow, [foreign.id])
    await prisma.diaryImage.deleteMany({ where: { updateId: u.id, id: { in: removed.map((i) => i.id) } } })
  }
  const foreignAfter = await prisma.diaryImage.findUnique({ where: { id: foreign.id } })
  assert.ok(foreignAfter, "other update's image survives")
  const mine = await prisma.diaryImage.count({ where: { updateId: u.id } })
  assert.equal(mine, 0, "all of this update's images removed by a foreign keep-list")

  // Cap: route rejects kept + new > 4 before touching the DB.
  const parsed = parseUpdatePatch({ id: u.id, images: Array(5).fill("data:image/png;base64,iVBORw0KGgo=") })
  assert.ok(!parsed.ok, "parser already rejects >4 new images")
})

await check("db: journey reconciliation — edit can drop a meaningful day", async () => {
  const dr = await mkDiary(updOwner.id, { startDate: d(0), createdAt: d(0) })
  const u = await prisma.diaryUpdate.create({
    data: { diaryId: dr.id, authorId: updOwner.id, title: "j", content: "meaningful update body", stage: "VEGETATIVE", createdAt: d(1) },
  })
  const journeyOf = async () => {
    const updates = await prisma.diaryUpdate.findMany({
      where: { diaryId: dr.id },
      select: {
        createdAt: true, stage: true, content: true, temperature: true, humidity: true,
        vpd: true, ph: true, ec: true, feeding: true, training: true, images: { select: { id: true } },
      },
    })
    return computeGrowJourney(dr, updates, d(80))
  }
  assert.equal((await journeyOf()).meaningfulDays, 1)
  await prisma.diaryUpdate.update({ where: { id: u.id }, data: { content: "ok" } })
  assert.equal((await journeyOf()).meaningfulDays, 0, "edit below the meaningful floor reconciles")
})

await check("db: update edit awards no creation reputation", async () => {
  const u = await prisma.diaryUpdate.create({
    data: { diaryId: updDiary.id, authorId: updOwner.id, title: "r", content: "x".repeat(12), stage: "VEGETATIVE", createdAt: d(6) },
  })
  const before = await prisma.reputationEvent.count({ where: { userId: updOwner.id, sourceId: updDiary.id } })
  await prisma.diaryUpdate.update({ where: { id: u.id }, data: { title: "edited title" } })
  const after = await prisma.reputationEvent.count({ where: { userId: updOwner.id, sourceId: updDiary.id } })
  assert.equal(after, before, "PATCH must never write a reputation event")
})

// ─── DB: setup write path ────────────────────────────────────────────
const setupOwner = await mkUser("setupowner")

await check("db: setup patch updates fields; protected fields + createdAt untouched", async () => {
  const s = await mkSetup(setupOwner.id, { title: "orig", description: "orig desc", lighting: "LED 600W", strain: "OG" })
  const createdAt = s.createdAt
  const parsed = parseSetupPatch({ id: s.id, title: "edited", lighting: "HPS 1000W", medium: null })
  assert.ok(parsed.ok)
  await prisma.growSetup.update({ where: { id: s.id }, data: parsed.data })
  const after = await prisma.growSetup.findUnique({ where: { id: s.id } })
  assert.equal(after?.title, "edited")
  assert.equal(after?.lighting, "HPS 1000W")
  assert.equal(after?.medium, null)
  assert.equal(after?.authorId, setupOwner.id, "authorId unchanged")
  assert.equal(after?.createdAt.getTime(), createdAt.getTime(), "createdAt unchanged")
  assert.ok(after!.updatedAt.getTime() > createdAt.getTime(), "updatedAt advances → edited marker")
})

await check("db: linked diary keeps setupId; setup edit never mutates the diary", async () => {
  const s = await mkSetup(setupOwner.id, { title: "linked setup" })
  const diary = await prisma.growDiary.create({
    data: {
      title: `__test_ce_d_${tag}`, description: "", growType: "INDOOR",
      startDate: new Date("2026-01-01T00:00:00Z"), authorId: setupOwner.id, setupId: s.id,
    },
  })
  cleanup.diaryIds.push(diary.id)
  const diaryBefore = await prisma.growDiary.findUnique({ where: { id: diary.id } })

  await prisma.growSetup.update({ where: { id: s.id }, data: { title: "renamed setup", lighting: "LED 900W" } })

  const diaryAfter = await prisma.growDiary.findUnique({ where: { id: diary.id } })
  assert.equal(diaryAfter?.setupId, s.id, "diary keeps pointing at the same setup after edit")
  assert.equal(
    diaryAfter?.updatedAt.getTime(), diaryBefore?.updatedAt.getTime(),
    "editing a setup never writes the diary row"
  )
})

await check("db: hard delete still SetNulls linked diaries", async () => {
  const s = await mkSetup(setupOwner.id)
  const diary = await prisma.growDiary.create({
    data: {
      title: `__test_ce_d_${tag}`, description: "", growType: "INDOOR",
      startDate: new Date("2026-01-01T00:00:00Z"), authorId: setupOwner.id, setupId: s.id,
    },
  })
  cleanup.diaryIds.push(diary.id)
  await prisma.growSetup.delete({ where: { id: s.id } })
  const after = await prisma.growDiary.findUnique({ where: { id: diary.id } })
  assert.equal(after?.setupId, null, "onDelete: SetNull preserved")
})

await check("db: setup image add/remove/replace — scoping, order, 6-image cap", async () => {
  const s = await mkSetup(setupOwner.id, {
    images: { create: [{ url: "https://blob/1.webp", order: 0 }, { url: "https://blob/2.webp", order: 1 }] },
  })
  const other = await mkSetup(setupOwner.id, {
    images: { create: [{ url: "https://blob/9.webp", order: 0 }] },
  })

  // Replace: drop image 1, add a new one — new row appends after max order.
  const imgs = await prisma.setupImage.findMany({ where: { setupId: s.id }, orderBy: { order: "asc" } })
  {
    const { kept, removed } = diffUpdateImages(imgs, [imgs[1].id])
    const nextOrder = kept.reduce((m, i) => Math.max(m, i.order), -1) + 1
    await prisma.$transaction([
      prisma.setupImage.deleteMany({ where: { setupId: s.id, id: { in: removed.map((i) => i.id) } } }),
      prisma.setupImage.createMany({ data: [{ setupId: s.id, url: "https://blob/3.webp", order: nextOrder }] }),
    ])
  }
  const after = await prisma.setupImage.findMany({ where: { setupId: s.id }, orderBy: { order: "asc" } })
  assert.deepEqual(after.map((i) => i.url), ["https://blob/2.webp", "https://blob/3.webp"])
  assert.deepEqual(after.map((i) => i.order), [1, 2], "kept order preserved, new appends after max")

  // Cross-setup protection: a keep-list naming the other setup's image id
  // can never remove it — the delete is scoped to this setupId.
  const foreign = (await prisma.setupImage.findFirst({ where: { setupId: other.id } }))!
  const mineNow = await prisma.setupImage.findMany({ where: { setupId: s.id } })
  {
    const { removed } = diffUpdateImages(mineNow, [foreign.id])
    await prisma.setupImage.deleteMany({ where: { setupId: s.id, id: { in: removed.map((i) => i.id) } } })
  }
  const foreignAfter = await prisma.setupImage.findUnique({ where: { id: foreign.id } })
  assert.ok(foreignAfter, "other setup's image survives")
  const mine = await prisma.setupImage.count({ where: { setupId: s.id } })
  assert.equal(mine, 0, "all of this setup's images removed by a foreign keep-list")

  // Cap: route rejects kept + new > 6 before touching the DB.
  const parsed = parseSetupPatch({ id: s.id, images: Array(7).fill("data:image/png;base64,iVBORw0KGgo=") })
  assert.ok(!parsed.ok, "parser already rejects >6 new images")
})

await check("db: setup edit awards no creation reputation", async () => {
  const s = await mkSetup(setupOwner.id)
  const before = await prisma.reputationEvent.count({ where: { userId: setupOwner.id, sourceId: s.id } })
  await prisma.growSetup.update({ where: { id: s.id }, data: { title: "edited title" } })
  const after = await prisma.reputationEvent.count({ where: { userId: setupOwner.id, sourceId: s.id } })
  assert.equal(after, before, "PATCH must never write a reputation event")
})

// ─── Strain link + suggestStrainLink (DB) ────────────────────────────
await check("suggestStrainLink: exact / case / punctuation variants", async () => {
  const s = await prisma.strain.create({ data: { name: `Test Legacy ${tag}` } })
  cleanup.strainIds.push(s.id)
  for (const text of [`Test Legacy ${tag}`, `test legacy ${tag}`, `TEST-LEGACY_${tag}!`]) {
    const r = await suggestStrainLink(text)
    assert.equal(r?.id, s.id, `"${text}" should suggest the catalog strain`)
  }
})

await check("suggestStrainLink: no match / empty / null → null", async () => {
  assert.equal(await suggestStrainLink(`Completely Unknown ${tag}`), null)
  assert.equal(await suggestStrainLink(""), null)
  assert.equal(await suggestStrainLink("   "), null)
  assert.equal(await suggestStrainLink(null), null)
})

await check("suggestStrainLink: fuzzy-prefix is not a suggestion", async () => {
  // "Test Legacy X Auto" only prefix-matches "Test Legacy X" — that's
  // exactly the ambiguity the feature must never auto-resolve.
  const r = await suggestStrainLink(`Test Legacy ${tag} Auto`)
  assert.equal(r, null, "prefix-fuzzy must not suggest")
})

await check("suggestStrainLink: multiple normalized matches → null", async () => {
  // Two raw names that normalize identically — the DB unique index is
  // case/punctuation-sensitive so both can exist.
  const a = await prisma.strain.create({ data: { name: `Test Ambig ${tag}` } })
  const b = await prisma.strain.create({ data: { name: `test-ambig-${tag}` } })
  cleanup.strainIds.push(a.id, b.id)
  assert.equal(await suggestStrainLink(`test ambig ${tag}`), null, "ambiguous must not suggest")
})

// ─── Route source contracts ──────────────────────────────────────────
await check("route: diary PATCH enforces ownership + soft-delete guards", () => {
  const src = readFileSync("src/app/api/diaries/[id]/route.ts", "utf8")
  const patch = src.slice(src.indexOf("export async function PATCH"))
  assert.ok(patch.includes("diary.authorId === session.user.id"), "route must check diary author")
  assert.ok(patch.includes("forbidden()"), "non-owner must get 403")
  assert.ok(patch.includes("deleted: false"), "guarded write must exclude soft-deleted rows")
  assert.ok(patch.includes("enforceLinkTrust"), "link trust required")
  assert.ok(!patch.includes("awardReputation"), "PATCH never writes reputation")
  assert.ok(!patch.includes('"startDate"'), "startDate is immutable — never patched")
})

await check("route: diary-update PATCH has no creation side effects or analytics bust", () => {
  const src = readFileSync("src/app/api/diaries/updates/route.ts", "utf8")
  const patch = src.slice(src.indexOf("export async function PATCH"))
  for (const banned of ["awardReputation", "checkBadges", "notifyMany", 'revalidateTag("analytics"', "reverseReputationByKey"]) {
    assert.ok(!patch.includes(banned), `PATCH must not call ${banned}`)
  }
  assert.ok(patch.includes('revalidateTag("diaries"'), "diaries bust required")
  assert.ok(patch.includes('revalidateTag("strains"'), "conditional strains bust required")
  assert.ok(patch.includes("evaluateGrowJourney"), "journey reconciliation required")
  assert.ok(patch.includes("enforceLinkTrust"), "link trust required")
  assert.ok(!patch.includes("growDiary.update"), "PATCH never writes the parent diary")
  assert.ok(patch.includes("MAX_POST_IMAGES"), "server enforces kept + new <= 4")
  // Ownership is enforced in the route, not just in this mirror.
  assert.ok(patch.includes("update.authorId !== session.user.id"), "route must check update author")
  assert.ok(patch.includes("update.diary.authorId !== session.user.id"), "route must check diary author")
  assert.ok(patch.includes("forbidden()"), "non-owner must get 403")
})

await check("route: setup PATCH has no creation side effects or unrelated busts", () => {
  const src = readFileSync("src/app/api/setups/route.ts", "utf8")
  const patch = src.slice(src.indexOf("export async function PATCH"))
  for (const banned of [
    "awardReputation", "checkBadges", "notifyMany", "notification.create",
    'revalidateTag("analytics"', 'revalidateTag("diaries"', 'revalidateTag("leaderboard"',
    "reverseReputation",
  ]) {
    assert.ok(!patch.includes(banned), `PATCH must not call ${banned}`)
  }
  assert.ok(patch.includes('revalidateTag("setups"'), "setups bust required")
  assert.ok(patch.includes('revalidateTag("strains"'), "conditional strains bust required")
  assert.ok(patch.includes("enforceLinkTrust"), "link trust required")
  assert.ok(patch.includes("SETUP_MAX_IMAGES"), "server enforces kept + new <= 6")
  assert.ok(patch.includes("deleted: false"), "guarded write must exclude soft-deleted rows")
  assert.ok(!patch.includes("growDiary.update"), "PATCH never writes diaries")
  // Ownership is enforced in the route, not just in this mirror.
  assert.ok(patch.includes("setup.authorId !== session.user.id"), "route must check setup author")
  assert.ok(patch.includes("forbidden()"), "non-owner must get 403")
})

// ─── Cleanup + summary ───────────────────────────────────────────────
try {
  if (cleanup.diaryIds.length) {
    await prisma.diaryUpdate.deleteMany({ where: { diaryId: { in: cleanup.diaryIds } } })
    await prisma.diaryImage.deleteMany({ where: { update: { diaryId: { in: cleanup.diaryIds } } } })
    await prisma.growDiary.deleteMany({ where: { id: { in: cleanup.diaryIds } } })
  }
  if (cleanup.threadIds.length) await prisma.thread.deleteMany({ where: { id: { in: cleanup.threadIds } } })
  if (cleanup.categoryIds.length) await prisma.category.deleteMany({ where: { id: { in: cleanup.categoryIds } } })
  if (cleanup.setupIds.length) await prisma.growSetup.deleteMany({ where: { id: { in: cleanup.setupIds } } })
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
await prisma.$disconnect()
process.exit(failed.length ? 1 : 0)
