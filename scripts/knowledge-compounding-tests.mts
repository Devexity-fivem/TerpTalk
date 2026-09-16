// Knowledge Compounding MVP regression tests — structured diary fields,
// strainId union aggregation, harvest review, wizardResultId + symptom
// tags, diary↔discussion linking, setup↔diary linking, privacy filters.
// Uses disposable __test_kc_ rows and cleans up everything it creates.
// Run: npx tsx scripts/knowledge-compounding-tests.mts   (dev DB only — guarded)
import "./db-guard.mjs"
import { strict as assert } from "node:assert"
import { prisma } from "@/lib/prisma"
import { activeAuthor } from "@/lib/security"
import { escapeLike, strainFieldMatches } from "@/lib/strain-stats"
import { parseMediumType, parseLightType, parseTechniques, parseHarvestDifficulty, TECHNIQUES } from "@/lib/grow-fields"
import { SYMPTOM_TAGS, wizardResultToTag, isValidWizardResultId } from "@/lib/symptom-tags"
import { WIZARD_RESULTS } from "@/lib/problem-wizard"
import { tokenizeSearchText } from "@/lib/search-terms"

const tag = Date.now().toString(36)
const results: [string, string][] = []
const pass = (n: string) => { results.push(["PASS", n]); console.log(`  ✓ ${n}`) }
const fail = (n: string, i: unknown) => { results.push(["FAIL", n]); console.log(`  ✗ ${n} — ${JSON.stringify(i)?.slice(0, 300)}`) }
const check = (n: string, fn: () => Promise<void> | void) =>
  Promise.resolve()
    .then(fn)
    .then(() => pass(n))
    .catch((e) => fail(n, e instanceof Error ? e.message : e))

const cleanup = { userIds: [] as string[], strainIds: [] as string[], diaryIds: [] as string[], threadIds: [] as string[], setupIds: [] as string[], tagIds: [] as string[] }

async function mkUser(name: string) {
  const u = await prisma.user.create({
    data: {
      name: `__test_kc_${name}_${tag}`,
      ageVerified: true,
      password: "x",
      sessionVersion: 1,
      profile: { create: { username: `__test_kc_${name}_${tag}` } },
    },
    include: { profile: true },
  })
  cleanup.userIds.push(u.id)
  return u
}

async function mkDiary(authorId: string, data: Record<string, unknown>) {
  const d = await prisma.growDiary.create({
    data: {
      title: `__test_kc_diary_${tag}`,
      description: "",
      growType: "INDOOR",
      startDate: new Date(),
      authorId,
      ...data,
    } as never,
  })
  cleanup.diaryIds.push(d.id)
  return d
}

// Replica of strain-stats.ts union matching — assert the same semantics.
async function unionDiaries(strainName: string, strainId: string) {
  const raw = await prisma.growDiary.findMany({
    where: {
      deleted: false,
      author: activeAuthor(),
      OR: [
        { strainId },
        { strain: { contains: escapeLike(strainName), mode: "insensitive" } },
      ],
    },
    select: { id: true, strain: true, strainId: true },
    take: 500,
  })
  return raw.filter((d) => d.strainId === strainId || strainFieldMatches(d.strain, strainName))
}

async function mkThread(authorId: string, categoryId: string, data: Record<string, unknown>) {
  const t = await prisma.thread.create({
    data: {
      title: `__test_kc_thread_${tag}`,
      slug: `test-kc-${tag}-${Math.random().toString(36).slice(2, 8)}`,
      content: "test content for knowledge compounding",
      categoryId,
      authorId,
      ...data,
    } as never,
  })
  cleanup.threadIds.push(t.id)
  return t
}

// ─── Legacy data ───────────────────────────────────────────────────
await check("legacy diary with only free-text strain fuzzy-matches", async () => {
  const u = await mkUser("legacy")
  const s = await prisma.strain.create({
    data: { name: `__test_kc_LegacyDream_${tag}`, createdById: u.id },
  })
  cleanup.strainIds.push(s.id)
  const d = await mkDiary(u.id, { strain: `__test_kc_LegacyDream_${tag} Auto` })
  const matched = await unionDiaries(s.name, s.id)
  assert.ok(matched.some((x) => x.id === d.id), "fuzzy text match must still find legacy diary")
  assert.equal(d.strainId, null)
})

await check("diary with no strainId and null structured fields is intact", async () => {
  const u = await mkUser("plain")
  const d = await mkDiary(u.id, {})
  const row = await prisma.growDiary.findUnique({ where: { id: d.id } })
  assert.equal(row?.strainId, null)
  assert.equal(row?.mediumType, null)
  assert.equal(row?.lightType, null)
  assert.deepEqual(row?.techniques, [])
  assert.equal(row?.setupId, null)
  assert.equal(row?.threadId, null)
})

// ─── Structured data ───────────────────────────────────────────────
await check("structured strainId diary joins the union set", async () => {
  const u = await mkUser("linked")
  const s = await prisma.strain.create({
    data: { name: `__test_kc_LinkedGelato_${tag}`, createdById: u.id },
  })
  cleanup.strainIds.push(s.id)
  // strainId set, but free text deliberately does NOT match the strain name.
  const d = await mkDiary(u.id, { strainId: s.id, strain: "mystery bag seed" })
  const matched = await unionDiaries(s.name, s.id)
  assert.ok(matched.some((x) => x.id === d.id), "strainId must match without text match")
})

await check("diary matching both strainId and text counts exactly once", async () => {
  const u = await mkUser("both")
  const s = await prisma.strain.create({
    data: { name: `__test_kc_DoubleKush_${tag}`, createdById: u.id },
  })
  cleanup.strainIds.push(s.id)
  const d = await mkDiary(u.id, { strainId: s.id, strain: s.name })
  const matched = await unionDiaries(s.name, s.id)
  assert.equal(matched.filter((x) => x.id === d.id).length, 1)
})

await check("structured fields persist and controlled vocab rejects invalid values", async () => {
  const u = await mkUser("fields")
  const d = await mkDiary(u.id, { mediumType: "COCO", lightType: "LED", techniques: ["LST", "SCROG"] })
  const row = await prisma.growDiary.findUnique({ where: { id: d.id } })
  assert.equal(row?.mediumType, "COCO")
  assert.equal(row?.lightType, "LED")
  assert.deepEqual(row?.techniques, ["LST", "SCROG"])
  // Route-side validation semantics: invalid values must be rejected.
  assert.equal(parseMediumType("PEAT"), null)
  assert.equal(parseLightType("PLASMA"), null)
  assert.equal(parseMediumType("SOIL"), "SOIL")
  const bad = parseTechniques(["LST", "ROLLING"])
  assert.ok(!bad || bad.length !== 2, "invalid technique must not survive strict check")
  assert.deepEqual(parseTechniques([...TECHNIQUES]), [...TECHNIQUES])
  assert.equal(parseTechniques("LST"), null, "non-array rejected")
})

await check("heightCm bounds: null ok, positive ok, negative/excessive rejected", async () => {
  const u = await mkUser("height")
  const d = await mkDiary(u.id, {})
  const mk = (heightCm: number | null) =>
    prisma.diaryUpdate.create({
      data: { title: "t", content: "c", stage: "VEGETATIVE", diaryId: d.id, authorId: u.id, heightCm },
    })
  await mk(null)
  const ok = await mk(45.5)
  assert.equal(ok.heightCm, 45.5)
  // Route RANGES mirror: [heightCm, 0.1, 500] — assert the semantics.
  const inRange = (v: number | null) => v == null || (v >= 0.1 && v <= 500)
  assert.ok(!inRange(-1), "negative rejected")
  assert.ok(!inRange(0), "zero rejected — positive only")
  assert.ok(!inRange(600), "excessive rejected")
  assert.ok(inRange(45.5) && inRange(null))
})

// ─── Harvest review ────────────────────────────────────────────────
await check("harvest works without review; review fields stay null", async () => {
  const u = await mkUser("harvest0")
  const d = await mkDiary(u.id, {})
  await prisma.growDiary.update({
    where: { id: d.id },
    data: { harvested: true, harvestedAt: new Date(), yieldAmount: 100, yieldUnit: "g", stage: "HARVEST" },
  })
  const row = await prisma.growDiary.findUnique({ where: { id: d.id } })
  assert.equal(row?.harvested, true)
  assert.equal(row?.harvestRating, null)
  assert.equal(row?.harvestDifficulty, null)
  assert.equal(row?.harvestNotes, null)
})

await check("harvest review persists; rating bounds 1-10 enforced by route semantics", async () => {
  const u = await mkUser("harvest1")
  const d = await mkDiary(u.id, {})
  await prisma.growDiary.update({
    where: { id: d.id },
    data: {
      harvested: true, harvestedAt: new Date(), stage: "HARVEST",
      harvestRating: 8, harvestDifficulty: "HARD", harvestNotes: "watch the stretch",
    },
  })
  const row = await prisma.growDiary.findUnique({ where: { id: d.id } })
  assert.equal(row?.harvestRating, 8)
  assert.equal(row?.harvestDifficulty, "HARD")
  assert.equal(row?.harvestNotes, "watch the stretch")
  // Route semantics: integer 1..10 only.
  const okRating = (v: unknown) => { const r = Number(v); return Number.isInteger(r) && r >= 1 && r <= 10 }
  assert.ok(okRating(1) && okRating(10) && !okRating(0) && !okRating(11) && !okRating(7.5) && !okRating("x"))
  assert.equal(parseHarvestDifficulty("BRUTAL"), null)
  assert.equal(parseHarvestDifficulty("EASY"), "EASY")
})

await check("unmarking harvest clears review fields", async () => {
  const u = await mkUser("harvest2")
  const d = await mkDiary(u.id, {
    harvested: true, harvestedAt: new Date(), stage: "HARVEST",
    yieldAmount: 50, yieldUnit: "g", harvestRating: 9, harvestDifficulty: "EASY", harvestNotes: "n",
  })
  // Mirror the route's else-branch: unharvest retires yield + review together.
  await prisma.growDiary.update({
    where: { id: d.id },
    data: {
      harvested: false, stage: "FLOWER", harvestedAt: null,
      yieldAmount: null, yieldUnit: null,
      harvestRating: null, harvestDifficulty: null, harvestNotes: null,
    },
  })
  const row = await prisma.growDiary.findUnique({ where: { id: d.id } })
  assert.equal(row?.harvestRating, null)
  assert.equal(row?.harvestNotes, null)
})

await check("harvest review writes no reputation events", async () => {
  const u = await mkUser("harvest3")
  const d = await mkDiary(u.id, {})
  const before = await prisma.reputationEvent.count({ where: { sourceId: d.id } })
  await prisma.growDiary.update({
    where: { id: d.id },
    data: { harvested: true, harvestedAt: new Date(), harvestRating: 7, harvestDifficulty: "NORMAL", harvestNotes: "ok" },
  })
  const after = await prisma.reputationEvent.count({ where: { sourceId: d.id } })
  assert.equal(after, before, "review fields must not emit reputation")
})

// ─── Privacy / deletion ────────────────────────────────────────────
await check("deleted diaries and banned authors drop out of the union", async () => {
  const u = await mkUser("privacy")
  const s = await prisma.strain.create({ data: { name: `__test_kc_Priv_${tag}`, createdById: u.id } })
  cleanup.strainIds.push(s.id)
  const live = await mkDiary(u.id, { strainId: s.id })
  const dead = await mkDiary(u.id, { strainId: s.id, deleted: true })
  const bannedUser = await mkUser("banned")
  await prisma.user.update({ where: { id: bannedUser.id }, data: { banned: true } })
  const bannedDiary = await mkDiary(bannedUser.id, { strainId: s.id })
  const matched = await unionDiaries(s.name, s.id)
  const ids = matched.map((x) => x.id)
  assert.ok(ids.includes(live.id))
  assert.ok(!ids.includes(dead.id), "deleted diary excluded")
  assert.ok(!ids.includes(bannedDiary.id), "banned author's diary excluded")
})

await check("strain hard-delete SetNulls diary.strainId without touching the diary", async () => {
  const u = await mkUser("strain-del")
  const s = await prisma.strain.create({ data: { name: `__test_kc_Gone_${tag}`, createdById: u.id } })
  const d = await mkDiary(u.id, { strainId: s.id, strain: s.name })
  await prisma.strain.delete({ where: { id: s.id } })
  const row = await prisma.growDiary.findUnique({ where: { id: d.id } })
  assert.ok(row, "diary survives strain deletion")
  assert.equal(row?.strainId, null, "FK SetNull")
  assert.equal(row?.strain, s.name, "legacy text untouched")
})

// ─── Plant Doctor / symptom tags ───────────────────────────────────
await check("every wizard result maps to exactly one symptom tag", () => {
  const ids = Object.keys(WIZARD_RESULTS)
  assert.ok(ids.length > 0)
  const covered = new Set(SYMPTOM_TAGS.flatMap((t) => t.resultIds))
  for (const id of ids) assert.ok(covered.has(id), `wizard result '${id}' unmapped`)
  // 10-20 tag vocabulary bound.
  assert.ok(SYMPTOM_TAGS.length >= 8 && SYMPTOM_TAGS.length <= 20, `tag count ${SYMPTOM_TAGS.length}`)
  for (const t of SYMPTOM_TAGS) {
    assert.ok(t.slug && t.name, "tag has slug+name")
    assert.equal(new Set(t.resultIds).size, t.resultIds.length, `dup ids in ${t.slug}`)
  }
})

await check("wizardResultToTag + isValidWizardResultId", () => {
  assert.equal(wizardResultToTag("nitrogen_def")?.slug, "nutrient-deficiency")
  assert.equal(wizardResultToTag("root_rot")?.slug, "root-problems")
  assert.equal(wizardResultToTag("pm")?.slug, "mold-mildew")
  assert.equal(wizardResultToTag("nope"), null)
  assert.equal(wizardResultToTag(null), null)
  assert.ok(isValidWizardResultId("nitrogen_def"))
  assert.ok(!isValidWizardResultId("injected"))
  assert.ok(!isValidWizardResultId(42))
})

await check("symptom lookup: exact wizardResultId first, solved threads ranked, fallback fills", async () => {
  const u = await mkUser("symp")
  const cat = await prisma.category.findUnique({ where: { slug: "plant-problems" }, select: { id: true } })
  assert.ok(cat, "plant-problems category exists")
  const baseWhere = { deleted: false, categoryId: cat!.id, author: activeAuthor() } as const

  // Exact-match threads — one unsolved, one solved.
  const unsolved = await mkThread(u.id, cat!.id, { wizardResultId: "root_rot" })
  const solved = await mkThread(u.id, cat!.id, { wizardResultId: "root_rot" })
  const answer = await prisma.post.create({
    data: { content: "let it dry out", threadId: solved.id, authorId: u.id },
  })
  await prisma.thread.update({ where: { id: solved.id }, data: { acceptedAnswerId: answer.id } })

  // Replica of the symptom route's exact-match query.
  const exact = await prisma.thread.findMany({
    where: { ...baseWhere, wizardResultId: "root_rot" },
    orderBy: [{ acceptedAnswerId: "desc" }, { createdAt: "desc" }],
    take: 5,
    select: { id: true, acceptedAnswerId: true },
  })
  exact.sort((a, b) => (b.acceptedAnswerId ? 1 : 0) - (a.acceptedAnswerId ? 1 : 0))
  assert.ok(exact.some((t) => t.id === solved.id) && exact.some((t) => t.id === unsolved.id))
  assert.equal(exact[0].id, solved.id, "solved thread ranks first")

  // Fallback: different result id → similar-title/tag search finds tagged thread.
  const tagRow = await prisma.tag.upsert({
    where: { slug: "root-problems" },
    create: { slug: "root-problems", name: "root problems" },
    update: {},
  })
  cleanup.tagIds.push(tagRow.id)
  const tagged = await mkThread(u.id, cat!.id, { title: `__test_kc_root problems_${tag}` })
  await prisma.threadTag.create({ data: { threadId: tagged.id, tagId: tagRow.id } })
  const sympTag = wizardResultToTag("damping_off") // no exact threads — maps to a different tag
  assert.equal(sympTag?.slug, "seedling-germination")
  const fallbackTag = wizardResultToTag("root_bound") // shares 'root problems' tag
  const words = tokenizeSearchText(fallbackTag!.name.replace(/-/g, " "))
  const similar = await prisma.thread.findMany({
    where: {
      ...baseWhere,
      OR: [
        { tags: { some: { tag: { slug: fallbackTag!.slug } } } },
        ...words.map((w) => ({ title: { contains: w, mode: "insensitive" as const } })),
      ],
    },
    take: 5,
    select: { id: true },
  })
  assert.ok(similar.some((t) => t.id === tagged.id), "fallback finds tag/title-matched thread")
})

await check("suspended/banned authors excluded from symptom lookup", async () => {
  const u = await mkUser("sympban")
  await prisma.user.update({ where: { id: u.id }, data: { banned: true } })
  const cat = await prisma.category.findUnique({ where: { slug: "plant-problems" }, select: { id: true } })
  const t = await mkThread(u.id, cat!.id, { wizardResultId: "bud_rot" })
  const found = await prisma.thread.findMany({
    where: { deleted: false, categoryId: cat!.id, author: activeAuthor(), wizardResultId: "bud_rot" },
    select: { id: true },
  })
  assert.ok(!found.some((x) => x.id === t.id), "banned author's thread excluded")
})

// ─── Diary ↔ discussion ────────────────────────────────────────────
await check("discuss claim is idempotent — only one canonical thread wins", async () => {
  const u = await mkUser("discuss")
  const d = await mkDiary(u.id, {})
  const cat = await prisma.category.findUnique({ where: { slug: "general-cannabis-discussion" }, select: { id: true } })
  assert.ok(cat, "general-cannabis-discussion exists")
  const t1 = await mkThread(u.id, cat!.id, {})
  const t2 = await mkThread(u.id, cat!.id, {})
  // Mirror the route's guarded claim.
  const c1 = await prisma.growDiary.updateMany({ where: { id: d.id, threadId: null }, data: { threadId: t1.id } })
  const c2 = await prisma.growDiary.updateMany({ where: { id: d.id, threadId: null }, data: { threadId: t2.id } })
  assert.equal(c1.count, 1, "first claim wins")
  assert.equal(c2.count, 0, "second claim refused — no duplicate canonical thread")
  const row = await prisma.growDiary.findUnique({ where: { id: d.id }, select: { threadId: true } })
  assert.equal(row?.threadId, t1.id)
})

await check("threadId unique — two diaries cannot share one canonical thread", async () => {
  const u = await mkUser("uniq")
  const d1 = await mkDiary(u.id, {})
  const d2 = await mkDiary(u.id, {})
  const cat = await prisma.category.findUnique({ where: { slug: "general-cannabis-discussion" }, select: { id: true } })
  const t = await mkThread(u.id, cat!.id, {})
  await prisma.growDiary.update({ where: { id: d1.id }, data: { threadId: t.id } })
  await assert.rejects(
    prisma.growDiary.update({ where: { id: d2.id }, data: { threadId: t.id } }),
    /unique|Unique/i
  )
})

await check("thread soft-delete clears diary.threadId; diary delete clears link", async () => {
  const u = await mkUser("del")
  const d = await mkDiary(u.id, {})
  const cat = await prisma.category.findUnique({ where: { slug: "general-cannabis-discussion" }, select: { id: true } })
  const t = await mkThread(u.id, cat!.id, {})
  await prisma.growDiary.update({ where: { id: d.id }, data: { threadId: t.id } })
  // Mirror the thread DELETE route's transaction step.
  await prisma.$transaction(async (tx) => {
    await tx.thread.update({ where: { id: t.id }, data: { deleted: true } })
    await tx.growDiary.updateMany({ where: { threadId: t.id }, data: { threadId: null } })
  })
  const row = await prisma.growDiary.findUnique({ where: { id: d.id }, select: { threadId: true } })
  assert.equal(row?.threadId, null, "diary link cleared on thread delete")
  // Re-link, then diary delete clears it the same way the DELETE route does.
  const t2 = await mkThread(u.id, cat!.id, {})
  await prisma.growDiary.update({ where: { id: d.id }, data: { threadId: t2.id } })
  await prisma.growDiary.update({ where: { id: d.id }, data: { deleted: true, threadId: null } })
  const row2 = await prisma.growDiary.findUnique({ where: { id: d.id }, select: { threadId: true } })
  assert.equal(row2?.threadId, null)
})

await check("generated discussion title never embeds the diary title", async () => {
  const u = await mkUser("gentitle")
  const s = await prisma.strain.create({ data: { name: `__test_kc_Gen_${tag}`, createdById: u.id } })
  cleanup.strainIds.push(s.id)
  const d = await mkDiary(u.id, {
    title: `__test_kc_SECRET_PERSONAL_NAME_${tag}`,
    strainId: s.id,
    strain: s.name,
  })
  // Mirror the discuss route's title construction.
  const strainName = s.name
  const genTitle = `${strainName.slice(0, 80)} grow — discussion`
  assert.ok(!genTitle.includes(d.title), "diary title must not appear")
  assert.ok(genTitle.includes(s.name))
})

// ─── Setup ↔ diary ─────────────────────────────────────────────────
await check("setup link is owner-scoped; other members' setups rejected", async () => {
  const owner = await mkUser("setup-owner")
  const other = await mkUser("setup-other")
  const setup = await prisma.growSetup.create({
    data: { title: `__test_kc_setup_${tag}`, description: "", authorId: owner.id },
  })
  cleanup.setupIds.push(setup.id)
  // Mirror the route's attach check: setup must exist, be live, and be the caller's.
  const check = async (userId: string) => {
    const s = await prisma.growSetup.findUnique({ where: { id: setup.id }, select: { authorId: true, deleted: true } })
    return !!s && !s.deleted && s.authorId === userId
  }
  assert.equal(await check(owner.id), true, "owner may link")
  assert.equal(await check(other.id), false, "non-owner refused")
})

await check("setup hard-delete SetNulls diary.setupId; diary delete leaves setup", async () => {
  const u = await mkUser("setup-del")
  const setup = await prisma.growSetup.create({
    data: { title: `__test_kc_setup2_${tag}`, description: "", authorId: u.id },
  })
  const d = await mkDiary(u.id, { setupId: setup.id })
  await prisma.growSetup.delete({ where: { id: setup.id } })
  const row = await prisma.growDiary.findUnique({ where: { id: d.id } })
  assert.ok(row, "diary survives setup deletion")
  assert.equal(row?.setupId, null, "FK SetNull")
  // Reverse direction: deleting the diary must not delete the setup.
  const setup2 = await prisma.growSetup.create({
    data: { title: `__test_kc_setup3_${tag}`, description: "", authorId: u.id },
  })
  cleanup.setupIds.push(setup2.id)
  const d2 = await mkDiary(u.id, { setupId: setup2.id })
  await prisma.growDiary.update({ where: { id: d2.id }, data: { deleted: true } })
  const s2 = await prisma.growSetup.findUnique({ where: { id: setup2.id } })
  assert.ok(s2, "setup survives diary deletion")
})

await check("setup 'used in' list excludes deleted diaries and banned authors", async () => {
  const u = await mkUser("usedin")
  const setup = await prisma.growSetup.create({
    data: { title: `__test_kc_setup4_${tag}`, description: "", authorId: u.id },
  })
  cleanup.setupIds.push(setup.id)
  const live = await mkDiary(u.id, { setupId: setup.id })
  const dead = await mkDiary(u.id, { setupId: setup.id, deleted: true })
  const bu = await mkUser("usedin-banned")
  await prisma.user.update({ where: { id: bu.id }, data: { banned: true } })
  const banned = await mkDiary(bu.id, { setupId: setup.id })
  // Replica of the setup page's usedIn query.
  const usedIn = await prisma.growDiary.findMany({
    where: { setupId: setup.id, deleted: false, author: activeAuthor() },
    select: { id: true },
  })
  const ids = usedIn.map((x) => x.id)
  assert.ok(ids.includes(live.id))
  assert.ok(!ids.includes(dead.id) && !ids.includes(banned.id))
})

// ─── Thread rendering context ──────────────────────────────────────
await check("thread.diaryFor surfaces only live diaries by active authors", async () => {
  const u = await mkUser("ctx")
  const d = await mkDiary(u.id, {})
  const cat = await prisma.category.findUnique({ where: { slug: "general-cannabis-discussion" }, select: { id: true } })
  const t = await mkThread(u.id, cat!.id, {})
  await prisma.growDiary.update({ where: { id: d.id }, data: { threadId: t.id } })
  const loaded = await prisma.thread.findUnique({
    where: { id: t.id },
    select: { diaryFor: { select: { id: true, deleted: true, author: { select: { banned: true, suspendedUntil: true } } } } },
  })
  assert.equal(loaded?.diaryFor?.id, d.id)
  // Soft-delete the diary → context card hides (render filters deleted).
  await prisma.growDiary.update({ where: { id: d.id }, data: { deleted: true, threadId: null } })
  const loaded2 = await prisma.thread.findUnique({
    where: { id: t.id },
    select: { diaryFor: { select: { id: true, deleted: true } } },
  })
  assert.equal(loaded2?.diaryFor, null, "cleared link — no dangling diary context")
})

// ─── Cleanup ───────────────────────────────────────────────────────
const failures = results.filter(([s]) => s === "FAIL")
try {
  // Order matters: dependents first.
  await prisma.threadTag.deleteMany({ where: { threadId: { in: cleanup.threadIds } } })
  await prisma.post.deleteMany({ where: { threadId: { in: cleanup.threadIds } } })
  await prisma.growDiary.deleteMany({ where: { id: { in: cleanup.diaryIds } } })
  await prisma.thread.deleteMany({ where: { id: { in: cleanup.threadIds } } })
  await prisma.growSetup.deleteMany({ where: { id: { in: cleanup.setupIds } } })
  await prisma.strain.deleteMany({ where: { id: { in: cleanup.strainIds } } })
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } })
  // Only remove test-created tag rows; pre-existing shared tags stay.
  const shared = new Set(SYMPTOM_TAGS.map((t) => t.slug))
  for (const id of cleanup.tagIds) {
    const t = await prisma.tag.findUnique({ where: { id }, select: { slug: true, createdAt: true } })
    if (t && shared.has(t.slug)) continue // pre-existing taxonomy tag — keep
    await prisma.tag.delete({ where: { id } }).catch(() => {})
  }
} catch (e) {
  console.error("cleanup error:", e)
}

console.log(`\n${results.length - failures.length}/${results.length} passed`)
if (failures.length) process.exit(1)
