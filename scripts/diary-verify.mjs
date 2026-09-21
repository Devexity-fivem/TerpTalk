// Phase 6 verification — grow diary API contracts, week grouping, harvest
// report, strain stats honesty tiers, Diary of the Month contest, reactions
// block check. Temp users/diaries/strains fully cleaned up.
import "./db-guard.mjs"
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
  return { status: res.status, html: await res.text(), location: res.headers.get("location") }
}

const main = async () => {
  // Owner is backdated + repped so the self-vote test reaches the self-vote
  // check rather than being stopped at the voter trust gate.
  const seedRep = async (userId, amount) => {
    await prisma.profile.update({ where: { userId }, data: { reputation: { increment: amount } } })
    await prisma.reputationEvent.create({
      data: { userId, type: "STAFF_ADJUSTMENT", amount, reason: "test seed" },
    })
  }
  const owner = await createUser("owner", { createdAt: new Date(Date.now() - 30 * 86400000) })
  await seedRep(owner.id, 50)
  const viewer = await createUser("viewer")
  const banned = await createUser("banned")
  // Contest voter needs 7d age + 10 rep — backdate + grant reputation.
  const voter = await createUser("voter", { createdAt: new Date(Date.now() - 9 * 86400000) })
  await seedRep(voter.id, 50)
  const users = [owner, viewer, banned, voter]
  const diaryIds = []
  const strainIds = []
  const setupIds = []
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
    // Page loads go through the canonical slug URL — the id URL is now a
    // permanent redirect (verified separately in the slug section below).
    const diaryHref = `/diaries/${r.data?.diary?.slug ?? diaryId}`
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
    let page = await getHtml(diaryHref, ownerCookie)
    page.status === 200 && page.html.includes("Week") && page.html.includes("Day ")
      ? pass("diary page renders week/day grouping")
      : fail("week grouping", page.status)
    page.html.includes("Environment — Temp / RH / VPD") ? pass("env chart section renders with 2+ readings") : fail("env chart", "heading missing")
    page.html.includes("Add Update") ? pass("owner sees update form") : fail("owner update form", "missing")
    page.html.includes("Grow setup") ? pass("setup details render") : fail("setup details", "missing")

    page = await getHtml(diaryHref, viewerCookie)
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

    page = await getHtml(diaryHref)
    page.status === 200 && page.html.includes("Harvest Report") && page.html.includes("100") && page.html.includes("oz")
      ? pass("harvest report card renders")
      : fail("harvest report", page.status)

    // Unmark returns the diary to a pre-harvest stage
    r = await callApi(`/api/diaries/${diaryId}/harvest`, { method: "PATCH", body: { harvested: false }, cookie: ownerCookie })
    r.status === 200 ? pass("unharvest works") : fail("unharvest", r.status)
    // Re-harvest so the contest/stat fixtures see a harvested diary
    await callApi(`/api/diaries/${diaryId}/harvest`, { method: "PATCH", body: { harvested: true, yieldAmount: 100, yieldUnit: "oz" }, cookie: ownerCookie })

    // ── Edit-path ownership (P1 — behavioral HTTP, not a mirrored query) ──
    r = await callApi("/api/diaries/updates", { method: "PATCH", body: { id: upd.id, title: M("hijack") }, cookie: viewerCookie })
    r.status === 403 ? pass("update PATCH rejects non-owner") : fail("update PATCH non-owner", r.status)

    r = await callApi(`/api/diaries/${diaryId}`, { method: "PATCH", body: { title: M("hijack") }, cookie: viewerCookie })
    r.status === 403 ? pass("diary PATCH rejects non-owner") : fail("diary PATCH non-owner", r.status)

    r = await callApi("/api/diaries/updates", { method: "PATCH", body: { id: upd.id, title: M("edited") }, cookie: ownerCookie })
    r.status === 200 ? pass("update PATCH succeeds for owner") : fail("update PATCH owner", { s: r.status, d: r.data })

    r = await callApi(`/api/diaries/${diaryId}`, { method: "PATCH", body: { title: M("edited") }, cookie: ownerCookie })
    r.status === 200 ? pass("diary PATCH succeeds for owner") : fail("diary PATCH owner", { s: r.status, d: r.data })

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

    // ── Visibility matrix ───────────────────────────────────────────
    // owner / viewer (blocked by owner — mutual semantics) / voter
    // (unrelated member) / guest × PUBLIC / UNLISTED / PRIVATE.
    const tok = M("vis")
    const mkVis = (visibility) => prisma.growDiary.create({
      data: {
        title: `${tok} ${visibility}`, description: "visibility fixture",
        growType: "INDOOR", startDate: new Date(), authorId: owner.id, visibility,
      },
    })
    const pubD = await mkVis("PUBLIC")
    const unlD = await mkVis("UNLISTED")
    const prvD = await mkVis("PRIVATE")
    diaryIds.push(pubD.id, unlD.id, prvD.id)
    // Give the PRIVATE diary an update + harvest so profile growStreak
    // counts differ between owner and non-owner viewers.
    await prisma.diaryUpdate.create({
      data: { diaryId: prvD.id, authorId: owner.id, title: M("pu"), content: "private update", stage: "VEGETATIVE", dayNumber: 1, weekNumber: 1 },
    })
    await prisma.growDiary.update({
      where: { id: prvD.id },
      data: { harvested: true, harvestedAt: new Date(), yieldAmount: 50, yieldUnit: "g" },
    })

    const actors = [
      ["owner", ownerCookie],
      ["other", voterCookie],
      ["blocked", viewerCookie],
      ["guest", undefined],
    ]
    const expect = {
      PUBLIC:   { owner: 200, other: 200, blocked: 200, guest: 200 },
      UNLISTED: { owner: 200, other: 200, blocked: 200, guest: 200 },
      PRIVATE:  { owner: 200, other: 404, blocked: 404, guest: 404 },
    }
    const pages = {}
    for (const [vis, d] of [["PUBLIC", pubD], ["UNLISTED", unlD], ["PRIVATE", prvD]]) {
      for (const [who, ck] of actors) {
        const p = await getHtml(`/diaries/${d.id}`, ck)
        p.status === expect[vis][who]
          ? pass(`${vis} diary → ${who} gets ${expect[vis][who]}`)
          : fail(`${vis} diary ${who}`, p.status)
        if (who === "guest") pages[vis] = p.html
        if (who === "owner") pages[`${vis}_owner`] = p.html
      }
    }

    ;/<meta name="robots"[^>]*noindex/.test(pages.UNLISTED || "")
      ? pass("unlisted page carries noindex")
      : fail("unlisted noindex", (pages.UNLISTED || "").match(/<meta name="robots"[^>]*>/)?.[0])
    ;(pages.PUBLIC || "").includes("BlogPosting")
      ? pass("public page emits BlogPosting JSON-LD")
      : fail("public JSON-LD", "missing")
    !(pages.UNLISTED || "").includes("BlogPosting") && !(pages.PRIVATE_owner || "").includes("BlogPosting")
      ? pass("non-public pages emit no BlogPosting JSON-LD")
      : fail("non-public JSON-LD", "leaked")

    let sr = await callApi(`/api/search?q=${tok}&type=diaries`)
    const srTitles = (sr.data?.diaries || []).map((d) => d.title)
    srTitles.includes(`${tok} PUBLIC`) && !srTitles.some((t) => t.includes("UNLISTED") || t.includes("PRIVATE"))
      ? pass("search returns only PUBLIC diary")
      : fail("search visibility", srTitles)

    const profOther = await callApi(`/api/users/${owner.username}`, { cookie: voterCookie })
    const profOwner = await callApi(`/api/users/${owner.username}`, { cookie: ownerCookie })
    const oTitles = (profOther.data?.diaries || profOther.data?.growDiaries || []).map((d) => d.title)
    const sTitles = (profOwner.data?.diaries || profOwner.data?.growDiaries || []).map((d) => d.title)
    oTitles.includes(`${tok} PUBLIC`) && !oTitles.some((t) => t.includes("UNLISTED") || t.includes("PRIVATE"))
      ? pass("profile API shows other member only PUBLIC diaries")
      : fail("profile other visibility", oTitles.filter((t) => t.includes(tok)))
    [`${tok} PUBLIC`, `${tok} UNLISTED`, `${tok} PRIVATE`].every((t) => sTitles.includes(t))
      ? pass("profile API shows owner all own diaries")
      : fail("profile owner visibility", sTitles.filter((t) => t.includes(tok)))

    // growStreak must not leak PRIVATE-diary activity to other viewers.
    const gsOther = profOther.data?.profile
    const gsOwner = profOwner.data?.profile
    const expOtherUpdates = await prisma.diaryUpdate.count({
      where: { authorId: owner.id, diary: { deleted: false, visibility: "PUBLIC" } },
    })
    const expOwnerUpdates = await prisma.diaryUpdate.count({
      where: { authorId: owner.id, diary: { deleted: false } },
    })
    const expOtherHarvested = await prisma.growDiary.count({
      where: { authorId: owner.id, deleted: false, harvested: true, visibility: "PUBLIC" },
    })
    const expOwnerHarvested = await prisma.growDiary.count({
      where: { authorId: owner.id, deleted: false, harvested: true },
    })
    gsOther?.totalUpdates === expOtherUpdates && gsOther?.harvestedDiaries === expOtherHarvested
      ? pass("profile growStreak scoped to PUBLIC for other member")
      : fail("growStreak other", { gsOther, expOtherUpdates, expOtherHarvested })
    gsOwner?.totalUpdates === expOwnerUpdates && gsOwner?.harvestedDiaries === expOwnerHarvested
      ? pass("profile growStreak full-scope for owner")
      : fail("growStreak owner", { gsOwner, expOwnerUpdates, expOwnerHarvested })

    // Interactions on non-public diaries
    r = await callApi("/api/follows", { method: "POST", body: { diaryId: prvD.id }, cookie: voterCookie })
    r.status === 404 ? pass("follow on PRIVATE diary 404s") : fail("follow private", r.status)
    r = await callApi("/api/reactions", { method: "POST", body: { type: "LIKE", diaryId: prvD.id }, cookie: voterCookie })
    r.status === 404 ? pass("reaction on PRIVATE diary 404s") : fail("react private", r.status)
    r = await callApi(`/api/diaries/${unlD.id}/discuss`, { method: "POST", cookie: voterCookie })
    r.status === 404 ? pass("discuss on UNLISTED diary 404s") : fail("discuss unlisted", r.status)

    // Visibility mutations
    r = await callApi(`/api/diaries/${pubD.id}`, { method: "PATCH", body: { visibility: "PRIVATE" }, cookie: voterCookie })
    r.status === 403 ? pass("non-owner visibility PATCH rejected") : fail("non-owner patch", r.status)
    r = await callApi(`/api/diaries/${pubD.id}`, { method: "PATCH", body: { visibility: "BOGUS" }, cookie: ownerCookie })
    r.status === 400 ? pass("invalid visibility rejected") : fail("bogus visibility", r.status)
    r = await callApi(`/api/diaries/${pubD.id}`, { method: "PATCH", body: { visibility: "UNLISTED" }, cookie: ownerCookie })
    r.status === 200 ? pass("owner visibility PATCH succeeds") : fail("owner patch", { s: r.status, d: r.data })
    r = await callApi(`/api/diaries/${pubD.id}`, { method: "PATCH", body: { visibility: "PUBLIC" }, cookie: ownerCookie })

    // /diaries is cached (300s) — the visibility PATCH above busts the
    // "diaries" tag, so this fetch sees the fresh public-only set.
    const dlVis = await getHtml("/diaries")
    dlVis.html.includes(`${tok} PUBLIC`) && !dlVis.html.includes(`${tok} UNLISTED`) && !dlVis.html.includes(`${tok} PRIVATE`)
      ? pass("/diaries lists only PUBLIC visibility")
      : fail("/diaries visibility", { pub: dlVis.html.includes(`${tok} PUBLIC`), unl: dlVis.html.includes(`${tok} UNLISTED`), prv: dlVis.html.includes(`${tok} PRIVATE`) })

    r = await callApi("/api/diaries", {
      method: "POST",
      body: { title: M("unlcreate"), growType: "INDOOR", startDate: new Date().toISOString(), visibility: "UNLISTED" },
      cookie: ownerCookie,
    })
    const unlCreated = r.data?.diary?.id
    if (unlCreated) diaryIds.push(unlCreated)
    const unlRow = unlCreated && await prisma.growDiary.findUnique({ where: { id: unlCreated }, select: { visibility: true } })
    r.status === 201 && unlRow?.visibility === "UNLISTED"
      ? pass("create with UNLISTED persists")
      : fail("create unlisted", { s: r.status, v: unlRow?.visibility })

    // Blocked author's PUBLIC diary hides from the blocker's lists but
    // stays visible to guests/unrelated members; blocker's own stays.
    const blockedPub = await prisma.growDiary.create({
      data: { title: `${tok} blocked-public`, description: "s", growType: "INDOOR", startDate: new Date(), authorId: viewer.id },
    })
    diaryIds.push(blockedPub.id)
    const dlBlocker = await getHtml("/diaries", ownerCookie)
    const dlGuest = await getHtml("/diaries")
    const dlUnrel = await getHtml("/diaries", voterCookie)
    !dlBlocker.html.includes("blocked-public") ? pass("blocked author's diary hidden from blocker list") : fail("blocker /diaries", "visible")
    dlGuest.html.includes("blocked-public") && dlUnrel.html.includes("blocked-public")
      ? pass("blocked author's diary visible to guest/unrelated")
      : fail("guest/unrelated /diaries", { g: dlGuest.html.includes("blocked-public"), u: dlUnrel.html.includes("blocked-public") })
    dlBlocker.html.includes(`${tok} PUBLIC`) ? pass("blocker's own diary still listed") : fail("blocker own diary", "missing")
    sr = await callApi(`/api/search?q=${encodeURIComponent("blocked-public")}&type=diaries`, { cookie: ownerCookie })
    !(sr.data?.diaries || []).some((d) => d.title.includes("blocked-public"))
      ? pass("blocked author's diary hidden from blocker search")
      : fail("blocker search", sr.data?.diaries)
    sr = await callApi(`/api/search?q=${encodeURIComponent("blocked-public")}&type=diaries`)
    ;(sr.data?.diaries || []).some((d) => d.title.includes("blocked-public"))
      ? pass("blocked author's diary searchable by guest")
      : fail("guest search", sr.data?.diaries)

    // ── Canonical slugs (id → 308 → slug, privacy-ordered) ─────────
    const slugifyLocal = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/^-+|-+$/g, "")
    const expSlug = (title, id, fallback) => `${slugifyLocal(title) || fallback}-${id.slice(-6).toLowerCase()}`

    r = await callApi("/api/diaries", {
      method: "POST",
      body: { title: `Blue Dream Indoor Grow ${TS}`, description: "slug fixture", growType: "INDOOR", startDate: new Date().toISOString() },
      cookie: ownerCookie,
    })
    const sDiary = r.data?.diary
    if (sDiary?.id) diaryIds.push(sDiary.id)
    r.status === 201 && sDiary?.slug === expSlug(`Blue Dream Indoor Grow ${TS}`, sDiary?.id ?? "", "diary")
      ? pass("diary created with canonical slug")
      : fail("diary slug", { s: r.status, slug: sDiary?.slug })

    if (sDiary?.slug) {
      page = await getHtml(`/diaries/${sDiary.slug}`)
      page.status === 200 ? pass("slug URL serves the diary") : fail("slug 200", page.status)

      const red = await getHtml(`/diaries/${sDiary.id}`)
      red.status === 308 && red.location === `/diaries/${sDiary.slug}`
        ? pass("old id URL 308s to slug URL")
        : fail("id redirect", { st: red.status, loc: red.location })

      ;(page.html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] || "").endsWith(`/diaries/${sDiary.slug}`)
        ? pass("canonical metadata uses slug URL")
        : fail("canonical slug", page.html.match(/<link rel="canonical"[^>]*>/)?.[0])

      // Rename keeps the slug — URLs are stable once issued.
      r = await callApi(`/api/diaries/${sDiary.id}`, { method: "PATCH", body: { title: `Renamed Grow ${TS}` }, cookie: ownerCookie })
      const renamed = await prisma.growDiary.findUnique({ where: { id: sDiary.id }, select: { slug: true } })
      r.status === 200 && renamed?.slug === sDiary.slug
        ? pass("rename preserves slug")
        : fail("rename slug", { s: r.status, slug: renamed?.slug })

      // Discovery surfaces emit the slug URL.
      const sRes = await callApi(`/api/search?q=${encodeURIComponent(`Renamed Grow ${TS}`)}&type=diaries`)
      const sHit = (sRes.data?.diaries || []).find((d) => d.id === sDiary.id)
      sHit?.slug === sDiary.slug
        ? pass("search result carries canonical slug")
        : fail("search slug", sHit)
      const dIdx = await getHtml("/diaries")
      dIdx.html.includes(`/diaries/${sDiary.slug}`)
        ? pass("/diaries card links slug URL")
        : fail("/diaries slug link", "missing")
      const smap = await getHtml("/sitemap.xml")
      smap.html.includes(`/diaries/${sDiary.slug}`) && !smap.html.includes(`/diaries/${sDiary.id}<`)
        ? pass("sitemap emits slug URL only")
        : fail("sitemap", { has: smap.html.includes(`/diaries/${sDiary.slug}`), id: smap.html.includes(`/diaries/${sDiary.id}<`) })

      // Notification invalidation catches both URL forms: seed an
      // old-style id link and a new-style slug link (with a deep anchor,
      // the form update notifications actually store).
      await prisma.notification.createMany({
        data: [
          { userId: owner.id, type: "DIARY_UPDATE", title: "legacy", content: "legacy id link", link: `/diaries/${sDiary.id}` },
          { userId: owner.id, type: "DIARY_UPDATE", title: "slugform", content: "slug link", link: `/diaries/${sDiary.slug}#week-3` },
        ],
      })
      const linkedBefore = await prisma.notification.count({
        where: { userId: owner.id, OR: [{ link: { contains: sDiary.id } }, { link: { contains: sDiary.slug } }] },
      })
      r = await callApi(`/api/diaries`, { method: "DELETE", body: { id: sDiary.id }, cookie: ownerCookie })
      const linkedAfter = await prisma.notification.count({
        where: { userId: owner.id, OR: [{ link: { contains: sDiary.id } }, { link: { contains: sDiary.slug } }] },
      })
      linkedBefore > 0 && linkedAfter === 0
        ? pass("diary delete invalidates id + slug notification links")
        : fail("notification invalidation", { linkedBefore, linkedAfter })
    }

    // PRIVATE diary: slug works for the owner, id URL 308s for the owner,
    // and neither URL reveals existence to anyone else.
    r = await callApi("/api/diaries", {
      method: "POST",
      body: { title: `Secret Grow ${TS}`, description: "slug fixture", growType: "INDOOR", startDate: new Date().toISOString(), visibility: "PRIVATE" },
      cookie: ownerCookie,
    })
    const pDiary = r.data?.diary
    if (pDiary?.id) diaryIds.push(pDiary.id)
    if (pDiary?.slug) {
      const oSlug = await getHtml(`/diaries/${pDiary.slug}`, ownerCookie)
      const oId = await getHtml(`/diaries/${pDiary.id}`, ownerCookie)
      oSlug.status === 200 ? pass("owner opens PRIVATE diary by slug") : fail("owner slug", oSlug.status)
      oId.status === 308 && oId.location === `/diaries/${pDiary.slug}`
        ? pass("owner id URL 308s to slug")
        : fail("owner id redirect", { st: oId.status, loc: oId.location })
      const gId = await getHtml(`/diaries/${pDiary.id}`)
      const gSlug = await getHtml(`/diaries/${pDiary.slug}`)
      const mSlug = await getHtml(`/diaries/${pDiary.slug}`, voterCookie)
      gId.status === 404 && gSlug.status === 404 && mSlug.status === 404 && !gId.location && !gSlug.location
        ? pass("PRIVATE diary leaks nothing via id or slug URL")
        : fail("private slug leak", { gId: gId.status, gSlug: gSlug.status, mSlug: mSlug.status, loc: gId.location })
    }

    // UNLISTED diary: reachable by slug, id URL still redirects, noindex kept.
    r = await callApi("/api/diaries", {
      method: "POST",
      body: { title: `Quiet Grow ${TS}`, description: "slug fixture", growType: "INDOOR", startDate: new Date().toISOString(), visibility: "UNLISTED" },
      cookie: ownerCookie,
    })
    const uDiary = r.data?.diary
    if (uDiary?.id) diaryIds.push(uDiary.id)
    if (uDiary?.slug) {
      const gSlug = await getHtml(`/diaries/${uDiary.slug}`)
      const gId = await getHtml(`/diaries/${uDiary.id}`)
      gSlug.status === 200 && /<meta name="robots"[^>]*noindex/.test(gSlug.html)
        ? pass("UNLISTED slug URL serves page with noindex")
        : fail("unlisted slug", { st: gSlug.status, noindex: /<meta name="robots"[^>]*noindex/.test(gSlug.html) })
      gId.status === 308 && gId.location === `/diaries/${uDiary.slug}`
        ? pass("UNLISTED id URL 308s to slug")
        : fail("unlisted redirect", { st: gId.status, loc: gId.location })
    }

    page = await getHtml(`/diaries/not-a-real-slug-${TS}`)
    page.status === 404 ? pass("missing slug 404s") : fail("missing slug", page.status)

    // Strain + setup get the same treatment: slug at creation, id → 308.
    const slugStrainName = `Slug Strain ${TS}`
    r = await callApi("/api/strains", { method: "POST", body: { name: slugStrainName, type: "HYBRID" }, cookie: ownerCookie })
    const sStrain = r.data?.strain
    if (sStrain?.id) strainIds.push(sStrain.id)
    sStrain?.slug === expSlug(slugStrainName, sStrain?.id ?? "", "strain")
      ? pass("strain created with canonical slug")
      : fail("strain slug", { s: r.status, slug: sStrain?.slug })
    if (sStrain?.slug) {
      const red = await getHtml(`/strains/${sStrain.id}`)
      red.status === 308 && red.location === `/strains/${sStrain.slug}`
        ? pass("strain id URL 308s to slug")
        : fail("strain redirect", { st: red.status, loc: red.location })
      page = await getHtml(`/strains/${sStrain.slug}`)
      page.status === 200 ? pass("strain slug URL serves page") : fail("strain slug 200", page.status)
      const smap = await getHtml("/sitemap.xml")
      smap.html.includes(`/strains/${sStrain.slug}`) && !smap.html.includes(`/strains/${sStrain.id}<`)
        ? pass("sitemap emits strain slug URL only")
        : fail("strain sitemap", sStrain.slug)
    }
    page = await getHtml(`/strains/not-a-real-slug-${TS}`)
    page.status === 404 ? pass("missing strain slug 404s") : fail("missing strain", page.status)

    const slugSetupTitle = `Slug Setup ${TS}`
    r = await callApi("/api/setups", { method: "POST", body: { title: slugSetupTitle, description: "slug fixture" }, cookie: ownerCookie })
    const sSetup = r.data?.setup
    if (sSetup?.id) setupIds.push(sSetup.id)
    sSetup?.slug === expSlug(slugSetupTitle, sSetup?.id ?? "", "setup")
      ? pass("setup created with canonical slug")
      : fail("setup slug", { s: r.status, slug: sSetup?.slug })
    if (sSetup?.slug) {
      const red = await getHtml(`/setups/${sSetup.id}`)
      red.status === 308 && red.location === `/setups/${sSetup.slug}`
        ? pass("setup id URL 308s to slug")
        : fail("setup redirect", { st: red.status, loc: red.location })
      page = await getHtml(`/setups/${sSetup.slug}`)
      page.status === 200 ? pass("setup slug URL serves page") : fail("setup slug 200", page.status)
      r = await callApi("/api/setups", { method: "PATCH", body: { id: sSetup.id, title: `Hijacked ${TS}` }, cookie: viewerCookie })
      r.status === 403 ? pass("setup PATCH rejects non-owner") : fail("setup PATCH non-owner", r.status)
      r = await callApi("/api/setups", { method: "PATCH", body: { id: sSetup.id, title: `Renamed Setup ${TS}` }, cookie: ownerCookie })
      const renamedSetup = await prisma.growSetup.findUnique({ where: { id: sSetup.id }, select: { slug: true } })
      r.status === 200 && renamedSetup?.slug === sSetup.slug
        ? pass("setup rename preserves slug")
        : fail("setup rename", { s: r.status, slug: renamedSetup?.slug })
      const smap = await getHtml("/sitemap.xml")
      smap.html.includes(`/setups/${sSetup.slug}`) && !smap.html.includes(`/setups/${sSetup.id}<`)
        ? pass("sitemap emits setup slug URL only")
        : fail("setup sitemap", sSetup.slug)
    }
    page = await getHtml(`/setups/not-a-real-slug-${TS}`)
    page.status === 404 ? pass("missing setup slug 404s") : fail("missing setup", page.status)

    // ── Deleted diary 404s ──────────────────────────────────────────
    await prisma.growDiary.update({ where: { id: sd2.id }, data: { deleted: true } })
    page = await getHtml(`/diaries/${sd2.id}`)
    page.status === 404 ? pass("deleted diary 404s") : fail("deleted diary", page.status)
  } catch (e) {
    fail("suite error", String(e))
  } finally {
    if (strainId) await prisma.strain.delete({ where: { id: strainId } }).catch(() => {})
    for (const id of strainIds) await prisma.strain.delete({ where: { id } }).catch(() => {})
    for (const id of setupIds) await prisma.growSetup.delete({ where: { id } }).catch(() => {})
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
