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

// Concatenated bodies of every sitemap chunk, resolved through the real
// sitemap index (/sitemap-index.xml → /sitemap/<id>.xml). /sitemap.xml is
// the metadata convention's reserved path — the index lives on its own URL.
async function getSitemapBodies() {
  const idx = await getHtml("/sitemap-index.xml")
  if (idx.status !== 200) return { status: idx.status, html: "" }
  const locs = [...idx.html.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  const bodies = await Promise.all(
    locs.map(async (loc) => {
      // <loc> entries are absolute canonical URLs — rewrite to the test
      // base so the assertion exercises this server's chunks.
      const path = new URL(loc).pathname
      const res = await fetch(`${BASE}${path}`, { redirect: "manual" })
      return res.ok ? res.text() : ""
    })
  )
  return { status: 200, html: bodies.join("\n") }
}

const main = async () => {
  // Owner is backdated + XP-seeded so the self-vote test reaches the
  // self-vote check rather than being stopped at the voter trust gate.
  const seedXp = async (userId, amount) => {
    await prisma.profile.update({ where: { userId }, data: { xp: { increment: amount } } })
    await prisma.progressionEvent.create({
      data: { userId, type: "STAFF_ADJUSTMENT", xp: amount, reason: "test seed" },
    })
  }
  const owner = await createUser("owner", { createdAt: new Date(Date.now() - 30 * 86400000) })
  await seedXp(owner.id, 50)
  const viewer = await createUser("viewer")
  const banned = await createUser("banned")
  // Contest voter needs 7d age + 10 XP — backdate + grant XP.
  const voter = await createUser("voter", { createdAt: new Date(Date.now() - 9 * 86400000) })
  await seedXp(voter.id, 50)
  const users = [owner, viewer, banned, voter]
  const diaryIds = []
  const strainIds = []
  const setupIds = []
  const threadIds = []
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

    // ── Structured nutrient rows (Slice B) ──────────────────────────
    r = await callApi("/api/diaries/updates", {
      method: "POST",
      body: {
        diaryId, title: M("nutes"), content: "fed at half strength", stage: "FLOWER",
        nutrients: [
          { productName: M("Grow"), doseMlPerL: 2.5 },
          { productName: M("Bloom") },
        ],
      },
      cookie: ownerCookie,
    })
    const nutUpd = r.data?.update
    const nutRows = r.status === 201
      ? await prisma.diaryUpdateNutrient.findMany({ where: { updateId: nutUpd.id } })
      : []
    r.status === 201 && nutRows.length === 2 &&
    nutRows.some((n) => n.productName === M("Bloom") && n.doseMlPerL === null) &&
    nutUpd?.nutrients?.length === 2
      ? pass("nutrients persist on create (dose optional)")
      : fail("nutrient create", { s: r.status, rows: nutRows })

    // PATCH replaces the whole collection when supplied.
    r = await callApi("/api/diaries/updates", {
      method: "PATCH",
      body: { id: nutUpd.id, nutrients: [{ productName: M("Micro"), doseMlPerL: 1 }] },
      cookie: ownerCookie,
    })
    const afterReplace = r.status === 200
      ? await prisma.diaryUpdateNutrient.findMany({ where: { updateId: nutUpd.id } })
      : []
    afterReplace.length === 1 && afterReplace[0].productName === M("Micro") && afterReplace[0].doseMlPerL === 1
      ? pass("PATCH replaces nutrient collection")
      : fail("nutrient replace", { s: r.status, rows: afterReplace })

    // Data export carries the structured rows on the owner's own export.
    r = await callApi("/api/profile/export", { cookie: ownerCookie })
    const exported = r.status === 200 && JSON.stringify(r.data).includes(`"productName":"${M("Micro")}"`)
    exported
      ? pass("profile export includes nutrient rows")
      : fail("nutrient export", r.status)

    // An edit that omits the key must not touch the rows.
    r = await callApi("/api/diaries/updates", { method: "PATCH", body: { id: nutUpd.id, title: M("nutes2") }, cookie: ownerCookie })
    const afterOmit = await prisma.diaryUpdateNutrient.count({ where: { updateId: nutUpd.id } })
    r.status === 200 && afterOmit === 1
      ? pass("PATCH without nutrients preserves rows")
      : fail("nutrient preserve", { s: r.status, count: afterOmit })

    // [] clears the collection explicitly.
    r = await callApi("/api/diaries/updates", { method: "PATCH", body: { id: nutUpd.id, nutrients: [] }, cookie: ownerCookie })
    const afterClear = await prisma.diaryUpdateNutrient.count({ where: { updateId: nutUpd.id } })
    r.status === 200 && afterClear === 0
      ? pass("PATCH [] clears nutrients")
      : fail("nutrient clear", { s: r.status, count: afterClear })

    // PATCH null is the one rejection that must hit the edit route — the
    // collection has no scalar-style null semantics there.
    r = await callApi("/api/diaries/updates", { method: "PATCH", body: { id: nutUpd.id, nutrients: null }, cookie: ownerCookie })
    r.status === 400 ? pass("PATCH nutrients null → 400") : fail("nutrients null", r.status)

    // Remaining rejection contract — exercised through POST (same shared
    // parseNutrientRows) to stay under the edit route's per-minute cap.
    for (const [payload, name] of [
      ["x", "nutrients non-array → 400"],
      [[{ productName: M("Dup") }, { productName: ` ${M("Dup").toLowerCase()}  ` }], "normalized duplicate → 400"],
      [Array.from({ length: 21 }, (_, i) => ({ productName: `F${i}` })), "21 nutrient rows → 400"],
      [[{ productName: "F", doseMlPerL: 101 }], "dose >100 → 400"],
      [[{ productName: "F", doseMlPerL: -1 }], "dose <0 → 400"],
      [[{ productName: "F", doseMlPerL: "2" }], "string dose → 400"],
      [[{ doseMlPerL: 2 }], "missing productName → 400"],
      [[{ productName: "F", brand: "x" }], "unknown row key → 400"],
    ]) {
      r = await callApi("/api/diaries/updates", {
        method: "POST",
        body: { diaryId, title: "x", content: "x", nutrients: payload },
        cookie: ownerCookie,
      })
      r.status === 400 ? pass(name) : fail(name, r.status)
    }

    // Ownership check is authoritative before any nutrient write.
    r = await callApi("/api/diaries/updates", {
      method: "PATCH",
      body: { id: nutUpd.id, nutrients: [{ productName: "Hijack" }] },
      cookie: viewerCookie,
    })
    r.status === 403 ? pass("non-owner nutrient PATCH forbidden") : fail("nutrient ownership", r.status)

    // Hard delete removes child rows via the FK cascade.
    r = await callApi("/api/diaries/updates", { method: "DELETE", body: { id: nutUpd.id }, cookie: ownerCookie })
    const afterDelete = await prisma.diaryUpdateNutrient.count({ where: { updateId: nutUpd.id } })
    r.status === 200 && afterDelete === 0
      ? pass("update DELETE cascades nutrient rows")
      : fail("nutrient cascade", { s: r.status, count: afterDelete })

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
    // Interaction affordance at the harvest — digest/feed/notification
    // harvest arrivals land on this card; the canonical discussion CTA
    // belongs where the member is looking.
    page.html.includes("Discuss this harvest")
      ? pass("harvest report exposes the discussion CTA")
      : fail("harvest discuss CTA", "missing")

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
    const mkVis = (visibility, authorId = owner.id) => prisma.growDiary.create({
      data: {
        title: `${tok} ${visibility}`, description: "visibility fixture",
        growType: "INDOOR", startDate: new Date(), authorId, visibility,
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

    // LiveRefresh tickle — the per-diary activity endpoint must apply the
    // exact same visibility matrix as the page (PRIVATE 404s for all but
    // the owner) so pollers can't probe existence.
    for (const [vis, d] of [["PUBLIC", pubD], ["UNLISTED", unlD], ["PRIVATE", prvD]]) {
      for (const [who, ck] of actors) {
        const a = await callApi(`/api/diaries/${d.id}/activity`, { cookie: ck })
        const body = a.data || {}
        const okStatus = a.status === expect[vis][who]
        const okShape = a.status !== 200 || typeof body.fingerprint === "string"
        okStatus && okShape
          ? pass(`live ${vis} diary activity → ${who} ${expect[vis][who]}`)
          : fail(`live ${vis} diary activity ${who}`, { status: a.status, body })
      }
    }
    // ── Media proxy authorization ──────────────────────────────────────
    // Restricted-class images serialize as /api/media/[kind]/[id]; the
    // route re-evaluates the same predicates per request. data: URIs stand
    // in for blobs locally (storeImage's dev fallback), exercising the
    // full resolve→authorize→stream path.
    const mkMedia = async (dId, authorId = owner.id) => {
      const u = await prisma.diaryUpdate.create({
        data: { diaryId: dId, authorId, title: M("mi"), content: "media fixture", stage: "VEGETATIVE", dayNumber: 1, weekNumber: 1 },
      })
      return prisma.diaryImage.create({ data: { updateId: u.id, url: TINY_PNG } })
    }
    const pubImg = await mkMedia(pubD.id)
    const prvImg = await mkMedia(prvD.id)
    const getMedia = async (kind, id, ck) => {
      const res = await fetch(`${BASE}/api/media/${kind}/${id}`, { headers: ck ? { cookie: ck } : {} })
      const buf = await res.arrayBuffer().catch(() => null)
      return {
        status: res.status,
        cache: res.headers.get("cache-control") || "",
        vary: res.headers.get("vary") || "",
        type: res.headers.get("content-type") || "",
        bodyLen: buf?.byteLength ?? -1,
      }
    }
    // Blocked viewers keep page-equivalent access: block hides discovery,
    // not content the page itself renders (same verdict the diary page
    // matrix asserts above).
    const mediaExpect = {
      pub: { owner: 200, other: 200, blocked: 200, guest: 200 },
      prv: { owner: 200, other: 404, blocked: 404, guest: 404 },
    }
    for (const [label, img] of [["pub", pubImg], ["prv", prvImg]]) {
      for (const [who, ck] of actors) {
        const m = await getMedia("diary", img.id, ck)
        m.status === mediaExpect[label][who]
          ? pass(`media ${label} → ${who} ${mediaExpect[label][who]}`)
          : fail(`media ${label} ${who}`, m.status)
        if (m.status === 200 && (!/private/.test(m.cache) || !/no-store/.test(m.cache) || !/cookie/i.test(m.vary) || !/^image\//.test(m.type))) {
          fail(`media ${label} ${who} headers`, { cache: m.cache, vary: m.vary, type: m.type })
        }
        // Denials are uniform: same status AND same empty body, so the
        // endpoint can't distinguish "exists but private" from "missing".
        if (m.status === 404 && m.bodyLen !== 0) {
          fail(`media ${label} ${who} denial leaks a body`, m.bodyLen)
        }
      }
    }

    // PUBLIC→PRIVATE flip must revoke guest media access immediately —
    // the proxy evaluates the row's current visibility, not a cached URL.
    r = await callApi(`/api/diaries/${pubD.id}`, { method: "PATCH", body: { visibility: "PRIVATE" }, cookie: ownerCookie })
    const flippedGuest = await getMedia("diary", pubImg.id, undefined)
    r.status === 200 && flippedGuest.status === 404
      ? pass("PUBLIC→PRIVATE flip revokes guest media access")
      : fail("media flip revoke", { patch: r.status, media: flippedGuest.status })
    const flippedOwner = await getMedia("diary", pubImg.id, ownerCookie)
    flippedOwner.status === 200
      ? pass("owner keeps media after PRIVATE flip")
      : fail("media flip owner", flippedOwner.status)
    r = await callApi(`/api/diaries/${pubD.id}`, { method: "PATCH", body: { visibility: "PUBLIC" }, cookie: ownerCookie })
    const restored = await getMedia("diary", pubImg.id, undefined)
    restored.status === 200 ? pass("PRIVATE→PUBLIC flip restores media") : fail("media flip restore", restored.status)

    // Repeated transitions stay consistent — a second cycle re-evaluates.
    // Runs under `voter` so these PATCHes don't consume owner's edit quota.
    const repD = await mkVis("PUBLIC", voter.id)
    diaryIds.push(repD.id)
    const repImg = await mkMedia(repD.id, voter.id)
    r = await callApi(`/api/diaries/${repD.id}`, { method: "PATCH", body: { visibility: "PRIVATE" }, cookie: voterCookie })
    const againGuest = await getMedia("diary", repImg.id, undefined)
    r.status === 200 && againGuest.status === 404
      ? pass("repeat PUBLIC→PRIVATE flip re-revokes media")
      : fail("media flip repeat", { patch: r.status, media: againGuest.status })
    r = await callApi(`/api/diaries/${repD.id}`, { method: "PATCH", body: { visibility: "PUBLIC" }, cookie: voterCookie })
    const againRestored = await getMedia("diary", repImg.id, undefined)
    r.status === 200 && againRestored.status === 200
      ? pass("repeat PRIVATE→PUBLIC flip re-restores media")
      : fail("media flip repeat restore", { patch: r.status, media: againRestored.status })

    // ── Privatization failure must abort the flip ────────────────────
    // A row on a real Vercel public host that cannot be privatized (no
    // BLOB_READ_WRITE_TOKEN here → null; with a token the nonexistent
    // source throws) means storage privacy cannot be established — the
    // transition must fail instead of reporting success on public blobs.
    const failD = await mkVis("PUBLIC", voter.id)
    diaryIds.push(failD.id)
    const failUpd = await prisma.diaryUpdate.create({
      data: { diaryId: failD.id, authorId: voter.id, title: M("fm"), content: "failure fixture", stage: "VEGETATIVE", dayNumber: 1, weekNumber: 1 },
    })
    const legacyImg = await prisma.diaryImage.create({
      data: { updateId: failUpd.id, url: "https://nonexistent0.public.blob.vercel-storage.com/diary-updates/legacy.webp" },
    })
    const failOkImg = await mkMedia(failD.id, voter.id)
    // Missing blob object → uniform 404 even for the owner.
    const missingBlob = await getMedia("diary", legacyImg.id, voterCookie)
    missingBlob.status === 404 && missingBlob.bodyLen === 0
      ? pass("media: unresolvable blob object → uniform 404")
      : fail("media missing blob", missingBlob.status)
    r = await callApi(`/api/diaries/${failD.id}`, { method: "PATCH", body: { visibility: "PRIVATE" }, cookie: voterCookie })
    r.status === 503
      ? pass("flip to PRIVATE aborts when media cannot be privatized")
      : fail("media flip failure abort", r.status)
    const failStillPub = await getMedia("diary", failOkImg.id, undefined)
    const failRow = await prisma.growDiary.findUnique({ where: { id: failD.id }, select: { visibility: true } })
    failStillPub.status === 200 && failRow?.visibility === "PUBLIC"
      ? pass("aborted flip leaves diary PUBLIC and media reachable")
      : fail("aborted flip state", { media: failStillPub.status, vis: failRow?.visibility })
    // Repair the object (fixture repoint), retry — transition completes.
    await prisma.diaryImage.update({ where: { id: legacyImg.id }, data: { url: TINY_PNG } })
    r = await callApi(`/api/diaries/${failD.id}`, { method: "PATCH", body: { visibility: "PRIVATE" }, cookie: voterCookie })
    const retryGuest = await getMedia("diary", failOkImg.id, undefined)
    const retryOwner = await getMedia("diary", failOkImg.id, voterCookie)
    r.status === 200 && retryGuest.status === 404 && retryOwner.status === 200
      ? pass("flip retry after repair succeeds and revokes guests")
      : fail("media flip retry", { patch: r.status, guest: retryGuest.status, owner: retryOwner.status })

    // ── Stale public twin must block the flip ──────────────────────
    // A row already repointed to a private URL can still have its old
    // public object live (a repoint whose source delete failed). The flip
    // must abort until that twin is confirmed deleted — success would mean
    // a "private" diary whose old URLs keep serving.
    const twinD = await mkVis("PUBLIC", voter.id)
    diaryIds.push(twinD.id)
    const twinUpd = await prisma.diaryUpdate.create({
      data: { diaryId: twinD.id, authorId: voter.id, title: M("tw"), content: "twin fixture", stage: "VEGETATIVE", dayNumber: 1, weekNumber: 1 },
    })
    const twinImg = await prisma.diaryImage.create({
      data: { updateId: twinUpd.id, url: "https://nonexistent0.private.blob.vercel-storage.com/diary-updates/twin.webp" },
    })
    r = await callApi(`/api/diaries/${twinD.id}`, { method: "PATCH", body: { visibility: "PRIVATE" }, cookie: voterCookie })
    const twinRow = await prisma.growDiary.findUnique({ where: { id: twinD.id }, select: { visibility: true } })
    // No BLOB_READ_WRITE_TOKEN locally → the twin cannot be confirmed
    // deleted → fail closed, diary stays PUBLIC.
    r.status === 503 && twinRow?.visibility === "PUBLIC"
      ? pass("unrevoked public twin aborts PRIVATE flip")
      : fail("twin revocation abort", { patch: r.status, vis: twinRow?.visibility })
    // Repair the object (no public copy left to revoke) — retry completes.
    await prisma.diaryImage.update({ where: { id: twinImg.id }, data: { url: TINY_PNG } })
    r = await callApi(`/api/diaries/${twinD.id}`, { method: "PATCH", body: { visibility: "PRIVATE" }, cookie: voterCookie })
    r.status === 200 ? pass("twin repaired → retry completes flip") : fail("twin retry", r.status)

    // ── Mixed-direction concurrent transitions ──────────────────────
    // The transition is last-writer-wins on the guarded update; the
    // contract is that whatever visibility the row lands on must be
    // consistent with what the media proxy then serves.
    const racer = await createUser("racer")
    users.push(racer)
    const { cookie: racerCookie } = await login(racer.username, racer.password)
    // Distinct title token — the visibility-matrix assertions below search
    // by the shared `tok` and must not see these fixtures.
    const mkRace = (visibility) => prisma.growDiary.create({
      data: {
        title: M(`race ${visibility}`), description: "race fixture",
        growType: "INDOOR", startDate: new Date(), authorId: racer.id, visibility,
      },
    })
    const flip = (id, vis) => callApi(`/api/diaries/${id}`, { method: "PATCH", body: { visibility: vis }, cookie: racerCookie })
    const consistent = async (d, img, label) => {
      const row = await prisma.growDiary.findUnique({ where: { id: d.id }, select: { visibility: true, deleted: true } })
      if (!row || row.deleted) {
        const g = await getMedia("diary", img.id, undefined)
        const o = await getMedia("diary", img.id, racerCookie)
        return g.status === 404 && o.status === 404
          ? { ok: true, state: "deleted" }
          : { ok: false, state: `deleted row but media ${g.status}/${o.status}` }
      }
      const g = await getMedia("diary", img.id, undefined)
      const o = await getMedia("diary", img.id, racerCookie)
      const expected = row.visibility === "PRIVATE" ? 404 : 200
      return g.status === expected && o.status === 200
        ? { ok: true, state: row.visibility }
        : { ok: false, state: `${row.visibility} but media ${g.status}/${o.status}` }
    }

    // Test A: two concurrent PUBLIC→PRIVATE — idempotent, converges PRIVATE.
    const raceA = await mkRace("PUBLIC")
    diaryIds.push(raceA.id)
    const raceAImg = await mkMedia(raceA.id, racer.id)
    const [a1, a2] = await Promise.all([flip(raceA.id, "PRIVATE"), flip(raceA.id, "PRIVATE")])
    const aState = await consistent(raceA, raceAImg, "A")
    aState.ok && aState.state === "PRIVATE" && a1.status === 200 && a2.status === 200
      ? pass("race: 2× PUBLIC→PRIVATE converges private, media consistent")
      : fail("race A", { patch: [a1.status, a2.status], ...aState })

    // Test B: two concurrent PRIVATE→PUBLIC — converges PUBLIC.
    const raceB = await mkRace("PRIVATE")
    diaryIds.push(raceB.id)
    const raceBImg = await mkMedia(raceB.id, racer.id)
    const [b1, b2] = await Promise.all([flip(raceB.id, "PUBLIC"), flip(raceB.id, "PUBLIC")])
    const bState = await consistent(raceB, raceBImg, "B")
    bState.ok && bState.state === "PUBLIC" && b1.status === 200 && b2.status === 200
      ? pass("race: 2× PRIVATE→PUBLIC converges public, media consistent")
      : fail("race B", { patch: [b1.status, b2.status], ...bState })

    // Test C: PUBLIC→PRIVATE against PRIVATE→PUBLIC — either side may
    // win; both outcomes are valid, an inconsistent media state is not.
    const raceC = await mkRace("PUBLIC")
    diaryIds.push(raceC.id)
    const raceCImg = await mkMedia(raceC.id, racer.id)
    const [c1, c2] = await Promise.all([flip(raceC.id, "PRIVATE"), flip(raceC.id, "PUBLIC")])
    const cState = await consistent(raceC, raceCImg, "C")
    cState.ok && (c1.status === 200 || c2.status === 200)
      ? pass(`race: mixed-direction flips land consistent (${cState.state})`)
      : fail("race C", { patch: [c1.status, c2.status], ...cState })

    // Test D1: flip concurrent with an image upload on the same diary.
    // The update PATCH and the visibility PATCH are independent writes;
    // the final visibility must govern the final set of image rows.
    const raceD1 = await mkRace("PUBLIC")
    diaryIds.push(raceD1.id)
    const d1Upd = await prisma.diaryUpdate.create({
      data: { diaryId: raceD1.id, authorId: racer.id, title: M("d1"), content: "race fixture", stage: "VEGETATIVE", dayNumber: 1, weekNumber: 1 },
    })
    const [d1f, d1u] = await Promise.all([
      flip(raceD1.id, "PRIVATE"),
      callApi(`/api/diaries/updates`, {
        method: "PATCH",
        body: { id: d1Upd.id, images: [TINY_PNG] },
        cookie: racerCookie,
      }),
    ])
    const d1Row = await prisma.growDiary.findUnique({ where: { id: raceD1.id }, select: { visibility: true } })
    const d1Imgs = await prisma.diaryImage.findMany({ where: { update: { diaryId: raceD1.id } }, select: { id: true } })
    let d1Ok = d1Row?.visibility === "PRIVATE" && d1f.status === 200
    for (const im of d1Imgs) {
      const g = await getMedia("diary", im.id, undefined)
      const o = await getMedia("diary", im.id, racerCookie)
      if (g.status !== 404 || o.status !== 200) d1Ok = false
    }
    d1Ok && d1u.status === 200
      ? pass("race: flip + concurrent upload — all rows private-consistent")
      : fail("race D1", { flip: d1f.status, upd: d1u.status, vis: d1Row?.visibility, imgs: d1Imgs.length })

    // Test D2: flip concurrent with image removal (keepImageIds=[]).
    const raceD2 = await mkRace("PUBLIC")
    diaryIds.push(raceD2.id)
    const d2Img = await mkMedia(raceD2.id, racer.id)
    const d2UpdId = (await prisma.diaryImage.findUnique({ where: { id: d2Img.id }, select: { updateId: true } })).updateId
    const [d2f, d2u] = await Promise.all([
      flip(raceD2.id, "PRIVATE"),
      callApi(`/api/diaries/updates`, {
        method: "PATCH",
        body: { id: d2UpdId, keepImageIds: [] },
        cookie: racerCookie,
      }),
    ])
    const d2Gone = await getMedia("diary", d2Img.id, racerCookie)
    const d2Row = await prisma.growDiary.findUnique({ where: { id: raceD2.id }, select: { visibility: true } })
    // Removed row must not resolve regardless of the flip's outcome.
    d2Gone.status === 404 && (d2Row?.visibility === "PRIVATE" || d2u.status === 200)
      ? pass("race: flip + concurrent image removal — removed media unreachable")
      : fail("race D2", { flip: d2f.status, upd: d2u.status, media: d2Gone.status })

    // Test D3: flip concurrent with diary deletion — whichever lands,
    // a deleted diary's media must never resolve.
    const raceD3 = await mkRace("PUBLIC")
    diaryIds.push(raceD3.id)
    const raceD3Img = await mkMedia(raceD3.id, racer.id)
    const [d3f, d3d] = await Promise.all([
      flip(raceD3.id, "PRIVATE"),
      callApi(`/api/diaries`, { method: "DELETE", body: { id: raceD3.id }, cookie: racerCookie }),
    ])
    const d3GoneG = await getMedia("diary", raceD3Img.id, undefined)
    const d3GoneO = await getMedia("diary", raceD3Img.id, racerCookie)
    const d3Row = await prisma.growDiary.findUnique({ where: { id: raceD3.id }, select: { deleted: true, visibility: true } })
    d3Row?.deleted && d3GoneG.status === 404 && d3GoneO.status === 404
      ? pass("race: flip + concurrent delete — deleted diary media unreachable")
      : fail("race D3", { flip: d3f.status, del: d3d.status, media: [d3GoneG.status, d3GoneO.status], row: d3Row })

    // Deleted objects and malformed/unknown ids are uniform 404s.
    const delD = await mkVis("PUBLIC")
    diaryIds.push(delD.id)
    const delImg = await mkMedia(delD.id)
    r = await callApi(`/api/diaries`, { method: "DELETE", body: { id: delD.id }, cookie: ownerCookie })
    const goneImg = await getMedia("diary", delImg.id, undefined)
    r.status === 200 && goneImg.status === 404
      ? pass("deleted diary media is unreachable")
      : fail("media deleted", { del: r.status, media: goneImg.status })
    const bogus = await getMedia("diary", "cnotarealid000000000", voterCookie)
    bogus.status === 404 ? pass("unknown media id → 404 (no oracle)") : fail("media oracle", bogus.status)
    const badKind = await getMedia("avatar", pubImg.id, voterCookie)
    badKind.status === 404 ? pass("non-restricted media kind rejected") : fail("media kind", badKind.status)

    // Index-level fingerprint for the diaries-list poller.
    r = await callApi(`/api/diaries/updates`)
    const idxBody = r.data || {}
    r.status === 200 && typeof idxBody.fingerprint === "string"
      ? pass("live: diaries index fingerprint")
      : fail("live diaries index", { status: r.status, body: idxBody })

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

    // ── Canonical discussion authorship (F-1 regression) ────────────
    // The lazy-created discussion thread belongs to the diary's grower —
    // the member who invokes discuss must not silently own it.
    const discD = await prisma.growDiary.create({
      data: { title: `${tok} discuss`, description: "s", growType: "INDOOR", startDate: new Date(), authorId: owner.id, visibility: "PUBLIC" },
    })
    diaryIds.push(discD.id)

    r = await callApi(`/api/diaries/${discD.id}/discuss`, { method: "POST" })
    r.status === 401 ? pass("discuss requires auth") : fail("discuss anon", r.status)

    // Unrelated member may trigger lazy creation — but the owner authors it.
    r = await callApi(`/api/diaries/${discD.id}/discuss`, { method: "POST", cookie: voterCookie })
    const discThread = r.data?.threadId && await prisma.thread.findUnique({
      where: { id: r.data.threadId },
      select: { id: true, slug: true, authorId: true, posts: { select: { authorId: true, deleted: true } } },
    })
    if (discThread) threadIds.push(discThread.id)
    r.status === 201 && discThread?.authorId === owner.id
      ? pass("canonical discussion authored by diary owner, not invoker")
      : fail("discuss authorship", { s: r.status, author: discThread?.authorId, owner: owner.id })
    discThread?.posts?.[0]?.authorId === owner.id
      ? pass("discussion opening post authored by diary owner")
      : fail("opening post author", discThread?.posts?.[0]?.authorId)
    const discRow = await prisma.growDiary.findUnique({ where: { id: discD.id }, select: { threadId: true } })
    discRow?.threadId === discThread?.id
      ? pass("diary links the canonical discussion thread")
      : fail("diary discussion link", discRow?.threadId)

    // Owner clicking later reopens the same thread — never a second one.
    r = await callApi(`/api/diaries/${discD.id}/discuss`, { method: "POST", cookie: ownerCookie })
    r.status === 200 && r.data?.threadId === discThread?.id
      ? pass("owner discuss reopens the canonical thread")
      : fail("discuss reopen", { s: r.status, d: r.data })

    r = await callApi(`/api/diaries/${prvD.id}/discuss`, { method: "POST", cookie: voterCookie })
    r.status === 404 ? pass("discuss on PRIVATE diary 404s without leaking") : fail("discuss private", r.status)

    // Concurrent invocations — exactly one canonical thread, owner-authored.
    const raceD = await prisma.growDiary.create({
      data: { title: `${tok} race`, description: "s", growType: "INDOOR", startDate: new Date(), authorId: owner.id, visibility: "PUBLIC" },
    })
    diaryIds.push(raceD.id)
    const [ra, rb] = await Promise.all([
      callApi(`/api/diaries/${raceD.id}/discuss`, { method: "POST", cookie: ownerCookie }),
      callApi(`/api/diaries/${raceD.id}/discuss`, { method: "POST", cookie: voterCookie }),
    ])
    const raceRow = await prisma.growDiary.findUnique({ where: { id: raceD.id }, select: { threadId: true } })
    const raceThreads = await prisma.thread.findMany({
      where: { id: { in: [ra.data?.threadId, rb.data?.threadId].filter(Boolean) } },
      select: { id: true, authorId: true, deleted: true },
    })
    raceThreads.forEach((t) => threadIds.push(t.id))
    const liveThreads = raceThreads.filter((t) => !t.deleted)
    ra.data?.threadId === rb.data?.threadId && raceRow?.threadId === ra.data?.threadId &&
      liveThreads.length === 1 && liveThreads[0].authorId === owner.id
      ? pass("concurrent discuss yields one canonical owner-authored thread")
      : fail("discuss race", { ra: ra.status, rb: rb.status, tid: raceRow?.threadId, threads: raceThreads })

    // ── Update-anchored discussion affordance ────────────────────────
    // Each update on a PUBLIC diary exposes the canonical diary
    // discussion — same lazy-create/link flow as the header button,
    // never a separate per-update thread. Non-public diaries render no
    // affordance, matching the discuss route's publicDiaryWhere gate.
    const discUpd = await prisma.diaryUpdate.create({
      data: { diaryId: discD.id, authorId: owner.id, title: M("du"), content: "discuss me", stage: "VEGETATIVE", dayNumber: 1, weekNumber: 1 },
    })
    const updPage = await getHtml(`/diaries/${discD.id}`, voterCookie)
    updPage.status === 200 && updPage.html.includes("Discuss the grow")
      ? pass("PUBLIC diary update exposes the discussion affordance")
      : fail("update discuss affordance", updPage.status)
    // The update-level action itself routes to the canonical thread —
    // resolve the href of the anchor whose content carries the label so
    // a coincidental link elsewhere on the page can't satisfy the check.
    const updHref = updPage.html.match(/href="([^"]*)"[^>]*>(?:(?!<\/a>)[\s\S])*?Discuss the grow/)?.[1]
    updHref === `/forum/thread/${discThread.slug}`
      ? pass("update affordance links the canonical discussion thread")
      : fail("update affordance thread link", updHref)
    !pages.PRIVATE_owner.includes("Discuss the grow")
      ? pass("PRIVATE diary update has no discussion affordance")
      : fail("private update affordance")
    !pages.UNLISTED.includes("Discuss the grow") && !pages.UNLISTED.includes("Discuss this grow")
      ? pass("UNLISTED diary exposes no discussion affordance")
      : fail("unlisted discuss affordance")
    !updPage.html.includes("Discuss in chat") && !pages.PUBLIC.includes("Discuss in chat")
      ? pass("contextless chat-discussion link removed from diary page")
      : fail("contextless chat link")

    // ── Social Grow Updates (Phase 1) ────────────────────────────────
    // A DiaryUpdate is a reaction target (Reaction.diaryUpdateId) and a
    // comment anchor (Post.diaryUpdateId inside the grow's canonical
    // discussion thread). Actors: owner (grower), voter (unrelated member),
    // viewer (blocked by owner since the block section above), guest.
    // Invariant: an interaction is never broader than its content.
    {
      const updReact = (body, cookie) => callApi("/api/reactions", { method: "POST", body, cookie })
      const updComment = (body, cookie) => callApi("/api/forum/posts", { method: "POST", body, cookie })
      const ownerUsername = (await prisma.profile.findUnique({ where: { userId: owner.id }, select: { username: true } }))?.username

      // Reactions — valid, toggle/switch, single row, exact-one-target.
      r = await updReact({ type: "LIKE", diaryUpdateId: discUpd.id }, voterCookie)
      const reactRow = await prisma.reaction.findFirst({ where: { userId: voter.id, diaryUpdateId: discUpd.id } })
      r.status === 201 && r.data?.action === "added" && reactRow && reactRow.postId === null && reactRow.diaryId === null
        ? pass("member reacts to a PUBLIC grow update (single update-target row)")
        : fail("update reaction add", { s: r.status, d: r.data, row: reactRow })
      r = await updReact({ type: "LIKE", diaryUpdateId: discUpd.id }, voterCookie)
      r.data?.action === "removed" ? pass("same-type update reaction toggles off") : fail("update reaction toggle", r.data)
      await updReact({ type: "LIKE", diaryUpdateId: discUpd.id }, voterCookie)
      r = await updReact({ type: "FIRE", diaryUpdateId: discUpd.id }, voterCookie)
      const reactRows = await prisma.reaction.count({ where: { userId: voter.id, diaryUpdateId: discUpd.id } })
      r.data?.action === "switched" && reactRows === 1
        ? pass("different type switches — duplicate prevention holds one row")
        : fail("update reaction switch/dupe", { a: r.data?.action, reactRows })
      r = await updReact({ type: "LIKE", diaryUpdateId: discUpd.id, diaryId: discD.id }, voterCookie)
      r.status === 400 ? pass("multi-target reaction body rejected") : fail("multi-target reaction", r.status)
      r = await updReact({ type: "BOGUS", diaryUpdateId: discUpd.id }, voterCookie)
      r.status === 400 ? pass("unknown reaction type rejected for updates") : fail("update reaction type", r.status)
      r = await updReact({ type: "LIKE", diaryUpdateId: discUpd.id })
      r.status === 401 ? pass("guest cannot react to an update") : fail("update reaction anon", r.status)
      r = await updReact({ type: "LIKE", diaryUpdateId: discUpd.id }, viewerCookie)
      r.status === 403 ? pass("blocked member cannot react to the grower's update") : fail("update reaction block", r.status)

      // Reaction notification — existing REACTION type, grouped per update,
      // deep-linked to the update anchor, deduped across toggles.
      const reactNotes = await prisma.notification.findMany({
        where: { userId: owner.id, type: "REACTION", groupKey: `REACTION:update:${discUpd.id}` },
        select: { link: true },
      })
      reactNotes.length === 1 && reactNotes[0].link?.endsWith(`#update-${discUpd.id}`)
        ? pass("update reaction notifies grower once (grouped, update deep link)")
        : fail("update reaction notification", reactNotes)

      // Visibility matrix for update reactions — same canViewDiary rule.
      const prvUpd = await prisma.diaryUpdate.findFirst({ where: { diaryId: prvD.id }, select: { id: true } })
      r = await updReact({ type: "LIKE", diaryUpdateId: prvUpd.id }, voterCookie)
      r.status === 404 ? pass("non-owner cannot react to a PRIVATE grow update (404, no oracle)") : fail("private update reaction", r.status)
      r = await updReact({ type: "LIKE", diaryUpdateId: prvUpd.id }, ownerCookie)
      r.status === 201 ? pass("owner can react to own PRIVATE update") : fail("owner private update reaction", r.status)
      const unlUpd = await prisma.diaryUpdate.create({
        data: { diaryId: unlD.id, authorId: owner.id, title: M("uu"), content: "unlisted update", stage: "VEGETATIVE", dayNumber: 1, weekNumber: 1 },
      })
      r = await updReact({ type: "LIKE", diaryUpdateId: unlUpd.id }, voterCookie)
      r.status === 201
        ? pass("UNLISTED update reaction follows the grow's link-holder rule (same as diary reactions)")
        : fail("unlisted update reaction", r.status)
      r = await updReact({ type: "LIKE", diaryUpdateId: M("nope") }, voterCookie)
      r.status === 404 ? pass("unknown update id 404s") : fail("missing update reaction", r.status)

      // Deleted grow / suspended grower → 404.
      const delD = await prisma.growDiary.create({
        data: { title: `${tok} del`, description: "s", growType: "INDOOR", startDate: new Date(), authorId: owner.id, visibility: "PUBLIC", deleted: true },
      })
      diaryIds.push(delD.id)
      const delUpd = await prisma.diaryUpdate.create({
        data: { diaryId: delD.id, authorId: owner.id, title: M("dlu"), content: "deleted grow update", stage: "VEGETATIVE", dayNumber: 1, weekNumber: 1 },
      })
      r = await updReact({ type: "LIKE", diaryUpdateId: delUpd.id }, voterCookie)
      r.status === 404 ? pass("deleted grow's update cannot be reacted to") : fail("deleted grow update reaction", r.status)
      const susp = await createUser("susp")
      users.push(susp)
      await prisma.user.update({ where: { id: susp.id }, data: { suspendedUntil: new Date(Date.now() + 86400000) } })
      const suspD = await prisma.growDiary.create({
        data: { title: `${tok} susp`, description: "s", growType: "INDOOR", startDate: new Date(), authorId: susp.id, visibility: "PUBLIC" },
      })
      diaryIds.push(suspD.id)
      const suspUpd = await prisma.diaryUpdate.create({
        data: { diaryId: suspD.id, authorId: susp.id, title: M("su"), content: "suspended grower update", stage: "VEGETATIVE", dayNumber: 1, weekNumber: 1 },
      })
      r = await updReact({ type: "LIKE", diaryUpdateId: suspUpd.id }, voterCookie)
      r.status === 404 ? pass("suspended grower's update cannot be reacted to") : fail("suspended update reaction", r.status)

      // Regression — existing Post and whole-diary targets unchanged.
      const opPost = await prisma.post.findFirst({ where: { threadId: discThread.id }, orderBy: { createdAt: "asc" }, select: { id: true } })
      r = await updReact({ type: "LIKE", postId: opPost.id }, voterCookie)
      const r2 = await updReact({ type: "LIKE", diaryId: discD.id }, voterCookie)
      r.status === 201 && r2.status === 201
        ? pass("existing Post + GrowDiary reaction targets still work")
        : fail("reaction target regression", { post: r.status, diary: r2.status })

      // Comments — a normal Post in the canonical discussion, anchored.
      const cTok = M("cmt")
      r = await updComment({ threadId: discThread.id, diaryUpdateId: discUpd.id, content: `${cTok} looks healthy, nice canopy` }, voterCookie)
      const cRow = r.data?.post?.id && await prisma.post.findUnique({ where: { id: r.data.post.id }, select: { threadId: true, diaryUpdateId: true } })
      r.status === 201 && cRow?.threadId === discThread.id && cRow?.diaryUpdateId === discUpd.id
        ? pass("update comment is a Post in the grow's discussion thread, anchored to the update")
        : fail("update comment create", { s: r.status, d: r.data, row: cRow })
      const commentId = r.data?.post?.id
      const otherThread = await prisma.thread.create({
        data: {
          title: M("other"), slug: M("other").toLowerCase().replace(/_/g, "-"), content: "x",
          authorId: owner.id, categoryId: (await prisma.thread.findUnique({ where: { id: discThread.id }, select: { categoryId: true } })).categoryId,
        },
      })
      threadIds.push(otherThread.id)
      r = await updComment({ threadId: otherThread.id, diaryUpdateId: discUpd.id, content: "anchored to the wrong thread" }, voterCookie)
      r.status === 404 ? pass("anchor must target the grow's own discussion thread") : fail("comment wrong thread", r.status)
      r = await updComment({ threadId: discThread.id, diaryUpdateId: discUpd.id, content: "comment with a photo", images: [TINY_PNG] }, voterCookie)
      r.status === 400 ? pass("update comments are text-only") : fail("comment images", r.status)
      r = await updComment({ threadId: discThread.id, diaryUpdateId: discUpd.id, content: "a comment from a guest" })
      r.status === 401 ? pass("guest cannot comment") : fail("comment anon", r.status)
      r = await updComment({ threadId: discThread.id, diaryUpdateId: discUpd.id, content: "a comment from blocked" }, viewerCookie)
      r.status === 403 ? pass("blocked member cannot comment on the grower's update") : fail("comment block", r.status)
      r = await updComment({ threadId: discThread.id, diaryUpdateId: prvUpd.id, content: "comment on a private update" }, voterCookie)
      const rU = await updComment({ threadId: discThread.id, diaryUpdateId: unlUpd.id, content: "comment on an unlisted update" }, voterCookie)
      r.status === 404 && rU.status === 404
        ? pass("PRIVATE + UNLISTED updates reject comments (404)")
        : fail("non-public update comment", { prv: r.status, unl: rU.status })
      r = await updComment({ threadId: discThread.id, diaryUpdateId: delUpd.id, content: "comment on a deleted grow" }, voterCookie)
      r.status === 404 ? pass("deleted grow's update rejects comments") : fail("deleted grow comment", r.status)
      r = await updComment({ threadId: discThread.id, diaryUpdateId: { id: discUpd.id }, content: "malformed anchor value" }, voterCookie)
      r.status === 400 ? pass("non-string diaryUpdateId rejected (no mass assignment)") : fail("anchor type", r.status)

      // Comment notification — existing COMMENT type, update deep link that
      // carries ?post= for delete cleanup; no REPLY for the same event; a
      // second comment inside the window does not stack.
      await updComment({ threadId: discThread.id, diaryUpdateId: discUpd.id, content: `${cTok} second comment, same window` }, voterCookie)
      const cNotes = await prisma.notification.findMany({
        where: { userId: owner.id, type: "COMMENT", groupKey: `COMMENT:update:${discUpd.id}` },
        select: { link: true },
      })
      const replyNotes = await prisma.notification.count({ where: { userId: owner.id, type: "REPLY", link: { contains: commentId } } })
      cNotes.length === 1 && cNotes[0].link?.includes(`?post=${commentId}#update-${discUpd.id}`) && replyNotes === 0
        ? pass("comment notifies grower once via COMMENT (grouped, update deep link, no REPLY dupe)")
        : fail("comment notification", { cNotes, replyNotes })

      // Mentions in an update comment use the existing mention path.
      const ment = await createUser("ment")
      users.push(ment)
      const mentUsername = (await prisma.profile.findUnique({ where: { userId: ment.id }, select: { username: true } }))?.username
      await updComment({ threadId: discThread.id, diaryUpdateId: discUpd.id, content: `@${mentUsername} @${ownerUsername} check this trichome shot` }, voterCookie)
      const mNote = await prisma.notification.findFirst({ where: { userId: ment.id, type: "MENTION" }, select: { link: true } })
      const ownerMention = await prisma.notification.count({ where: { userId: owner.id, type: "MENTION", actorId: voter.id } })
      mNote?.link?.includes(`#update-${discUpd.id}`) && ownerMention === 0
        ? pass("mention in update comment notifies mentionee (update link); grower not double-notified")
        : fail("comment mention", { mNote, ownerMention })

      // Update-notification deep link — a real update POST notifies diary
      // followers at #update-<id> (the update's own react/comment row), the
      // same anchor feed/digest/comment surfaces already use. Week-header
      // links land near the update; update links land on it — and
      // updateLinkWhere already purges them on update delete.
      await callApi("/api/follows", { method: "POST", body: { diaryId: discD.id }, cookie: voterCookie })
      r = await callApi("/api/diaries/updates", {
        method: "POST",
        body: { diaryId: discD.id, title: M("du-link"), content: "deep link target", stage: "VEGETATIVE", dayNumber: 2, weekNumber: 1 },
        cookie: ownerCookie,
      })
      const linkUpdId = r.data?.update?.id
      const duNote = await prisma.notification.findFirst({
        where: { userId: voter.id, type: "DIARY_UPDATE", link: { contains: `#update-${linkUpdId}` } },
        select: { link: true },
      })
      r.status === 201 && linkUpdId && duNote?.link?.endsWith(`#update-${linkUpdId}`)
        ? pass("update notification deep-links to the update anchor (#update-<id>)")
        : fail("update notification link", { s: r.status, linkUpdId, duNote })
      await prisma.diaryFollow.deleteMany({ where: { userId: voter.id, diaryId: discD.id } })

      // Rate limit — anchored comments share the post limiter.
      await prisma.rateLimit.upsert({
        where: { key: `post:${voter.id}` },
        create: { key: `post:${voter.id}`, count: 100000, expiresAt: new Date(Date.now() + 600000) },
        update: { count: 100000, expiresAt: new Date(Date.now() + 600000) },
      })
      r = await updComment({ threadId: discThread.id, diaryUpdateId: discUpd.id, content: "one comment too many" }, voterCookie)
      r.status === 429 ? pass("update comments honor the post rate limit") : fail("comment rate limit", r.status)
      await prisma.rateLimit.delete({ where: { key: `post:${voter.id}` } }).catch(() => {})

      // Rendering — diary timeline + thread chip.
      const socPage = await getHtml(`/diaries/${discD.id}`, voterCookie)
      socPage.html.includes(`data-update-social="${discUpd.id}"`) &&
      socPage.html.includes(`data-update-comment="${discUpd.id}"`) &&
      socPage.html.includes(`${cTok} looks healthy`) &&
      socPage.html.includes("Comments on this update")
        ? pass("diary timeline renders update reactions, comment action, and inline comments")
        : fail("update social render", socPage.status)
      const guestSoc = await getHtml(`/diaries/${discD.id}`)
      guestSoc.html.includes(`${cTok} looks healthy`) ? pass("guest sees public update comments") : fail("guest comment render")
      const blockedSoc = await getHtml(`/diaries/${discD.id}`, viewerCookie)
      blockedSoc.status === 200 && !blockedSoc.html.includes(`data-update-comment="${discUpd.id}"`)
        ? pass("blocked member gets a read-only interaction row (no composer)")
        : fail("blocked render", blockedSoc.status)
      !pages.PRIVATE_owner.includes("data-update-comment=") && !pages.UNLISTED.includes("data-update-comment=")
        ? pass("non-public grows render no comment composer")
        : fail("non-public composer")
      const emptyUpd = await prisma.diaryUpdate.create({
        data: { diaryId: discD.id, authorId: owner.id, title: M("eu"), content: "no comments yet", stage: "VEGETATIVE", dayNumber: 2, weekNumber: 1 },
      })
      const emptyPage = await getHtml(`/diaries/${discD.id}`, voterCookie)
      // Slice this update's rendered block only — stop at the next update
      // row and at the RSC flight payload (<script>), which serializes every
      // row's props and would otherwise bleed into the last block.
      const emptyBlock = emptyPage.html
        .split(`data-update-social="${emptyUpd.id}"`)[1]
        ?.split("data-update-social=")[0]
        .split("<script")[0] ?? ""
      emptyBlock && !emptyBlock.includes("Comments on this update")
        ? pass("update without comments renders no empty comment list")
        : fail("empty comment state", { status: emptyPage.status, found: !!emptyBlock, len: emptyBlock.length })
      let threadPage = await getHtml(`/forum/thread/${discThread.slug}`)
      threadPage.html.includes(`${cTok} looks healthy`) && threadPage.html.includes("on update:")
        ? pass("anchored comment appears in the grow discussion with its update chip")
        : fail("thread anchored render", threadPage.status)

      // Privacy flip — UNLISTED / deleted grow hides anchored comments from
      // the public thread and search; restoring PUBLIC brings them back.
      // Positive control first (search results are cached per query, so the
      // control and the negative use distinct never-before-searched tokens).
      const pTok = M("srch")
      await updComment({ threadId: discThread.id, diaryUpdateId: discUpd.id, content: `${pTok} searchable while public` }, voterCookie)
      const searchVisible = await callApi(`/api/search?q=${encodeURIComponent(pTok)}`)
      JSON.stringify(searchVisible.data ?? {}).includes("searchable while public")
        ? pass("public anchored comment is searchable (positive control)")
        : fail("anchored search control", { s: searchVisible.status })
      await prisma.growDiary.update({ where: { id: discD.id }, data: { visibility: "UNLISTED" } })
      threadPage = await getHtml(`/forum/thread/${discThread.slug}`)
      const searchHidden = await callApi(`/api/search?q=${encodeURIComponent(cTok)}`)
      !threadPage.html.includes(`${cTok} looks healthy`) && !JSON.stringify(searchHidden.data ?? {}).includes("looks healthy")
        ? pass("grow leaves PUBLIC → anchored comments vanish from thread + search")
        : fail("anchored privacy flip", { thread: threadPage.html.includes(cTok), search: searchHidden.status })
      await prisma.growDiary.update({ where: { id: discD.id }, data: { visibility: "PUBLIC", deleted: true } })
      threadPage = await getHtml(`/forum/thread/${discThread.slug}`)
      !threadPage.html.includes(`${cTok} looks healthy`)
        ? pass("deleted grow → anchored comments never leak through the thread")
        : fail("anchored deleted grow")
      await prisma.growDiary.update({ where: { id: discD.id }, data: { deleted: false } })
      threadPage = await getHtml(`/forum/thread/${discThread.slug}`)
      threadPage.html.includes(`${cTok} looks healthy`)
        ? pass("restoring PUBLIC restores anchored comments (non-destructive)")
        : fail("anchored restore")

      // Comment delete — normal Post delete; its notification is cleaned.
      r = await callApi("/api/forum/posts", { method: "DELETE", body: { id: commentId }, cookie: ownerCookie })
      r.status === 403 ? pass("grower cannot delete another member's comment (moderation stays staff-only)") : fail("owner delete other comment", r.status)
      r = await callApi("/api/forum/posts", { method: "DELETE", body: { id: commentId }, cookie: voterCookie })
      const delNote = await prisma.notification.count({ where: { link: { contains: `?post=${commentId}` } } })
      r.status === 200 && delNote === 0
        ? pass("comment author deletes own comment; deep-link notification removed")
        : fail("comment delete", { s: r.status, delNote })

      // Update delete — anchored comments soft-deleted (no orphans),
      // update reactions cascade, update-linked notifications removed.
      const goneUpd = await prisma.diaryUpdate.create({
        data: { diaryId: discD.id, authorId: owner.id, title: M("gu"), content: "about to be deleted", stage: "VEGETATIVE", dayNumber: 3, weekNumber: 1 },
      })
      await updReact({ type: "LIKE", diaryUpdateId: goneUpd.id }, voterCookie)
      r = await updComment({ threadId: discThread.id, diaryUpdateId: goneUpd.id, content: `${cTok} orphan candidate comment` }, voterCookie)
      const orphanId = r.data?.post?.id
      const replyBefore = (await prisma.thread.findUnique({ where: { id: discThread.id }, select: { replyCount: true } })).replyCount
      r = await callApi("/api/diaries/updates", { method: "DELETE", body: { id: goneUpd.id }, cookie: ownerCookie })
      const orphan = orphanId && await prisma.post.findUnique({ where: { id: orphanId }, select: { deleted: true } })
      const goneReacts = await prisma.reaction.count({ where: { diaryUpdateId: goneUpd.id } })
      const goneNotes = await prisma.notification.count({ where: { link: { contains: `#update-${goneUpd.id}` } } })
      const replyAfter = (await prisma.thread.findUnique({ where: { id: discThread.id }, select: { replyCount: true } })).replyCount
      threadPage = await getHtml(`/forum/thread/${discThread.slug}`)
      r.status === 200 && orphan?.deleted === true && goneReacts === 0 && goneNotes === 0 &&
      replyAfter === replyBefore - 1 && !threadPage.html.includes("orphan candidate comment")
        ? pass("update delete soft-deletes anchored comments, cascades reactions, purges notifications")
        : fail("update delete social cleanup", { s: r.status, orphan, goneReacts, goneNotes, replyBefore, replyAfter })

      // Feed card exposes interaction counts + update deep link.
      const feedHtml = (await getHtml("/feed", voterCookie)).html
      feedHtml.includes(`#update-${emptyUpd.id}`)
        ? pass("feed update card deep-links to the update with interaction counts")
        : fail("feed update card link")
    }

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
      const smap = await getSitemapBodies()
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
      const smap = await getSitemapBodies()
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
      const smap = await getSitemapBodies()
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
    for (const id of threadIds) await prisma.thread.delete({ where: { id } }).catch(() => {})
    for (const u of users) await prisma.user.delete({ where: { id: u.id } }).catch(() => {})
    await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "login" } } }).catch(() => {})
    await prisma.$disconnect()
  }

  process.exit(finish())
}

main()
