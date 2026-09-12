// Phase 6 verification — grow diary API contracts, week grouping, harvest
// report, strain stats honesty tiers, Diary of the Month contest, reactions
// block check. Temp users/diaries/strains fully cleaned up.
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const BASE = process.env.VERIFY_URL || "http://localhost:3000"
const prisma = new PrismaClient()
const results = []
function pass(n) { results.push(["PASS", n]); console.log(`  ✓ ${n}`) }
function fail(n, i) { results.push(["FAIL", n]); console.log(`  ✗ ${n} — ${JSON.stringify(i)?.slice(0, 300)}`) }

const TS = Date.now().toString(36)
const M = (l) => `__dv_${l}_${TS}`

const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

async function createUser(tag, extra = {}) {
  const password = "VerifyPass123!"
  const user = await prisma.user.create({
    data: {
      name: `__verify_${tag}_${TS}`,
      ageVerified: true,
      password: await bcrypt.hash(password, 12),
      sessionVersion: 1,
      onboardingCompletedAt: new Date(),
      profile: { create: { username: `__dv_${tag}_${TS}` } },
      ...extra,
    },
    include: { profile: true },
  })
  return { ...user, password, username: user.profile.username }
}

async function login(username, password) {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`)
  const { csrfToken } = await csrfRes.json()
  const csrfCookie = (csrfRes.headers.getSetCookie?.() || [csrfRes.headers.get("set-cookie")]).filter(Boolean).map((c) => c.split(";")[0]).join("; ")
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", cookie: csrfCookie },
    body: new URLSearchParams({ csrfToken, username, password, json: "true" }),
    redirect: "manual",
  })
  const cookies = [...(csrfCookie ? [csrfCookie] : []), ...(res.headers.getSetCookie?.() || []).map((c) => c.split(";")[0])].join("; ")
  return { cookie: cookies }
}

async function callApi(path, { method = "GET", body, cookie } = {}) {
  const headers = {}
  if (body) headers["Content-Type"] = "application/json"
  if (cookie) headers["cookie"] = cookie
  let res
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: "manual" })
  } catch (e) {
    return { status: 0, data: { fetchError: String(e) }, location: null }
  }
  let data = null
  try { data = await res.json() } catch { /* html/redirect */ }
  return { status: res.status, data, location: res.headers.get("location") }
}

async function getHtml(path, cookie) {
  const res = await fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {}, redirect: "manual" })
  return { status: res.status, html: await res.text() }
}

const main = async () => {
  // Owner is backdated + repped so the self-vote test reaches the self-vote
  // check rather than being stopped at the voter trust gate.
  const owner = await createUser("owner", { createdAt: new Date(Date.now() - 30 * 86400000) })
  await prisma.profile.update({ where: { userId: owner.id }, data: { reputation: 50 } })
  const viewer = await createUser("viewer")
  const banned = await createUser("banned")
  // Contest voter needs 7d age + 10 rep — backdate + grant reputation.
  const voter = await createUser("voter", { createdAt: new Date(Date.now() - 9 * 86400000) })
  await prisma.profile.update({ where: { userId: voter.id }, data: { reputation: 50 } })
  const users = [owner, viewer, banned, voter]
  const diaryIds = []
  let strainId = null
  let contestEntryId = null

  try {
    await prisma.user.update({ where: { id: banned.id }, data: { banned: true } })
    await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "login" } } })

    const { cookie: ownerCookie } = await login(owner.username, owner.password)
    const { cookie: viewerCookie } = await login(viewer.username, viewer.password)
    const { cookie: bannedCookie } = await login(banned.username, banned.password)
    const { cookie: voterCookie } = await login(voter.username, voter.password)
    ;[ownerCookie, viewerCookie, bannedCookie, voterCookie].every(Boolean)
      ? pass("logins work")
      : fail("logins", "missing session cookie")

    // ── Diary create contracts ──────────────────────────────────────
    let r = await callApi("/api/diaries", { method: "POST", body: { title: M("d"), startDate: "2026-01-01", growType: "INDOOR" } })
    r.status === 401 ? pass("diary create requires auth") : fail("diary create anon", r.status)

    r = await callApi("/api/diaries", { method: "POST", body: { title: "", growType: "INDOOR" }, cookie: ownerCookie })
    r.status === 400 ? pass("diary create validates required fields") : fail("diary create 400", r.status)

    r = await callApi("/api/diaries", {
      method: "POST",
      body: { title: M("grow"), description: "verification diary", strain: M("strain"), growType: "INDOOR", startDate: new Date(Date.now() - 20 * 86400000).toISOString(), medium: "coco", lighting: "LED" },
      cookie: ownerCookie,
    })
    r.status === 201 && r.data?.diary?.id ? pass("diary created via API") : fail("diary create", { s: r.status, d: r.data })
    const diaryId = r.data?.diary?.id
    if (diaryId) diaryIds.push(diaryId)
    if (!diaryId) throw new Error("cannot continue without a diary")

    // ── Update contracts ────────────────────────────────────────────
    r = await callApi("/api/diaries/updates", { method: "POST", body: { diaryId, title: "t", content: "c" } })
    r.status === 401 ? pass("update requires auth") : fail("update anon", r.status)

    r = await callApi("/api/diaries/updates", { method: "POST", body: { diaryId, title: "t", content: "c" }, cookie: viewerCookie })
    r.status === 403 ? pass("update requires ownership") : fail("update non-owner", r.status)

    r = await callApi("/api/diaries/updates", {
      method: "POST",
      body: { diaryId, title: M("u1"), content: "first update", stage: "VEGETATIVE", temperature: 75, humidity: 55, vpd: 1.1 },
      cookie: ownerCookie,
    })
    const upd = r.data?.update
    r.status === 201 && typeof upd?.dayNumber === "number" && typeof upd?.weekNumber === "number"
      ? pass("update created with auto-derived day/week")
      : fail("update create/derive", { s: r.status, day: upd?.dayNumber, week: upd?.weekNumber })

    // Second update with env so the env chart threshold (>=2) is met
    r = await callApi("/api/diaries/updates", {
      method: "POST",
      body: { diaryId, title: M("u2"), content: "second update", stage: "FLOWER", temperature: 78, humidity: 50, vpd: 1.4, images: [TINY_PNG] },
      cookie: ownerCookie,
    })
    r.status === 201 ? pass("second update with photo created") : fail("update 2", { s: r.status, d: r.data })

    r = await callApi("/api/diaries/updates", {
      method: "POST",
      body: { diaryId, title: "x", content: "x", temperature: 500 },
      cookie: ownerCookie,
    })
    r.status === 400 ? pass("out-of-range env value rejected") : fail("env bounds", r.status)

    r = await callApi("/api/diaries/updates", {
      method: "POST",
      body: { diaryId, title: "x", content: "x", stage: "BOGUS" },
      cookie: ownerCookie,
    })
    r.status === 400 ? pass("invalid stage rejected") : fail("stage validation", r.status)

    // Stage propagation: the FLOWER update should have moved the diary stage
    const diaryRow = await prisma.growDiary.findUnique({ where: { id: diaryId }, select: { stage: true } })
    diaryRow?.stage === "FLOWER" ? pass("explicit stage propagates to diary") : fail("stage propagation", diaryRow?.stage)

    // ── Diary page HTML — weekly grouping + gating ──────────────────
    let page = await getHtml(`/diaries/${diaryId}`, ownerCookie)
    page.status === 200 && page.html.includes("Week") && page.html.includes("Day ")
      ? pass("diary page renders week/day grouping")
      : fail("week grouping", page.status)
    page.html.includes("Environment — Temp / RH / VPD") ? pass("env chart section renders with 2+ readings") : fail("env chart", "heading missing")
    page.html.includes("Add Update") ? pass("owner sees update form") : fail("owner update form", "missing")
    page.html.includes("Grow setup") ? pass("setup details render") : fail("setup details", "missing")

    page = await getHtml(`/diaries/${diaryId}`, viewerCookie)
    page.status === 200 && !page.html.includes("Add Update") && !page.html.includes("Log harvest")
      ? pass("viewer does not see owner controls")
      : fail("viewer gating", page.html.includes("Add Update"))

    // ── Harvest contracts + report ──────────────────────────────────
    r = await callApi(`/api/diaries/${diaryId}/harvest`, { method: "PATCH", body: {}, cookie: ownerCookie })
    r.status === 400 ? pass("harvest requires boolean") : fail("harvest 400", r.status)

    r = await callApi(`/api/diaries/${diaryId}/harvest`, { method: "PATCH", body: { harvested: true }, cookie: viewerCookie })
    r.status === 403 ? pass("harvest requires ownership") : fail("harvest 403", r.status)

    r = await callApi(`/api/diaries/${diaryId}/harvest`, { method: "PATCH", body: { harvested: true, yieldAmount: 100, yieldUnit: "stone" }, cookie: ownerCookie })
    r.status === 400 ? pass("invalid yield unit rejected") : fail("yieldUnit enum", r.status)

    r = await callApi(`/api/diaries/${diaryId}/harvest`, { method: "PATCH", body: { harvested: true, yieldAmount: 100, yieldUnit: "oz" }, cookie: ownerCookie })
    r.status === 200 ? pass("harvest logged") : fail("harvest 200", { s: r.status, d: r.data })

    page = await getHtml(`/diaries/${diaryId}`)
    page.status === 200 && page.html.includes("Harvest Report") && page.html.includes("100") && page.html.includes("oz")
      ? pass("harvest report card renders")
      : fail("harvest report", page.status)

    // Unmark returns the diary to a pre-harvest stage
    r = await callApi(`/api/diaries/${diaryId}/harvest`, { method: "PATCH", body: { harvested: false }, cookie: ownerCookie })
    r.status === 200 ? pass("unharvest works") : fail("unharvest", r.status)
    // Re-harvest so the contest/stat fixtures see a harvested diary
    await callApi(`/api/diaries/${diaryId}/harvest`, { method: "PATCH", body: { harvested: true, yieldAmount: 100, yieldUnit: "oz" }, cookie: ownerCookie })

    // ── Diary of the Month ──────────────────────────────────────────
    // The diary needs 4+ updates this month — we have 2, add 2 more.
    for (const t of ["u3", "u4"]) {
      await callApi("/api/diaries/updates", { method: "POST", body: { diaryId, title: M(t), content: "contest eligibility update" }, cookie: ownerCookie })
    }

    let dc = await callApi("/api/diary-contest")
    dc.status === 200 && Array.isArray(dc.data?.entries) ? pass("diary contest GET works") : fail("contest GET", dc.status)

    r = await callApi("/api/diary-contest", { method: "POST", body: { action: "enter" } })
    r.status === 401 ? pass("contest enter requires auth") : fail("enter anon", r.status)

    r = await callApi("/api/diary-contest", { method: "POST", body: { action: "enter", diaryId }, cookie: viewerCookie })
    r.status === 400 ? pass("entering someone else's diary rejected") : fail("enter ownership", r.status)

    r = await callApi("/api/diary-contest", { method: "POST", body: { action: "enter", diaryId }, cookie: ownerCookie })
    if (r.status === 201) { contestEntryId = r.data?.entry?.id; pass("eligible diary entered") }
    else fail("contest enter", { s: r.status, d: r.data })

    r = await callApi("/api/diary-contest", { method: "POST", body: { action: "enter", diaryId }, cookie: ownerCookie })
    r.status === 409 ? pass("double entry rejected") : fail("enter 409", r.status)

    if (contestEntryId) {
      // Fresh viewer (age 0, rep 0) is blocked by the voter trust gate
      r = await callApi("/api/diary-contest", { method: "POST", body: { action: "vote", entryId: contestEntryId }, cookie: viewerCookie })
      r.status === 403 ? pass("untrusted voter rejected") : fail("voter gate", r.status)

      r = await callApi("/api/diary-contest", { method: "POST", body: { action: "vote", entryId: contestEntryId }, cookie: ownerCookie })
      r.status === 400 ? pass("self-vote rejected") : fail("self vote", r.status)

      r = await callApi("/api/diary-contest", { method: "POST", body: { action: "vote", entryId: contestEntryId }, cookie: voterCookie })
      r.status === 200 ? pass("trusted voter can vote") : fail("vote", { s: r.status, d: r.data })
    }

    // ── Reactions honor blocks ──────────────────────────────────────
    await prisma.block.create({ data: { blockerId: owner.id, blockedId: viewer.id } })
    r = await callApi("/api/reactions", { method: "POST", body: { type: "LIKE", diaryId }, cookie: viewerCookie })
    r.status === 403 ? pass("blocked user cannot react to diary") : fail("reaction block", r.status)

    // ── Strain stats honesty ────────────────────────────────────────
    // Run-unique strain + two more matching diaries (via prisma to avoid the
    // 5/day create cap) → "early" tier.
    const strain = await prisma.strain.create({
      data: { name: M("cultivar"), createdById: owner.id },
    })
    strainId = strain.id
    const mk = (extra) => prisma.growDiary.create({
      data: {
        title: M("sg"), description: "s", strain: strain.name, growType: "INDOOR",
        startDate: new Date(Date.now() - 90 * 86400000), authorId: voter.id, ...extra,
      },
    })
    const sd1 = await mk({ harvested: true, harvestedAt: new Date(Date.now() - 10 * 86400000), yieldAmount: 200, yieldUnit: "g" })
    const sd2 = await mk({ harvested: true, harvestedAt: new Date(Date.now() - 5 * 86400000), yieldAmount: 4, yieldUnit: "oz" })
    const sd3 = await prisma.growDiary.create({
      data: {
        title: M("sg"), description: "s", strain: strain.name, growType: "INDOOR",
        startDate: new Date(Date.now() - 30 * 86400000), authorId: viewer.id,
      },
    })
    diaryIds.push(sd1.id, sd2.id, sd3.id)

    page = await getHtml(`/strains/${strain.id}`)
    page.status === 200 && page.html.includes("Community grow data") && page.html.includes("Early community data")
      ? pass("strain stats block renders with early-tier label")
      : fail("strain stats", page.status)

    // Banned author's diary should not surface on /diaries
    const bd = await prisma.growDiary.create({
      data: { title: M("banned"), description: "s", growType: "INDOOR", startDate: new Date(), authorId: banned.id },
    })
    diaryIds.push(bd.id)
    const dl = await getHtml("/diaries")
    !dl.html.includes(M("banned")) ? pass("banned author hidden from diary list") : fail("banned diary listed", bd.id)

    // ── Deleted diary 404s ──────────────────────────────────────────
    await prisma.growDiary.update({ where: { id: sd2.id }, data: { deleted: true } })
    page = await getHtml(`/diaries/${sd2.id}`)
    page.status === 404 ? pass("deleted diary 404s") : fail("deleted diary", page.status)
  } catch (e) {
    fail("suite error", String(e))
  } finally {
    if (strainId) await prisma.strain.delete({ where: { id: strainId } }).catch(() => {})
    for (const id of diaryIds) await prisma.growDiary.delete({ where: { id } }).catch(() => {})
    for (const u of users) await prisma.user.delete({ where: { id: u.id } }).catch(() => {})
    await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "login" } } }).catch(() => {})
    await prisma.$disconnect()
  }

  const failed = results.filter((r) => r[0] === "FAIL")
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
}

main()
