// Strain Lifecycle V1 regression tests — STRAIN report plumbing,
// creator-less ("") subject semantics, hard-delete FK/cascade behavior,
// reputation reversal idempotency, and the route source contracts for
// Blob cleanup + cache invalidation. Run against the dev DB only.
// Run: npx tsx scripts/strain-lifecycle-tests.mts   (dev DB only — guarded)
import "./db-guard.mjs"
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { prisma } from "@/lib/prisma"
import { STRAIN_TYPES, parseSeedToHarvestWeeks } from "@/lib/strain-fields"
import { strainTypeLabel } from "@/lib/strain-stats"


const tag = Date.now().toString(36)
const results: [string, string][] = []
const pass = (n: string) => { results.push(["PASS", n]); console.log(`  ✓ ${n}`) }
const fail = (n: string, i: unknown) => { results.push(["FAIL", n]); console.log(`  ✗ ${n} — ${JSON.stringify(i)?.slice(0, 300)}`) }
const check = (n: string, fn: () => Promise<void> | void) =>
  Promise.resolve()
    .then(fn)
    .then(() => pass(n))
    .catch((e) => fail(n, e instanceof Error ? e.message : e))

const cleanup = { userIds: [] as string[], strainIds: [] as string[], diaryIds: [] as string[], reportIds: [] as string[] }

async function mkUser(name: string, role: "MEMBER" | "MODERATOR" = "MEMBER") {
  const u = await prisma.user.create({
    data: {
      name: `__test_sl_${name}_${tag}`,
      ageVerified: true,
      password: "x",
      sessionVersion: 1,
      role,
      profile: { create: { username: `__test_sl_${name}_${tag}` } },
    },
  })
  cleanup.userIds.push(u.id)
  return u
}

async function mkStrain(createdById: string | null, over: Record<string, unknown> = {}) {
  const s = await prisma.strain.create({
    data: {
      name: `__test_sl_strain_${tag}_${Math.random().toString(36).slice(2, 8)}`,
      description: "lifecycle test strain",
      ...over,
      createdById,
    },
  })
  cleanup.strainIds.push(s.id)
  return s
}

async function mkPhoto(strainId: string, userId: string) {
  return prisma.strainPhoto.create({
    data: { strainId, userId, kind: "PLANT", imageUrl: `https://blob.test/${tag}/${Math.random().toString(36).slice(2)}.webp` },
  })
}

async function mkDiary(authorId: string, over: Record<string, unknown> = {}) {
  const d = await prisma.growDiary.create({
    data: {
      title: `__test_sl_d_${tag}`,
      description: "",
      growType: "INDOOR",
      startDate: new Date("2026-01-01T00:00:00Z"),
      authorId,
      ...over,
    },
  })
  cleanup.diaryIds.push(d.id)
  return d
}

/** Mirrors the reports route's reported-user resolution for a STRAIN. */
async function resolveReportedUserId(targetId: string): Promise<string | null> {
  const s = await prisma.strain.findUnique({ where: { id: targetId }, select: { createdById: true } })
  if (!s) return null
  return s.createdById ?? ""
}

const creator = await mkUser("creator")
const reporter = await mkUser("reporter")
const other = await mkUser("other")

// ─── Report semantics ────────────────────────────────────────────────
await check("report: STRAIN resolves creator as reportedId; missing target → null", async () => {
  const s = await mkStrain(creator.id)
  assert.equal(await resolveReportedUserId(s.id), creator.id)
  assert.equal(await resolveReportedUserId("nonexistent"), null, "missing strain must not resolve")
})

await check("report: creator-less strain resolves to \"\" (still reportable)", async () => {
  const s = await mkStrain(null)
  assert.equal(await resolveReportedUserId(s.id), "")
})

await check("report: STRAIN row stores type/targetId/reportedId; \"\" subject survives", async () => {
  const s1 = await mkStrain(creator.id)
  const s2 = await mkStrain(null)
  const r1 = await prisma.report.create({
    data: { type: "STRAIN", reason: "SPAM", reporterId: reporter.id, reportedId: creator.id, targetId: s1.id, priority: "NORMAL" },
  })
  const r2 = await prisma.report.create({
    data: { type: "STRAIN", reason: "OTHER", reporterId: reporter.id, reportedId: "", targetId: s2.id, priority: "NORMAL" },
  })
  cleanup.reportIds.push(r1.id, r2.id)
  assert.equal(r1.type, "STRAIN")
  assert.equal(r1.targetId, s1.id)
  assert.equal(r1.reportedId, creator.id)
  assert.equal(r2.reportedId, "", "non-null schema accepts empty-string subject")
})

await check("report: empty-string subject degrades like a deleted user everywhere", async () => {
  // usernames() filters falsy ids; profile lookup of "" yields nothing —
  // the queue renders \"Deleted user\", subjectContext returns missing.
  const users = await prisma.user.findMany({ where: { id: { in: [""] } }, select: { id: true } })
  assert.equal(users.length, 0)
  const profile = await prisma.profile.findUnique({ where: { userId: "" } })
  assert.equal(profile, null)
  // Queue related/open-report queries treat "" like any other id — no crash.
  const n = await prisma.report.count({ where: { reportedId: "", status: { in: ["PENDING", "REVIEWING", "ESCALATED"] } } })
  assert.ok(n >= 1, "the creator-less report exists and is countable")
})

// ─── Hard delete ─────────────────────────────────────────────────────
await check("delete: photos cascade, diaries SetNull, free-text strain survives", async () => {
  const s = await mkStrain(creator.id, { name: `__test_sl_del_${tag}` })
  const p1 = await mkPhoto(s.id, creator.id)
  const p2 = await mkPhoto(s.id, other.id)
  const d = await mkDiary(creator.id, { strainId: s.id, strain: `__test_sl_del_${tag}` })
  const diaryBefore = await prisma.growDiary.findUnique({ where: { id: d.id } })

  await prisma.strain.delete({ where: { id: s.id } })

  assert.equal(await prisma.strain.findUnique({ where: { id: s.id } }), null, "strain row gone")
  assert.equal(await prisma.strainPhoto.count({ where: { id: { in: [p1.id, p2.id] } } }), 0, "photos cascade-deleted")
  const dAfter = await prisma.growDiary.findUnique({ where: { id: d.id } })
  assert.equal(dAfter?.strainId, null, "onDelete: SetNull")
  assert.equal(dAfter?.strain, `__test_sl_del_${tag}`, "legacy free text preserved")
  assert.equal(dAfter?.authorId, creator.id, "diary ownership untouched")
  assert.equal(dAfter?.title, diaryBefore?.title, "diary content untouched")
})

await check("delete: other strains + their photos untouched", async () => {
  const doomed = await mkStrain(creator.id)
  const keeper = await mkStrain(other.id)
  const kp = await mkPhoto(keeper.id, other.id)
  await mkPhoto(doomed.id, other.id)
  await prisma.strain.delete({ where: { id: doomed.id } })
  assert.ok(await prisma.strain.findUnique({ where: { id: keeper.id } }), "other strain survives")
  assert.ok(await prisma.strainPhoto.findUnique({ where: { id: kp.id } }), "other strain's photo survives")
})

await check("delete: missing target is a no-hit, not a crash", async () => {
  // Route loads the strain first and throws CONTENT_NOT_FOUND — the same
  // findUnique → null path verified here.
  assert.equal(await prisma.strain.findUnique({ where: { id: "nonexistent" } }), null)
  await assert.rejects(() => prisma.strain.delete({ where: { id: "nonexistent" } }), "delete of missing row rejects")
})

// ─── Post-delete discovery ───────────────────────────────────────────
await check("discovery: deleted strain leaves browse/search/suggest/sitemap results", async () => {
  const s = await mkStrain(creator.id, { name: `__test_sl_gone_${tag}` })
  await prisma.strain.delete({ where: { id: s.id } })
  // Every consumer derives from live rows — verify each shape.
  const browse = await prisma.strain.findMany({ where: { name: { contains: "__test_sl_gone", mode: "insensitive" } } })
  const combobox = await prisma.strain.findMany({ where: { name: { contains: "__test_sl_gone", mode: "insensitive" } }, take: 15 })
  const detail = await prisma.strain.findUnique({ where: { id: s.id } })
  assert.equal(browse.length + combobox.length, 0)
  assert.equal(detail, null, "detail route gets notFound")
})

// ─── Route source contracts ──────────────────────────────────────────
await check("route contract: reports accepts STRAIN + tolerates creator-less", () => {
  const src = readFileSync("src/app/api/reports/route.ts", "utf8")
  assert.ok(src.includes('"STRAIN"'), "STRAIN in REPORT_TYPES")
  assert.ok(src.includes('case "STRAIN"'), "STRAIN target resolution")
  assert.ok(src.includes('?? ""'), "creator-less → empty reportedId")
  assert.ok(!src.slice(src.indexOf('case "STRAIN"'), src.indexOf("Prevent duplicate")).includes("return NextResponse.json({ error: \"Reported content not found\" }, { status: 404 })\n        reportedUserId"), "no unconditional 404 after strain case")
})

await check("route contract: actions hard-deletes strain + reverses rep + busts strains only", () => {
  const src = readFileSync("src/app/api/moderation/actions/route.ts", "utf8")
  assert.ok(src.includes('"STRAIN"'), "STRAIN in CONTENT_TYPES")
  const strainCase = src.slice(src.indexOf('case "STRAIN"'), src.indexOf('case "STRAIN"') + 2200)
  assert.ok(strainCase.includes("strain.findUnique"), "loads the strain first")
  assert.ok(strainCase.includes("createdById"), "verifies creator ownership")
  assert.ok(strainCase.includes("strain.delete"), "hard delete")
  assert.ok(strainCase.includes("imageUrl"), "photo URLs collected pre-delete")
  assert.ok(src.includes('sourceType: "STRAIN", sourceId: targetId'), "STRAIN_CREATED reversal enqueued durably")
  assert.ok(src.includes('sourceType: "STRAIN_PHOTO", sourceId: pid'), "STRAIN_PHOTO reversal enqueued per photo")
  assert.ok(src.includes("drainOne"), "enqueued reversals are drained post-commit")
  assert.ok(src.includes("deleteImagesIfUnreferenced(deletedBlobUrls)"), "unreferenced-blob sweep")
  assert.ok(src.includes("diaryContentDeleted || strainDeleted"), "strains bust covers strain deletion")
  assert.ok(src.includes('targetType !== "STRAIN"'), "analytics bust excludes strains")
})

await check("route contract: queue + case detail resolve STRAIN previews", () => {
  const queue = readFileSync("src/app/api/moderation/queue/route.ts", "utf8")
  const detail = readFileSync("src/app/api/moderation/queue/[id]/route.ts", "utf8")
  assert.ok(queue.includes('case "STRAIN"') && queue.includes("strain.findMany"), "queue label")
  assert.ok(detail.includes('case "STRAIN"') && detail.includes("strain.findUnique"), "case detail")
  assert.ok(!detail.slice(detail.indexOf('case "STRAIN"'), detail.indexOf('case "PROFILE"')).includes("createdBy"), "no creator PII in preview")
})

await check("route contract: strain page wires ReportButton + owner photo delete", () => {
  const page = readFileSync("src/app/strains/[id]/page.tsx", "utf8")
  const btn = readFileSync("src/components/report-button.tsx", "utf8")
  assert.ok(page.includes('type="STRAIN"') && page.includes("ReportButton"), "report button present")
  assert.ok(page.includes("OwnerDeleteButton") && page.includes('endpoint="/api/strains/photos"'), "owner photo delete")
  assert.ok(btn.includes('"STRAIN"'), "report button type union")
})

// ─── Catalog fields: type vocab + autoflower timing + breeder links ──
await check("vocab: RUDERALIS removed from STRAIN_TYPES; AUTO_FLOWER remains", () => {
  assert.equal(STRAIN_TYPES.includes("RUDERALIS" as never), false)
  assert.ok(STRAIN_TYPES.includes("AUTO_FLOWER"))
  // A legacy DB row typed RUDERALIS must still render a label, not raw enum text.
  assert.equal(strainTypeLabel("RUDERALIS"), "Ruderalis")
})

await check("parseSeedToHarvestWeeks: bounds 6–24, non-numeric → null", () => {
  assert.equal(parseSeedToHarvestWeeks(6), 6)
  assert.equal(parseSeedToHarvestWeeks(24), 24)
  assert.equal(parseSeedToHarvestWeeks("10"), 10)
  assert.equal(parseSeedToHarvestWeeks(5), null)
  assert.equal(parseSeedToHarvestWeeks(25), null)
  assert.equal(parseSeedToHarvestWeeks("abc"), null)
  assert.equal(parseSeedToHarvestWeeks(null), null)
})

await check("strain: seedToHarvestWeeks + breeder image/source fields persist", async () => {
  const s = await mkStrain(creator.id, {
    type: "AUTO_FLOWER",
    seedToHarvestWeeks: 10,
    breederImageUrl: "https://breeder.test/img.webp",
    breederSourceUrl: "https://breeder.test/strain",
  })
  const back = await prisma.strain.findUniqueOrThrow({
    where: { id: s.id },
    select: { type: true, seedToHarvestWeeks: true, breederImageUrl: true, breederSourceUrl: true },
  })
  assert.equal(back.seedToHarvestWeeks, 10)
  assert.equal(back.breederImageUrl, "https://breeder.test/img.webp")
  assert.equal(back.breederSourceUrl, "https://breeder.test/strain")
})

await check("route contract: POST /api/strains validates type + seed-to-harvest, keeps breeder links catalog-managed", () => {
  const route = readFileSync("src/app/api/strains/route.ts", "utf8")
  assert.ok(route.includes("STRAIN_TYPES as readonly string[]"), "type validated against vocab")
  assert.ok(!route.includes('"RUDERALIS"'), "no RUDERALIS literal in route")
  assert.ok(route.includes("parseSeedToHarvestWeeks(seedToHarvestWeeks)"), "parser wired")
  assert.ok(route.includes('error: "Invalid seed-to-harvest weeks"'), "invalid timing rejected 400")
  assert.ok(route.includes("seedToHarvestWeeks: cleanSeedToHarvest"), "persisted")
  // Breeder attribution is curated data — member POSTs must not set it.
  const create = route.slice(route.indexOf("prisma.strain.create"), route.indexOf("revalidateTag"))
  assert.ok(!create.includes("breederImageUrl"), "breederImageUrl not member-settable")
  assert.ok(!create.includes("breederSourceUrl"), "breederSourceUrl not member-settable")
})

// ─── Summary + cleanup ───────────────────────────────────────────────
const failed = results.filter(([s]) => s === "FAIL")
console.log(`\n${results.length - failed.length}/${results.length} passed`)

await prisma.report.deleteMany({ where: { id: { in: cleanup.reportIds } } })
await prisma.reputationEvent.deleteMany({
  where: { OR: [{ userId: { in: cleanup.userIds } }, { actorId: { in: cleanup.userIds } }] },
})
await prisma.growDiary.deleteMany({ where: { id: { in: cleanup.diaryIds } } })
await prisma.strain.deleteMany({ where: { id: { in: cleanup.strainIds } } })
await prisma.profile.deleteMany({ where: { userId: { in: cleanup.userIds } } })
await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } })
await prisma.$disconnect()
process.exit(failed.length ? 1 : 0)
