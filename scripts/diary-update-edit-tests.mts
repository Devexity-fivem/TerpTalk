// Diary Update Editing V1 regression tests — parseUpdatePatch validation,
// diffUpdateImages scoping, updatePatchTouchesStrainStats cache decisions,
// and the route's guarded write path (parse → ownership → scoped image diff
// → updateMany) exercised against the dev database.
// Run: npx tsx scripts/diary-update-edit-tests.mts   (dev DB only — guarded)
import "./db-guard.mjs"
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { prisma } from "@/lib/prisma"
import {
  parseUpdatePatch,
  diffUpdateImages,
  updatePatchTouchesStrainStats,
} from "@/lib/diary-update-edit"
import { computeGrowJourney } from "@/lib/grow-journey"
import { stageDurations, growthSummary } from "@/lib/diary-weeks"

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
const DAY = 86400000
const base = new Date("2026-01-01T00:00:00Z").getTime()
const d = (days: number, h = 0) => new Date(base + days * DAY + h * 3600000)

async function mkUser(name: string) {
  const u = await prisma.user.create({
    data: {
      name: `__test_due_${name}_${tag}`,
      ageVerified: true,
      password: "x",
      sessionVersion: 1,
      role: "MEMBER",
      profile: { create: { username: `__test_due_${name}_${tag}` } },
    },
  })
  cleanup.userIds.push(u.id)
  return u
}

async function mkDiary(authorId: string, over: Record<string, unknown> = {}) {
  const dr = await prisma.growDiary.create({
    data: {
      title: `__test_due_d_${tag}`,
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

/** Mirror of the route's write path: scoped image diff + guarded updateMany.
 *  `actorId` mirrors the route's ownership guard — the write refuses to touch
 *  an update the actor does not own. */
async function applyPatch(
  updateId: string,
  data: Record<string, unknown>,
  opts: { keepImageIds?: string[]; newImageUrls?: string[]; actorId?: string } = {}
) {
  const update = await prisma.diaryUpdate.findUnique({
    where: { id: updateId },
    select: { authorId: true, images: { select: { id: true, order: true } } },
  })
  if (!update) throw new Error("not found")
  if (opts.actorId && update.authorId !== opts.actorId) return { count: 0 }
  const { kept, removed } = diffUpdateImages(update.images, opts.keepImageIds)
  const nextOrder = kept.reduce((m, i) => Math.max(m, i.order), -1) + 1
  return prisma.$transaction(async (tx) => {
    if (removed.length) {
      await tx.diaryImage.deleteMany({ where: { updateId, id: { in: removed.map((i) => i.id) } } })
    }
    if (opts.newImageUrls?.length) {
      await tx.diaryImage.createMany({
        data: opts.newImageUrls.map((url, i) => ({ updateId, url, order: nextOrder + i })),
      })
    }
    return tx.diaryUpdate.updateMany({ where: { id: updateId }, data: { ...data, updatedAt: new Date() } })
  })
}

// ─── Allowlist / protected fields ────────────────────────────────────
await check("parser: every editable field + image controls accepted", () => {
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

await check("parser: protected and unknown fields rejected", () => {
  for (const key of [
    "authorId", "diaryId", "createdAt", "updatedAt", "dayNumber", "weekNumber",
    "deleted", "author", "diary", "bogus", "role",
  ]) {
    const r = parseUpdatePatch({ [key]: "x" })
    assert.ok(!r.ok, `${key} must be rejected`)
  }
})

await check("parser: id alone produces empty patch; malformed bodies rejected", () => {
  const r = parseUpdatePatch({ id: "u1" })
  assert.ok(r.ok && r.id === "u1" && Object.keys(r.data).length === 0)
  assert.ok(!parseUpdatePatch({ id: "" }).ok, "empty id rejects")
  assert.ok(!parseUpdatePatch({ id: 42 }).ok, "non-string id rejects")
  for (const body of [null, undefined, "x", 42, [1, 2]]) {
    assert.ok(!parseUpdatePatch(body).ok, `${JSON.stringify(body)} must reject`)
  }
})

// ─── Field validation ────────────────────────────────────────────────
await check("parser: title/content — non-empty, NOT NULL, length caps", () => {
  assert.ok(!parseUpdatePatch({ title: "   " }).ok)
  assert.ok(!parseUpdatePatch({ title: null }).ok)
  assert.ok(!parseUpdatePatch({ title: 42 }).ok)
  assert.ok(!parseUpdatePatch({ title: "x".repeat(101) }).ok)
  assert.ok(!parseUpdatePatch({ content: "  " }).ok)
  assert.ok(!parseUpdatePatch({ content: null }).ok)
  assert.ok(!parseUpdatePatch({ content: "x".repeat(10001) }).ok)
  assert.ok(parseUpdatePatch({ title: "ok", content: "ok" }).ok)
})

await check("parser: stage enum — invalid and null rejected", () => {
  assert.ok(!parseUpdatePatch({ stage: "BOGUS" }).ok)
  assert.ok(!parseUpdatePatch({ stage: null }).ok)
  assert.ok(!parseUpdatePatch({ stage: 5 }).ok)
  const r = parseUpdatePatch({ stage: "VEGETATIVE" })
  assert.ok(r.ok && r.data.stage === "VEGETATIVE")
})

await check("parser: numeric fields — ranges enforced, null clears", () => {
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

await check("parser: feeding/training — trim, 300 cap, null clears", () => {
  const r = parseUpdatePatch({ feeding: "  nutes  ", training: null })
  assert.ok(r.ok && r.data.feeding === "nutes" && r.data.training === null)
  const long = parseUpdatePatch({ feeding: "x".repeat(400) })
  assert.ok(long.ok && (long.data.feeding as string).length === 300, "truncates at 300 like creation")
  assert.ok(!parseUpdatePatch({ feeding: 5 }).ok)
})

await check("parser: images — shape, count, and data-URI validation", () => {
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

// ─── Image diff ──────────────────────────────────────────────────────
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

// ─── Strain-stat cache decision ──────────────────────────────────────
await check("updatePatchTouchesStrainStats: stage/env fields trigger", () => {
  const before = { stage: "VEGETATIVE", temperature: 75, humidity: 50, vpd: 1, ph: 6.5, ec: 1.5 }
  assert.ok(updatePatchTouchesStrainStats(before, { stage: "FLOWER" }))
  assert.ok(updatePatchTouchesStrainStats(before, { temperature: 80 }))
  assert.ok(updatePatchTouchesStrainStats(before, { ph: null }))
  for (const f of ["humidity", "vpd", "ec"]) {
    assert.ok(updatePatchTouchesStrainStats(before, { [f]: 9 }), f)
  }
})

await check("updatePatchTouchesStrainStats: non-stat edits stay cold", () => {
  const before = { stage: "VEGETATIVE", temperature: 75, humidity: 50, vpd: 1, ph: 6.5, ec: 1.5 }
  for (const data of [
    { title: "new" },
    { content: "new body" },
    { feeding: "x" },
    { training: "x" },
    { heightCm: 99 },       // height chart reads live, not via strain stats
    {},                      // image-only edit produces no data keys
    { stage: "VEGETATIVE" }, // unchanged value → no bust
  ]) {
    assert.equal(updatePatchTouchesStrainStats(before, data), false, JSON.stringify(data))
  }
})

// ─── DB: write path ──────────────────────────────────────────────────
const owner = await mkUser("owner")
const diary = await mkDiary(owner.id, { stage: "VEGETATIVE" })

await check("db: patch updates fields; protected fields + createdAt untouched", async () => {
  const u = await prisma.diaryUpdate.create({
    data: { diaryId: diary.id, authorId: owner.id, title: "orig", content: "original body text", stage: "VEGETATIVE", createdAt: d(5), dayNumber: 5, weekNumber: 1 },
  })
  const parsed = parseUpdatePatch({ id: u.id, title: "edited", content: "new body here", temperature: 72, feeding: null })
  assert.ok(parsed.ok)
  await applyPatch(u.id, parsed.data)
  const after = await prisma.diaryUpdate.findUnique({ where: { id: u.id } })
  assert.equal(after?.title, "edited")
  assert.equal(after?.content, "new body here")
  assert.equal(after?.temperature, 72)
  assert.equal(after?.feeding, null)
  assert.equal(after?.authorId, owner.id)
  assert.equal(after?.diaryId, diary.id)
  assert.equal(after?.createdAt.getTime(), d(5).getTime(), "createdAt is authoritative chronology")
  assert.equal(after?.dayNumber, 5, "derived display fields untouched")
  assert.ok(after!.updatedAt.getTime() > after!.createdAt.getTime(), "updatedAt advances → edited marker")
  const diaryAfter = await prisma.growDiary.findUnique({ where: { id: diary.id } })
  assert.equal(diaryAfter?.stage, "VEGETATIVE", "update stage edits never move the diary's stage")
})

await check("db: guarded write — updateMany on missing row returns 0, no resurrection", async () => {
  const res = await prisma.diaryUpdate.updateMany({ where: { id: "missing-id" }, data: { title: "x" } })
  assert.equal(res.count, 0)
})

await check("db: ownership predicate — non-owner patch is refused", async () => {
  const other = await mkUser("notowner")
  const u = await prisma.diaryUpdate.create({
    data: { diaryId: diary.id, authorId: owner.id, title: "mine", content: "x".repeat(12), stage: "VEGETATIVE", createdAt: d(7) },
  })
  const res = await applyPatch(u.id, { title: "hijacked" }, { actorId: other.id })
  assert.equal((res as { count: number }).count, 0, "foreign actor must not write")
  const after = await prisma.diaryUpdate.findUnique({ where: { id: u.id }, select: { title: true } })
  assert.equal(after?.title, "mine")
  const own = await applyPatch(u.id, { title: "renamed" }, { actorId: owner.id })
  assert.equal((own as { count: number }).count, 1, "owner write still succeeds")
})

await check("db: stage edit flows into stage-duration inputs", async () => {
  const dr = await mkDiary(owner.id, { startDate: d(0), harvested: true, harvestedAt: d(40), stage: "HARVEST" })
  const u1 = await prisma.diaryUpdate.create({
    data: { diaryId: dr.id, authorId: owner.id, title: "a", content: "x".repeat(12), stage: "SEEDLING", createdAt: d(1) },
  })
  await prisma.diaryUpdate.create({
    data: { diaryId: dr.id, authorId: owner.id, title: "b", content: "x".repeat(12), stage: "VEGETATIVE", createdAt: d(10) },
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
  await applyPatch(u1.id, parsed.data)
  const post = await summarize()
  assert.equal(post.find((r) => r.stage === "SEEDLING"), undefined, "edited stage relabels history")
  // Both updates are now VEG — one merged run from day 2 through harvest.
  assert.equal(post.find((r) => r.stage === "VEGETATIVE")?.days, 40)
})

await check("db: height edit flows into the live growth series", async () => {
  const dr = await mkDiary(owner.id, { startDate: d(0) })
  const u = await prisma.diaryUpdate.create({
    data: { diaryId: dr.id, authorId: owner.id, title: "h", content: "x".repeat(12), stage: "VEGETATIVE", heightCm: 30, createdAt: d(10) },
  })
  const read = async () =>
    growthSummary(dr, await prisma.diaryUpdate.findMany({
      where: { diaryId: dr.id }, select: { id: true, createdAt: true, stage: true, heightCm: true }, orderBy: { createdAt: "asc" },
    }), d(80))
  assert.equal((await read()).currentHeight, 30)
  await applyPatch(u.id, { heightCm: 45 })
  assert.equal((await read()).currentHeight, 45, "height edit flows through the existing live read")
})

await check("db: image add/remove/replace — scoping, order, 4-image cap", async () => {
  const dr = await mkDiary(owner.id, { startDate: d(0) })
  const u = await prisma.diaryUpdate.create({
    data: { diaryId: dr.id, authorId: owner.id, title: "i", content: "x".repeat(12), stage: "VEGETATIVE",
      images: { create: [{ url: "https://blob/1.webp", order: 0 }, { url: "https://blob/2.webp", order: 1 }] } },
  })
  const other = await prisma.diaryUpdate.create({
    data: { diaryId: dr.id, authorId: owner.id, title: "o", content: "x".repeat(12), stage: "VEGETATIVE",
      images: { create: [{ url: "https://blob/9.webp", order: 0 }] } },
  })

  // Replace: drop image 1, add a new one — new row appends after max order.
  const imgs = await prisma.diaryImage.findMany({ where: { updateId: u.id }, orderBy: { order: "asc" } })
  await applyPatch(u.id, {}, { keepImageIds: [imgs[1].id], newImageUrls: ["https://blob/3.webp"] })
  const after = await prisma.diaryImage.findMany({ where: { updateId: u.id }, orderBy: { order: "asc" } })
  assert.deepEqual(after.map((i) => i.url), ["https://blob/2.webp", "https://blob/3.webp"])
  assert.deepEqual(after.map((i) => i.order), [1, 2], "kept order preserved, new appends after max")

  // Cross-update protection: a keep-list naming the other update's image id
  // can never remove it — the delete is scoped to this updateId.
  const foreign = (await prisma.diaryImage.findFirst({ where: { updateId: other.id } }))!
  await applyPatch(u.id, {}, { keepImageIds: [foreign.id] })
  const foreignAfter = await prisma.diaryImage.findUnique({ where: { id: foreign.id } })
  assert.ok(foreignAfter, "other update's image survives")
  const mine = await prisma.diaryImage.count({ where: { updateId: u.id } })
  assert.equal(mine, 0, "all of this update's images removed by a foreign keep-list")

  // Cap: route rejects kept + new > 4 before touching the DB.
  const parsed = parseUpdatePatch({ id: u.id, images: Array(5).fill("data:image/png;base64,iVBORw0KGgo=") })
  assert.ok(!parsed.ok, "parser already rejects >4 new images")
})

await check("db: journey reconciliation — edit can drop a meaningful day", async () => {
  const dr = await mkDiary(owner.id, { startDate: d(0), createdAt: d(0) })
  const u = await prisma.diaryUpdate.create({
    data: { diaryId: dr.id, authorId: owner.id, title: "j", content: "meaningful update body", stage: "VEGETATIVE", createdAt: d(1) },
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
  await applyPatch(u.id, { content: "ok" })
  assert.equal((await journeyOf()).meaningfulDays, 0, "edit below the meaningful floor reconciles")
})

await check("db: edit awards no creation reputation", async () => {
  const u = await prisma.diaryUpdate.create({
    data: { diaryId: diary.id, authorId: owner.id, title: "r", content: "x".repeat(12), stage: "VEGETATIVE", createdAt: d(6) },
  })
  const before = await prisma.reputationEvent.count({ where: { userId: owner.id, sourceId: diary.id } })
  await applyPatch(u.id, { title: "edited title" })
  const after = await prisma.reputationEvent.count({ where: { userId: owner.id, sourceId: diary.id } })
  assert.equal(after, before, "PATCH must never write a reputation event")
})

// ─── Route source contract ───────────────────────────────────────────
await check("route: PATCH has no creation side effects or analytics bust", () => {
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

// ─── Summary + cleanup ───────────────────────────────────────────────
const failed = results.filter(([s]) => s === "FAIL")
console.log(`\n${results.length - failed.length}/${results.length} passed`)

await prisma.diaryUpdate.deleteMany({ where: { diaryId: { in: cleanup.diaryIds } } })
await prisma.growDiary.deleteMany({ where: { id: { in: cleanup.diaryIds } } })
await prisma.profile.deleteMany({ where: { userId: { in: cleanup.userIds } } })
await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } })
await prisma.$disconnect()
process.exit(failed.length ? 1 : 0)
