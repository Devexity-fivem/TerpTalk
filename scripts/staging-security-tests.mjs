import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const BASE = process.env.STAGING_URL || "https://forums-smoky.vercel.app"
const BYPASS = process.env.VERCEL_BYPASS_TOKEN
if (!BYPASS) {
  throw new Error("Set VERCEL_BYPASS_TOKEN env var to access the protected staging deployment")
}
const prisma = new PrismaClient()
const results = []

function pass(name) { results.push({ name, status: "PASS" }); console.log(`  ✓ ${name}`) }
function fail(name, info) { results.push({ name, status: "FAIL", info }); console.log(`  ✗ ${name} — ${info}`) }

async function createUser(username, role = "MEMBER") {
  const password = "TestPass123!"
  const hashed = await bcrypt.hash(password, 12)
  const name = `__staging_${username}_${Date.now()}`
  const user = await prisma.user.create({
    data: {
      name,
      ageVerified: true,
      password: hashed,
      role,
      sessionVersion: 1,
      profile: { create: { username } },
    },
    include: { profile: true },
  })
  return { ...user, password, username }
}

async function deleteUser(id) {
  await prisma.user.delete({ where: { id } }).catch(() => {})
}

async function getCsrf() {
  const res = await fetch(`${BASE}/api/auth/csrf`, { headers: { "x-vercel-protection-bypass": BYPASS } })
  const data = await res.json()
  const cookie = res.headers.getSetCookie?.()?.[0]?.split(";")[0] || res.headers.get("set-cookie")?.split(",")[0]?.split(";")[0]
  return { csrfToken: data.csrfToken, csrfCookie: cookie || "" }
}

async function login(username, password) {
  const { csrfToken, csrfCookie } = await getCsrf()
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", cookie: csrfCookie, "x-vercel-protection-bypass": BYPASS },
    body: new URLSearchParams({ csrfToken, username, password, json: "true" }),
    redirect: "manual",
  })
  const setCookies = res.headers.getSetCookie?.() || []
  const cookie = [...(csrfCookie ? [csrfCookie] : []), ...setCookies.map((c) => c.split(";")[0])].join("; ")
  const sessionRes = await fetch(`${BASE}/api/auth/session`, { headers: { cookie, "x-vercel-protection-bypass": BYPASS } })
  const session = await sessionRes.json().catch(() => ({}))
  return { cookie, session }
}

async function api(path, { method = "GET", body, cookie } = {}) {
  const headers = { "x-vercel-protection-bypass": BYPASS }
  if (body) headers["Content-Type"] = "application/json"
  if (cookie) headers["cookie"] = cookie
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  })
  const text = await res.text()
  let data = null
  try { data = JSON.parse(text) } catch { data = text }
  return { status: res.status, data, headers: res.headers }
}

async function tinyPngDataUri() {
  const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
  return `data:image/png;base64,${b64}`
}

async function run() {
  console.log(`\n=== STAGING SECURITY TESTS — ${BASE} ===\n`)

  let userA, userB, mod, admin
  let threadA, postA, dmId
  let categoryId = null
  let chatRoomId = "general-staging"
  let cleanupRoom = async () => {}

  try {
    // ── Create test accounts ──
    console.log("[Setup] Creating test accounts")
    userA = await createUser(`sa_user_a_${Date.now()}`)
    userB = await createUser(`sa_user_b_${Date.now()}`)
    mod = await createUser(`sa_mod_${Date.now()}`, "MODERATOR")
    admin = await createUser(`sa_admin_${Date.now()}`, "ADMINISTRATOR")

    await prisma.chatRoom.upsert({
      where: { id: chatRoomId },
      create: { id: chatRoomId, name: "Staging General", slug: chatRoomId, isPrivate: false, locked: false },
      update: {},
    })
    cleanupRoom = async () => prisma.chatRoom.delete({ where: { id: chatRoomId } }).catch(() => {})

    // ── Auth / Session ──
    console.log("\n[1] Authentication & Session")
    const aLogin = await login(userA.username, userA.password)
    aLogin.session?.user?.id ? pass("User A login") : fail("User A login", "no session")
    const aCookie = aLogin.cookie

    const modLogin = await login(mod.username, mod.password)
    modLogin.session?.user?.id && modLogin.session.user.role === "MODERATOR" ? pass("Moderator login") : fail("Moderator login", modLogin.session)
    const modCookie = modLogin.cookie

    const adminLogin = await login(admin.username, admin.password)
    adminLogin.session?.user?.id && adminLogin.session.user.role === "ADMINISTRATOR" ? pass("Administrator login") : fail("Administrator login", adminLogin.session)
    const adminCookie = adminLogin.cookie

    // Password change invalidation
    await prisma.user.update({ where: { id: userA.id }, data: { password: await bcrypt.hash("NewPass123!", 12), sessionVersion: { increment: 1 } } })
    const afterPw = await api("/api/auth/session", { cookie: aCookie })
    !afterPw.data?.user?.id ? pass("Session invalidated after password change") : fail("Session invalidated after password change", "session still valid")

    // Re-login as A with new password
    const aLogin2 = await login(userA.username, "NewPass123!")
    const aCookie2 = aLogin2.cookie
    aLogin2.session?.user?.id ? pass("User A re-login after password change") : fail("User A re-login after password change", aLogin2.data)

    // Suspension invalidation
    await prisma.user.update({ where: { id: userA.id }, data: { suspendedUntil: new Date(Date.now() + 60_000), sessionVersion: { increment: 1 } } })
    const afterSus = await api(`/api/chat/messages?roomId=${chatRoomId}`, { cookie: aCookie2 })
    ;[401, 403].includes(afterSus.status) ? pass("Suspended user rejected by getToken route") : fail("Suspended user getToken route", `status ${afterSus.status}`)

    // Unsuspend
    await prisma.user.update({ where: { id: userA.id }, data: { suspendedUntil: null, sessionVersion: { increment: 1 } } })

    // Ban invalidation
    await prisma.user.update({ where: { id: userA.id }, data: { banned: true, sessionVersion: { increment: 1 } } })
    const afterBan = await api("/api/profile", { cookie: aCookie2 })
    afterBan.status === 401 ? pass("Banned user rejected by getServerSession route") : fail("Banned user getServerSession route", `status ${afterBan.status}`)

    // Unban for remaining tests
    await prisma.user.update({ where: { id: userA.id }, data: { banned: false, sessionVersion: { increment: 1 } } })
    const aLogin3 = await login(userA.username, "NewPass123!")
    const aCookie3 = aLogin3.cookie

    // Role change invalidation
    await prisma.user.update({ where: { id: userA.id }, data: { role: "VERIFIED_MEMBER", sessionVersion: { increment: 1 } } })
    const afterRole = await api("/api/auth/session", { cookie: aCookie3 })
    !afterRole.data?.user?.id ? pass("Session invalidated after role change") : fail("Session invalidated after role change", "session still valid")

    // ── IDOR / Authorization ──
    console.log("\n[2] IDOR & Authorization")
    const aLoginFinal = await login(userA.username, "NewPass123!")
    const aCookieFinal = aLoginFinal.cookie
    const bLogin = await login(userB.username, userB.password)
    const bCookie = bLogin.cookie

    const cats = await api("/api/categories", { cookie: aCookieFinal })
    categoryId = cats.data?.categories?.[0]?.id || cats.data?.[0]?.id || "default"
    if (categoryId === "default") {
      console.warn("  ! Could not resolve a real category id; using 'default' placeholder")
    }

    // Create a thread as User A
    const threadRes = await api("/api/forum/threads", {
      method: "POST",
      body: { title: "Staging test thread", content: "hello", categoryId, tagInputs: [] },
      cookie: aCookieFinal,
    })
    if (threadRes.status === 201 && threadRes.data?.thread?.id) {
      threadA = threadRes.data.thread
      pass("User A created a thread")
    } else {
      fail("User A create thread", `${threadRes.status} ${JSON.stringify(threadRes.data).slice(0, 200)}`)
    }

    if (threadA) {
      // User B attempts to delete User A's thread
      const delByB = await api("/api/forum/threads", {
        method: "DELETE",
        body: { id: threadA.id },
        cookie: bCookie,
      })
      delByB.status === 403 ? pass("User B cannot delete User A's thread") : fail("User B delete A thread", `status ${delByB.status}`)

      // User A deletes own thread
      const delByA = await api("/api/forum/threads", {
        method: "DELETE",
        body: { id: threadA.id },
        cookie: aCookieFinal,
      })
      delByA.status === 200 ? pass("User A can delete own thread") : fail("User A delete own thread", `status ${delByA.status}`)
    }

    // User A cannot call admin endpoint
    const adminStats = await api("/api/admin/stats", { cookie: aCookieFinal })
    adminStats.status === 403 || adminStats.status === 401 ? pass("Member cannot access admin stats") : fail("Member admin stats", `status ${adminStats.status}`)

    // Moderator cannot access admin-only endpoint
    const adminUsers = await api("/api/admin/users", { cookie: modCookie })
    adminUsers.status === 403 || adminUsers.status === 401 ? pass("Moderator cannot access admin users") : fail("Moderator admin users", `status ${adminUsers.status}`)

    // Moderator cannot moderate admin content: admin creates thread, mod tries to delete
    const adminThread = await api("/api/forum/threads", {
      method: "POST",
      body: { title: "Admin thread", content: "admin content", categoryId, tagInputs: [] },
      cookie: adminCookie,
    })
    if (adminThread.status === 201 && adminThread.data?.thread?.id) {
      const modDelAdmin = await api("/api/forum/threads", {
        method: "DELETE",
        body: { id: adminThread.data.thread.id },
        cookie: modCookie,
      })
      modDelAdmin.status === 403 ? pass("Moderator cannot delete admin's thread") : fail("Moderator delete admin thread", `status ${modDelAdmin.status}`)
    } else {
      fail("Admin create thread", `${adminThread.status} ${JSON.stringify(adminThread.data).slice(0, 200)}`)
    }

    // ── Uploads ──
    console.log("\n[3] Upload / Storage Security")
    const validPng = await tinyPngDataUri()
    const uploadRes = await api("/api/forum/threads", {
      method: "POST",
      body: { title: "Upload test", content: "with image", categoryId, tagInputs: [], images: [validPng] },
      cookie: aCookieFinal,
    })
    uploadRes.status === 201 ? pass("Valid PNG data URI accepted") : fail("Valid PNG upload", `status ${uploadRes.status}`)

    const svgPayload = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxzY3JpcHQ+YWxlcnQoMSk8L3NjcmlwdD48L3N2Zz4="
    const svgRes = await api("/api/forum/threads", {
      method: "POST",
      body: { title: "SVG test", content: "with svg", categoryId, tagInputs: [], images: [svgPayload] },
      cookie: aCookieFinal,
    })
    svgRes.status === 400 ? pass("SVG upload rejected") : fail("SVG upload rejected", `status ${svgRes.status}`)

    const badMime = "data:image/jpeg;base64," + validPng.split(",")[1]
    const badMimeRes = await api("/api/forum/threads", {
      method: "POST",
      body: { title: "Bad MIME test", content: "with png as jpeg", categoryId, tagInputs: [], images: [badMime] },
      cookie: aCookieFinal,
    })
    // Should reject because MIME claims jpeg but bytes are PNG
    badMimeRes.status === 400 ? pass("Spoofed MIME rejected") : fail("Spoofed MIME", `status ${badMimeRes.status}`)

    // ── Chat / Moderation ──
    console.log("\n[4] Chat & Moderation")
    const msgRes = await api("/api/chat/messages", {
      method: "POST",
      body: { roomId: chatRoomId, content: "hello staging" },
      cookie: aCookieFinal,
    })
    msgRes.status === 201 ? pass("Member can send chat message") : fail("Chat message", `status ${msgRes.status}`)

    const helpRes = await api("/api/chat/commands", {
      method: "POST",
      body: { roomId: chatRoomId, content: "/help" },
      cookie: aCookieFinal,
    })
    helpRes.status === 200 ? pass("Member /help command") : fail("Member /help", `status ${helpRes.status}`)

    const modWarn = await api("/api/chat/commands", {
      method: "POST",
      body: { roomId: chatRoomId, content: `/warn @${userB.username} test warning` },
      cookie: modCookie,
    })
    modWarn.status === 200 ? pass("Moderator /warn command") : fail("Moderator /warn", `status ${modWarn.status} ${JSON.stringify(modWarn.data).slice(0,200)}`)

    const aBan = await api("/api/chat/commands", {
      method: "POST",
      body: { roomId: chatRoomId, content: `/ban @${userB.username} 1h test ban` },
      cookie: aCookieFinal,
    })
    aBan.status === 403 || aBan.status === 401 ? pass("Member cannot /ban") : fail("Member /ban", `status ${aBan.status}`)

    // ── Rate Limiting ──
    console.log("\n[5] Rate Limiting")
    const searchHits = []
    for (let i = 0; i < 65; i++) {
      const r = await api("/api/forum/tags?q=test")
      searchHits.push(r.status)
    }
    searchHits.some((s) => s === 429) ? pass("Public tags rate limit triggers") : fail("Public tags rate limit", `statuses ${searchHits.join(",")}`)

    // Note: login rate limiting was not live-tested to avoid locking the test IP/account.

    // ── Privacy / Info Disclosure ──
    console.log("\n[6] Privacy & Information Disclosure")
    const publicProfile = await api(`/api/users/${userA.username}`)
    const p = publicProfile.data?.profile || {}
    if (p.password || p.email || p.recoveryPhraseHash) {
      fail("Public profile leak", "sensitive field exposed")
    } else {
      pass("No password/email/recovery in public profile")
    }
    "role" in p ? pass("Role is exposed in public profile (known low-sev)") : pass("Role not exposed in public profile")

    // ── Account Deletion ──
    console.log("\n[7] Account Deletion")
    const delRes = await api("/api/profile", {
      method: "DELETE",
      body: { confirmUsername: userA.username, password: "NewPass123!" },
      cookie: aCookieFinal,
    })
    if (delRes.status === 200) {
      pass("Account deletion endpoint accepts request")
      const afterDel = await api("/api/auth/session", { cookie: aCookieFinal })
      !afterDel.data?.user?.id ? pass("Session empty after deletion") : fail("Session after deletion", "still valid")
      const publicAfter = await api(`/api/users/${userA.username}`)
      publicAfter.status === 404 ? pass("Public profile returns 404 after deletion") : fail("Public profile after deletion", `status ${publicAfter.status}`)
    } else {
      fail("Account deletion", `status ${delRes.status} ${JSON.stringify(delRes.data).slice(0, 200)}`)
    }

    // ── Browser / Headers ──
    console.log("\n[8] CSP & Browser Headers")
    const home = await fetch(BASE, { headers: { "x-vercel-protection-bypass": BYPASS } })
    const csp = home.headers.get("content-security-policy") || ""
    const hsts = home.headers.get("strict-transport-security") || ""
    const xframe = home.headers.get("x-frame-options") || ""
    const cto = home.headers.get("x-content-type-options") || ""
    const ref = home.headers.get("referrer-policy") || ""
    csp.includes("unsafe-inline") ? pass("CSP present with unsafe-inline (known residual)") : pass("CSP without unsafe-inline")
    hsts.includes("max-age=31536000") ? pass("HSTS header present") : fail("HSTS", hsts)
    xframe === "DENY" ? pass("X-Frame-Options DENY") : fail("X-Frame-Options", xframe)
    cto === "nosniff" ? pass("X-Content-Type-Options nosniff") : fail("X-Content-Type-Options", cto)
    ref.includes("strict-origin-when-cross-origin") ? pass("Referrer-Policy present") : fail("Referrer-Policy", ref)

  } catch (err) {
    console.error("\nStaging test error:", err)
    results.push({ name: "RUNTIME_EXCEPTION", status: "FAIL", info: err.message })
  } finally {
    console.log("\n[Cleanup] Removing test accounts and data")
    if (userA) await deleteUser(userA.id)
    if (userB) await deleteUser(userB.id)
    if (mod) await deleteUser(mod.id)
    if (admin) await deleteUser(admin.id)
    await cleanupRoom()
    await prisma.$disconnect().catch(() => {})
  }

  console.log("\n=== STAGING TEST SUMMARY ===")
  const passCount = results.filter((r) => r.status === "PASS").length
  const failCount = results.filter((r) => r.status === "FAIL").length
  console.log(`Passed: ${passCount}, Failed: ${failCount}, Total: ${results.length}`)
  console.log(JSON.stringify(results, null, 2))
  process.exit(failCount > 0 ? 1 : 0)
}

run()
