// Diary Editing V1 regression tests — parseDiaryPatch validation,
// patchTouchesStrainStats cache decisions, and the route's guarded
// write path (parse → strain/setup lookup → updateMany on deleted:false)
// exercised against the dev database.
// Run: npx tsx scripts/diary-edit-tests.mts   (dev DB only — guarded)
import "./db-guard.mjs"
import { strict as assert } from "node:assert"
import { prisma } from "@/lib/prisma"
import { parseDiaryPatch, patchTouchesStrainStats, DIARY_EDITABLE_FIELDS } from "@/lib/diary-edit"
import { escapeLike, strainFieldMatches, suggestStrainLink } from "@/lib/strain-stats"
import { activeAuthor } from "@/lib/security"

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

async function mkUser(name: string, role = "MEMBER") {
  const u = await prisma.user.create({
    data: {
      name: `__test_de_${name}_${tag}`,
      ageVerified: true,
      password: "x",
      sessionVersion: 1,
      role,
      profile: { create: { username: `__test_de_${name}_${tag}` } },
    },
  })
  cleanup.userIds.push(u.id)
  return u
}

// Mirror of the route's write path for a validated patch.
async function applyPatch(diaryId: string, data: Record<string, unknown>, userId: string) {
  if (typeof data.strainId === "string") {
    const s = await prisma.strain.findUnique({ where: { id: data.strainId }, select: { id: true, name: true } })
    if (!s) throw new Error("Strain not found")
    data.strain = s.name
  }
  if (typeof data.setupId === "string") {
    const setup = await prisma.growSetup.findUnique({ where: { id: data.setupId }, select: { id: true, authorId: true, deleted: true } })
    if (!setup || setup.deleted || setup.authorId !== userId) throw new Error("Setup not found")
  }
  return prisma.growDiary.updateMany({ where: { id: diaryId, deleted: false }, data })
}

const before = {
  strain: "Old Name", strainId: null as string | null, mediumType: "SOIL" as string | null,
  lightType: "LED" as string | null, techniques: ["LST"],
}

// ─── Allowlist / protected fields ────────────────────────────────────
await check("parser: every editable field is accepted", () => {
  const r = parseDiaryPatch({
    title: "T", description: "d", strain: "s", strainId: null, genetics: "g",
    growType: "OUTDOOR", medium: "m", mediumType: "COCO", containerSize: "5g",
    lighting: "l", lightType: "HPS", nutrients: "n", equipment: "e",
    techniques: ["SCROG"], spaceDimensions: "4x4", setupId: null,
  })
  assert.ok(r.ok, "all 16 fields should parse")
  assert.equal(Object.keys(r.data).length, 16)
})

await check("parser: protected and unknown fields rejected", () => {
  for (const key of [
    "startDate", "stage", "harvested", "harvestedAt", "yieldAmount", "yieldUnit",
    "harvestRating", "harvestDifficulty", "harvestNotes", "threadId", "authorId",
    "featured", "deleted", "createdAt", "updatedAt", "id", "updates", "bogus",
  ]) {
    const r = parseDiaryPatch({ [key]: "x" })
    assert.ok(!r.ok, `${key} must be rejected`)
  }
})

await check("parser: omitted keys produce empty patch (leave unchanged)", () => {
  const r = parseDiaryPatch({})
  assert.ok(r.ok)
  assert.equal(Object.keys(r.data).length, 0)
})

await check("parser: malformed bodies rejected", () => {
  for (const body of [null, undefined, "x", 42, [1, 2]]) {
    assert.ok(!parseDiaryPatch(body).ok, `${JSON.stringify(body)} must reject`)
  }
})

// ─── Field validation ────────────────────────────────────────────────
await check("parser: title — non-string, empty, oversized rejected", () => {
  assert.ok(!parseDiaryPatch({ title: 42 }).ok)
  assert.ok(!parseDiaryPatch({ title: "   " }).ok)
  assert.ok(!parseDiaryPatch({ title: "x".repeat(101) }).ok)
  assert.ok(parseDiaryPatch({ title: "ok" }).ok)
})

await check("parser: description — null rejected (NOT NULL col), oversized rejected", () => {
  assert.ok(!parseDiaryPatch({ description: null }).ok)
  assert.ok(!parseDiaryPatch({ description: 7 }).ok)
  assert.ok(!parseDiaryPatch({ description: "x".repeat(2001) }).ok)
  assert.ok(parseDiaryPatch({ description: "" }).ok)
})

await check("parser: free-text fields — null allowed, oversized rejected", () => {
  for (const f of ["genetics", "medium", "containerSize", "lighting", "nutrients", "equipment", "spaceDimensions"]) {
    assert.ok(!parseDiaryPatch({ [f]: "x".repeat(501) }).ok, `${f} >500 must reject`)
    const r = parseDiaryPatch({ [f]: null })
    assert.ok(r.ok && r.data[f] === null, `${f}: null clears`)
  }
  assert.ok(!parseDiaryPatch({ strain: "x".repeat(501) }).ok)
})

await check("parser: growType enum", () => {
  assert.ok(!parseDiaryPatch({ growType: "BOGUS" }).ok)
  assert.ok(!parseDiaryPatch({ growType: null }).ok)
  const r = parseDiaryPatch({ growType: "GREENHOUSE" })
  assert.ok(r.ok && r.data.growType === "GREENHOUSE")
})

await check("parser: mediumType/lightType — invalid rejects, null clears", () => {
  assert.ok(!parseDiaryPatch({ mediumType: "BOGUS" }).ok)
  assert.ok(!parseDiaryPatch({ lightType: "BOGUS" }).ok)
  const r = parseDiaryPatch({ mediumType: null, lightType: null })
  assert.ok(r.ok && r.data.mediumType === null && r.data.lightType === null)
})

await check("parser: techniques — strict array semantics", () => {
  assert.ok(!parseDiaryPatch({ techniques: "LST" }).ok, "non-array rejects")
  assert.ok(!parseDiaryPatch({ techniques: null }).ok, "null rejects (non-nullable column)")
  assert.ok(!parseDiaryPatch({ techniques: ["LST", "BOGUS"] }).ok, "any invalid rejects")
  const r = parseDiaryPatch({ techniques: [] })
  assert.ok(r.ok && (r.data.techniques as string[]).length === 0, "empty array clears")
})

await check("parser: strainId/setupId shape — non-string rejects, blank → null", () => {
  assert.ok(!parseDiaryPatch({ strainId: 42 }).ok)
  assert.ok(!parseDiaryPatch({ setupId: {} }).ok)
  const r = parseDiaryPatch({ strainId: "  ", setupId: "" })
  assert.ok(r.ok && r.data.strainId === null && r.data.setupId === null)
})

// ─── Cache-invalidation decision ─────────────────────────────────────
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

// ─── DB: apply patches like the route ────────────────────────────────
await check("db: owner patch persists editable fields, leaves protected untouched", async () => {
  const u = await mkUser("own")
  const dr = await prisma.growDiary.create({
    data: {
      title: `__test_de_d1_${tag}`, description: "orig", growType: "INDOOR",
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
  await applyPatch(dr.id, r.data, u.id)
  const d = await prisma.growDiary.findUnique({ where: { id: dr.id } })
  assert.equal(d?.title, "Renamed")
  assert.equal(d?.mediumType, "COCO")
  assert.deepEqual(d?.techniques, ["SCROG", "TOPPING"])
  assert.equal(d?.stage, "VEGETATIVE", "stage untouched")
  assert.equal(d?.harvested, false)
  assert.equal(d?.startDate.toISOString(), new Date("2026-01-01").toISOString(), "startDate immutable")
  assert.equal(d?.authorId, u.id)
})

await check("db: catalog strainId syncs strain text; strainId null retains text", async () => {
  const u = await mkUser("strain")
  const s = await prisma.strain.create({ data: { name: `__test_de_Strain_${tag}` } })
  cleanup.strainIds.push(s.id)
  const dr = await prisma.growDiary.create({
    data: { title: `__test_de_d2_${tag}`, description: "", growType: "INDOOR", startDate: new Date(), authorId: u.id },
  })
  cleanup.diaryIds.push(dr.id)

  const link = parseDiaryPatch({ strainId: s.id })
  assert.ok(link.ok)
  await applyPatch(dr.id, link.data, u.id)
  let d = await prisma.growDiary.findUnique({ where: { id: dr.id }, select: { strain: true, strainId: true } })
  assert.equal(d?.strainId, s.id)
  assert.equal(d?.strain, s.name, "catalog name wins the text field")

  const unlink = parseDiaryPatch({ strainId: null })
  assert.ok(unlink.ok)
  await applyPatch(dr.id, unlink.data, u.id)
  d = await prisma.growDiary.findUnique({ where: { id: dr.id }, select: { strain: true, strainId: true } })
  assert.equal(d?.strainId, null)
  assert.equal(d?.strain, s.name, "text survives unlink")

  await assert.rejects(() => applyPatch(dr.id, { strainId: "nonexistent-id" }, u.id), /Strain not found/)
})

await check("db: setup ownership — own links, foreign/deleted/missing rejected", async () => {
  const owner = await mkUser("sown")
  const other = await mkUser("soth")
  const own = await prisma.growSetup.create({ data: { title: "own", description: "", authorId: owner.id } })
  const foreign = await prisma.growSetup.create({ data: { title: "foreign", description: "", authorId: other.id } })
  const deleted = await prisma.growSetup.create({ data: { title: "gone", description: "", authorId: owner.id, deleted: true } })
  cleanup.setupIds.push(own.id, foreign.id, deleted.id)
  const dr = await prisma.growDiary.create({
    data: { title: `__test_de_d3_${tag}`, description: "", growType: "INDOOR", startDate: new Date(), authorId: owner.id },
  })
  cleanup.diaryIds.push(dr.id)

  await applyPatch(dr.id, { setupId: own.id }, owner.id)
  let d = await prisma.growDiary.findUnique({ where: { id: dr.id }, select: { setupId: true } })
  assert.equal(d?.setupId, own.id)

  for (const [name, sid] of [["foreign", foreign.id], ["deleted", deleted.id], ["missing", "nope"]] as const) {
    await assert.rejects(() => applyPatch(dr.id, { setupId: sid }, owner.id), /Setup not found/, name)
  }

  await applyPatch(dr.id, { setupId: null }, owner.id)
  d = await prisma.growDiary.findUnique({ where: { id: dr.id }, select: { setupId: true } })
  assert.equal(d?.setupId, null, "null unlinks")
})

await check("db: deleted diary write is a no-op (404 path)", async () => {
  const u = await mkUser("del")
  const dr = await prisma.growDiary.create({
    data: { title: `__test_de_d4_${tag}`, description: "", growType: "INDOOR", startDate: new Date(), authorId: u.id, deleted: true },
  })
  cleanup.diaryIds.push(dr.id)
  const res = await applyPatch(dr.id, { title: "nope" }, u.id)
  assert.equal(res.count, 0, "guarded update touches nothing")
})

await check("db: edit leaves threadId and updates intact", async () => {
  const u = await mkUser("thread")
  const dr = await prisma.growDiary.create({
    data: { title: `__test_de_d5_${tag}`, description: "", growType: "INDOOR", startDate: new Date(), authorId: u.id },
  })
  cleanup.diaryIds.push(dr.id)
  const up = await prisma.diaryUpdate.create({
    data: { diaryId: dr.id, authorId: u.id, title: "u", content: "x".repeat(12), stage: "VEGETATIVE", heightCm: 30 },
  })
  const cat = await prisma.category.upsert({
    where: { slug: `__test_de_cat_${tag}` },
    create: { slug: `__test_de_cat_${tag}`, name: "test", description: "test" },
    update: {},
  })
  cleanup.categoryIds.push(cat.id)
  const th = await prisma.thread.create({
    data: { title: "t", slug: `__test_de_th_${tag}`, content: "x", categoryId: cat.id, authorId: u.id },
  })
  cleanup.threadIds.push(th.id)
  await prisma.growDiary.update({ where: { id: dr.id }, data: { threadId: th.id } })
  await applyPatch(dr.id, { title: "After", strain: "NewStrain" }, u.id)
  const d = await prisma.growDiary.findUnique({ where: { id: dr.id }, select: { threadId: true } })
  assert.equal(d?.threadId, th.id, "canonical discussion link unchanged")
  const still = await prisma.diaryUpdate.findUnique({ where: { id: up.id }, select: { heightCm: true } })
  assert.equal(still?.heightCm, 30, "historical update untouched")
})

await check("db: strain stats reflect edited membership", async () => {
  const u = await mkUser("stats")
  const s = await prisma.strain.create({ data: { name: `__test_de_Stats_${tag}` } })
  cleanup.strainIds.push(s.id)
  const dr = await prisma.growDiary.create({
    data: { title: `__test_de_d6_${tag}`, description: "", growType: "INDOOR", startDate: new Date(), authorId: u.id, strain: "unrelated" },
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
    return rows.filter((d) => d.strainId === s.id || strainFieldMatches(d.strain, s.name)).length
  }
  assert.equal(await memberCount(), 0, "not counted before link")
  await applyPatch(dr.id, { strainId: s.id }, u.id)
  assert.equal(await memberCount(), 1, "counted after link")
  await applyPatch(dr.id, { strainId: null, strain: "unrelated" }, u.id)
  assert.equal(await memberCount(), 0, "uncounted after unlink")
})

// ─── suggestStrainLink ───────────────────────────────────────────────
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

await check("db: editable-field allowlist matches schema", () => {
  // Guard against drift: every allowlisted key must be a real GrowDiary field.
  const fields = (prisma as unknown as { _runtimeDataModel: { models: { GrowDiary: { fields: { name: string }[] } } } })
    ._runtimeDataModel.models.GrowDiary.fields.map((f) => f.name)
  for (const k of DIARY_EDITABLE_FIELDS) assert.ok(fields.includes(k), `${k} not a GrowDiary field`)
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
if (failed.length) process.exit(1)
