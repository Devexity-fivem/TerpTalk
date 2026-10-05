// Plant Doctor outcome loop regression tests — case creation, owner-only
// access, append-only outcome reporting, no-false-success, and the
// once-per-case follow-up reminder (eligibility window, claim dedupe,
// stop-on-report). HTTP boundary for the API routes + real lib calls for
// the cron scan. Disposable __pd_ fixtures; everything cleaned up.
// Run: npm run test:plant-doctor
import "./db-guard.mjs"
import { strict as assert } from "node:assert"
import { prisma } from "@/lib/prisma"
import { WIZARD_RESULTS } from "@/lib/problem-wizard"
import { wizardResultToTag } from "@/lib/symptom-tags"
import {
  createPlantDoctorCase,
  plantDoctorCasesFor,
  openPlantDoctorCases,
  scanPlantDoctorFollowups,
} from "@/lib/plant-doctor"
import { makeHarness } from "./lib/http-harness.mjs"

const harnessOpts = {
  username: (tag: string, ts: string) => `__pd_${tag}_${ts}`,
  name: (tag: string, ts: string) => `__pd_${tag}_${ts}`,
  summary: "fraction",
}
// harness option typing omits `username` — required at runtime.
const { prisma: hp, pass, fail, createUser, login: rawLogin, finish } = makeHarness(
  harnessOpts as { name: (tag: string, ts: string) => string; summary: string },
)
const login = (u: string, p: string) => rawLogin(u, p) as Promise<{ cookie: string }>

const BASE = process.env.BASE_URL || "http://localhost:3000"

interface CaseDto { id: string; outcome: string | null; outcomeCount: number; open: boolean }
interface ApiData { caseId?: string; reused?: boolean; cases?: CaseDto[]; error?: string }

async function api(path: string, opts: { method?: string; body?: unknown; cookie?: string } = {}): Promise<{ status: number; data: ApiData }> {
  const headers: Record<string, string> = {}
  if (opts.body) headers["Content-Type"] = "application/json"
  if (opts.cookie) headers["cookie"] = opts.cookie
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    redirect: "manual",
  })
  let data: ApiData = {}
  try { data = await res.json() } catch { /* non-JSON */ }
  return { status: res.status, data }
}

const RESULT_ID = Object.keys(WIZARD_RESULTS)[0]
assert.ok(RESULT_ID && WIZARD_RESULTS[RESULT_ID], "suite needs at least one wizard result")

const userIds: string[] = []
const diaryIds: string[] = []
const caseIds: string[] = []
const botEventKeys: string[] = []
const notificationIds: string[] = []
const rateLimitKeys: string[] = []

async function main() {
  console.log("Starting Plant Doctor outcome-loop tests...")
  const [owner, other, banned] = await Promise.all([
    createUser("a"),
    createUser("b"),
    createUser("c", { banned: true }),
  ])
  userIds.push(owner.id, other.id, banned.id)
  const { cookie: ownerCookie } = await login(owner.username, owner.password)
  const { cookie: otherCookie } = await login(other.username, other.password)
  assert.ok(ownerCookie && otherCookie, "fixture logins must succeed")
  rateLimitKeys.push(`pd-case:${owner.id}`, `pd-case:${other.id}`)

  const results = { passed: 0, failed: 0 }
  const check = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn()
      pass(name)
      results.passed++
    } catch (e) {
      fail(name, e)
      results.failed++
    }
  }

  // ── Auth + validation ────────────────────────────────────────────
  await check("anonymous cannot create or list cases", async () => {
    const r = await api("/api/plant-doctor/cases", { method: "POST", body: { resultId: RESULT_ID } })
    assert.equal(r.status, 401)
    const g = await api("/api/plant-doctor/cases")
    assert.equal(g.status, 401)
  })

  await check("invalid wizard result rejected", async () => {
    const r = await api("/api/plant-doctor/cases", {
      method: "POST",
      body: { resultId: "not_a_real_result" },
      cookie: ownerCookie,
    })
    assert.equal(r.status, 400)
  })

  // ── Case lifecycle ───────────────────────────────────────────────
  let caseId = ""
  await check("diagnosis creates a tracked case; repeat dedupes", async () => {
    const r = await api("/api/plant-doctor/cases", {
      method: "POST",
      body: { resultId: RESULT_ID },
      cookie: ownerCookie,
    })
    assert.equal(r.status, 200, `create: ${JSON.stringify(r.data)}`)
    assert.ok(r.data.caseId)
    assert.equal(r.data.reused, false)
    caseId = r.data.caseId
    caseIds.push(caseId)

    const again = await api("/api/plant-doctor/cases", {
      method: "POST",
      body: { resultId: RESULT_ID },
      cookie: ownerCookie,
    })
    assert.equal(again.status, 200)
    assert.equal(again.data.caseId, caseId, "same open case reused")
    assert.equal(again.data.reused, true)
  })

  await check("new case starts unresolved — no outcome, open", async () => {
    const cases = await plantDoctorCasesFor(owner.id)
    const c = cases.find((x) => x.id === caseId)
    assert.ok(c, "case visible to owner")
    assert.equal(c!.outcome, null)
    assert.equal(c!.open, true, "absence of report is unresolved, never success")
  })

  // ── Grow linkage + privacy ───────────────────────────────────────
  let linkedCaseId = ""
  await check("cannot link a case to someone else's diary", async () => {
    const otherDiary = await prisma.growDiary.create({
      data: { title: "__pd_x", description: "x", growType: "INDOOR", startDate: new Date(), authorId: other.id },
    })
    diaryIds.push(otherDiary.id)
    const r = await api("/api/plant-doctor/cases", {
      method: "POST",
      body: { resultId: RESULT_ID, diaryId: otherDiary.id },
      cookie: ownerCookie,
    })
    assert.equal(r.status, 400, "foreign diary rejected")
  })

  await check("own private diary links and snapshots structured context", async () => {
    const diary = await prisma.growDiary.create({
      data: {
        title: "__pd_priv", description: "x", growType: "INDOOR", startDate: new Date(),
        authorId: owner.id, visibility: "PRIVATE", stage: "VEGETATIVE", mediumType: "COCO", lightType: "LED",
      },
    })
    diaryIds.push(diary.id)
    const r = await api("/api/plant-doctor/cases", {
      method: "POST",
      body: { resultId: RESULT_ID, diaryId: diary.id },
      cookie: ownerCookie,
    })
    assert.equal(r.status, 200)
    assert.ok(r.data.caseId)
    linkedCaseId = r.data.caseId
    caseIds.push(linkedCaseId)
    const row = await prisma.plantDoctorCase.findUnique({ where: { id: linkedCaseId } })
    assert.equal(row!.diaryId, diary.id)
    assert.equal(row!.stage, "VEGETATIVE")
    assert.equal(row!.mediumType, "COCO")
    assert.equal(row!.lightType, "LED")
    assert.equal(row!.tagSlug, wizardResultToTag(RESULT_ID)?.slug ?? null, "structured tag linkage recorded")
  })

  await check("owner-only read — other member's list contains nothing", async () => {
    const g = await api("/api/plant-doctor/cases", { cookie: otherCookie })
    assert.equal(g.status, 200)
    const ids = (g.data.cases ?? []).map((c: { id: string }) => c.id)
    assert.ok(!ids.includes(caseId) && !ids.includes(linkedCaseId), "cases never leak to other members")
  })

  // ── Outcome reporting ────────────────────────────────────────────
  await check("non-owner cannot report on the case", async () => {
    const r = await api(`/api/plant-doctor/cases/${caseId}/outcome`, {
      method: "POST",
      body: { outcome: "IMPROVED" },
      cookie: otherCookie,
    })
    assert.equal(r.status, 404, "foreign case reports look like a missing case")
  })

  await check("invalid outcome rejected", async () => {
    const r = await api(`/api/plant-doctor/cases/${caseId}/outcome`, {
      method: "POST",
      body: { outcome: "CURED_FOREVER" },
      cookie: ownerCookie,
    })
    assert.equal(r.status, 400)
  })

  await check("explicit report persists and survives reload", async () => {
    const r = await api(`/api/plant-doctor/cases/${caseId}/outcome`, {
      method: "POST",
      body: { outcome: "IMPROVED" },
      cookie: ownerCookie,
    })
    assert.equal(r.status, 200)
    const g = await api("/api/plant-doctor/cases", { cookie: ownerCookie })
    const c = (g.data.cases ?? []).find((x) => x.id === caseId)
    assert.ok(c, "case returned to owner after report")
    assert.equal(c.outcome, "IMPROVED", "latest report returned to owner")
    assert.equal(c.outcomeCount, 1)
    assert.equal(c.open, false)
  })

  await check("correction appends — earlier report is kept in history", async () => {
    const r = await api(`/api/plant-doctor/cases/${caseId}/outcome`, {
      method: "POST",
      body: { outcome: "NO_CHANGE" },
      cookie: ownerCookie,
    })
    assert.equal(r.status, 200)
    const rows = await prisma.plantDoctorOutcome.findMany({
      where: { caseId },
      orderBy: { createdAt: "asc" },
    })
    assert.equal(rows.length, 2, "both reports retained")
    assert.equal(rows[0].outcome, "IMPROVED")
    assert.equal(rows[1].outcome, "NO_CHANGE")
    const cases = await plantDoctorCasesFor(owner.id)
    assert.equal(cases.find((c) => c.id === caseId)!.outcome, "NO_CHANGE", "latest wins")
  })

  await check("UNSURE keeps the case open but counts as a report", async () => {
    // A different result so the open-case dedupe can't reuse caseId.
    const alt = Object.keys(WIZARD_RESULTS).find((k) => k !== RESULT_ID)!
    const c2 = await createPlantDoctorCase({ userId: owner.id, resultId: alt })
    assert.ok("caseId" in c2)
    caseIds.push(c2.caseId)
    const r = await api(`/api/plant-doctor/cases/${c2.caseId}/outcome`, {
      method: "POST",
      body: { outcome: "UNSURE" },
      cookie: ownerCookie,
    })
    assert.equal(r.status, 200)
    const open = await openPlantDoctorCases(owner.id)
    const entry = open.find((x) => x.id === c2.caseId)
    assert.ok(entry, "UNSURE case still wants a definitive report")
    assert.equal(entry!.outcome, "UNSURE")
  })

  await check("deleted diary does not break reporting or history", async () => {
    const linked = await prisma.plantDoctorCase.findUnique({ where: { id: linkedCaseId }, select: { diaryId: true } })
    await prisma.growDiary.update({ where: { id: linked!.diaryId! }, data: { deleted: true } })
    const r = await api(`/api/plant-doctor/cases/${linkedCaseId}/outcome`, {
      method: "POST",
      body: { outcome: "WORSE" },
      cookie: ownerCookie,
    })
    assert.equal(r.status, 200, "report still lands after the grow is deleted")
  })

  // ── Follow-up reminder (once per case, never after a report) ─────
  await check("fresh cases are not reminder-eligible", async () => {
    const fresh = await createPlantDoctorCase({ userId: owner.id, resultId: Object.keys(WIZARD_RESULTS)[2] })
    assert.ok("caseId" in fresh)
    caseIds.push(fresh.caseId)
    const r = await scanPlantDoctorFollowups({ caseIds: [fresh.caseId] })
    assert.equal(r.sent, 0, "cases under 5 days stay quiet")
  })

  let reminderCaseId = ""
  await check("unresolved case ≥5d gets exactly one reminder", async () => {
    const c = await createPlantDoctorCase({ userId: owner.id, resultId: Object.keys(WIZARD_RESULTS)[3] })
    assert.ok("caseId" in c)
    reminderCaseId = c.caseId
    caseIds.push(c.caseId)
    botEventKeys.push(`assist:pd-followup:${c.caseId}`)
    rateLimitKeys.push(`terpbot:assist:user:${owner.id}`)
    await prisma.plantDoctorCase.update({
      where: { id: c.caseId },
      data: { createdAt: new Date(Date.now() - 10 * 86400000) },
    })
    const r1 = await scanPlantDoctorFollowups({ caseIds: [c.caseId] })
    assert.equal(r1.sent, 1, "one follow-up nudge")
    const n = await prisma.notification.findFirst({
      where: { userId: owner.id, type: "BOT_ASSIST", link: "/plant-doctor" },
    })
    assert.ok(n, "BOT_ASSIST notification delivered")
    notificationIds.push(n!.id)

    const r2 = await scanPlantDoctorFollowups({ caseIds: [c.caseId] })
    assert.equal(r2.sent, 0, "claimed key dedupes the retry")
  })

  await check("reported case never reminds again", async () => {
    const r = await api(`/api/plant-doctor/cases/${reminderCaseId}/outcome`, {
      method: "POST",
      body: { outcome: "IMPROVED" },
      cookie: ownerCookie,
    })
    assert.equal(r.status, 200)
    // Release the claim — even a released claim cannot re-notify because
    // the case no longer matches `outcomes: none`.
    const before = await prisma.notification.count({ where: { userId: owner.id, type: "BOT_ASSIST" } })
    const res = await scanPlantDoctorFollowups({ caseIds: [reminderCaseId] })
    assert.equal(res.sent, 0, "reported outcome removes eligibility")
    const after = await prisma.notification.count({ where: { userId: owner.id, type: "BOT_ASSIST" } })
    assert.equal(after, before, "no new notification")
  })

  await check("banned owners are excluded from the scan", async () => {
    const c = await createPlantDoctorCase({ userId: banned.id, resultId: RESULT_ID })
    assert.ok("caseId" in c)
    caseIds.push(c.caseId)
    botEventKeys.push(`assist:pd-followup:${c.caseId}`)
    await prisma.plantDoctorCase.update({
      where: { id: c.caseId },
      data: { createdAt: new Date(Date.now() - 10 * 86400000) },
    })
    const r = await scanPlantDoctorFollowups({ caseIds: [c.caseId] })
    assert.equal(r.sent, 0, "banned member never assisted")
    assert.equal(r.scanned, 0, "banned member filtered before evaluation")
  })

  await check("no automatic success — unreported cases stay open", async () => {
    // caseId reported NO_CHANGE → resolved; reminderCaseId reported
    // IMPROVED → resolved. Every OTHER case created without a report must
    // still be open regardless of age.
    const all = await plantDoctorCasesFor(owner.id, 20)
    for (const c of all) {
      if (c.id === caseId || c.id === reminderCaseId) continue
      const rows = await prisma.plantDoctorOutcome.count({ where: { caseId: c.id } })
      if (rows === 0) assert.equal(c.open, true, `${c.id}: unreported ≠ success`)
    }
  })

  // ── Cleanup ─────────────────────────────────────────────────────
  try {
    await prisma.plantDoctorCase.deleteMany({ where: { id: { in: caseIds } } }).catch(() => {})
    await prisma.growDiary.deleteMany({ where: { id: { in: diaryIds } } }).catch(() => {})
    await prisma.notification.deleteMany({ where: { id: { in: notificationIds } } }).catch(() => {})
    await prisma.botEvent.deleteMany({ where: { key: { in: botEventKeys } } }).catch(() => {})
    await prisma.rateLimit.deleteMany({
      where: { OR: rateLimitKeys.map((k) => ({ key: { startsWith: k } })) },
    }).catch(() => {})
    await hp.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {})
  } catch { /* cleanup best-effort */ }

  return finish()
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => Promise.all([prisma.$disconnect(), hp.$disconnect()]))
