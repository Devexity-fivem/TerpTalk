// Grow Setup Editing V1 regression tests — parseSetupPatch validation,
// image-diff scoping, setupPatchTouchesStrainStats cache decisions, and
// the route's guarded write path (parse → ownership → scoped image diff
// → updateMany) exercised against the dev database.
// Run: npx tsx scripts/setup-edit-tests.mts   (dev DB only — guarded)
import "./db-guard.mjs"
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { prisma } from "@/lib/prisma"
import { LIMITS } from "@/lib/security"
import {
  parseSetupPatch,
  setupPatchTouchesStrainStats,
  SETUP_MAX_IMAGES,
  SETUP_SPEC_FIELDS,
} from "@/lib/setup-edit"
import { diffUpdateImages } from "@/lib/diary-update-edit"

const tag = Date.now().toString(36)
const results: [string, string][] = []
const pass = (n: string) => { results.push(["PASS", n]); console.log(`  ✓ ${n}`) }
const fail = (n: string, i: unknown) => { results.push(["FAIL", n]); console.log(`  ✗ ${n} — ${JSON.stringify(i)?.slice(0, 300)}`) }
const check = (n: string, fn: () => Promise<void> | void) =>
  Promise.resolve()
    .then(fn)
    .then(() => pass(n))
    .catch((e) => fail(n, e instanceof Error ? e.message : e))

const cleanup = { userIds: [] as string[], setupIds: [] as string[], diaryIds: [] as string[] }

async function mkUser(name: string) {
  const u = await prisma.user.create({
    data: {
      name: `__test_se_${name}_${tag}`,
      ageVerified: true,
      password: "x",
      sessionVersion: 1,
      role: "MEMBER",
      profile: { create: { username: `__test_se_${name}_${tag}` } },
    },
  })
  cleanup.userIds.push(u.id)
  return u
}

async function mkSetup(authorId: string, over: Record<string, unknown> = {}) {
  const s = await prisma.growSetup.create({
    data: {
      title: `__test_se_s_${tag}`,
      description: "",
      authorId,
      ...over,
    },
  })
  cleanup.setupIds.push(s.id)
  return s
}

/** Mirror of the route's write path: scoped image diff + guarded updateMany.
 *  `actorId` mirrors the route's ownership guard — the write refuses to touch
 *  a setup the actor does not own. */
async function applyPatch(
  setupId: string,
  data: Record<string, unknown>,
  opts: { keepImageIds?: string[]; newImageUrls?: string[]; actorId?: string } = {}
) {
  const setup = await prisma.growSetup.findUnique({
    where: { id: setupId },
    select: { authorId: true, images: { select: { id: true, order: true } } },
  })
  if (!setup) throw new Error("not found")
  if (opts.actorId && setup.authorId !== opts.actorId) return { count: 0 }
  const { kept, removed } = diffUpdateImages(setup.images, opts.keepImageIds)
  const nextOrder = kept.reduce((m, i) => Math.max(m, i.order), -1) + 1
  return prisma.$transaction(async (tx) => {
    if (removed.length) {
      await tx.setupImage.deleteMany({ where: { setupId, id: { in: removed.map((i) => i.id) } } })
    }
    if (opts.newImageUrls?.length) {
      await tx.setupImage.createMany({
        data: opts.newImageUrls.map((url, i) => ({ setupId, url, order: nextOrder + i })),
      })
    }
    return tx.growSetup.updateMany({
      where: { id: setupId, deleted: false },
      data: { ...data, updatedAt: new Date() },
    })
  })
}

// ─── Allowlist / protected fields ────────────────────────────────────
await check("parser: every editable field + image controls accepted", () => {
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

await check("parser: protected and unknown fields rejected", () => {
  for (const key of [
    "authorId", "createdAt", "updatedAt", "deleted",
    "author", "diaries", "comments", "setupId", "bogus", "role",
  ]) {
    const r = parseSetupPatch({ [key]: "x" })
    assert.ok(!r.ok, `${key} must be rejected`)
  }
})

await check("parser: id alone produces empty patch; malformed bodies rejected", () => {
  const r = parseSetupPatch({ id: "s1" })
  assert.ok(r.ok && r.id === "s1" && Object.keys(r.data).length === 0)
  assert.ok(!parseSetupPatch({ id: "" }).ok, "empty id rejects")
  assert.ok(!parseSetupPatch({ id: 42 }).ok, "non-string id rejects")
  for (const body of [null, undefined, "x", 42, [1, 2]]) {
    assert.ok(!parseSetupPatch(body).ok, `${JSON.stringify(body)} must reject`)
  }
})

// ─── Field validation ────────────────────────────────────────────────
await check("parser: title — required non-empty, TITLE_MAX cap", () => {
  assert.ok(!parseSetupPatch({ title: "   " }).ok)
  assert.ok(!parseSetupPatch({ title: null }).ok)
  assert.ok(!parseSetupPatch({ title: 42 }).ok)
  assert.ok(!parseSetupPatch({ title: "x".repeat(LIMITS.TITLE_MAX + 1) }).ok)
  assert.ok(parseSetupPatch({ title: "ok" }).ok)
})

await check("parser: description — NOT NULL, empty string ok, 500 cap", () => {
  assert.ok(!parseSetupPatch({ description: null }).ok, "null rejected — column is NOT NULL")
  assert.ok(!parseSetupPatch({ description: 42 }).ok)
  assert.ok(!parseSetupPatch({ description: "x".repeat(501) }).ok)
  const r = parseSetupPatch({ description: "" })
  assert.ok(r.ok && r.data.description === "", "empty string accepted like creation")
})

await check("parser: spec fields — 500 cap, null clears, trim-to-null", () => {
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

await check("parser: images — shape, count, and data-URI validation", () => {
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

// ─── Strain-stat cache decision ──────────────────────────────────────
await check("setupPatchTouchesStrainStats: strain change triggers, nothing else does", () => {
  const before = { strain: "OG Kush" }
  assert.ok(setupPatchTouchesStrainStats(before, { strain: "Blue Dream" }))
  assert.ok(setupPatchTouchesStrainStats(before, { strain: null }), "clearing strain still changes it")
  for (const data of [
    { title: "new" },
    { description: "new" },
    { lighting: "1000W HPS" },
    { medium: "coco" },
    {},                       // image-only edit produces no data keys
    { strain: "OG Kush" },    // unchanged value → no bust
  ]) {
    assert.equal(setupPatchTouchesStrainStats(before, data), false, JSON.stringify(data))
  }
})

// ─── DB: write path ──────────────────────────────────────────────────
const owner = await mkUser("owner")

await check("db: patch updates fields; protected fields + createdAt untouched", async () => {
  const s = await mkSetup(owner.id, { title: "orig", description: "orig desc", lighting: "LED 600W", strain: "OG" })
  const createdAt = s.createdAt
  const parsed = parseSetupPatch({ id: s.id, title: "edited", lighting: "HPS 1000W", medium: null })
  assert.ok(parsed.ok)
  await applyPatch(s.id, parsed.data)
  const after = await prisma.growSetup.findUnique({ where: { id: s.id } })
  assert.equal(after?.title, "edited")
  assert.equal(after?.lighting, "HPS 1000W")
  assert.equal(after?.medium, null)
  assert.equal(after?.authorId, owner.id, "authorId unchanged")
  assert.equal(after?.createdAt.getTime(), createdAt.getTime(), "createdAt unchanged")
  assert.ok(after!.updatedAt.getTime() > createdAt.getTime(), "updatedAt advances → edited marker")
})

await check("db: guarded write — soft-deleted setup yields count 0, no resurrection", async () => {
  const s = await mkSetup(owner.id)
  await prisma.growSetup.update({ where: { id: s.id }, data: { deleted: true } })
  const res = await applyPatch(s.id, { title: "x" })
  assert.equal(res.count, 0, "deleted:false guard blocks resurrection")
  const after = await prisma.growSetup.findUnique({ where: { id: s.id } })
  assert.equal(after?.deleted, true)
  assert.equal(after?.title, "__test_se_s_" + tag, "deleted row untouched")
})

await check("db: linked diary keeps setupId; edit never mutates the diary", async () => {
  const s = await mkSetup(owner.id, { title: "linked setup" })
  const diary = await prisma.growDiary.create({
    data: {
      title: `__test_se_d_${tag}`, description: "", growType: "INDOOR",
      startDate: new Date("2026-01-01T00:00:00Z"), authorId: owner.id, setupId: s.id,
    },
  })
  cleanup.diaryIds.push(diary.id)
  const diaryBefore = await prisma.growDiary.findUnique({ where: { id: diary.id } })

  await applyPatch(s.id, { title: "renamed setup", lighting: "LED 900W" })

  const diaryAfter = await prisma.growDiary.findUnique({ where: { id: diary.id } })
  assert.equal(diaryAfter?.setupId, s.id, "diary keeps pointing at the same setup after edit")
  assert.equal(
    diaryAfter?.updatedAt.getTime(), diaryBefore?.updatedAt.getTime(),
    "editing a setup never writes the diary row"
  )
})

await check("db: hard delete still SetNulls linked diaries", async () => {
  const s = await mkSetup(owner.id)
  const diary = await prisma.growDiary.create({
    data: {
      title: `__test_se_d_${tag}`, description: "", growType: "INDOOR",
      startDate: new Date("2026-01-01T00:00:00Z"), authorId: owner.id, setupId: s.id,
    },
  })
  cleanup.diaryIds.push(diary.id)
  await prisma.growSetup.delete({ where: { id: s.id } })
  const after = await prisma.growDiary.findUnique({ where: { id: diary.id } })
  assert.equal(after?.setupId, null, "onDelete: SetNull preserved")
})

await check("db: image add/remove/replace — scoping, order, 6-image cap", async () => {
  const s = await mkSetup(owner.id, {
    images: { create: [{ url: "https://blob/1.webp", order: 0 }, { url: "https://blob/2.webp", order: 1 }] },
  })
  const other = await mkSetup(owner.id, {
    images: { create: [{ url: "https://blob/9.webp", order: 0 }] },
  })

  // Replace: drop image 1, add a new one — new row appends after max order.
  const imgs = await prisma.setupImage.findMany({ where: { setupId: s.id }, orderBy: { order: "asc" } })
  await applyPatch(s.id, {}, { keepImageIds: [imgs[1].id], newImageUrls: ["https://blob/3.webp"] })
  const after = await prisma.setupImage.findMany({ where: { setupId: s.id }, orderBy: { order: "asc" } })
  assert.deepEqual(after.map((i) => i.url), ["https://blob/2.webp", "https://blob/3.webp"])
  assert.deepEqual(after.map((i) => i.order), [1, 2], "kept order preserved, new appends after max")

  // Cross-setup protection: a keep-list naming the other setup's image id
  // can never remove it — the delete is scoped to this setupId.
  const foreign = (await prisma.setupImage.findFirst({ where: { setupId: other.id } }))!
  await applyPatch(s.id, {}, { keepImageIds: [foreign.id] })
  const foreignAfter = await prisma.setupImage.findUnique({ where: { id: foreign.id } })
  assert.ok(foreignAfter, "other setup's image survives")
  const mine = await prisma.setupImage.count({ where: { setupId: s.id } })
  assert.equal(mine, 0, "all of this setup's images removed by a foreign keep-list")

  // Cap: route rejects kept + new > 6 before touching the DB.
  const parsed = parseSetupPatch({ id: s.id, images: Array(7).fill("data:image/png;base64,iVBORw0KGgo=") })
  assert.ok(!parsed.ok, "parser already rejects >6 new images")
})

await check("db: edit awards no creation reputation", async () => {
  const s = await mkSetup(owner.id)
  const before = await prisma.reputationEvent.count({ where: { userId: owner.id, sourceId: s.id } })
  await applyPatch(s.id, { title: "edited title" })
  const after = await prisma.reputationEvent.count({ where: { userId: owner.id, sourceId: s.id } })
  assert.equal(after, before, "PATCH must never write a reputation event")
})

// ─── Route source contract ───────────────────────────────────────────
await check("route: PATCH has no creation side effects or unrelated busts", () => {
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

await check("db: ownership predicate — non-owner patch is refused", async () => {
  const otherUser = await mkUser("notowner")
  const s = await mkSetup(owner.id)
  const res = await applyPatch(s.id, { title: "hijacked" }, { actorId: otherUser.id })
  assert.equal((res as { count: number }).count, 0, "foreign actor must not write")
  const after = await prisma.growSetup.findUnique({ where: { id: s.id }, select: { title: true } })
  assert.notEqual(after?.title, "hijacked")
  const own = await applyPatch(s.id, { title: "renamed" }, { actorId: owner.id })
  assert.equal((own as { count: number }).count, 1, "owner write still succeeds")
})

// ─── Summary + cleanup ───────────────────────────────────────────────
const failed = results.filter(([s]) => s === "FAIL")
console.log(`\n${results.length - failed.length}/${results.length} passed`)

await prisma.growDiary.deleteMany({ where: { id: { in: cleanup.diaryIds } } })
await prisma.growSetup.deleteMany({ where: { id: { in: cleanup.setupIds } } })
await prisma.profile.deleteMany({ where: { userId: { in: cleanup.userIds } } })
await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } })
await prisma.$disconnect()
process.exit(failed.length ? 1 : 0)
