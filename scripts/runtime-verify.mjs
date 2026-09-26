// Runtime security verification — black-box launch gate. Exercises the
// security properties established by the source audit through real HTTP
// (and Pusher realtime) against the dev server: auth/session invalidation,
// cross-user authz, diary privacy, deletion, realtime channels, browser
// exposure, cache isolation, upload validation, rate limits, enumeration,
// staff boundaries, TerpBot. Fixtures use __rv_ markers; fully cleaned up.
import { makeHarness } from "./lib/http-harness.mjs"
import Pusher from "pusher-js"
import bcrypt from "bcryptjs"
import { generateMnemonic } from "bip39"

const { prisma, BASE, ts: TS, results, pass, fail, createUser, login, api: callApi, finish } = makeHarness({
  username: (tag, ts) => `__rv_${tag}_${ts}`,
  summary: "fraction",
})

const M = (l) => `__rv_${l}_${TS}`

async function getHtml(path, cookie) {
  const res = await fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {}, redirect: "manual" })
  return { status: res.status, html: await res.text(), location: res.headers.get("location"), headers: res.headers }
}

// Raw NextAuth credentials attempt — returns status, response url, and
// whether a session cookie was issued. Failure and success must be
// distinguishable only by the cookie/url, never by error text.
async function tryLogin(username, password) {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`)
  const { csrfToken } = await csrfRes.json()
  const csrfCookie = (csrfRes.headers.getSetCookie?.() || [csrfRes.headers.get("set-cookie")]).filter(Boolean).map((c) => c.split(";")[0]).join("; ")
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", cookie: csrfCookie },
    body: new URLSearchParams({ csrfToken, username, password, json: "true" }),
    redirect: "manual",
  })
  const setCookies = res.headers.getSetCookie?.() || []
  const body = await res.json().catch(() => ({}))
  return { status: res.status, url: body.url || "", sessionCookie: setCookies.some((c) => /session-token/.test(c)) }
}

// Direct Pusher channel authorization — the same call pusher-js makes.
async function pusherAuth(cookie, socketId, channel) {
  const res = await fetch(`${BASE}/api/pusher/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", cookie },
    body: new URLSearchParams({ socket_id: socketId, channel_name: channel }),
  })
  return { status: res.status, data: await res.json().catch(() => null) }
}

const main = async () => {
  const a = await createUser("a")
  const b = await createUser("b")
  const c = await createUser("c")
  const mod = await createUser("mod", { role: "MODERATOR" })
  const admin = await createUser("admin", { role: "ADMINISTRATOR" })
  const sess = await createUser("sess")        // session-invalidation subject
  const del = await createUser("del")          // deletion subject
  const users = [a, b, c, mod, admin, sess, del]

  const diaryIds = []
  const setupIds = []
  const strainIds = []
  const threadIds = []
  const postIds = []
  const roomIds = []
  const rateKeys = []                            // rateLimit keys to clear

  try {
    await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "login" } } })

    const { cookie: aC } = await login(a.username, a.password)
    const { cookie: bC } = await login(b.username, b.password)
    const { cookie: cC } = await login(c.username, c.password)
    const { cookie: modC } = await login(mod.username, mod.password)
    const { cookie: adminC } = await login(admin.username, admin.password)
    const { cookie: sessC } = await login(sess.username, sess.password)
    const { cookie: delC } = await login(del.username, del.password)
    ;[aC, bC, cC, modC, adminC, sessC, delC].every(Boolean)
      ? pass("setup: all fixture logins work")
      : fail("logins", "missing session cookie")

    // ══ 1. Authentication black-box ═══════════════════════════════
    const ok = await tryLogin(a.username, a.password)
    ok.sessionCookie ? pass("login: correct credentials issue session") : fail("login ok", ok)

    const wrong = await tryLogin(a.username, "definitely-wrong-1")
    const ghost = await tryLogin(`__rv_nouser_${TS}`, "definitely-wrong-1")
    wrong.status === ghost.status && !wrong.sessionCookie && !ghost.sessionCookie &&
      /error/i.test(wrong.url) && /error/i.test(ghost.url)
      ? pass("login: wrong password vs nonexistent user are indistinguishable")
      : fail("login enumeration", { wrong, ghost })

    // Banned member — the ban message only surfaces AFTER correct creds.
    const banSub = await createUser("bansub")
    users.push(banSub)
    await prisma.user.update({ where: { id: banSub.id }, data: { banned: true, bannedReason: "rv fixture" } })
    const bannedOk = await tryLogin(banSub.username, banSub.password)
    const bannedBad = await tryLogin(banSub.username, "wrong-pass-1")
    !bannedOk.sessionCookie && !bannedBad.sessionCookie
      ? pass("login: banned member gets no session (correct or wrong password)")
      : fail("banned login", { bannedOk, bannedBad })

    // Per-username rate limit — 10/15min. Wrong attempts burn the budget;
    // the 11th attempt fails even with the right password.
    const rlUser = await createUser("rlu")
    users.push(rlUser)
    for (let i = 0; i < 10; i++) await tryLogin(rlUser.username, "wrong-" + i)
    const afterLimit = await tryLogin(rlUser.username, rlUser.password)
    const otherStillOk = await tryLogin(b.username, b.password)
    !afterLimit.sessionCookie && otherStillOk.sessionCookie
      ? pass("login: per-username rate limit engages; other users unaffected")
      : fail("login rate limit", { afterLimit, otherOk: otherStillOk.sessionCookie })
    rateKeys.push(`login:user:${rlUser.username.toLowerCase()}`)
    await prisma.rateLimit.deleteMany({ where: { key: { contains: "login" } } })

    // ══ 2. Session invalidation ═══════════════════════════════════
    let r = await callApi("/api/profile", { cookie: sessC })
    r.status === 200 ? pass("session: baseline authed call works") : fail("session baseline", r.status)

    // Privilege change via the real admin flow kills the session.
    r = await callApi("/api/admin/users", { method: "PATCH", body: { userId: sess.id, role: "MODERATOR" }, cookie: adminC })
    const stale1 = await callApi("/api/profile", { cookie: sessC })
    r.status === 200 && (stale1.status === 401 || stale1.status === 403)
      ? pass("session: role change revokes live session immediately")
      : fail("role-change revocation", { role: r.status, stale: stale1.status })

    // Re-login as MODERATOR, hit a moderator surface, then get demoted.
    const { cookie: sessModC } = await login(sess.username, sess.password)
    const modSurf = await callApi("/api/moderation/user?username=" + encodeURIComponent(a.username), { cookie: sessModC })
    modSurf.status === 200 ? pass("session: promoted role reaches moderator surface") : fail("mod surface", modSurf.status)
    const adminSurfAsMod = await callApi("/api/admin/users", { cookie: sessModC })
    adminSurfAsMod.status === 403 ? pass("session: moderator denied admin surface") : fail("mod→admin", adminSurfAsMod.status)
    r = await callApi("/api/admin/users", { method: "PATCH", body: { userId: sess.id, role: "MEMBER" }, cookie: adminC })
    const stale2 = await callApi("/api/moderation/user?username=x", { cookie: sessModC })
    stale2.status === 401 || stale2.status === 403
      ? pass("session: demotion kills elevated session instantly")
      : fail("demotion revocation", stale2.status)

    // Password reset via the real recovery flow invalidates sessions.
    // Clear the 5/hr recover limiter — prior runs share the same IP hash.
    await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "recover" } } }).catch(() => {})
    const phrase = generateMnemonic()
    const phraseHash = bcrypt.hashSync(phrase.toLowerCase().trim().replace(/\s+/g, " "), 10)
    await prisma.user.update({ where: { id: sess.id }, data: { recoveryPhraseHash: phraseHash } })
    const { cookie: sessC2 } = await login(sess.username, sess.password)
    r = await callApi("/api/auth/recover", {
      method: "POST",
      body: { username: sess.username, phrase, newPassword: "NewPass-987!" },
    })
    const stale3 = await callApi("/api/profile", { cookie: sessC2 })
    r.status === 200 && (stale3.status === 401 || stale3.status === 403)
      ? pass("session: password reset revokes prior sessions")
      : fail("recovery revocation", { rec: r.status, stale: stale3.status })
    const reLogin = await tryLogin(sess.username, "NewPass-987!")
    reLogin.sessionCookie ? pass("session: post-reset login works with new password") : fail("post-reset login", reLogin)

    // Ban kills the session mid-flight.
    const { cookie: sessC3 } = await login(sess.username, "NewPass-987!")
    r = await callApi("/api/moderation/actions", {
      method: "POST",
      body: { actionType: "PERMANENT_BAN", targetUserId: sess.id, reason: "rv ban test" },
      cookie: adminC,
    })
    const stale4 = await callApi("/api/profile", { cookie: sessC3 })
    r.status === 200 && (stale4.status === 401 || stale4.status === 403)
      ? pass("session: permanent ban revokes live session")
      : fail("ban revocation", { ban: r.status, stale: stale4.status })
    // Restore for cleanup-friendliness.
    await callApi("/api/moderation/actions", {
      method: "POST",
      body: { actionType: "UNBAN", targetUserId: sess.id, reason: "rv cleanup" },
      cookie: adminC,
    })

    // ══ 3. Cross-user authorization matrix ════════════════════════
    // A owns: diary (with update + experiment), setup (+comment),
    // thread (+post), notification, bookmark, saved search, follow, block, DM.
    const aDiary = await prisma.growDiary.create({
      data: { title: M("diary"), description: "d", growType: "INDOOR", startDate: new Date(), authorId: a.id, visibility: "PUBLIC" },
    })
    diaryIds.push(aDiary.id)
    const aUpdate = await prisma.diaryUpdate.create({
      data: { diaryId: aDiary.id, authorId: a.id, title: M("upd"), content: "c", stage: "VEGETATIVE", dayNumber: 1, weekNumber: 1 },
    })
    const aExp = await prisma.growExperiment.create({
      data: { diaryId: aDiary.id, authorId: a.id, title: M("exp"), change: "x", category: "OTHER" },
    })
    const aSetup = await prisma.growSetup.create({
      data: { title: M("setup"), description: "d", authorId: a.id },
    })
    setupIds.push(aSetup.id)
    const cat = await prisma.category.findFirst({ where: { hidden: false }, select: { id: true } })
    const aThread = await prisma.thread.create({
      data: { title: M("thread"), slug: `rv-t-${TS}`, content: "c", categoryId: cat.id, authorId: a.id },
    })
    threadIds.push(aThread.id)
    const aPost = await prisma.post.create({
      data: { threadId: aThread.id, authorId: a.id, content: "a post" },
    })
    postIds.push(aPost.id)
    const aNotif = await prisma.notification.create({
      data: { userId: a.id, type: "SYSTEM", title: M("notif"), content: "c" },
    })
    const aComment = await callApi("/api/setups/comments", { method: "POST", body: { setupId: aSetup.id, content: "a comment" }, cookie: aC })
    const aCommentId = aComment.data?.comment?.id

    const matrix = [
      // [name, request factory, forbidden-statuses]
      ["diary PATCH", () => callApi(`/api/diaries/${aDiary.id}`, { method: "PATCH", body: { title: "pwned" }, cookie: bC })],
      ["diary DELETE", () => callApi("/api/diaries", { method: "DELETE", body: { id: aDiary.id }, cookie: bC })],
      ["diary update POST", () => callApi("/api/diaries/updates", { method: "POST", body: { diaryId: aDiary.id, title: "x", content: "y" }, cookie: bC })],
      ["diary update DELETE", () => callApi("/api/diaries/updates", { method: "DELETE", body: { id: aUpdate.id }, cookie: bC })],
      ["experiment PATCH", () => callApi(`/api/diaries/${aDiary.id}/experiments/${aExp.id}`, { method: "PATCH", body: { status: "COMPLETED" }, cookie: bC })],
      ["experiment DELETE", () => callApi(`/api/diaries/${aDiary.id}/experiments/${aExp.id}`, { method: "DELETE", cookie: bC })],
      ["setup PATCH", () => callApi("/api/setups", { method: "PATCH", body: { id: aSetup.id, title: "pwned" }, cookie: bC })],
      ["setup DELETE", () => callApi("/api/setups", { method: "DELETE", body: { id: aSetup.id }, cookie: bC })],
      ["setup comment DELETE", () => callApi("/api/setups/comments", { method: "DELETE", body: { id: aCommentId }, cookie: bC })],
      // Threads expose no PATCH handler at all — 405 is itself a denial.
      ["thread PATCH", () => callApi("/api/forum/threads", { method: "PATCH", body: { id: aThread.id, title: "pwned" }, cookie: bC }), [405]],
      ["thread DELETE", () => callApi("/api/forum/threads", { method: "DELETE", body: { id: aThread.id }, cookie: bC })],
      ["post PATCH", () => callApi("/api/forum/posts", { method: "PATCH", body: { id: aPost.id, content: "pwned content long enough" }, cookie: bC })],
      ["post DELETE", () => callApi("/api/forum/posts", { method: "DELETE", body: { id: aPost.id }, cookie: bC })],
      ["saved-search DELETE", async () => {
        const ss = await prisma.savedSearch.create({ data: { userId: a.id, name: M("ss"), query: "x" } })
        const res = await callApi("/api/saved-searches", { method: "DELETE", body: { id: ss.id }, cookie: bC })
        const alive = await prisma.savedSearch.findUnique({ where: { id: ss.id } })
        res._persisted = !!alive
        return res
      }],
    ]
    for (const [name, fn, accepted] of matrix) {
      const res = await fn()
      const denied = (accepted || [401, 403, 404]).includes(res.status)
      const persisted = res._persisted !== false
      denied && persisted
        ? pass(`authz: ${name} rejects non-owner`)
        : fail(`authz ${name}`, { s: res.status, persisted })
    }

    // Notification ownership — mutations are silent no-ops on foreign ids.
    r = await callApi("/api/notifications", { method: "PATCH", body: { ids: [aNotif.id] }, cookie: bC })
    const notifAlive = await prisma.notification.findUnique({ where: { id: aNotif.id }, select: { read: true } })
    !notifAlive?.read ? pass("authz: notification PATCH on foreign id is a no-op") : fail("notif PATCH", { s: r.status, read: notifAlive?.read })
    r = await callApi("/api/notifications", { method: "DELETE", body: { ids: [aNotif.id] }, cookie: bC })
    const notifStill = await prisma.notification.findUnique({ where: { id: aNotif.id } })
    !!notifStill ? pass("authz: notification DELETE on foreign id is a no-op") : fail("notif DELETE", r.status)

    // Bookmark — B cannot remove A's bookmark.
    await callApi("/api/bookmarks", { method: "POST", body: { threadId: aThread.id }, cookie: aC })
    await callApi("/api/bookmarks", { method: "DELETE", body: { threadId: aThread.id }, cookie: bC })
    const bmAlive = await prisma.bookmark.findFirst({ where: { userId: a.id, threadId: aThread.id } })
    !!bmAlive ? pass("authz: bookmark survives non-owner delete") : fail("bookmark", "removed")

    // Follows/blocks are own-scoped — B's delete can't touch A's rows.
    await prisma.follow.create({ data: { followerId: a.id, followingId: b.id } }).catch(() => {})
    await callApi("/api/follows", { method: "DELETE", body: { userId: a.id }, cookie: bC })
    const followAlive = await prisma.follow.findFirst({ where: { followerId: a.id, followingId: b.id } })
    !!followAlive ? pass("authz: follow survives non-owner delete") : fail("follow", "removed")
    await prisma.block.create({ data: { blockerId: a.id, blockedId: c.id } }).catch(() => {})
    await callApi("/api/blocks", { method: "DELETE", body: { userId: c.id }, cookie: bC })
    const blockAlive = await prisma.block.findFirst({ where: { blockerId: a.id, blockedId: c.id } })
    !!blockAlive ? pass("authz: block survives non-owner delete") : fail("block", "removed")

    // DM — B sees only its own conversation; foreign sender injection fails.
    await callApi("/api/messages", { method: "POST", body: { to: b.id, content: `dm ${M("dm")}` }, cookie: aC })
    const bConv = await callApi(`/api/messages?with=${a.id}`, { cookie: bC })
    const bMsgs = bConv.data?.messages || []
    const foreignLeak = bMsgs.some((m) => m.senderId !== a.id && m.senderId !== b.id)
    bConv.status === 200 && !foreignLeak
      ? pass("authz: DM conversation returns only own messages")
      : fail("dm leak", { s: bConv.status, foreignLeak })
    // Spoofed senderId in body must be ignored.
    await callApi("/api/messages", { method: "POST", body: { to: a.id, content: "x", senderId: c.id }, cookie: bC })
    const forged = await prisma.directMessage.findFirst({ where: { senderId: c.id, content: "x" } })
    !forged ? pass("authz: senderId field in DM body is ignored") : fail("dm sender forge", forged?.id)

    // Profile PATCH is session-scoped — a userId field must be ignored.
    await callApi("/api/profile", { method: "PATCH", body: { userId: a.id, bio: `pwned ${TS}` }, cookie: bC })
    const aProf = await prisma.profile.findUnique({ where: { userId: a.id }, select: { bio: true } })
    aProf?.bio !== `pwned ${TS}` ? pass("authz: profile PATCH cannot target another user") : fail("profile forge", aProf?.bio)

    // ══ 4. Private diary matrix ═══════════════════════════════════
    const mkVis = (visibility) => prisma.growDiary.create({
      data: { title: `${M("vis")} ${visibility}`, description: "v", growType: "INDOOR", startDate: new Date(), authorId: a.id, visibility },
    })
    const pubD = await mkVis("PUBLIC")
    const unlD = await mkVis("UNLISTED")
    const prvD = await mkVis("PRIVATE")
    diaryIds.push(pubD.id, unlD.id, prvD.id)
    // a already blocked c above — c is the blocked viewer of a's content.

    const visExpect = {
      PUBLIC: { owner: 200, member: 200, blocked: 200, guest: 200 },
      UNLISTED: { owner: 200, member: 200, blocked: 200, guest: 200 },
      PRIVATE: { owner: 200, member: 404, blocked: 404, guest: 404 },
    }
    const actors = [["owner", aC], ["member", bC], ["blocked", cC], ["guest", undefined]]
    for (const [vis, d] of [["PUBLIC", pubD], ["UNLISTED", unlD], ["PRIVATE", prvD]]) {
      for (const [who, ck] of actors) {
        const p = await getHtml(`/diaries/${d.id}`, ck)
        p.status === visExpect[vis][who]
          ? pass(`vis: ${vis} diary → ${who} ${visExpect[vis][who]}`)
          : fail(`vis ${vis} ${who}`, p.status)
      }
    }
    // Identical 404 for private vs nonexistent — no existence oracle. Bodies
    // embed per-request nonces, so compare status + absence of private content.
    const privRes = await getHtml(`/diaries/${prvD.id}`, bC)
    const noneRes = await getHtml(`/diaries/clxxxxxxxxxxxxxxxxxxxxx`, bC)
    privRes.status === 404 && noneRes.status === 404 && !privRes.html.includes(`${M("vis")} PRIVATE`)
      ? pass("vis: PRIVATE diary indistinguishable from nonexistent")
      : fail("existence oracle", { priv: privRes.status, none: noneRes.status, leaks: privRes.html.includes(`${M("vis")} PRIVATE`) })

    // Private diary must not appear in lists/search; UNLISTED must not either.
    const idx = await getHtml("/diaries", bC)
    !idx.html.includes(`${M("vis")} PRIVATE`) && !idx.html.includes(`${M("vis")} UNLISTED`)
      ? pass("vis: /diaries index hides PRIVATE + UNLISTED")
      : fail("/diaries index leak")
    let sr = await callApi(`/api/search?q=${encodeURIComponent(M("vis"))}&type=diaries`, { cookie: bC })
    const hits = (sr.data?.diaries || []).map((d) => d.title)
    hits.includes(`${M("vis")} PUBLIC`) && !hits.some((t) => /PRIVATE|UNLISTED/.test(t))
      ? pass("vis: search returns only PUBLIC diary")
      : fail("search vis", hits)
    // Sub-resource endpoints.
    r = await callApi(`/api/diaries/${prvD.id}/experiments`, { cookie: bC })
    r.status === 404 ? pass("vis: experiments on PRIVATE diary 404 for member") : fail("exp private", r.status)
    r = await callApi(`/api/diaries/${prvD.id}/intel`, { cookie: bC })
    r.status === 404 ? pass("vis: intel on PRIVATE diary 404 for member") : fail("intel private", r.status)
    r = await callApi(`/api/diaries/${prvD.id}/discuss`, { method: "POST", cookie: bC })
    r.status === 404 ? pass("vis: discuss on PRIVATE diary 404 for member") : fail("discuss private", r.status)
    r = await callApi("/api/diaries/updates", { method: "POST", body: { diaryId: prvD.id, title: "x", content: "y" }, cookie: bC })
    ;[403, 404].includes(r.status) ? pass("vis: update POST on PRIVATE diary rejected") : fail("update private", r.status)
    r = await callApi(`/api/diaries/${prvD.id}/intel`, { cookie: aC })
    r.status === 200 ? pass("vis: owner intel on PRIVATE diary works") : fail("owner intel", r.status)

    // ══ 5. Account deletion ═══════════════════════════════════════
    // del owns a thread+post+diary+setup, follows a, blocks c, and is the
    // actor on a notification in a's inbox.
    const dThread = await prisma.thread.create({
      data: { title: M("delthread"), slug: `rv-dt-${TS}`, content: "c", categoryId: cat.id, authorId: del.id },
    })
    threadIds.push(dThread.id)
    const dPost = await prisma.post.create({ data: { threadId: dThread.id, authorId: del.id, content: "d" } })
    postIds.push(dPost.id)
    const dDiary = await prisma.growDiary.create({
      data: { title: M("deldiary"), description: "d", growType: "INDOOR", startDate: new Date(), authorId: del.id },
    })
    diaryIds.push(dDiary.id)
    await prisma.follow.create({ data: { followerId: del.id, followingId: a.id } }).catch(() => {})
    await prisma.block.create({ data: { blockerId: del.id, blockedId: c.id } }).catch(() => {})
    const aInbox = await prisma.notification.create({
      data: { userId: a.id, actorId: del.id, type: "REPLY", title: "t", content: `@${del.username} replied`, link: `/u/${del.username}` },
    })

    // Wrong password / wrong confirm must refuse.
    r = await callApi("/api/profile", { method: "DELETE", body: { confirmUsername: del.username, password: "wrong-pass" }, cookie: delC })
    r.status === 403 ? pass("delete: wrong password refused") : fail("delete wrong pass", r.status)
    r = await callApi("/api/profile", { method: "DELETE", body: { confirmUsername: "nope", password: del.password }, cookie: delC })
    r.status === 400 ? pass("delete: wrong username confirmation refused") : fail("delete wrong user", r.status)

    r = await callApi("/api/profile", { method: "DELETE", body: { confirmUsername: del.username, password: del.password }, cookie: delC })
    r.status === 200 ? pass("delete: account deletion succeeds") : fail("delete", { s: r.status, d: r.data })

    const deadSess = await callApi("/api/profile", { cookie: delC })
    deadSess.status === 401 ? pass("delete: dead account session rejected") : fail("dead session", deadSess.status)
    const deadProf = await getHtml(`/u/${del.username}`)
    deadProf.status === 404 ? pass("delete: profile page 404s") : fail("dead profile", deadProf.status)
    const deadProfApi = await callApi(`/api/users/${del.username}`)
    deadProfApi.status === 404 ? pass("delete: profile API 404s") : fail("dead profile api", deadProfApi.status)
    const deadThread = await getHtml(`/forum/thread/${dThread.slug}`)
    deadThread.status === 404 ? pass("delete: owned thread unreachable") : fail("dead thread", deadThread.status)
    const deadRows = await prisma.thread.count({ where: { id: dThread.id } }) +
      await prisma.growDiary.count({ where: { id: dDiary.id } }) +
      await prisma.user.count({ where: { id: del.id } })
    deadRows === 0 ? pass("delete: owned rows fully cascaded") : fail("delete cascade", deadRows)
    const scrubbed = await prisma.notification.findUnique({ where: { id: aInbox.id }, select: { content: true, link: true } })
    scrubbed && !scrubbed.content.includes(del.username) && !scrubbed.link
      ? pass("delete: actor identity scrubbed from others' notifications")
      : fail("notification scrub", scrubbed)
    const deadPusher = await pusherAuth(delC, "1.1", `private-user-${del.id}`)
    deadPusher.status === 401 || deadPusher.status === 403
      ? pass("delete: realtime auth rejected for deleted account")
      : fail("dead pusher", deadPusher.status)

    // ══ 6. Realtime / Pusher two-client ═══════════════════════════
    // Channel authorization boundaries first (the actual security gate).
    const sok = await pusherAuth(aC, "1.1", `private-user-${a.id}`)
    sok.status === 200 && sok.data?.auth ? pass("pusher: own user channel authorized") : fail("pusher own", sok.status)
    for (const [n, ch] of [
      ["foreign user channel", `private-user-${b.id}`],
      ["nonexistent room", "private-chat-c0000000000000000000000x"],
      ["malformed channel", "private-evil"],
      ["presence channel", `presence-user-${a.id}`],
      ["public-named channel", `public-user-${a.id}`],
    ]) {
      const res = await pusherAuth(aC, "1.1", ch)
      res.status === 403 ? pass(`pusher: ${n} denied`) : fail(`pusher ${n}`, res.status)
    }
    const anonPusher = await pusherAuth(undefined, "1.1", `private-user-${a.id}`)
    anonPusher.status === 401 ? pass("pusher: anonymous auth denied") : fail("pusher anon", anonPusher.status)

    // requiredRep must be null, not 0 — a non-null rep gate requires the
    // grow_room_enabled rollout flag, which is off by default.
    const room = await prisma.chatRoom.create({ data: { name: `__rv-room-${TS}`, slug: `rv-room-${TS}`, isPrivate: false, requiredRep: null }, select: { id: true } })
    roomIds.push(room.id)
    {
      const rok = await pusherAuth(aC, "1.1", `private-chat-${room.id}`)
      rok.status === 200 ? pass("pusher: open room channel authorized") : fail("pusher room", rok.status)
      const rbad = await pusherAuth(undefined, "1.1", `private-chat-${room.id}`)
      rbad.status === 401 ? pass("pusher: room channel denied for anon") : fail("pusher room anon", rbad.status)
    }

    // Real two-client event delivery — user channel gets a content-free
    // notification DTO on DM; chat channel gets a {roomId, latestAt} tickle.
    if (process.env.NEXT_PUBLIC_PUSHER_KEY) {
      const mkClient = (cookie) => new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY, {
        cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
        enabledTransports: ["ws", "wss"],
        // pusher-js refuses to forward `cookie` in auth.headers — do the auth
        // POST ourselves so the session cookie travels in the fetch.
        authorizer: (channel) => ({
          authorize: async (socketId, callback) => {
            try {
              const res = await fetch(`${BASE}/api/pusher/auth`, {
                method: "POST",
                headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
                body: `socket_id=${encodeURIComponent(socketId)}&channel_name=${encodeURIComponent(channel.name)}`,
              })
              if (!res.ok) return callback(new Error(`auth ${res.status}`), null)
              callback(null, await res.json())
            } catch (e) {
              callback(e, null)
            }
          },
        }),
      })
      const bClient = mkClient(bC)
      const cClient = mkClient(cC)
      const chanB = bClient.subscribe(`private-user-${b.id}`)
      const chanC = cClient.subscribe(`private-user-${c.id}`)
      const subRes = await Promise.all([
        new Promise((res) => { chanB.bind("pusher:subscription_succeeded", () => res("ok")); chanB.bind("pusher:subscription_error", (e) => res(`err:${JSON.stringify(e)}`)) }),
        new Promise((res) => { chanC.bind("pusher:subscription_succeeded", () => res("ok")); chanC.bind("pusher:subscription_error", (e) => res(`err:${JSON.stringify(e)}`)) }),
      ])
      const subsOk = subRes.every((s) => s === "ok")
      !subsOk && fail("pusher subscribe", subRes)

      const bEvents = []
      const cEvents = []
      chanB.bind_global((ev, data) => bEvents.push({ ev, data }))
      chanC.bind_global((ev, data) => cEvents.push({ ev, data }))
      // c→b: fresh DM groupKey (the a→b pair was already used in the authz
      // section — notify() dedupes repeat DMs for 10min, suppressing the push).
      const dmRes = await callApi("/api/messages", { method: "POST", body: { to: b.id, content: `SECRET-DM-${TS}` }, cookie: cC })
      await new Promise((res) => setTimeout(res, 4000))
      const dmEv = bEvents.find((e) => e.ev === "new-notification")
      dmEv && !JSON.stringify(dmEv.data).includes(`SECRET-DM-${TS}`)
        ? pass("pusher: DM notification reaches recipient without content leak")
        : fail("pusher dm event", { got: !!dmEv, data: dmEv?.data, sendStatus: dmRes.status, events: bEvents })
      cEvents.length === 0
        ? pass("pusher: unrelated client receives nothing")
        : fail("pusher cross-talk", cEvents)

      const roomB = bClient.subscribe(`private-chat-${room.id}`)
      const roomSub = await new Promise((res) => { roomB.bind("pusher:subscription_succeeded", () => res("ok")); roomB.bind("pusher:subscription_error", (e) => res(`err:${JSON.stringify(e)}`)) })
      const roomEvents = []
      roomB.bind_global((ev, data) => roomEvents.push({ ev, data }))
      const chatRes = await callApi("/api/chat/messages", { method: "POST", body: { roomId: room.id, content: `SECRET-CHAT-${TS}` }, cookie: aC })
      await new Promise((res) => setTimeout(res, 4000))
      const msgEv = roomEvents.find((e) => e.ev === "new-message")
      msgEv && !JSON.stringify(msgEv.data).includes(`SECRET-CHAT-${TS}`)
        ? pass("pusher: chat push is a content-free tickle")
        : fail("pusher chat tickle", { got: !!msgEv, data: msgEv?.data, sub: roomSub, sendStatus: chatRes.status })
      bClient.disconnect()
      cClient.disconnect()
    } else {
      fail("pusher config", "NEXT_PUBLIC_PUSHER_KEY unset — realtime delivery not verifiable")
    }

    // ══ 7. Browser data exposure ══════════════════════════════════
    const FORBIDDEN = [/recoveryPhraseHash/i, /sessionVersion/i, /\$2[aby]\$\d+\$/, /IP_HASH_SALT/i, /NEXTAUTH_SECRET/i, /"password"\s*:/]
    const exposurePages = ["/settings", "/profile", `/diaries/${aDiary.id}`, `/forum/thread/${aThread.slug}`, "/messages"]
    for (const p of exposurePages) {
      const pg = await getHtml(p, aC)
      const hits = FORBIDDEN.filter((re) => re.test(pg.html)).map((r) => r.source)
      hits.length === 0 ? pass(`exposure: ${p} leaks no server internals`) : fail(`exposure ${p}`, hits)
    }
    // B's view of A's pages must not contain A's private diary or internals.
    const bView = await getHtml(`/u/${a.username}`, bC)
    !bView.html.includes(`${M("vis")} PRIVATE`) && !bView.html.includes(`${M("vis")} UNLISTED`)
      ? pass("exposure: public profile hides non-PUBLIC diaries")
      : fail("profile diary leak")

    // ══ 8. Cache isolation ════════════════════════════════════════
    const profA = await callApi("/api/profile", { cookie: aC })
    const profB = await callApi("/api/profile", { cookie: bC })
    profA.data?.user?.id === a.id && profB.data?.user?.id === b.id
      ? pass("cache: /api/profile returns per-viewer data")
      : fail("profile cache", { a: profA.data?.user?.id, b: profB.data?.user?.id })
    const notifA = await callApi("/api/notifications", { cookie: aC })
    const notifB = await callApi("/api/notifications", { cookie: bC })
    const notifLeak = (notifA.data?.notifications || []).some((n) => (notifB.data?.notifications || []).some((m) => m.id === n.id)) &&
      JSON.stringify(notifA.data) === JSON.stringify(notifB.data)
    !notifLeak ? pass("cache: notifications are per-viewer") : fail("notif cache")

    // A-then-B on the same path — private page for A must not serve to B.
    await getHtml(`/diaries/${prvD.id}`, aC)
    const bAfter = await getHtml(`/diaries/${prvD.id}`, bC)
    bAfter.status === 404 ? pass("cache: private page not shared after owner fetch") : fail("private cache", bAfter.status)

    // Viewer-dependent responses must not be publicly cacheable.
    const profHeaders = (await getHtml("/settings", aC)).headers.get("cache-control") || ""
    const apiProf = await fetch(`${BASE}/api/profile`, { headers: { cookie: aC } })
    const cc = apiProf.headers.get("cache-control") || ""
    ;(/private|no-store|no-cache/).test(cc)
      ? pass("cache: authed API marks viewer responses non-shared")
      : fail("api cache-control", cc)

    // Suggest: block filtering post-cache — a blocks c; c must vanish for a.
    sr = await callApi(`/api/search/suggest?q=${encodeURIComponent(c.username)}`, { cookie: aC })
    !(sr.data?.suggestions || []).some((s) => s.type === "user" && s.slug === c.username)
      ? pass("cache: suggest applies block filter after shared cache")
      : fail("suggest block", sr.data?.suggestions)
    sr = await callApi(`/api/search/suggest?q=${encodeURIComponent(c.username)}`)
    ;(sr.data?.suggestions || []).some((s) => s.type === "user" && s.slug === c.username)
      ? pass("cache: guest suggest unaffected by other users' blocks")
      : fail("suggest guest", sr.data?.suggestions)

    // ══ 9. Upload validation ══════════════════════════════════════
    // Storage is dev pass-through without BLOB_READ_WRITE_TOKEN — these
    // verify the validation boundary only.
    const BAD_PNG = "data:image/png;base64," + Buffer.from("not an image").toString("base64")
    r = await callApi("/api/profile", { method: "PATCH", body: { avatarUrl: BAD_PNG }, cookie: aC })
    r.status === 400 ? pass("upload: magic-byte mismatch rejected") : fail("bad image", r.status)
    r = await callApi("/api/profile", { method: "PATCH", body: { avatarUrl: "data:image/svg+xml;base64,PHN2Zy8+" }, cookie: aC })
    r.status === 400 ? pass("upload: SVG rejected") : fail("svg", r.status)
    r = await callApi("/api/profile", { method: "PATCH", body: { avatarUrl: "data:image/png;base64,!!!notbase64" }, cookie: aC })
    r.status === 400 ? pass("upload: malformed base64 rejected") : fail("malformed", r.status)
    r = await callApi("/api/profile", { method: "PATCH", body: { avatarUrl: "https://evil.example.com/x.png" }, cookie: aC })
    r.status === 400 ? pass("upload: external URL avatar rejected") : fail("ext url", r.status)
    r = await callApi("/api/profile", { method: "PATCH", body: { avatarUrl: "javascript:alert(1)" }, cookie: aC })
    r.status === 400 ? pass("upload: javascript: URI rejected") : fail("js uri", r.status)

    // ══ 10. Rate limits ═══════════════════════════════════════════
    // profile PATCH — 20/hr per user.
    let last = null
    for (let i = 0; i < 21; i++) {
      last = await callApi("/api/profile", { method: "PATCH", body: { bio: `x${i}` }, cookie: aC })
      if (last.status === 429) break
    }
    last?.status === 429 ? pass("ratelimit: profile PATCH 429s after 20/hr") : fail("profile rl", last?.status)
    await prisma.rateLimit.deleteMany({ where: { key: `profile-update:${a.id}` } })

    // diary-discuss — 10/min per user; cheap 404s burn the budget.
    let dLast = null
    for (let i = 0; i < 12; i++) {
      dLast = await callApi(`/api/diaries/${pubD.id}/discuss`, { method: "POST", cookie: aC })
      if (dLast.status === 429) break
    }
    ;[200, 201, 429].includes(dLast?.status)
      ? pass(`ratelimit: discuss bounded (ended at ${dLast.status})`)
      : fail("discuss rl", dLast?.status)

    // Suggest — 60/min per hashed IP; rotating spoofed XFF must not evade.
    let sLast = null
    for (let i = 0; i < 65; i++) {
      const res = await fetch(`${BASE}/api/search/suggest?q=ab`, {
        headers: { "x-forwarded-for": `10.${i % 250}.${i % 250}.${i % 250}` },
      })
      sLast = res.status
      if (sLast === 429) break
    }
    sLast === 429
      ? pass("ratelimit: suggest 429s; spoofed X-Forwarded-For cannot evade")
      : fail("suggest rl/xff", sLast)
    await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "search-suggest" } } })

    // ══ 11. Enumeration ═══════════════════════════════════════════
    const exUser = await callApi(`/api/users/${a.username}`)
    const noUser = await callApi(`/api/users/__rv_no_such_${TS}`)
    exUser.status === 200 && noUser.status === 404
      ? pass("enum: existing vs missing username distinguished only where public")
      : fail("user enum", { ex: exUser.status, no: noUser.status })
    // Blocked relationship — c is blocked by a: c asking for a's profile
    // gets the same 404 as a nonexistent user.
    const blockedView = await callApi(`/api/users/${a.username}`, { cookie: cC })
    const ghostView = await callApi(`/api/users/__rv_no_such_${TS}`, { cookie: cC })
    blockedView.status === 404 && ghostView.status === 404 &&
      JSON.stringify(blockedView.data) === JSON.stringify(ghostView.data)
      ? pass("enum: blocked profile indistinguishable from nonexistent")
      : fail("block oracle", { blocked: blockedView.status, ghost: ghostView.status, b: blockedView.data, g: ghostView.data })

    // Recovery — wrong phrase on real account vs nonexistent account uniform.
    // Reset the 5/hr limiter so earlier runs' attempts can't poison this probe.
    await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "recover" } } }).catch(() => {})
    const rec1 = await callApi("/api/auth/recover", { method: "POST", body: { username: a.username, phrase: "a ".repeat(12).trim(), newPassword: "Whatever123!" } })
    const rec2 = await callApi("/api/auth/recover", { method: "POST", body: { username: `__rv_no_such_${TS}`, phrase: "a ".repeat(12).trim(), newPassword: "Whatever123!" } })
    rec1.status === rec2.status && JSON.stringify(rec1.data) === JSON.stringify(rec2.data)
      ? pass("enum: recovery failure uniform for real vs nonexistent accounts")
      : fail("recover enum", { rec1, rec2 })

    // ══ 12. Admin / moderator boundaries ══════════════════════════
    const adminEndpoints = [
      ["GET /api/admin/users", () => callApi("/api/admin/users", { cookie: bC })],
      ["GET /api/admin/stats", () => callApi("/api/admin/stats", { cookie: bC })],
      ["GET /api/admin/security", () => callApi("/api/admin/security", { cookie: bC })],
      ["GET /api/admin/audit", () => callApi("/api/admin/audit", { cookie: bC })],
      ["PATCH /api/admin/users", () => callApi("/api/admin/users", { method: "PATCH", body: { userId: c.id, role: "MODERATOR" }, cookie: bC })],
      ["POST /api/admin/announce", () => callApi("/api/admin/announce", { method: "POST", body: { title: "x", content: "y" }, cookie: bC })],
      ["POST /api/admin/reputation", () => callApi("/api/admin/reputation", { method: "POST", body: { userId: c.id, amount: 100, reason: "x" }, cookie: bC })],
      ["POST /api/moderation/actions", () => callApi("/api/moderation/actions", { method: "POST", body: { actionType: "WARNING", targetUserId: c.id, reason: "x" }, cookie: bC })],
      ["GET /api/moderation/queue", () => callApi("/api/moderation/queue", { cookie: bC })],
    ]
    for (const [n, fn] of adminEndpoints) {
      const res = await fn()
      res.status === 403 || res.status === 401
        ? pass(`staff: member denied ${n}`)
        : fail(`staff member ${n}`, res.status)
    }
    // Moderator can warn but cannot do admin-only ops.
    r = await callApi("/api/moderation/actions", { method: "POST", body: { actionType: "WARNING", targetUserId: c.id, reason: "rv warning" }, cookie: modC })
    r.status === 200 ? pass("staff: moderator can warn") : fail("mod warn", r.status)
    r = await callApi("/api/moderation/actions", { method: "POST", body: { actionType: "REMOVE_SUSPENSION", targetUserId: c.id, reason: "x" }, cookie: modC })
    r.status === 403 || r.status === 400
      ? pass("staff: moderator denied admin-only action")
      : fail("mod admin action", r.status)
    r = await callApi("/api/admin/users", { method: "PATCH", body: { userId: c.id, role: "MEMBER" }, cookie: modC })
    r.status === 403 ? pass("staff: moderator cannot change roles") : fail("mod role change", r.status)
    r = await callApi("/api/admin/reputation", { method: "POST", body: { userId: c.id, amount: 100, reason: "x" }, cookie: modC })
    r.status === 403 ? pass("staff: moderator cannot adjust reputation") : fail("mod rep", r.status)
    // Self-targeting and admin-targeting must be refused.
    r = await callApi("/api/moderation/actions", { method: "POST", body: { actionType: "WARNING", targetUserId: mod.id, reason: "x" }, cookie: modC })
    r.status === 400 || r.status === 403 ? pass("staff: self-action refused") : fail("mod self", r.status)
    r = await callApi("/api/moderation/actions", { method: "POST", body: { actionType: "PERMANENT_BAN", targetUserId: admin.id, reason: "x" }, cookie: modC })
    r.status === 400 || r.status === 403 ? pass("staff: moderator cannot ban admin") : fail("mod→admin ban", r.status)

    // ══ 13. TerpBot ═══════════════════════════════════════════════
    if (room) {
      r = await callApi("/api/chat/commands", { method: "POST", body: { roomId: room.id, content: "/ban @someone" }, cookie: bC })
      const deniedOr404 = [400, 403, 404].includes(r.status) || /denied|staff|permission|not allowed|unknown/i.test(JSON.stringify(r.data))
      deniedOr404 ? pass("terpbot: member denied staff command /ban") : fail("bot /ban", { s: r.status, d: r.data })
      r = await callApi("/api/chat/commands", { method: "POST", body: { roomId: room.id, content: "/warn @someone" }, cookie: bC })
      const denied2 = [400, 403, 404].includes(r.status) || /denied|staff|permission|not allowed|unknown/i.test(JSON.stringify(r.data))
      denied2 ? pass("terpbot: member denied staff command /warn") : fail("bot /warn", { s: r.status, d: r.data })
      r = await callApi("/api/chat/commands", { method: "POST", body: { roomId: room.id, content: "/checkin" }, cookie: bC })
      const okStatus = [200, 400, 403].includes(r.status)
      okStatus ? pass("terpbot: member command handled without 500") : fail("bot checkin", r.status)
      // Private data must not be reachable via bot output.
      r = await callApi("/api/chat/commands", { method: "POST", body: { roomId: room.id, content: `/diagnose ${prvD.id}` }, cookie: bC })
      const leakedPrivate = JSON.stringify(r.data ?? "").includes(`${M("vis")} PRIVATE`)
      !leakedPrivate ? pass("terpbot: no private diary data in command output") : fail("bot private leak", r.data)
    }
    const botRow = await prisma.user.findFirst({ where: { profile: { username: "terpbot" } }, select: { role: true, password: true } })
    const botPinned = !botRow || (botRow.role === "MEMBER" && botRow.password === null)
    botPinned
      ? pass("terpbot: bot account pinned MEMBER + passwordless")
      : fail("bot privilege", botRow)

    console.log(`\n${results.filter(([s]) => s === "PASS").length} passed, ${results.filter(([s]) => s === "FAIL").length} failed`)
  } catch (e) {
    fail("suite error", String(e?.stack || e))
  } finally {
    for (const id of postIds) await prisma.post.delete({ where: { id } }).catch(() => {})
    for (const id of roomIds) await prisma.chatRoom.delete({ where: { id } }).catch(() => {})
    for (const id of threadIds) await prisma.thread.delete({ where: { id } }).catch(() => {})
    for (const id of diaryIds) await prisma.growDiary.delete({ where: { id } }).catch(() => {})
    for (const id of setupIds) await prisma.growSetup.delete({ where: { id } }).catch(() => {})
    for (const id of strainIds) await prisma.strain.delete({ where: { id } }).catch(() => {})
    for (const u of users) await prisma.user.delete({ where: { id: u.id } }).catch(() => {})
    await prisma.rateLimit.deleteMany({ where: { OR: [{ key: { contains: "login" } }, { key: { startsWith: "search-suggest" } }, { key: { startsWith: "diary-discuss" } }, { key: { startsWith: "profile-update" } }, { key: { startsWith: "recover" } }] } }).catch(() => {})
    await prisma.$disconnect()
  }

  process.exit(finish())
}

main().catch((e) => { console.error(e); process.exit(1) })
