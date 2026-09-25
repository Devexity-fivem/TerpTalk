// Phase 6 verification — grow diary API contracts, week grouping, harvest
// report, strain stats honesty tiers, Diary of the Month contest, reactions
// block check. Temp users/diaries/strains fully cleaned up.
import { makeHarness } from "./lib/http-harness.mjs"

const { prisma, BASE, ts: TS, pass, fail, createUser, login, api: callApi, finish } = makeHarness({
  username: (tag, ts) => `__dv_${tag}_${ts}`,
  summary: "fraction",
})

const M = (l) => `__dv_${l}_${TS}`

const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

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

    // Structured environmental observations — the full Slice A set persists on create
    r = await callApi("/api/diaries/updates", {
      method: "POST",
      body: {
        diaryId, title: M("env"), content: "structured env update", stage: "FLOWER",
        nightTemperature: 64, substrateTemperature: 71, co2Ppm: 900,
        wateringLiters: 1.5, ppfd: 720, photoperiodHours: 12,
        runoffPh: 6.1, runoffEc: 2.4, lampDistanceCm: 38,
      },
      cookie: ownerCookie,
    })
    const envUpd = r.data?.update
    r.status === 201 && envUpd?.ppfd === 720 && envUpd?.runoffPh === 6.1 && envUpd?.photoperiodHours === 12
      ? pass("structured env observations persist on create")
      : fail("env obs create", { s: r.status, d: r.data })

    r = await callApi("/api/diaries/updates", {
      method: "POST",
      body: { diaryId, title: "x", content: "x", photoperiodHours: 25 },
      cookie: ownerCookie,
    })
    r.status === 400 ? pass("photoperiod >24h rejected") : fail("photoperiod bound", r.status)

    r = await callApi("/api/diaries/updates", {
      method: "POST",
      body: { diaryId, title: "x", content: "x", ppfd: "bright" },
      cookie: ownerCookie,
    })
    r.status === 400 ? pass("non-numeric env value rejected") : fail("env type check", r.status)

    // PATCH — owner can add a metric and clear another
    r = await callApi("/api/diaries/updates", {
      method: "PATCH",
      body: { id: envUpd.id, ppfd: 800, runoffEc: null },
      cookie: ownerCookie,
    })
    const envRow = r.status === 200
      ? await prisma.diaryUpdate.findUnique({ where: { id: envUpd.id }, select: { ppfd: true, runoffEc: true } })
      : null
    envRow?.ppfd === 800 && envRow?.runoffEc === null
      ? pass("PATCH edits and clears env fields")
      : fail("env PATCH", { s: r.status, row: envRow })

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

    // ── Week navigator — needs 2+ week groups, so backdate one update
    // into week 1 (createdAt drives grouping, never the annotation). ──
    await prisma.diaryUpdate.create({
      data: { diaryId, authorId: owner.id, title: M("u0"), content: "backdated week-1 update", stage: "SEEDLING", dayNumber: 2, weekNumber: 1, createdAt: new Date(Date.now() - 19 * 86400000) },
    })
    page = await getHtml(diaryHref, ownerCookie)
    ;(page.status === 200 &&
      page.html.includes('id="week-1"') &&
      page.html.includes('id="week-3"') &&
      page.html.includes('aria-label="Jump to week"') &&
      page.html.includes('href="#week-1"'))
      ? pass("week navigator renders jump links + week anchors")
      : fail("week navigator", page.status)

    // Completeness signal in the hero — owner sees the real metric.
    // This fixture has strain/medium/lighting, 3+ updates, a photo, env
    // readings, and FLOWER stage → ≥80% → "Well documented".
    page.html.includes("Well documented") || page.html.includes("Log completeness")
      ? pass("hero surfaces the log-completeness signal for the owner")
      : fail("hero completeness", "signal missing")

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

    // ── strainId linkage through the real PATCH route ──
    const patchStrain = await prisma.strain.create({ data: { name: M("patchstrain"), createdById: owner.id } })
    strainIds.push(patchStrain.id)
    r = await callApi(`/api/diaries/${diaryId}`, { method: "PATCH", body: { strainId: patchStrain.id }, cookie: ownerCookie })
    const dLinked = await prisma.growDiary.findUnique({ where: { id: diaryId }, select: { strain: true, strainId: true } })
    r.status === 200 && dLinked?.strainId === patchStrain.id && dLinked?.strain === patchStrain.name
      ? pass("diary PATCH strainId links + syncs strain text to catalog name")
      : fail("diary PATCH strainId link", { s: r.status, dLinked })
    r = await callApi(`/api/diaries/${diaryId}`, { method: "PATCH", body: { strainId: null }, cookie: ownerCookie })
    const dUnlinked = await prisma.growDiary.findUnique({ where: { id: diaryId }, select: { strain: true, strainId: true } })
    r.status === 200 && dUnlinked?.strainId === null && dUnlinked?.strain === patchStrain.name
      ? pass("diary PATCH strainId null unlinks, keeps strain text")
      : fail("diary PATCH strainId null", { s: r.status, dUnlinked })
    r = await callApi(`/api/diaries/${diaryId}`, { method: "PATCH", body: { strainId: "nonexistent" }, cookie: ownerCookie })
    r.status === 400 && r.data?.error === "Strain not found"
      ? pass("diary PATCH unknown strainId → 400 Strain not found")
      : fail("diary PATCH unknown strainId", { s: r.status, d: r.data })

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

    // ── Similar grows honor blocks ──────────────────────────────────
    // Regression for the object-spread collision in diaries/[id]/page.tsx:
    // `...notBlockedAuthor(ids)` produced `authorId: { notIn }` which the
    // later `authorId: { not: diary.author.id }` key silently overwrote.
    const simB = await createUser("simb")
    const simC = await createUser("simc")
    users.push(simB, simC)
    const S = `__sim_${TS}`
    const mkSim = (authorId, t) => prisma.growDiary.create({
      data: {
        title: M(t), description: "similar fixture", strain: S, growType: "INDOOR",
        startDate: new Date(), authorId, visibility: "PUBLIC",
      },
    })
    const anchor = await mkSim(owner.id, "anchor")
    const ownerOther = await mkSim(owner.id, "owner-other")
    const bDiary = await mkSim(simB.id, "sim-b")
    const cDiary = await mkSim(simC.id, "sim-c")
    diaryIds.push(anchor.id, ownerOther.id, bDiary.id, cDiary.id)

    // "More from this grower" renders before "Similar grows" in the DOM, so
    // slicing at the h2 keeps the author's own titles out of the region.
    // Scripts are stripped first — the RSC flight payload at the page tail
    // embeds every fetched title (incl. moreFromAuthor) in <script> chunks.
    const simSlice = (html) => {
      const clean = html.replace(/<script[\s\S]*?<\/script>/g, "")
      const i = clean.indexOf("Similar grows")
      return i === -1 ? "" : clean.slice(i)
    }
    page = await getHtml(`/diaries/${anchor.id}`, ownerCookie)
    let simHtml = page.status === 200 ? simSlice(page.html) : ""
    simHtml.includes(bDiary.title) && simHtml.includes(cDiary.title)
      ? pass("similar grows lists eligible other growers")
      : fail("similar grows eligible", { s: page.status, b: simHtml.includes(bDiary.title), c: simHtml.includes(cDiary.title) })
    !simHtml.includes(ownerOther.title)
      ? pass("similar grows excludes current author's other diaries")
      : fail("similar grows author leak", ownerOther.id)

    await prisma.block.create({ data: { blockerId: owner.id, blockedId: simB.id } })
    page = await getHtml(`/diaries/${anchor.id}`, ownerCookie)
    simHtml = page.status === 200 ? simSlice(page.html) : ""
    simHtml.includes(cDiary.title) && !simHtml.includes(bDiary.title)
      ? pass("similar grows hides blocked author")
      : fail("similar grows blocked", { s: page.status, b: simHtml.includes(bDiary.title), c: simHtml.includes(cDiary.title) })

    await prisma.block.deleteMany({ where: { blockerId: owner.id, blockedId: simB.id } })
    page = await getHtml(`/diaries/${anchor.id}`, ownerCookie)
    simHtml = page.status === 200 ? simSlice(page.html) : ""
    simHtml.includes(bDiary.title)
      ? pass("similar grows restores author after unblock")
      : fail("similar grows unblock", { s: page.status })

    page = await getHtml(`/diaries/${anchor.id}`)
    simHtml = page.status === 200 ? simSlice(page.html) : ""
    simHtml.includes(bDiary.title) && simHtml.includes(cDiary.title)
      ? pass("similar grows visible to guests under public rules")
      : fail("similar grows guest", { s: page.status, b: simHtml.includes(bDiary.title), c: simHtml.includes(cDiary.title) })

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
    // ── Grow experiments — lifecycle, authz, evidence, privacy ─────
    r = await callApi(`/api/diaries/${diaryId}/experiments`, { method: "POST", body: { title: M("exp"), change: "dimmer 60 to 80" } })
    r.status === 401 ? pass("experiment create requires auth") : fail("experiment anon", r.status)

    r = await callApi(`/api/diaries/${diaryId}/experiments`, { method: "POST", body: { title: M("exp"), change: "x" }, cookie: viewerCookie })
    r.status === 403 ? pass("experiment create requires ownership") : fail("experiment non-owner", r.status)

    r = await callApi(`/api/diaries/${diaryId}/experiments`, { method: "POST", body: { title: M("exp") }, cookie: ownerCookie })
    r.status === 400 ? pass("experiment create requires a change description") : fail("experiment missing change", r.status)

    r = await callApi(`/api/diaries/${diaryId}/experiments`, { method: "POST", body: { title: M("exp"), change: "x", category: "MAGIC" }, cookie: ownerCookie })
    r.status === 400 ? pass("experiment rejects unknown category") : fail("experiment category", r.status)

    r = await callApi(`/api/diaries/${diaryId}/experiments`, { method: "POST", body: { title: M("exp"), change: "x", status: "COMPLETED" }, cookie: ownerCookie })
    r.status === 400 ? pass("experiment cannot be created already-completed") : fail("experiment create status", r.status)

    r = await callApi(`/api/diaries/${diaryId}/experiments`, {
      method: "POST",
      body: { title: `Light bump ${TS}`, change: "raised light intensity", reason: "leaf posture changed", expected: "posture recovers", category: "LIGHTING" },
      cookie: ownerCookie,
    })
    const expId = r.data?.experiment?.id
    r.status === 201 && expId && r.data.experiment.status === "ACTIVE" && r.data.experiment.followUp === "awaiting_first_observation"
      ? pass("experiment created ACTIVE with first-observation follow-up")
      : fail("experiment create", { s: r.status, d: r.data })

    r = await callApi(`/api/diaries/${diaryId}/experiments`, { method: "POST", body: { title: M("exp"), change: "x" }, cookie: bannedCookie })
    ;(r.status === 401 || r.status === 403) ? pass("banned member cannot create experiment") : fail("experiment banned", r.status)

    if (expId) {
      // Lifecycle — non-owner first (403 via forbidden path, not 404: the
      // experiment exists on a public diary so no oracle concern)
      r = await callApi(`/api/diaries/${diaryId}/experiments/${expId}`, { method: "PATCH", body: { status: "OBSERVING" }, cookie: viewerCookie })
      r.status === 403 ? pass("experiment PATCH rejects non-owner") : fail("experiment PATCH non-owner", r.status)

      r = await callApi(`/api/diaries/${diaryId}/experiments/${expId}`, { method: "PATCH", body: { status: "BOGUS" }, cookie: ownerCookie })
      r.status === 400 ? pass("experiment rejects invalid status") : fail("experiment bogus status", r.status)

      r = await callApi(`/api/diaries/${diaryId}/experiments/${expId}`, { method: "PATCH", body: { outcome: "SORTA" }, cookie: ownerCookie })
      r.status === 400 ? pass("experiment rejects non-vocabulary outcome") : fail("experiment bogus outcome", r.status)

      // Cross-diary link guard — an experiment id from another grow must
      // not be attachable to this diary's updates.
      const foreignExp = await prisma.growExperiment.create({
        data: { diaryId: sd1.id, authorId: voter.id, title: M("foreign"), change: "x", category: "OTHER" },
      })
      r = await callApi("/api/diaries/updates", {
        method: "POST",
        body: { diaryId, title: M("fx"), content: "cross-link attempt", experimentId: foreignExp.id },
        cookie: ownerCookie,
      })
      r.status === 400 ? pass("update rejects experiment from another diary") : fail("cross-diary experiment link", r.status)

      // Linked observation deterministically advances ACTIVE → OBSERVING
      r = await callApi("/api/diaries/updates", {
        method: "POST",
        body: { diaryId, title: M("obs"), content: "posture improved overnight", experimentId: expId },
        cookie: ownerCookie,
      })
      const expAfterObs = await prisma.growExperiment.findUnique({ where: { id: expId }, select: { status: true } })
      r.status === 201 && expAfterObs?.status === "OBSERVING"
        ? pass("linked observation advances ACTIVE → OBSERVING")
        : fail("observing transition", { s: r.status, st: expAfterObs?.status })

      // Grower-stated completion — outcome is explicit input, never derived
      r = await callApi(`/api/diaries/${diaryId}/experiments/${expId}`, {
        method: "PATCH",
        body: { status: "COMPLETED", outcome: "WORKED", conclusion: "posture recovered in two days" },
        cookie: ownerCookie,
      })
      const expDone = await prisma.growExperiment.findUnique({ where: { id: expId }, select: { status: true, outcome: true, endedAt: true } })
      r.status === 200 && expDone?.status === "COMPLETED" && expDone?.outcome === "WORKED" && expDone.endedAt
        ? pass("completion stamps endedAt + grower-stated outcome")
        : fail("experiment completion", { s: r.status, expDone })

      r = await callApi(`/api/diaries/${diaryId}/experiments/${expId}`, { method: "PATCH", body: { status: "ACTIVE" }, cookie: ownerCookie })
      const expReopen = await prisma.growExperiment.findUnique({ where: { id: expId }, select: { endedAt: true } })
      r.status === 200 && expReopen?.endedAt === null
        ? pass("reopen clears endedAt")
        : fail("experiment reopen", { s: r.status, endedAt: expReopen?.endedAt })

      // List: public diary exposes experiments to guests; owner sees all
      r = await callApi(`/api/diaries/${diaryId}/experiments`)
      r.status === 200 && (r.data?.experiments || []).some((e) => e.id === expId)
        ? pass("guest lists experiments on PUBLIC diary")
        : fail("guest experiment list", { s: r.status, d: r.data })

      // Timeline integration — the experiment card renders on the page
      // (status label reflects the reopen above; the card anchor proves
      // the node rendered)
      page = await getHtml(diaryHref, ownerCookie)
      page.status === 200 && page.html.includes(`Light bump ${TS}`) && page.html.includes(`experiment-${expId}`)
        ? pass("experiment renders in diary timeline")
        : fail("timeline experiment node", { s: page.status, has: page.html.includes(`Light bump ${TS}`) })

      // Owner intel endpoint exposes the experiment lines; non-owner 404s
      r = await callApi(`/api/diaries/${diaryId}/intel?action=experiments`, { cookie: ownerCookie })
      r.status === 200 && (r.data?.lines || []).some((l) => l.includes(`Light bump ${TS}`))
        ? pass("owner intel action=experiments returns canonical lines")
        : fail("intel experiments owner", { s: r.status, d: r.data })
      r = await callApi(`/api/diaries/${diaryId}/intel?action=experiments`, { cookie: viewerCookie })
      r.status === 404 ? pass("non-owner intel action=experiments 404s") : fail("intel experiments non-owner", r.status)

      // DELETE — non-owner forbidden; owner delete unlinks updates
      r = await callApi(`/api/diaries/${diaryId}/experiments/${expId}`, { method: "DELETE", cookie: viewerCookie })
      r.status === 403 ? pass("experiment DELETE rejects non-owner") : fail("experiment DELETE non-owner", r.status)
      const linkedUpd = await prisma.diaryUpdate.findFirst({ where: { experimentId: expId }, select: { id: true } })
      r = await callApi(`/api/diaries/${diaryId}/experiments/${expId}`, { method: "DELETE", cookie: ownerCookie })
      const unlinked = linkedUpd && await prisma.diaryUpdate.findUnique({ where: { id: linkedUpd.id }, select: { experimentId: true, title: true } })
      r.status === 200 && unlinked && unlinked.experimentId === null
        ? pass("delete unlinks updates, keeps their content")
        : fail("experiment delete unlink", { s: r.status, unlinked })
    }

    // Private diary — experiments follow diary visibility
    const prvExpD = await prisma.growDiary.create({
      data: { title: `${tok} expprivate`, description: "s", growType: "INDOOR", startDate: new Date(), authorId: owner.id, visibility: "PRIVATE" },
    })
    diaryIds.push(prvExpD.id)
    await prisma.growExperiment.create({
      data: { diaryId: prvExpD.id, authorId: owner.id, title: `Secret change ${TS}`, change: "x", category: "OTHER" },
    })
    r = await callApi(`/api/diaries/${prvExpD.id}/experiments`, { cookie: ownerCookie })
    r.status === 200 && (r.data?.experiments || []).length === 1
      ? pass("owner lists experiments on PRIVATE diary")
      : fail("owner private experiments", { s: r.status, d: r.data })
    for (const [who, ck] of [["viewer", viewerCookie], ["guest", undefined]]) {
      r = await callApi(`/api/diaries/${prvExpD.id}/experiments`, { cookie: ck })
      r.status === 404 ? pass(`PRIVATE diary experiments invisible to ${who}`) : fail(`private experiments ${who}`, r.status)
    }

    // Lessons — structured JSON on the diary, owner-authored
    r = await callApi(`/api/diaries/${diaryId}`, { method: "PATCH", body: { lessons: { learned: "less is more", bogus: "x" } }, cookie: ownerCookie })
    r.status === 400 ? pass("lessons reject unknown keys") : fail("lessons bogus key", r.status)
    r = await callApi(`/api/diaries/${diaryId}`, { method: "PATCH", body: { lessons: { learned: "less is more" } }, cookie: viewerCookie })
    r.status === 403 ? pass("lessons PATCH requires ownership") : fail("lessons non-owner", r.status)
    r = await callApi(`/api/diaries/${diaryId}`, { method: "PATCH", body: { lessons: { learned: "less is more", worked: "steady environment" } }, cookie: ownerCookie })
    const lessonsRow = await prisma.growDiary.findUnique({ where: { id: diaryId }, select: { lessons: true } })
    r.status === 200 && lessonsRow?.lessons?.learned === "less is more"
      ? pass("lessons persist as structured JSON")
      : fail("lessons persist", { s: r.status, lessons: lessonsRow?.lessons })

    // Strain evidence aggregation — public experiments only, thresholds
    // gate category counts; private experiments must not leak.
    const evStrain = await prisma.strain.create({ data: { name: M("evstrain"), createdById: owner.id } })
    strainIds.push(evStrain.id)
    const evMk = async (authorId, extra = {}) => {
      const d = await prisma.growDiary.create({
        data: { title: M("ev"), description: "s", strain: evStrain.name, strainId: evStrain.id, growType: "INDOOR", startDate: new Date(), authorId, ...extra },
      })
      diaryIds.push(d.id)
      return d
    }
    for (const authorId of [owner.id, voter.id, viewer.id]) {
      const d = await evMk(authorId)
      await prisma.growExperiment.create({
        data: { diaryId: d.id, authorId, title: M("evexp"), change: "x", category: "TRAINING", status: "COMPLETED", outcome: "WORKED" },
      })
    }
    // A private grow's experiment on the same strain — must not count.
    const prvEv = await evMk(owner.id, { visibility: "PRIVATE" })
    await prisma.growExperiment.create({
      data: { diaryId: prvEv.id, authorId: owner.id, title: M("evprv"), change: "x", category: "SETUP" },
    })
    page = await getHtml(`/strains/${evStrain.id}`)
    // JSX text expressions render with <!-- --> separators — strip them
    // before substring checks.
    const evHtml = page.html.replace(/<!--.*?-->/g, "")
    const evOk = evHtml.includes("Documented approaches") && evHtml.includes("3 experiments") && evHtml.includes("3 public grow")
    const noLeak = !evHtml.includes("Setup change") && !evHtml.includes("4 experiment")
    page.status === 200 && evOk && noLeak
      ? pass("strain evidence aggregates public experiments, excludes private")
      : fail("strain evidence", { s: page.status, evOk, noLeak })

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

  process.exit(finish())
}

main()
