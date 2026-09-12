// Phase 2 authenticated verification — temp users, localhost, full cleanup.
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const BASE = process.env.VERIFY_URL || "http://localhost:3000"
const prisma = new PrismaClient()
const results = []
function pass(n) { results.push(["PASS", n]); console.log(`  ✓ ${n}`) }
function fail(n, i) { results.push(["FAIL", n]); console.log(`  ✗ ${n} — ${JSON.stringify(i)?.slice(0, 300)}`) }

async function createUser(username) {
  const password = "VerifyPass123!"
  const user = await prisma.user.create({
    data: {
      name: `__verify_${username}_${Date.now()}`,
      ageVerified: true,
      password: await bcrypt.hash(password, 12),
      sessionVersion: 1,
      profile: { create: { username: `__v_${username}_${Date.now().toString(36)}` } },
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
  const session = await (await fetch(`${BASE}/api/auth/session`, { headers: { cookie: cookies } })).json().catch(() => ({}))
  return { cookie: cookies, session }
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

const main = async () => {
  const userA = await createUser("newbie")
  const userB = await createUser("veteran") // follow target
  const userC = await createUser("resume") // mid-flow resume user
  const userD = await createUser("coldstart") // zero follows — feed fallback

  try {
    // give B an avatar+bio so it's eligible for the suggestion pool
    await prisma.profile.update({ where: { userId: userB.id }, data: { bio: "verification target", reputation: 5 } })

    const { cookie, session } = await login(userA.username, userA.password)
    session?.user?.id ? pass("login works") : fail("login works", session)

    // 1. Pending user reaches /welcome
    let r = await callApi("/welcome", { cookie })
    r.status === 200 ? pass("pending user: GET /welcome 200") : fail("pending user: GET /welcome 200", r.status)

    // 2. Suggestions — twice, second hits unstable_cache (Date serialization check)
    r = await callApi("/api/onboarding/suggestions", { cookie })
    const s1 = r.status
    r = await callApi("/api/onboarding/suggestions", { cookie })
    const s2 = r.status
    s1 === 200 && s2 === 200 ? pass("suggestions 200 on cold + warm cache") : fail("suggestions cache", { s1, s2, d: r.data })
    if (Array.isArray(r.data?.users)) {
      !r.data.users.some((u) => u.id === userA.id) ? pass("suggestions exclude self") : fail("suggestions exclude self", "self present")
      !r.data.users.some((u) => u.username === "terpbot" || u.name === "terpbot") ? pass("suggestions exclude terpbot") : fail("suggestions exclude terpbot", "bot present")
    }

    // 3. Interests — valid + fake + hidden rejected
    const cats = await prisma.category.findMany({ select: { id: true, hidden: true } })
    const validCat = cats.find((c) => !c.hidden)
    const hiddenCat = cats.find((c) => c.hidden)
    r = await callApi("/api/onboarding/interests", { method: "POST", body: { categoryIds: [validCat.id, "fake-id-123", ...(hiddenCat ? [hiddenCat.id] : [])] }, cookie })
    const cf = await prisma.categoryFollow.findMany({ where: { userId: userA.id } })
    r.status === 200 && cf.length === 1 && cf[0].categoryId === validCat.id
      ? pass("interests: valid saved, fake/hidden rejected")
      : fail("interests", { status: r.status, follows: cf.length })

    // 3b. Sync — deselecting un-follows
    r = await callApi("/api/onboarding/interests", { method: "POST", body: { categoryIds: [] }, cookie })
    const cf2 = await prisma.categoryFollow.findMany({ where: { userId: userA.id } })
    r.status === 200 && cf2.length === 0 ? pass("interests sync: deselect un-follows") : fail("interests sync", { status: r.status, follows: cf2.length })

    // 4. Profile save (stepper-style, no flag) must NOT mark onboarding complete
    r = await callApi("/api/profile/complete", { method: "POST", body: { bio: "verifying onboarding" }, cookie })
    const afterProfile = await prisma.user.findUnique({ where: { id: userA.id }, select: { onboardingCompletedAt: true } })
    r.status === 200 && afterProfile?.onboardingCompletedAt === null
      ? pass("stepper profile save leaves onboardingCompletedAt null")
      : fail("profile save flag", { status: r.status, flag: afterProfile?.onboardingCompletedAt })

    // 5. Recovery — first-time generation keeps session alive
    r = await callApi("/api/profile/recovery", { method: "POST", body: { password: userA.password }, cookie })
    const phrase = r.data?.phrase
    const phraseOk = typeof phrase === "string" && phrase.trim().split(/\s+/).length === 12
    const sessionAfter = await (await fetch(`${BASE}/api/auth/session`, { headers: { cookie } })).json()
    r.status === 200 && phraseOk ? pass("recovery: 12-word phrase returned once") : fail("recovery phrase", { status: r.status, ok: phraseOk })
    sessionAfter?.user?.id ? pass("recovery: session survives first generation") : fail("session killed", sessionAfter)
    const hash = await prisma.user.findUnique({ where: { id: userA.id }, select: { recoveryPhraseHash: true } })
    hash?.recoveryPhraseHash && !hash.recoveryPhraseHash.includes(phrase) ? pass("recovery: phrase stored as hash only") : fail("phrase hash", hash)

    // 6. Batch follow — creates Follow + notification, dedupes on retry
    r = await callApi("/api/onboarding/follow", { method: "POST", body: { userIds: [userB.id, userA.id, "nonexistent-id"] }, cookie })
    const follows1 = await prisma.follow.count({ where: { followerId: userA.id, followingId: userB.id } })
    r.status === 200 && follows1 === 1 ? pass("follow: valid target followed, self/fake dropped") : fail("follow", { status: r.status, follows1 })
    const notifs1 = await prisma.notification.count({ where: { userId: userB.id, type: "FOLLOW", groupKey: `FOLLOW:${userA.id}:${userB.id}` } })
    notifs1 === 1 ? pass("follow: one FOLLOW notification") : fail("follow notif", notifs1)
    await callApi("/api/onboarding/follow", { method: "POST", body: { userIds: [userB.id] }, cookie })
    const notifs2 = await prisma.notification.count({ where: { userId: userB.id, type: "FOLLOW", groupKey: `FOLLOW:${userA.id}:${userB.id}` } })
    notifs2 === 1 ? pass("follow retry: no duplicate notification (dedupeMs)") : fail("dedupe", notifs2)

    // 7. Resume — user C mid-flow (has interests only) still gets /welcome
    await prisma.categoryFollow.create({ data: { userId: userC.id, categoryId: validCat.id } })
    const loginC = await login(userC.username, userC.password)
    r = await callApi("/welcome", { cookie: loginC.cookie })
    r.status === 200 ? pass("resume: mid-flow user still reaches /welcome") : fail("resume", r.status)

    // 8. Completion sets flag; /welcome then redirects away
    r = await callApi("/api/onboarding/complete", { method: "POST", cookie })
    const done = await prisma.user.findUnique({ where: { id: userA.id }, select: { onboardingCompletedAt: true } })
    r.status === 200 && done?.onboardingCompletedAt ? pass("complete: onboardingCompletedAt set") : fail("complete", r.status)
    r = await callApi("/welcome", { cookie })
    ;(r.status === 307 || r.status === 308) ? pass("completed user: /welcome redirects away") : fail("welcome redirect", r.status)

    // 9. Callback security — evil callback rejected
    r = await callApi("/welcome?callbackUrl=" + encodeURIComponent("https://evil.example"), { cookie })
    const loc = r.location ?? ""
    !loc.includes("evil.example") ? pass("callback: external URL rejected") : fail("callback external", loc)
    r = await callApi("/welcome?callbackUrl=" + encodeURIComponent("//evil.example"), { cookie })
    !(r.location ?? "").includes("evil") ? pass("callback: protocol-relative rejected") : fail("callback proto-rel", r.location)

    // 10. Feed — completed user with follows gets 200 + content
    r = await callApi("/feed?tab=for-you", { cookie })
    r.status === 200 ? pass("feed: for-you 200") : fail("feed", r.status)

    // 10b. Cold-start — zero-follow user gets public content, not an empty state
    const loginD = await login(userD.username, userD.password)
    const feedRes = await fetch(`${BASE}/feed?tab=for-you`, { headers: { cookie: loginD.cookie } })
    const feedHtml = await feedRes.text()
    const hasContent = feedHtml.includes("/forum/") || feedHtml.includes("/diaries/") || feedHtml.includes("/t/")
    feedRes.status === 200 && hasContent
      ? pass("cold-start: zero-follow for-you shows content")
      : fail("cold-start feed", { status: feedRes.status, hasContent })

    // 11. Unauthenticated API access (suggestions is GET, the rest are POST)
    r = await callApi("/api/onboarding/suggestions")
    r.status === 401 ? pass("anon: /api/onboarding/suggestions 401") : fail("anon suggestions", r.status)
    for (const p of ["/api/onboarding/interests", "/api/onboarding/follow", "/api/onboarding/complete"]) {
      r = await callApi(p, { method: "POST", body: {} })
      r.status === 401 ? pass(`anon: ${p} 401`) : fail(`anon ${p}`, r.status)
    }

    console.log(`\n${results.filter(([s]) => s === "PASS").length} passed, ${results.filter(([s]) => s === "FAIL").length} failed`)
  } finally {
    for (const u of [userA, userB, userC, userD]) {
      await prisma.user.delete({ where: { id: u.id } }).catch(() => {})
    }
    await prisma.$disconnect()
  }
}

main()
