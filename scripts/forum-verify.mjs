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
  const category = await prisma.category.findFirst({ where: { hidden: false }, select: { id: true } })
  const hiddenCat = await prisma.category.create({
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

  try {
    const { cookie: followerCookie } = await login(follower.username, follower.password)
    const { cookie: replierCookie } = await login(replier.username, replier.password)
    const { cookie: bannedCookie } = await login(banned.username, banned.password)
    const { cookie: freshCookie } = await login(fresh.username, fresh.password)
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

    // Blocked actor — follower blocks replier → reply generates nothing
    await prisma.threadFollow.updateMany({ where: { userId: follower.id, threadId: thread.id }, data: { lastNotifiedAt: null } })
    await prisma.block.create({ data: { blockerId: follower.id, blockedId: replier.id } })
    await callApi("/api/forum/posts", { method: "POST", body: replyBody(), cookie: replierCookie })
    await new Promise((res) => setTimeout(res, 1500))
    ;(await notifCount(follower.id)) === 1
      ? pass("notify: blocked actor suppressed")
      : fail("block notif", await notifCount(follower.id))
    await prisma.block.deleteMany({ where: { blockerId: follower.id } })

    // Preference off — notifyOnCategoryFollow=false suppresses
    await prisma.threadFollow.updateMany({ where: { userId: follower.id, threadId: thread.id }, data: { lastNotifiedAt: null } })
    await prisma.profile.update({ where: { userId: follower.id }, data: { notifyOnCategoryFollow: false } })
    await callApi("/api/forum/posts", { method: "POST", body: replyBody(), cookie: replierCookie })
    await new Promise((res) => setTimeout(res, 1500))
    ;(await notifCount(follower.id)) === 1
      ? pass("notify: preference off suppresses")
      : fail("pref notif", await notifCount(follower.id))
    await prisma.profile.update({ where: { userId: follower.id }, data: { notifyOnCategoryFollow: true } })

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

    // Unrelated threads unaffected — hiddenThread never followed
    const other = await prisma.threadFollow.findFirst({ where: { userId: follower.id, threadId: hiddenThread.id } })
    !other ? pass("unread: unrelated threads unaffected") : fail("unrelated", other.id)

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

    // ── 6. Anon page smoke ──
    r = await callApi(`/forum/thread/${thread.slug}`)
    r.status === 200 ? pass("page: public thread 200 anon") : fail("anon thread page", r.status)

    console.log(`\n${results.filter(([s]) => s === "PASS").length} passed, ${results.filter(([s]) => s === "FAIL").length} failed`)
  } finally {
    for (const u of [follower, replier, banned, fresh]) {
      await prisma.user.delete({ where: { id: u.id } }).catch(() => {})
    }
    for (const t of [thread, hiddenThread, deletedThread]) {
      await prisma.thread.delete({ where: { id: t.id } }).catch(() => {})
    }
    await prisma.category.delete({ where: { id: hiddenCat.id } }).catch(() => {})
    await prisma.rateLimit.deleteMany({
      where: { key: { in: [follower, replier, banned, fresh].map((u) => `thread-follow:${u.id}`) } },
    }).catch(() => {})
    await prisma.$disconnect()
  }
}

main()
