// Phase 3 authenticated verification — thread follows, reply notifications,
// unread state, first-action nudge. Temp users/threads fully cleaned up.
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const BASE = process.env.VERIFY_URL || "http://localhost:3000"
const prisma = new PrismaClient()
const results = []
function pass(n) { results.push(["PASS", n]); console.log(`  ✓ ${n}`) }
function fail(n, i) { results.push(["FAIL", n]); console.log(`  ✗ ${n} — ${JSON.stringify(i)?.slice(0, 300)}`) }

async function createUser(tag) {
  const password = "VerifyPass123!"
  const user = await prisma.user.create({
    data: {
      name: `__verify_${tag}_${Date.now()}`,
      ageVerified: true,
      password: await bcrypt.hash(password, 12),
      sessionVersion: 1,
      onboardingCompletedAt: new Date(),
      profile: { create: { username: `__v_${tag}_${Date.now().toString(36)}` } },
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

// after() fan-out lands after the response — poll briefly for async work.
async function waitFor(fn, tries = 12) {
  for (let i = 0; i < tries; i++) {
    const v = await fn()
    if (v) return v
    await new Promise((r) => setTimeout(r, 400))
  }
  return null
}

const FOLLOW_URL = "/api/forum/threads/follow"

const main = async () => {
  const follower = await createUser("follower")
  const replier = await createUser("replier")
  const banned = await createUser("banned")
  const fresh = await createUser("fresh") // zero posts — first-action nudge
  const author = await createUser("author") // distinct thread author
  const mod = await createUser("mod")
  const admin = await createUser("admin")
  await prisma.user.update({ where: { id: mod.id }, data: { role: "MODERATOR" } })
  await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMINISTRATOR" } })

  const users = [follower, replier, banned, fresh, author, mod, admin]
  const threads = []
  let hiddenCat = null

  try {
    const category = await prisma.category.findFirst({ where: { hidden: false }, select: { id: true } })
    if (!category) throw new Error("no visible category seeded")
    hiddenCat = await prisma.category.create({
      data: { name: `__verify_hidden_${Date.now()}`, slug: `__verify-hidden-${Date.now()}`, description: "verification", hidden: true },
    })
    const thread = await prisma.thread.create({
      data: {
        title: `__verify thread ${Date.now()}`,
        slug: `__verify-${Date.now()}`,
        content: "verification thread content — enough chars",
        categoryId: category.id,
        authorId: replier.id,
      },
    })
    const hiddenThread = await prisma.thread.create({
      data: {
        title: `__verify hidden ${Date.now()}`,
        slug: `__verify-h-${Date.now()}`,
        content: "verification hidden thread content",
        categoryId: hiddenCat.id,
        authorId: replier.id,
      },
    })
    const deletedThread = await prisma.thread.create({
      data: {
        title: `__verify deleted ${Date.now()}`,
        slug: `__verify-d-${Date.now()}`,
        content: "verification deleted thread content",
        categoryId: category.id,
        authorId: replier.id,
        deleted: true,
      },
    })
    threads.push(thread, hiddenThread, deletedThread)

    const { cookie: followerCookie } = await login(follower.username, follower.password)
    const { cookie: replierCookie } = await login(replier.username, replier.password)
    const { cookie: bannedCookie } = await login(banned.username, banned.password)
    const { cookie: freshCookie } = await login(fresh.username, fresh.password)
    const { cookie: authorCookie } = await login(author.username, author.password)
    const { cookie: modCookie } = await login(mod.username, mod.password)
    const { cookie: adminCookie } = await login(admin.username, admin.password)
    followerCookie ? pass("logins work") : fail("logins", "no cookie")

    // ── 1. Follow toggle ──
    let r = await callApi(FOLLOW_URL, { method: "POST", body: {} })
    r.status === 401 ? pass("anon: follow 401") : fail("anon follow", r.status)

    r = await callApi(FOLLOW_URL, { method: "POST", body: { threadId: thread.id }, cookie: followerCookie })
    const fr = await prisma.threadFollow.findUnique({ where: { userId_threadId: { userId: follower.id, threadId: thread.id } } })
    r.status === 200 && r.data?.following === true && fr ? pass("follow: authenticated user can follow") : fail("follow", { s: r.status, d: r.data })

    r = await callApi(FOLLOW_URL, { method: "POST", body: { threadId: thread.id }, cookie: followerCookie })
    // second toggle = unfollow
    r.status === 200 && r.data?.following === false
      ? pass("follow: toggle unfollows")
      : fail("unfollow", { s: r.status, d: r.data })

    // Re-follow for notification tests; then duplicate POST race check
    await callApi(FOLLOW_URL, { method: "POST", body: { threadId: thread.id }, cookie: followerCookie })
    const [r1, r2] = await Promise.all([
      callApi(FOLLOW_URL, { method: "POST", body: { threadId: thread.id }, cookie: followerCookie }),
      callApi(FOLLOW_URL, { method: "POST", body: { threadId: thread.id }, cookie: followerCookie }),
    ])
    const rows = await prisma.threadFollow.count({ where: { userId: follower.id, threadId: thread.id } })
    ;(r1.status === 200 && r2.status === 200 && rows <= 1)
      ? pass("follow: concurrent toggle safe (no 500, ≤1 row)")
      : fail("concurrent follow", { s1: r1.status, s2: r2.status, rows })
    // ensure followed state for later checks
    if (rows === 0) await callApi(FOLLOW_URL, { method: "POST", body: { threadId: thread.id }, cookie: followerCookie })

    // ── 2. Guards ──
    // Permanently banned users have their sessions rejected (401); suspended
    // users keep a session but are blocked by isBanned (403). Either way the
    // mutation is refused.
    await prisma.user.update({ where: { id: banned.id }, data: { suspendedUntil: new Date(Date.now() + 86400000) } })
    r = await callApi(FOLLOW_URL, { method: "POST", body: { threadId: thread.id }, cookie: bannedCookie })
    ;(r.status === 401 || r.status === 403) ? pass("follow: suspended user refused (401/403)") : fail("banned follow", r.status)

    r = await callApi(FOLLOW_URL, { method: "POST", body: { threadId: "nonexistent-thread-id" }, cookie: followerCookie })
    r.status === 404 ? pass("follow: nonexistent thread 404") : fail("404 check", r.status)

    r = await callApi(FOLLOW_URL, { method: "POST", body: { threadId: deletedThread.id }, cookie: followerCookie })
    r.status === 404 ? pass("follow: deleted thread 404") : fail("deleted follow", r.status)

    r = await callApi(FOLLOW_URL, { method: "POST", body: { threadId: hiddenThread.id }, cookie: followerCookie })
    r.status === 404 ? pass("follow: hidden-category thread 404") : fail("hidden follow", r.status)

    // Hidden page guards — direct link must 404 for non-moderators
    r = await callApi(`/forum/thread/${hiddenThread.slug}`, { cookie: followerCookie })
    r.status === 404 ? pass("page: hidden thread 404 for member") : fail("hidden page", r.status)
    r = await callApi(`/forum/category/${hiddenCat.slug}`, { cookie: followerCookie })
    r.status === 404 ? pass("page: hidden category 404 for member") : fail("hidden cat page", r.status)

    // Rate limit — seed the counter to the cap, next call must 429
    await prisma.rateLimit.upsert({
      where: { key: `thread-follow:${banned.id}` },
      create: { key: `thread-follow:${banned.id}`, count: 60, expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
      update: { count: 60, expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
    })
    await prisma.user.update({ where: { id: banned.id }, data: { suspendedUntil: null } })
    r = await callApi(FOLLOW_URL, { method: "POST", body: { threadId: thread.id }, cookie: bannedCookie })
    r.status === 429 ? pass("follow: rate limited at cap") : fail("rate limit", r.status)
    await prisma.rateLimit.deleteMany({ where: { key: `thread-follow:${banned.id}` } })

    // Block check — follower blocks thread author, follow refused
    await prisma.block.create({ data: { blockerId: fresh.id, blockedId: replier.id } })
    r = await callApi(FOLLOW_URL, { method: "POST", body: { threadId: thread.id }, cookie: freshCookie })
    r.status === 403 ? pass("follow: block vs author → 403") : fail("block follow", r.status)
    await prisma.block.deleteMany({ where: { blockerId: fresh.id } })

    // ── 3. Reply → follower notification ──
    const replyBody = () => ({ content: `Verification reply ${Date.now()} — enough content to pass the minimum.`, threadId: thread.id })
    const notifCount = (uid) => prisma.notification.count({ where: { userId: uid, type: "THREAD_ACTIVITY", link: `/forum/thread/${thread.slug}` } })

    r = await callApi("/api/forum/posts", { method: "POST", body: replyBody(), cookie: replierCookie })
    r.status === 201 ? pass("reply: created") : fail("reply create", { s: r.status, d: r.data })

    const got = await waitFor(() => notifCount(follower.id))
    got === 1 ? pass("notify: follower gets THREAD_ACTIVITY on reply") : fail("follower notif", got)

    // Replier auto-followed + own reply doesn't flag unread for them
    const replierFollow = await waitFor(() =>
      prisma.threadFollow.findUnique({ where: { userId_threadId: { userId: replier.id, threadId: thread.id } } }))
    const t1 = await prisma.thread.findUnique({ where: { id: thread.id }, select: { lastActivityAt: true } })
    replierFollow && !(t1.lastActivityAt > replierFollow.lastSeenAt)
      ? pass("unread: replier auto-follows, own reply stays read")
      : fail("replier autofollow", { f: !!replierFollow, t: t1?.lastActivityAt, s: replierFollow?.lastSeenAt })

    // Follower's lastSeenAt is older than lastActivityAt → unread
    const ff = await prisma.threadFollow.findUnique({ where: { userId_threadId: { userId: follower.id, threadId: thread.id } } })
    ff && t1.lastActivityAt > ff.lastSeenAt
      ? pass("unread: new activity marks followed thread unread")
      : fail("unread mark", { s: ff?.lastSeenAt, a: t1.lastActivityAt })

    // Throttle — immediate second reply must NOT create another notification
    await callApi("/api/forum/posts", { method: "POST", body: replyBody(), cookie: replierCookie })
    await new Promise((res) => setTimeout(res, 1500))
    ;(await notifCount(follower.id)) === 1
      ? pass("notify: second reply within 6h throttled (lastNotifiedAt)")
      : fail("throttle", await notifCount(follower.id))

    // Author doesn't double-notify: replier is author here — check they got
    // no THREAD_ACTIVITY for own reply
    ;(await notifCount(replier.id)) === 0
      ? pass("notify: no self-reply notification")
      : fail("self notif", await notifCount(replier.id))

    // Blocked actor — follower blocks replier → reply generates nothing.
    // Clear the earlier notification AND lastNotifiedAt first, otherwise the
    // groupKey dedupe would mask the check (vacuous pass).
    const clearNotifs = () =>
      prisma.notification.deleteMany({ where: { userId: follower.id, type: "THREAD_ACTIVITY", link: `/forum/thread/${thread.slug}` } })
    await clearNotifs()
    await prisma.threadFollow.updateMany({ where: { userId: follower.id, threadId: thread.id }, data: { lastNotifiedAt: null } })
    await prisma.block.create({ data: { blockerId: follower.id, blockedId: replier.id } })
    await callApi("/api/forum/posts", { method: "POST", body: replyBody(), cookie: replierCookie })
    await new Promise((res) => setTimeout(res, 1500))
    ;(await notifCount(follower.id)) === 0
      ? pass("notify: blocked actor suppressed")
      : fail("block notif", await notifCount(follower.id))
    await prisma.block.deleteMany({ where: { blockerId: follower.id } })

    // Preference off — notifyOnCategoryFollow=false suppresses
    await clearNotifs()
    await prisma.threadFollow.updateMany({ where: { userId: follower.id, threadId: thread.id }, data: { lastNotifiedAt: null } })
    await prisma.profile.update({ where: { userId: follower.id }, data: { notifyOnCategoryFollow: false } })
    await callApi("/api/forum/posts", { method: "POST", body: replyBody(), cookie: replierCookie })
    await new Promise((res) => setTimeout(res, 1500))
    ;(await notifCount(follower.id)) === 0
      ? pass("notify: preference off suppresses")
      : fail("pref notif", await notifCount(follower.id))
    await prisma.profile.update({ where: { userId: follower.id }, data: { notifyOnCategoryFollow: true } })
    // Filtered-out followers must not have their 6h window burned.
    const ffN = await prisma.threadFollow.findUnique({ where: { userId_threadId: { userId: follower.id, threadId: thread.id } } })
    ffN && ffN.lastNotifiedAt === null
      ? pass("notify: filtered follower not stamped (lastNotifiedAt stays null)")
      : fail("filtered stamp", ffN?.lastNotifiedAt)

    // ── 3b. Unread dot renders on the category list while unread ──
    const catSlug = (await prisma.category.findUnique({ where: { id: category.id }, select: { slug: true } })).slug
    const catHtml1 = await (await fetch(`${BASE}/forum/category/${catSlug}`, { headers: { cookie: followerCookie } })).text()
    catHtml1.includes('aria-label="Unread"')
      ? pass("unread: dot rendered on category list")
      : fail("unread dot render", catHtml1.length)

    // ── 3c. Distinct author — REPLY to author, excluded from follower fan-out ──
    const authorThread = await prisma.thread.create({
      data: {
        title: `__verify author ${Date.now()}`,
        slug: `__verify-a-${Date.now()}`,
        content: "verification author thread content",
        categoryId: category.id,
        authorId: author.id,
      },
    })
    threads.push(authorThread)
    const replyToAuthor = () => ({ content: `Verification reply to author ${Date.now()} — enough content.`, threadId: authorThread.id })
    r = await callApi("/api/forum/posts", { method: "POST", body: replyToAuthor(), cookie: replierCookie })
    r.status === 201 ? pass("reply to authored thread: created") : fail("author reply", { s: r.status, d: r.data })
    const replyNotif = await waitFor(() =>
      prisma.notification.count({ where: { userId: author.id, type: "REPLY", link: `/forum/thread/${authorThread.slug}` } }).then((c) => (c > 0 ? c : null)))
    replyNotif === 1 ? pass("notify: author gets REPLY") : fail("author REPLY", replyNotif)
    await new Promise((res) => setTimeout(res, 1500))
    ;(await prisma.notification.count({ where: { userId: author.id, type: "THREAD_ACTIVITY", link: `/forum/thread/${authorThread.slug}` } })) === 0
      ? pass("notify: author excluded from follower fan-out")
      : fail("author fan-out", "author got THREAD_ACTIVITY")
    // Second reply — REPLY dedupe (1h groupKey) holds
    await callApi("/api/forum/posts", { method: "POST", body: replyToAuthor(), cookie: replierCookie })
    await new Promise((res) => setTimeout(res, 1500))
    ;(await prisma.notification.count({ where: { userId: author.id, type: "REPLY", link: `/forum/thread/${authorThread.slug}` } })) === 1
      ? pass("notify: author REPLY deduped within 1h")
      : fail("REPLY dedupe", "duplicate REPLY")

    // ── 3d. Moderator paths — can follow hidden thread; hidden fan-out blocked ──
    r = await callApi(FOLLOW_URL, { method: "POST", body: { threadId: hiddenThread.id }, cookie: modCookie })
    r.status === 200 && r.data?.following === true
      ? pass("follow: moderator can follow hidden-category thread")
      : fail("mod hidden follow", { s: r.status, d: r.data })
    // Seed a member's follow on the hidden thread directly (API correctly 404s
    // members), then a mod reply must NOT fan out to them.
    await prisma.threadFollow.create({ data: { userId: follower.id, threadId: hiddenThread.id, lastSeenAt: new Date() } })
    r = await callApi("/api/forum/posts", { method: "POST", body: { content: "Moderator reply inside a hidden thread — verification.", threadId: hiddenThread.id }, cookie: modCookie })
    r.status === 201 ? pass("reply: moderator can post in hidden thread") : fail("mod hidden reply", { s: r.status, d: r.data })
    await new Promise((res) => setTimeout(res, 1500))
    ;(await prisma.notification.count({ where: { userId: follower.id, link: `/forum/thread/${hiddenThread.slug}` } })) === 0
      ? pass("notify: hidden-category reply never fans out")
      : fail("hidden fan-out", "notification leaked for hidden thread")

    // ── 3e. Thread author auto-follows on create ──
    r = await callApi("/api/forum/threads", {
      method: "POST",
      body: { title: `__verify created ${Date.now()}`, content: "verification thread created via the real API", categoryId: category.id },
      cookie: authorCookie,
    })
    const createdId = r.data?.thread?.id
    if (createdId) threads.push({ id: createdId })
    const autoFollow = createdId
      ? await prisma.threadFollow.findUnique({ where: { userId_threadId: { userId: author.id, threadId: createdId } } })
      : null
    r.status === 201 && autoFollow
      ? pass("auto-follow: thread author follows on create")
      : fail("author autofollow", { s: r.status, id: createdId })

    // ── 4. Mark-seen — viewing the thread clears unread ──
    r = await callApi(`/forum/thread/${thread.slug}`, { cookie: followerCookie })
    const ff2 = await waitFor(async () => {
      const f = await prisma.threadFollow.findUnique({ where: { userId_threadId: { userId: follower.id, threadId: thread.id } } })
      const t = await prisma.thread.findUnique({ where: { id: thread.id }, select: { lastActivityAt: true } })
      return f && !(t.lastActivityAt > f.lastSeenAt) ? f : null
    })
    r.status === 200 && ff2
      ? pass("unread: viewing thread clears unread (monotonic)")
      : fail("mark seen", { s: r.status })

    // Unrelated threads unaffected — authorThread was never followed
    const other = await prisma.threadFollow.findFirst({ where: { userId: follower.id, threadId: authorThread.id } })
    !other ? pass("unread: unrelated threads unaffected") : fail("unrelated", other.id)

    // Dot gone from the category list after viewing (thread is marked seen;
    // hiddenThread lives in a hidden category and authorThread is unfollowed).
    const catHtml2 = await (await fetch(`${BASE}/forum/category/${catSlug}`, { headers: { cookie: followerCookie } })).text()
    !catHtml2.includes('aria-label="Unread"')
      ? pass("unread: dot cleared on category list")
      : fail("unread dot cleared", "dot still rendered")

    // ── 5. First-action nudge — fresh user sees it, replier doesn't ──
    const feedRes = await fetch(`${BASE}/feed`, { headers: { cookie: freshCookie } })
    const feedHtml = await feedRes.text()
    feedHtml.includes("Join the conversation")
      ? pass("first-action: zero-post user sees reply nudge")
      : fail("nudge fresh", feedRes.status)
    const feedRes2 = await fetch(`${BASE}/feed`, { headers: { cookie: replierCookie } })
    const feedHtml2 = await feedRes2.text()
    !feedHtml2.includes("Join the conversation")
      ? pass("first-action: posting user does not see nudge")
      : fail("nudge replier", "nudge shown")

    // ── 5b. Ban purge — banning a user removes their unread notifications ──
    const preBan = await prisma.notification.count({ where: { actorId: replier.id, read: false } })
    r = await callApi("/api/moderation/actions", {
      method: "POST",
      body: { actionType: "PERMANENT_BAN", targetUserId: replier.id, reason: "verification" },
      cookie: adminCookie,
    })
    const postBan = await prisma.notification.count({ where: { actorId: replier.id, read: false } })
    r.status === 200 && preBan > 0 && postBan === 0
      ? pass("moderation: ban purges actor's unread notifications")
      : fail("ban purge", { s: r.status, preBan, postBan })

    // ── 6. Anon page smoke ──
    r = await callApi(`/forum/thread/${thread.slug}`)
    r.status === 200 ? pass("page: public thread 200 anon") : fail("anon thread page", r.status)

    console.log(`\n${results.filter(([s]) => s === "PASS").length} passed, ${results.filter(([s]) => s === "FAIL").length} failed`)
  } finally {
    for (const u of users) {
      await prisma.user.delete({ where: { id: u.id } }).catch(() => {})
    }
    for (const t of threads) {
      await prisma.thread.delete({ where: { id: t.id } }).catch(() => {})
    }
    if (hiddenCat) await prisma.category.delete({ where: { id: hiddenCat.id } }).catch(() => {})
    await prisma.rateLimit.deleteMany({
      where: { key: { in: users.map((u) => `thread-follow:${u.id}`) } },
    }).catch(() => {})
    await prisma.$disconnect()
  }
}

main()
