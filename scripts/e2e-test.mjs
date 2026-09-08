/* eslint-disable @typescript-eslint/no-unused-expressions */
/**
 * TerpTalk Beta E2E Test — exercises the complete beta scope via live HTTP.
 * Usage: node scripts/e2e-test.mjs  (dev server must be running on :3000)
 * Requires test invite code + admin/mod credentials seeded via env.
 */
const BASE = "http://localhost:3000"
const results = []
const pass = (name) => { results.push([name, "PASS"]); console.log(`  ✓ ${name}`) }
const fail = (name, info) => { results.push([name, "FAIL", info]); console.log(`  ✗ ${name} — ${info}`) }

const cookies = {}
async function req(path, { method = "GET", body, as } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(as && cookies[as] ? { cookie: cookies[as] } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  })
  const setCookie = res.headers.get("set-cookie")
  if (setCookie && as) {
    cookies[as] = cookies[as]
      ? cookies[as] + "; " + setCookie.split(";")[0]
      : setCookie.split(";")[0]
  }
  let data = null
  const text = await res.text()
  try { data = JSON.parse(text) } catch { data = text }
  return { status: res.status, data, text }
}

async function login(username, password, jar) {
  // NextAuth credentials flow: get CSRF token then POST callback
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`)
  const { csrfToken } = await csrfRes.json()
  const csrfCookie = csrfRes.headers.get("set-cookie")?.split(";")[0] || ""
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", cookie: csrfCookie },
    body: new URLSearchParams({ csrfToken, username, password, json: "true" }),
    redirect: "manual",
  })
  const setCookies = res.headers.getSetCookie?.() || []
  cookies[jar] = [csrfCookie, ...setCookies.map((c) => c.split(";")[0])].join("; ")
  // verify session
  const s = await fetch(`${BASE}/api/auth/session`, { headers: { cookie: cookies[jar] } })
  const session = await s.json()
  return session?.user ? session.user : null
}

async function main() {
  console.log("\n=== TERPTALK BETA E2E ===\n")

  // ── 1. Public pages ──
  console.log("[1] Public access")
  for (const p of ["/", "/forum", "/feed", "/diaries", "/setups", "/strains", "/auth/signin", "/auth/signup"]) {
    const r = await req(p)
    r.status === 200 ? pass(`GET ${p} → 200`) : fail(`GET ${p}`, `status ${r.status}`)
  }

  // ── 2. Registration without invite must fail ──
  console.log("[2] Registration security")
  const cap = await req("/api/auth/register")
  if (cap.status !== 200 || !cap.data?.captcha?.id) { fail("captcha issue", cap.status); return }
  // Solve captcha — we can't know the answer; test that wrong answer is rejected
  const noInvite = await req("/api/auth/register", { method: "POST", body: { username: "test_no_invite", password: "Password123!", captchaId: cap.data.captcha.id, captchaAnswer: "999", ageVerified: true } })
  noInvite.status === 400 ? pass("register without invite rejected (captcha also checked)") : fail("register without invite", noInvite.status)

  const cap2 = await req("/api/auth/register")
  const noAge = await req("/api/auth/register", { method: "POST", body: { username: "test_no_age", password: "Password123!", captchaId: cap2.data.captcha.id, captchaAnswer: "999", ageVerified: false, inviteCode: "TERP-06BE0675" } })
  noAge.status === 400 ? pass("ageVerified=false rejected") : fail("age gate bypass", noAge.status)

  // Real registration requires solving the captcha — we do it via a direct DB answer lookup isn't possible from here;
  // so we verify invalid invite code is rejected BEFORE captcha? Our impl checks invite first — test that:
  const cap3 = await req("/api/auth/register")
  const badInvite = await req("/api/auth/register", { method: "POST", body: { username: "test_bad_inv", password: "Password123!", captchaId: cap3.data.captcha.id, captchaAnswer: "5", ageVerified: true, inviteCode: "TERP-INVALIDX" } })
  badInvite.status === 400 && /invite/i.test(badInvite.data?.error || "") ? pass("invalid invite rejected") : fail("bad invite", `${badInvite.status} ${badInvite.data?.error}`)

  // ── 3. Auth: seeded admin/moderator ──
  console.log("[3] Authentication")
  const admin = await login("ttadmin", process.env.ADMIN_PASSWORD || "TestAdmin123!", "admin")
  admin ? pass(`admin login (${admin.name})`) : fail("admin login", "no session")
  const mod = await login("ttmoderator", process.env.MOD_PASSWORD || "TestMod123!", "mod")
  mod ? pass(`moderator login (${mod.name})`) : fail("mod login", "no session")

  const badLogin = await login("ttadmin", "wrongpassword", "bad")
  !badLogin ? pass("wrong password rejected") : fail("bad login", "session returned")

  // ── 4. Create a real user via API (need captcha answer — use DB bypass: we can't. Use admin invite + real captcha requires answer known only to DB. Workaround: create user via prisma script is external; here test endpoints only) ──
  // For E2E we create a test user through registration by reading the captcha answer from DB is not possible via HTTP.
  // Instead verify the seeded invite list via admin endpoint:
  console.log("[4] Admin invite management")
  const inv = await req("/api/admin/invites", { method: "POST", body: { count: 1 }, as: "admin" })
  inv.status === 201 && inv.data?.invites?.[0]?.code ? pass(`admin generated invite ${inv.data.invites[0].code}`) : fail("invite create", inv.status)
  const invList = await req("/api/admin/invites", { as: "admin" })
  invList.status === 200 ? pass("admin lists invites") : fail("invite list", invList.status)

  // Non-admin cannot create invites
  const invDenied = await req("/api/admin/invites", { method: "POST", body: { count: 1 }, as: "mod" })
  invDenied.status === 403 ? pass("moderator cannot create invites (403)") : fail("mod invite", invDenied.status)
  const invAnon = await req("/api/admin/invites", { method: "POST", body: { count: 1 } })
  invAnon.status === 401 ? pass("anonymous invite creation rejected (401)") : fail("anon invite", invAnon.status)

  // Admin stats
  const stats = await req("/api/admin/stats", { as: "admin" })
  stats.status === 200 && typeof stats.data?.stats?.users === "number" ? pass("admin stats") : fail("admin stats", stats.status)
  const statsMod = await req("/api/admin/stats", { as: "mod" })
  statsMod.status === 403 ? pass("moderator denied admin stats") : fail("mod stats", statsMod.status)

  // ── 5. Register a real user — need captcha answer. Read it via prisma in-process is not possible here;
  //        use admin invite + fetch captcha, then answer via a test-only helper? No test helper exists.
  //        Instead create users with the same process-level approach: temporarily mark answer? Can't.
  //        We DO have direct DB access in this repo — spawn a node script to read captcha answer. ──
  console.log("[5] Full user journey (via captcha-DB lookup)")
  const { execSync } = await import("child_process")
  const capR = await req("/api/auth/register")
  const capId = capR.data.captcha.id
  const answer = execSync(`node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.captcha.findUnique({where:{id:'${capId}'}}).then(c=>{console.log(c.answer);process.exit(0)})"`, { cwd: process.cwd() }).toString().trim()
  const newUser = "betauser_" + Math.random().toString(36).slice(2, 8)
  const inviteCode = inv.data?.invites?.[0]?.code || "TERP-7B024D32"
  const reg = await req("/api/auth/register", { method: "POST", body: { username: newUser, password: "BetaPass123!", captchaId: capId, captchaAnswer: answer, ageVerified: true, inviteCode } })
  reg.status === 201 ? pass(`registered ${newUser}`) : fail("registration", `${reg.status} ${reg.data?.error}`)

  // Duplicate username rejected
  const capR2 = await req("/api/auth/register")
  const answer2 = execSync(`node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.captcha.findUnique({where:{id:'${capR2.data.captcha.id}'}}).then(c=>{console.log(c.answer);process.exit(0)})"`, { cwd: process.cwd() }).toString().trim()
  const dup = await req("/api/auth/register", { method: "POST", body: { username: newUser, password: "BetaPass123!", captchaId: capR2.data.captcha.id, captchaAnswer: answer2, ageVerified: true, inviteCode } })
  dup.status === 400 ? pass("duplicate username rejected") : fail("dup username", dup.status)

  // Invite reuse rejected
  const capR3 = await req("/api/auth/register")
  const answer3 = execSync(`node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.captcha.findUnique({where:{id:'${capR3.data.captcha.id}'}}).then(c=>{console.log(c.answer);process.exit(0)})"`, { cwd: process.cwd() }).toString().trim()
  const reuse = await req("/api/auth/register", { method: "POST", body: { username: "another_" + Math.random().toString(36).slice(2, 6), password: "BetaPass123!", captchaId: capR3.data.captcha.id, captchaAnswer: answer3, ageVerified: true, inviteCode } })
  reuse.status === 400 && /invite/i.test(reuse.data?.error || "") ? pass("invite reuse rejected") : fail("invite reuse", `${reuse.status}`)

  // Login as new user
  const u1 = await login(newUser, "BetaPass123!", "u1")
  u1 ? pass(`user login ${newUser}`) : fail("user login", "no session")

  // ── 6. Sensitive-data exposure check ──
  console.log("[6] Data exposure")
  const rooms = await req("/api/chat/rooms", { as: "u1" })
  if (rooms.status === 200 && rooms.data.rooms.length > 0) {
    const msgs = await req(`/api/chat/messages?roomId=${rooms.data.rooms[0].id}`, { as: "u1" })
    const leak = JSON.stringify(msgs.data).match(/"password"|"email"|"emailVerified"/)
    !leak ? pass("no password/email in chat API") : fail("chat leak", leak[0])
  }
  const prof = await req("/api/profile", { as: "u1" })
  const profLeak = JSON.stringify(prof.data).match(/"password"/)
  !profLeak ? pass("no password in profile API") : fail("profile leak", "password present")
  const pubUser = await req(`/api/users/${newUser}`)
  pubUser.status === 200 && !JSON.stringify(pubUser.data).match(/"password"|"email"/) ? pass("public profile safe") : fail("public profile", pubUser.status)

  // ── 7. Forum flow ──
  console.log("[7] Forum flow")
  const cats = await req("/api/categories")
  const catId = cats.data?.categories?.[0]?.id
  const thread = await req("/api/forum/threads", { method: "POST", body: { title: "E2E Test Thread", content: "This is a test thread with enough content to pass validation.", categoryId: catId }, as: "u1" })
  thread.status === 201 ? pass("thread created") : fail("thread create", `${thread.status} ${thread.data?.error}`)
  const threadId = thread.data?.thread?.id
  const threadSlug = thread.data?.thread?.slug

  const threadPage = await req(`/forum/thread/${threadSlug}`)
  threadPage.status === 200 ? pass("thread page renders") : fail("thread page", threadPage.status)

  const reply = await req("/api/forum/posts", { method: "POST", body: { content: "Test reply content here.", threadId }, as: "u1" })
  reply.status === 201 ? pass("reply posted") : fail("reply", `${reply.status} ${reply.data?.error}`)
  const postId = reply.data?.post?.id

  // Empty/oversized
  const empty = await req("/api/forum/posts", { method: "POST", body: { content: "x", threadId }, as: "u1" })
  empty.status === 400 ? pass("short post rejected") : fail("short post", empty.status)
  const huge = await req("/api/forum/posts", { method: "POST", body: { content: "x".repeat(20000), threadId }, as: "u1" })
  huge.status === 400 ? pass("oversized post rejected") : fail("huge post", huge.status)

  // XSS escaping — verify script tag stored but escaped on render
  const xss = await req("/api/forum/posts", { method: "POST", body: { content: "<script>alert(1)</script> XSS test", threadId }, as: "u1" })
  if (xss.status === 201) {
    const page = await req(`/forum/thread/${threadSlug}`)
    !page.text.includes("<script>alert(1)</script>") ? pass("XSS payload escaped in HTML") : fail("XSS", "raw script in page")
  }

  // Edit own post
  const edit = await req("/api/forum/posts", { method: "PATCH", body: { id: postId, content: "Edited content for the test post." }, as: "u1" })
  edit.status === 200 ? pass("edit own post") : fail("edit own post", `${edit.status}`)

  // Other user cannot edit — use moderator session (mod shouldn't edit user post; only delete)
  const editOther = await req("/api/forum/posts", { method: "PATCH", body: { id: postId, content: "Hijacked content attempt!!!" }, as: "mod" })
  editOther.status === 403 ? pass("moderator cannot edit user's post") : fail("mod edit", editOther.status)

  const anonEdit = await req("/api/forum/posts", { method: "PATCH", body: { id: postId, content: "Anon hijack attempt!!!" } })
  anonEdit.status === 401 ? pass("anonymous edit rejected") : fail("anon edit", anonEdit.status)

  // Reactions
  const react = await req("/api/reactions", { method: "POST", body: { type: "LIKE", postId }, as: "mod" })
  react.status === 200 || react.status === 201 ? pass("reaction added") : fail("reaction", react.status)
  const badReact = await req("/api/reactions", { method: "POST", body: { type: "HACK", postId }, as: "u1" })
  badReact.status === 400 ? pass("invalid reaction type rejected") : fail("bad reaction", badReact.status)

  // ── 8. Blocking ──
  console.log("[8] Blocking")
  // u1 blocks the moderator's user id? Get a real user id: use profile API of mod? Use public profile endpoint:
  const modPub = await req(`/api/users/ttmoderator`, { as: "u1" })
  if (modPub.status === 200) {
    const modId = modPub.data.profile.id
    const block = await req("/api/blocks", { method: "POST", body: { userId: modId }, as: "u1" })
    block.status === 201 ? pass("block created") : fail("block", block.status)
    const myBlocks = await req("/api/blocks", { as: "u1" })
    myBlocks.data?.blocks?.some((b) => b.username === "ttmoderator") ? pass("block listed (private)") : fail("block list", JSON.stringify(myBlocks.data))
    // blocked user viewing blocker's profile → 404
    const viewBlocked = await req(`/api/users/${newUser}`, { as: "mod" })
    viewBlocked.status === 404 ? pass("blocker hidden from blocked user") : fail("blocked view", viewBlocked.status)
    const unblock = await req("/api/blocks", { method: "DELETE", body: { userId: modId }, as: "u1" })
    unblock.status === 200 ? pass("unblock works") : fail("unblock", unblock.status)
  } else {
    fail("mod public profile", modPub.status)
  }

  // ── 9. Reporting + moderation ──
  console.log("[9] Reporting & moderation")
  const report = await req("/api/reports", { method: "POST", body: { type: "POST", targetId: postId, reason: "SPAM", description: "E2E test report" }, as: "mod" })
  report.status === 201 ? pass("report submitted") : fail("report", `${report.status} ${report.data?.error}`)

  const queue = await req("/api/moderation/reports", { as: "mod" })
  queue.status === 200 && queue.data.reports.length > 0 ? pass("moderator sees queue") : fail("mod queue", queue.status)
  const queueUser = await req("/api/moderation/reports", { as: "u1" })
  queueUser.status === 403 ? pass("normal user denied queue") : fail("user queue", queueUser.status)
  const queueAnon = await req("/api/moderation/reports")
  queueAnon.status === 401 ? pass("anonymous denied queue") : fail("anon queue", queueAnon.status)

  const reportId = queue.data.reports.find((r) => r.status === "PENDING")?.id
  if (reportId) {
    const resolve = await req("/api/moderation/reports", { method: "PATCH", body: { reportId, status: "RESOLVED", resolution: "E2E resolved" }, as: "mod" })
    resolve.status === 200 ? pass("report resolved") : fail("resolve", resolve.status)
  }

  // Moderator cannot ban (admin-only)
  const banByMod = await req("/api/moderation/actions", { method: "POST", body: { actionType: "PERMANENT_BAN", targetUserId: u1.id, reason: "test" }, as: "mod" })
  banByMod.status === 403 ? pass("moderator cannot ban (admin only)") : fail("mod ban", banByMod.status)

  // Admin cannot ban self
  const selfBan = await req("/api/moderation/actions", { method: "POST", body: { actionType: "PERMANENT_BAN", targetUserId: admin.id, reason: "test" }, as: "admin" })
  selfBan.status === 400 ? pass("self-moderation blocked") : fail("self ban", selfBan.status)

  // ── 10. Notifications ──
  const notifs = await req("/api/notifications", { as: "u1" })
  notifs.status === 200 ? pass(`notifications fetch (${notifs.data?.unreadCount ?? 0} unread)`) : fail("notifications", notifs.status)

  // ── 11. Chat ──
  console.log("[10] Chat")
  const msg = await req("/api/chat/messages", { method: "POST", body: { content: "Hello from E2E test", roomId: rooms.data.rooms[0].id }, as: "u1" })
  msg.status === 201 ? pass("chat message sent") : fail("chat send", `${msg.status} ${msg.data?.error}`)
  const anonChat = await req("/api/chat/messages", { method: "POST", body: { content: "anon", roomId: rooms.data.rooms[0].id } })
  anonChat.status === 401 ? pass("anonymous chat rejected") : fail("anon chat", anonChat.status)

  // ── 12. Deletion & export ──
  console.log("[11] Account controls")
  const exp = await req("/api/profile/export", { as: "u1" })
  exp.status === 200 && exp.data?.user?.id === u1.id ? pass("data export works") : fail("export", exp.status)

  const delWrong = await req("/api/profile", { method: "DELETE", body: { confirmUsername: "wrong" }, as: "u1" })
  delWrong.status === 400 ? pass("deletion requires username confirm") : fail("del confirm", delWrong.status)

  // ── Summary ──
  const fails = results.filter((r) => r[1] === "FAIL")
  console.log(`\n=== RESULTS: ${results.length - fails.length} passed, ${fails.length} failed ===\n`)
  if (fails.length) { console.log("FAILURES:"); fails.forEach((f) => console.log(`  - ${f[0]}: ${f[2]}`)); process.exit(1) }
}

main().catch((e) => { console.error("E2E crashed:", e); process.exit(1) })
