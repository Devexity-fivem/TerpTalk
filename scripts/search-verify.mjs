// Phase 5 search verification — exercises /api/search and /api/search/suggest
// end-to-end: result buckets, tiering, solved/matched-post metadata,
// pagination, malformed input, and hidden/deleted/suspended exclusion.
// Temp fixtures use unique `__sv_<ts>` markers and are fully cleaned up.
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const BASE = process.env.VERIFY_URL || "http://localhost:3000"
const prisma = new PrismaClient()
const results = []
function pass(n) { results.push(["PASS", n]); console.log(`  ✓ ${n}`) }
function fail(n, i) { results.push(["FAIL", n]); console.log(`  ✗ ${n} — ${JSON.stringify(i)?.slice(0, 300)}`) }

const TS = Date.now().toString(36)
const M = (label) => `__sv_${label}_${TS}` // unique marker per entity kind

async function createUser(tag, extra = {}) {
  const password = "VerifyPass123!"
  const user = await prisma.user.create({
    data: {
      name: `__svuser_${tag}_${TS}`,
      ageVerified: true,
      password: await bcrypt.hash(password, 12),
      sessionVersion: 1,
      onboardingCompletedAt: new Date(),
      profile: { create: { username: `__sv_${TS}_${tag}` } },
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
    return { status: 0, data: { fetchError: String(e) } }
  }
  let data = null
  try { data = await res.json() } catch { /* html/redirect */ }
  return { status: res.status, data }
}

const search = (params) => callApi(`/api/search?${params}`)
const suggest = (q) => callApi(`/api/search/suggest?q=${encodeURIComponent(q)}`)

const main = async () => {
  const author = await createUser("author")
  const answerer = await createUser("answerer")
  const bannedU = await createUser("banned", { banned: true })
  const suspendedU = await createUser("susp", { suspendedUntil: new Date(Date.now() + 86400000) })
  const users = [author, answerer, bannedU, suspendedU]

  const threads = []
  const posts = []
  const cleanup = { categories: [], strains: [], diaries: [], setups: [], guides: [], tags: [] }

  try {
    const category = await prisma.category.findFirst({ where: { hidden: false }, select: { id: true } })
    if (!category) throw new Error("no visible category seeded")
    const hiddenCat = await prisma.category.create({
      data: { name: `__sv hidden ${TS}`, slug: `__sv-hidden-${TS}`, description: "v", hidden: true },
    })
    cleanup.categories.push(hiddenCat)

    // Clear rate limits — repeated suite runs would otherwise trip login/search caps.
    await prisma.rateLimit.deleteMany({ where: { OR: [{ key: { startsWith: "login" } }, { key: { startsWith: "search" } }] } })

    const { cookie: authorCookie } = await login(author.username, author.password)
    const { cookie: answererCookie } = await login(answerer.username, answerer.password)
    ;[authorCookie, answererCookie].every(Boolean)
      ? pass("logins work")
      : fail("logins", "missing session cookie")

    // ── Fixtures ──
    // Thread A: query marker in the TITLE (tier 1). Created via API so
    // revalidateTag("forum") fires.
    const tA = await callApi("/api/forum/threads", {
      method: "POST",
      body: { title: `How to fix ${M("title")} nutrient burn`, content: "verification content — enough characters here", categoryId: category.id },
      cookie: authorCookie,
    })
    const threadA = tA.data?.thread
    if (threadA?.id) threads.push(threadA)
    tA.status === 201 && threadA?.slug
      ? pass("setup: thread A via API")
      : fail("thread A setup", { s: tA.status })

    // Thread B: marker only in the opening-post body (tier 2).
    const tB = await callApi("/api/forum/threads", {
      method: "POST",
      body: { title: `Generic question ${TS}`, content: `body contains ${M("title")} only`, categoryId: category.id },
      cookie: authorCookie,
    })
    const threadB = tB.data?.thread
    if (threadB?.id) threads.push(threadB)
    tB.status === 201 ? pass("setup: thread B via API") : fail("thread B setup", { s: tB.status })

    // Reply on thread A carrying a post-only marker → becomes accepted answer.
    const rA = await callApi("/api/forum/posts", {
      method: "POST",
      body: { threadId: threadA.id, content: `reply with ${M("post")} inside` },
      cookie: answererCookie,
    })
    const replyA = rA.data?.post
    if (replyA?.id) posts.push(replyA)
    rA.status === 201 && replyA?.id ? pass("setup: reply via API") : fail("reply setup", { s: rA.status })

    if (!threadA?.id || !threadB?.id || !replyA?.id) throw new Error("fixture setup failed — aborting")

    // Hidden + deleted threads with the same marker.
    const hiddenThread = await prisma.thread.create({
      data: { title: `hidden ${M("title")}`, slug: `sv-h-${TS}`, content: "h", categoryId: hiddenCat.id, authorId: author.id },
    })
    const deletedThread = await prisma.thread.create({
      data: { title: `deleted ${M("title")}`, slug: `sv-d-${TS}`, content: "d", categoryId: category.id, authorId: author.id, deleted: true },
    })
    threads.push(hiddenThread, deletedThread)
    // A reply in the hidden category carrying the post marker.
    const hiddenPost = await prisma.post.create({
      data: { threadId: hiddenThread.id, authorId: answerer.id, content: `hidden ${M("post")}` },
    })
    posts.push(hiddenPost)

    // Other entity fixtures.
    const guide = await prisma.guide.create({
      data: { title: `Guide to ${M("guide")}`, slug: `sv-g-${TS}`, excerpt: "verification excerpt", content: "content", topic: "BASICS", authorId: author.id, published: true },
    })
    cleanup.guides.push(guide)
    const unpubGuide = await prisma.guide.create({
      data: { title: `Unpub ${M("guide")}`, slug: `sv-gu-${TS}`, excerpt: "x", content: "c", topic: "BASICS", authorId: author.id, published: false },
    })
    cleanup.guides.push(unpubGuide)
    const strain = await prisma.strain.create({ data: { name: `${M("strain")} Kush` } })
    cleanup.strains.push(strain)
    const diary = await prisma.growDiary.create({
      data: { title: `${M("diary")} grow`, description: "d", growType: "INDOOR", startDate: new Date(), authorId: author.id },
    })
    cleanup.diaries.push(diary)
    const setup = await prisma.growSetup.create({
      data: { title: `${M("setup")} tent`, description: "d", authorId: author.id },
    })
    cleanup.setups.push(setup)
    const tag = await prisma.tag.create({ data: { name: M("tag"), slug: `sv-t-${TS}` } })
    cleanup.tags.push(tag)
    await prisma.threadTag.create({ data: { threadId: threadA.id, tagId: tag.id } })

    // Accept the reply as the answer — author accepts via API.
    const acc = await callApi("/api/forum/threads/accept", {
      method: "POST",
      body: { threadId: threadA.id, postId: replyA.id },
      cookie: authorCookie,
    })
    acc.status === 200 ? pass("setup: accepted answer via API") : fail("accept setup", { s: acc.status })

    // ── Buckets ──
    let r = await search(`q=${M("title")}&type=threads`)
    const tIds = (r.data?.threads || []).map((t) => t.id)
    tIds.includes(threadA.id) && tIds.includes(threadB.id)
      ? pass("threads: title+body matches found")
      : fail("thread match", { s: r.status, n: tIds.length })
    // Tiering: title-match (A) must rank above body-only match (B).
    tIds.indexOf(threadA.id) < tIds.indexOf(threadB.id)
      ? pass("threads: title match outranks body match")
      : fail("tiering", tIds)

    // Hidden/deleted exclusion.
    !tIds.includes(hiddenThread.id) && !tIds.includes(deletedThread.id)
      ? pass("threads: hidden + deleted excluded")
      : fail("hidden/deleted leak", tIds)

    // Solved metadata on the accepted thread.
    const solvedThread = (r.data?.threads || []).find((t) => t.id === threadA.id)
    solvedThread?.solved === true && typeof solvedThread?.answerSnippet === "string"
      ? pass("threads: solved badge + answer snippet")
      : fail("solved meta", solvedThread && { s: solvedThread.solved })

    // Post-content match → matchedPost deep link to the actual reply.
    r = await search(`q=${M("post")}&type=threads`)
    const mp = (r.data?.threads || []).find((t) => t.id === threadA.id)?.matchedPost
    mp?.id === replyA.id
      ? pass("threads: matchedPost deep link")
      : fail("matchedPost", mp)
    // The hidden-category reply must NOT surface its thread.
    !(r.data?.threads || []).some((t) => t.id === hiddenThread.id)
      ? pass("threads: hidden-category post excluded")
      : fail("hidden post leak", r.data?.threads?.length)

    // Other buckets.
    r = await search(`q=${M("guide")}&type=guides`)
    const gSlugs = (r.data?.guides || []).map((g) => g.slug)
    gSlugs.includes(guide.slug) && !gSlugs.includes(unpubGuide.slug)
      ? pass("guides: published found, unpublished excluded")
      : fail("guides", gSlugs)

    r = await search(`q=${encodeURIComponent(M("strain"))}&type=strains`)
    ;(r.data?.strains || []).some((s) => s.id === strain.id)
      ? pass("strains: name match")
      : fail("strains", { s: r.status })

    r = await search(`q=${M("diary")}&type=diaries`)
    ;(r.data?.diaries || []).some((d) => d.id === diary.id)
      ? pass("diaries: title match")
      : fail("diaries", { s: r.status })

    r = await search(`q=${M("setup")}&type=setups`)
    ;(r.data?.setups || []).some((s) => s.id === setup.id)
      ? pass("setups: title match")
      : fail("setups", { s: r.status })

    r = await search(`q=${M("tag")}&type=tags`)
    ;(r.data?.tags || []).some((t) => t.slug === tag.slug)
      ? pass("tags: name match")
      : fail("tags", { s: r.status })

    // Tag membership boosts a thread into tier 1.
    r = await search(`q=${M("tag")}&type=threads`)
    ;(r.data?.threads || []).some((t) => t.id === threadA.id)
      ? pass("threads: tag match surfaces thread")
      : fail("tag→thread", { s: r.status })

    // Users: normal found, banned + suspended excluded.
    r = await search(`q=__sv_${TS}_&type=users`)
    const uNames = (r.data?.users || []).map((u) => u.username)
    uNames.includes(author.username) && !uNames.includes(bannedU.username) && !uNames.includes(suspendedU.username)
      ? pass("users: active found, banned+suspended excluded")
      : fail("users", { u: uNames.slice(0, 8), a: author.username, b: bannedU.username, s: suspendedU.username })

    // ── Input handling ──
    r = await search("q=")
    r.status === 200 && (r.data?.threads || []).length === 0
      ? pass("input: empty query → empty buckets")
      : fail("empty q", r.status)
    r = await search("q=x")
    r.status === 200 && (r.data?.threads || []).length === 0
      ? pass("input: 1-char query → empty")
      : fail("short q", r.status)
    r = await search(`q=${encodeURIComponent("%%%")}`)
    r.status === 200 && !(r.data?.threads || []).some((t) => t.id === threadA.id)
      ? pass("input: wildcard-only query matches nothing")
      : fail("wildcards", { s: r.status, n: r.data?.threads?.length })
    r = await search(`q=${encodeURIComponent("z".repeat(200))}`)
    r.status === 200
      ? pass("input: 200-char query handled")
      : fail("long q", r.status)
    r = await search(`q=${M("title")}&type=bogus`)
    r.status === 200 && Array.isArray(r.data?.threads) && Array.isArray(r.data?.guides)
      ? pass("input: unknown type falls back to all")
      : fail("bad type", r.status)

    // ── Category scoping ──
    r = await search(`q=${M("title")}&type=threads&category=__no_such_slug__`)
    ;(r.data?.threads || []).length === 0
      ? pass("category: bogus slug narrows to zero")
      : fail("bogus category", r.data?.threads?.length)
    r = await search(`q=${M("title")}&type=threads&category=${hiddenCat.slug}`)
    ;(r.data?.threads || []).length === 0
      ? pass("category: hidden slug returns zero (no existence leak)")
      : fail("hidden category", r.data?.threads?.length)

    // ── Pagination & bounds ──
    r = await search(`q=${M("title")}&type=all`)
    const buckets = ["threads", "strains", "users", "diaries", "guides", "setups", "tags"]
    buckets.every((b) => Array.isArray(r.data?.[b]) && r.data[b].length <= 10)
      ? pass("bounds: all-bucket view ≤10 each")
      : fail("bucket bounds", buckets.map((b) => r.data?.[b]?.length))
    r = await search(`q=${M("title")}&type=threads&page=99`)
    r.status === 200 && (r.data?.threads || []).length === 0
      ? pass("bounds: deep page returns empty, not crash")
      : fail("deep page", r.status)
    r = await search(`q=${M("title")}&type=threads&page=1`)
    r.data?.hasMore && typeof r.data.hasMore.threads === "boolean"
      ? pass("bounds: hasMore metadata present")
      : fail("hasMore", r.data?.hasMore)

    // ── Suggest ──
    r = await suggest(M("title"))
    const sTypes = (r.data?.suggestions || []).map((s) => s.type)
    sTypes.includes("thread")
      ? pass("suggest: thread suggestion")
      : fail("suggest thread", sTypes)
    r = await suggest(M("guide"))
    ;(r.data?.suggestions || []).some((s) => s.type === "guide")
      ? pass("suggest: guide suggestion")
      : fail("suggest guide", r.data?.suggestions)
    r = await suggest(M("title"))
    !(r.data?.suggestions || []).some((s) => s.slug === hiddenThread.slug || s.slug === deletedThread.slug)
      ? pass("suggest: hidden + deleted threads excluded")
      : fail("suggest leak", r.data?.suggestions)
    r = await suggest(`__sv_${TS}_`)
    !(r.data?.suggestions || []).some((s) => s.slug === bannedU.username || s.slug === suspendedU.username)
      ? pass("suggest: banned + suspended users excluded")
      : fail("suggest users", r.data?.suggestions?.slice(0, 8))
    r = await suggest("x")
    r.status === 200 && (r.data?.suggestions || []).length === 0
      ? pass("suggest: short query → empty")
      : fail("suggest short", r.status)

    console.log(`\n${results.filter(([s]) => s === "PASS").length} passed, ${results.filter(([s]) => s === "FAIL").length} failed`)
  } finally {
    for (const u of users) await prisma.user.delete({ where: { id: u.id } }).catch(() => {})
    for (const t of threads) await prisma.thread.delete({ where: { id: t.id } }).catch(() => {})
    for (const c of cleanup.categories) await prisma.category.delete({ where: { id: c.id } }).catch(() => {})
    for (const s of cleanup.strains) await prisma.strain.delete({ where: { id: s.id } }).catch(() => {})
    for (const d of cleanup.diaries) await prisma.growDiary.delete({ where: { id: d.id } }).catch(() => {})
    for (const s of cleanup.setups) await prisma.growSetup.delete({ where: { id: s.id } }).catch(() => {})
    for (const g of cleanup.guides) await prisma.guide.delete({ where: { id: g.id } }).catch(() => {})
    for (const t of cleanup.tags) await prisma.tag.delete({ where: { id: t.id } }).catch(() => {})
    await prisma.$disconnect()
  }
}

main()
