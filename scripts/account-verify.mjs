// Account lifecycle HTTP verification — auth/onboarding, direct messages,
// account deletion, and registration captcha. Temp users, localhost, full cleanup.
import { makeHarness } from "./lib/http-harness.mjs"

// onboarding users must NOT get sessionVersion/onboardingCompletedAt —
// the suite verifies mid-flow resume behavior.
const { prisma, BASE, results, pass, fail, createUser, login, api: callApi } = makeHarness({
  username: (tag) => `__v_${tag}_${Date.now().toString(36)}`,
  name: (tag) => `__verify_${tag}_${Date.now()}`,
  userDefaults: { sessionVersion: undefined, onboardingCompletedAt: undefined },
  loginShape: "session",
  summary: "counts",
})

const main = async () => {
  const userA = await createUser("newbie")
  const userB = await createUser("veteran") // follow target
  const userC = await createUser("resume") // mid-flow resume user
  const userD = await createUser("coldstart") // zero follows — feed fallback

  // DM/deletion users need a normal session — the suite default omits
  // sessionVersion for the mid-flow onboarding checks above.
  const active = { sessionVersion: 1, onboardingCompletedAt: new Date() }
  const dmA = await createUser("dma", active)
  const dmB = await createUser("dmb", active)
  const dmC = await createUser("dmc", active)
  const dmD = await createUser("dmd", active)
  const delE = await createUser("dele", active)
  const rlF = await createUser("rlf", active)
  const phA = await createUser("pha", active) // pinned-harvest, rank-gated
  const phB = await createUser("phb", active) // pinned-harvest, streak-gated
  const expU = await createUser("exp", active) // data-export fixtures
  const captchaIds = []
  const registeredUsernames = []

  try {
    // give B an avatar+bio so it's eligible for the suggestion pool
    await prisma.profile.update({ where: { userId: userB.id }, data: { bio: "verification target", xp: 5 } })
    await prisma.progressionEvent.create({
      data: { userId: userB.id, type: "STAFF_ADJUSTMENT", xp: 5, reason: "test seed" },
    })

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

    // ══ Direct messages (HTTP) ═══════════════════════════════════════
    const loginA = await login(dmA.username, dmA.password)
    const cookieA = loginA.cookie
    loginA.session?.user?.id ? pass("dmA login works") : fail("dmA login works", loginA.session)

    // 105 messages, 1 minute apart, msg-000 … msg-104
    const base = Date.now() - 105 * 60 * 1000
    await prisma.directMessage.createMany({
      data: Array.from({ length: 105 }, (_, i) => ({
        senderId: i % 2 ? dmB.id : dmA.id,
        receiverId: i % 2 ? dmA.id : dmB.id,
        content: `msg-${String(i).padStart(3, "0")}`,
        createdAt: new Date(base + i * 60_000),
      })),
    })

    // Tail-load: newest 100, returned oldest→newest
    r = await callApi(`/api/messages?with=${dmB.id}`, { cookie: cookieA })
    const msgs = r.data?.messages ?? []
    r.status === 200 && msgs.length === 100 && r.data.hasMore === true
      ? pass("dm tail: 100 messages + hasMore")
      : fail("dm tail: 100 messages + hasMore", { status: r.status, n: msgs.length, hasMore: r.data?.hasMore })
    msgs[0]?.content === "msg-005" && msgs[99]?.content === "msg-104"
      ? pass("dm tail: oldest→newest msg-005…msg-104")
      : fail("dm tail order", { first: msgs[0]?.content, last: msgs[99]?.content })

    // Before-cursor: the remaining 5
    const first = msgs[0]
    r = await callApi(`/api/messages?with=${dmB.id}&before=${encodeURIComponent(first.createdAt)}&beforeId=${first.id}`, { cookie: cookieA })
    const older = r.data?.messages ?? []
    r.status === 200 && older.length === 5 && r.data.hasMore === false && older[0]?.content === "msg-000" && older[4]?.content === "msg-004"
      ? pass("dm before-cursor: 5 oldest, no more")
      : fail("dm before-cursor", { status: r.status, n: older.length, hasMore: r.data?.hasMore })

    // Timestamp-tie incremental: 3 DMs sharing one createdAt
    const tieTs = new Date(base + 200 * 60_000)
    await prisma.directMessage.createMany({
      data: [0, 1, 2].map((i) => ({
        senderId: dmA.id, receiverId: dmB.id, content: `tie-${i}`, createdAt: tieTs,
      })),
    })
    const tieRows = await prisma.directMessage.findMany({
      where: { senderId: dmA.id, receiverId: dmB.id, createdAt: tieTs },
      orderBy: { id: "asc" },
    })
    r = await callApi(`/api/messages?with=${dmB.id}&after=${encodeURIComponent(tieTs.toISOString())}&afterId=${tieRows[0].id}`, { cookie: cookieA })
    const fresh = r.data?.messages ?? []
    r.status === 200 && r.data.incremental === true && fresh.length === 2 &&
      fresh.every((m) => tieRows.slice(1).some((t) => t.id === m.id))
      ? pass("dm after-cursor: timestamp tie returns other two")
      : fail("dm after-cursor tie", { status: r.status, n: fresh.length })

    // Regex-passing but invalid dates → 400
    r = await callApi(`/api/messages?with=${dmB.id}&after=9999-99-99T99:99:99Z`, { cookie: cookieA })
    r.status === 400 ? pass("dm: invalid after → 400") : fail("dm: invalid after → 400", r.status)
    r = await callApi(`/api/messages?with=${dmB.id}&before=9999-99-99T99:99:99Z`, { cookie: cookieA })
    r.status === 400 ? pass("dm: invalid before → 400") : fail("dm: invalid before → 400", r.status)

    // Anonymous → 401
    r = await callApi(`/api/messages?with=${dmB.id}`)
    r.status === 401 ? pass("dm: anonymous GET → 401") : fail("dm: anonymous GET → 401", r.status)

    // ── DM policy matrix (POST /api/messages { to, content }) ──
    // Unique content per attempt so every status is backed by a DB write check.
    const send = (to, content) => callApi("/api/messages", { method: "POST", body: { to, content }, cookie: cookieA })
    const dmRowCount = (senderId, receiverId, content) =>
      prisma.directMessage.count({ where: { senderId, receiverId, content, deleted: false } })
    const expectWritten = async (label, res, senderId, receiverId, content) => {
      const n = await dmRowCount(senderId, receiverId, content)
      res.status === 201 && n === 1 ? pass(label) : fail(label, { status: res.status, rows: n })
    }
    const expectRejected = async (label, res, status, senderId, receiverId, content) => {
      const n = await dmRowCount(senderId, receiverId, content)
      res.status === status && n === 0 ? pass(label) : fail(label, { status: res.status, rows: n })
    }

    await expectWritten("dm post: EVERYONE policy → 201 + row written", await send(dmB.id, "t-everyone"), dmA.id, dmB.id, "t-everyone")

    await prisma.profile.update({ where: { userId: dmB.id }, data: { dmPolicy: "NONE" } })
    await expectRejected("dm post: NONE policy → 403, no row", await send(dmB.id, "t-none"), 403, dmA.id, dmB.id, "t-none")

    await prisma.profile.update({ where: { userId: dmB.id }, data: { dmPolicy: "FOLLOWING" } })
    await expectRejected("dm post: FOLLOWING policy, no follow → 403, no row", await send(dmB.id, "t-nofollow"), 403, dmA.id, dmB.id, "t-nofollow")
    // Route requires the recipient to follow the sender.
    await prisma.follow.create({ data: { followerId: dmB.id, followingId: dmA.id } })
    await expectWritten("dm post: FOLLOWING policy, recipient follows sender → 201 + row", await send(dmB.id, "t-followed"), dmA.id, dmB.id, "t-followed")
    await prisma.follow.deleteMany({ where: { followerId: dmB.id, followingId: dmA.id } })

    await prisma.profile.update({ where: { userId: dmB.id }, data: { dmPolicy: "EVERYONE" } })
    await prisma.block.create({ data: { blockerId: dmB.id, blockedId: dmA.id } })
    await expectRejected("dm post: blocked by recipient → 403, no row", await send(dmB.id, "t-blockedby"), 403, dmA.id, dmB.id, "t-blockedby")
    await prisma.block.deleteMany({ where: { blockerId: dmB.id, blockedId: dmA.id } })
    await prisma.block.create({ data: { blockerId: dmA.id, blockedId: dmB.id } })
    await expectRejected("dm post: sender blocked recipient → 403, no row", await send(dmB.id, "t-blocked"), 403, dmA.id, dmB.id, "t-blocked")
    await prisma.block.deleteMany({ where: { blockerId: dmA.id, blockedId: dmB.id } })

    await expectRejected("dm post: to self → 400, no row", await send(dmA.id, "t-self"), 400, dmA.id, dmA.id, "t-self")
    // Unknown recipient: scope the no-row check to the sender's outbox.
    {
      const res = await send("nonexistent-user-id", "t-unknown")
      const n = await prisma.directMessage.count({ where: { senderId: dmA.id, content: "t-unknown" } })
      res.status === 404 && n === 0 ? pass("dm post: unknown recipient → 404, no row") : fail("dm post: unknown recipient", { status: res.status, rows: n })
    }

    // Inbox: an old (1y) conversation plus a newer one both list
    await prisma.directMessage.create({
      data: { senderId: dmC.id, receiverId: dmA.id, content: "old-convo", createdAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) },
    })
    await prisma.directMessage.createMany({
      data: [1, 2].map((i) => ({ senderId: dmD.id, receiverId: dmA.id, content: `new-${i}`, createdAt: new Date(Date.now() - i * 1000) })),
    })
    r = await callApi("/api/messages", { cookie: cookieA })
    const convos = r.data?.conversations ?? []
    const partnerIds = convos.map((c) => c.partner?.id)
    r.status === 200 && partnerIds.includes(dmC.id) && partnerIds.includes(dmD.id)
      ? pass("dm inbox: old + new conversations both listed")
      : fail("dm inbox", { status: r.status, partners: partnerIds.length })

    // ══ Profile recents exclude soft-deleted (N-1) ═══════════════════
    const n1Thread = await prisma.thread.create({
      data: { title: "__av n1 thread", slug: `__av-n1-${Date.now().toString(36)}`, content: "0123456789", authorId: userA.id, categoryId: validCat.id },
      select: { id: true },
    })
    const n1Diary = await prisma.growDiary.create({
      data: { title: "__av n1 diary", description: "x", growType: "INDOOR", startDate: new Date(), authorId: userA.id, visibility: "PUBLIC" },
      select: { id: true },
    })
    r = await callApi("/api/profile", { cookie })
    const present = (r.data?.recentThreads ?? []).some((t) => t.id === n1Thread.id) && (r.data?.recentDiaries ?? []).some((d) => d.id === n1Diary.id)
    r.status === 200 && present ? pass("profile: own live thread/diary appear in recents") : fail("profile recents present", { status: r.status })
    await prisma.thread.update({ where: { id: n1Thread.id }, data: { deleted: true } })
    await prisma.growDiary.update({ where: { id: n1Diary.id }, data: { deleted: true } })
    r = await callApi("/api/profile", { cookie })
    const stillThere = (r.data?.recentThreads ?? []).some((t) => t.id === n1Thread.id) || (r.data?.recentDiaries ?? []).some((d) => d.id === n1Diary.id)
    r.status === 200 && !stillThere
      ? pass("profile: soft-deleted items excluded from own recents")
      : fail("profile recents deleted", { status: r.status, stillThere })

    // ══ Account deletion (HTTP) ══════════════════════════════════════
    r = await callApi("/api/profile", { method: "DELETE", body: {} })
    r.status === 401 ? pass("delete: anonymous → 401") : fail("delete: anonymous → 401", r.status)

    const loginE = await login(delE.username, delE.password)
    const cookieE = loginE.cookie

    // Missing fields → 400 (checked before the rate-limit bucket)
    r = await callApi("/api/profile", { method: "DELETE", body: {}, cookie: cookieE })
    r.status === 400 ? pass("delete: missing fields → 400") : fail("delete: missing fields → 400", r.status)

    r = await callApi("/api/profile", { method: "DELETE", body: { confirmUsername: delE.username, password: "WrongPass999!" }, cookie: cookieE })
    r.status === 403 ? pass("delete: wrong password → 403") : fail("delete: wrong password → 403", r.status)

    r = await callApi("/api/profile", { method: "DELETE", body: { confirmUsername: `${delE.username}_nope`, password: delE.password }, cookie: cookieE })
    r.status === 400 ? pass("delete: mismatched confirmUsername → 400") : fail("delete: mismatched confirmUsername → 400", r.status)

    // Ledger fixture: a post E made + matching events on both ledgers —
    // legacy reputation row and a live V2 progression award.
    const cat = await prisma.category.findFirst({ where: { hidden: false }, select: { id: true } })
    const eThread = await prisma.thread.create({
      data: { title: `__av del thread`, slug: `__av-del-${Date.now().toString(36)}`, content: "x", authorId: delE.id, categoryId: cat.id },
      select: { id: true },
    })
    const ePost = await prisma.post.create({
      data: { content: "fixture post", authorId: delE.id, threadId: eThread.id },
      select: { id: true },
    })
    await prisma.$transaction([
      prisma.reputationEvent.create({
        data: { userId: delE.id, type: "POST_CREATED", amount: 5, reason: "fixture", sourceType: "POST", sourceId: ePost.id },
      }),
      prisma.profile.update({ where: { userId: delE.id }, data: { reputation: { increment: 5 } } }),
      prisma.progressionEvent.create({
        data: { userId: delE.id, type: "POST_CREATED", xp: 2, reason: "fixture", sourceType: "POST", sourceId: ePost.id },
      }),
      prisma.profile.update({ where: { userId: delE.id }, data: { xp: { increment: 2 } } }),
    ])

    // Correct deletion — confirmUsername in different case proves insensitive match
    r = await callApi("/api/profile", {
      method: "DELETE",
      body: { confirmUsername: delE.username.toUpperCase(), password: delE.password },
      cookie: cookieE,
    })
    r.status === 200 && r.data?.deleted === true ? pass("delete: correct body → 200 {deleted:true}") : fail("delete: success", { status: r.status, data: r.data })
    const eGone = await prisma.user.findUnique({ where: { id: delE.id }, select: { id: true } })
    eGone === null ? pass("delete: user row gone (hard delete)") : fail("delete: user row gone", eGone)
    const pending = await prisma.pendingReversal.count({ where: { sourceId: ePost.id } })
    pending === 0 ? pass("delete: pending reversal drained for owned post") : fail("delete: pending reversal drained", pending)
    const xpPending = await prisma.pendingXpReversal.count({ where: { sourceId: ePost.id } })
    xpPending === 0 ? pass("delete: V2 pending reversal drained for owned post") : fail("delete: V2 pending reversal drained", xpPending)

    // Old cookie must no longer resolve a session
    r = await callApi("/api/messages?unread=1", { cookie: cookieE })
    r.status === 401 || r.status === 403 ? pass(`delete: old cookie → ${r.status}`) : fail("delete: old cookie rejected", r.status)

    // Rate limit: 3 attempts/hour per user — F burns 3 then hits 429
    const loginF = await login(rlF.username, rlF.password)
    const cookieF = loginF.cookie
    let last
    for (let i = 0; i < 3; i++) {
      last = await callApi("/api/profile", { method: "DELETE", body: { confirmUsername: rlF.username, password: "WrongPass999!" }, cookie: cookieF })
    }
    last.status === 403 ? pass("delete: 3rd failing attempt → 403") : fail("delete: 3rd failing attempt → 403", last.status)
    r = await callApi("/api/profile", { method: "DELETE", body: { confirmUsername: rlF.username, password: "WrongPass999!" }, cookie: cookieF })
    r.status === 429 ? pass("delete: 4th attempt → 429") : fail("delete: 4th attempt → 429", r.status)

    // ══ Pinned harvest (Garden Perk, HTTP) ═══════════════════════════
    // PATCH /api/profile { pinnedDiaryId } — the pin unlocks at Harvested
    // rank (7500 XP) or a 60-day streak marker; the diary must be the
    // member's own harvested, non-deleted grow.
    const phCookieA = (await login(phA.username, phA.password)).cookie
    const phCookieB = (await login(phB.username, phB.password)).cookie
    const phHarvested = await prisma.growDiary.create({
      data: { title: "__av ph harvested", description: "x", growType: "INDOOR", startDate: new Date(), authorId: phA.id, harvested: true, harvestedAt: new Date(), visibility: "PUBLIC" },
      select: { id: true },
    })
    const phUnharvested = await prisma.growDiary.create({
      data: { title: "__av ph live", description: "x", growType: "INDOOR", startDate: new Date(), authorId: phA.id, visibility: "PUBLIC" },
      select: { id: true },
    })
    const phForeign = await prisma.growDiary.create({
      data: { title: "__av ph foreign", description: "x", growType: "INDOOR", startDate: new Date(), authorId: dmB.id, harvested: true, harvestedAt: new Date(), visibility: "PUBLIC" },
      select: { id: true },
    })
    const pinBody = (v) => ({ pinnedDiaryId: v })
    const pinCheck = (ok, name, info) => { if (ok) pass(name); else fail(name, info) }

    r = await callApi("/api/profile", { method: "PATCH", body: pinBody(phHarvested.id), cookie: phCookieA })
    pinCheck(r.status === 403, "pin: below rank, no streak → 403", r.status)

    // Give phA the Harvested threshold on the V2 ledger (keeps xp == SUM).
    await prisma.$transaction([
      prisma.progressionEvent.create({ data: { userId: phA.id, type: "STAFF_ADJUSTMENT", xp: 7500, reason: "fixture rank bump" } }),
      prisma.profile.update({ where: { userId: phA.id }, data: { xp: { increment: 7500 } } }),
    ])

    r = await callApi("/api/profile", { method: "PATCH", body: pinBody(phForeign.id), cookie: phCookieA })
    pinCheck(r.status === 400, "pin: someone else's diary → 400", r.status)

    r = await callApi("/api/profile", { method: "PATCH", body: pinBody(phUnharvested.id), cookie: phCookieA })
    pinCheck(r.status === 400, "pin: unharvested diary → 400", r.status)

    r = await callApi("/api/profile", { method: "PATCH", body: pinBody(phHarvested.id), cookie: phCookieA })
    const pinnedNow = await prisma.profile.findUnique({ where: { userId: phA.id }, select: { pinnedDiaryId: true } })
    pinCheck(r.status === 200 && pinnedNow?.pinnedDiaryId === phHarvested.id, "pin: at Harvested rank → 200, pinned", { status: r.status, data: r.data })

    r = await callApi("/api/profile", { method: "PATCH", body: pinBody(null), cookie: phCookieA })
    const cleared = await prisma.profile.findUnique({ where: { userId: phA.id }, select: { pinnedDiaryId: true } })
    pinCheck(r.status === 200 && cleared?.pinnedDiaryId === null, "pin: null clears", { status: r.status, data: r.data })

    // Streak route: phB has low XP but a streak:60 marker (0 XP row).
    await prisma.progressionEvent.create({
      data: { userId: phB.id, type: "STREAK_MILESTONE", key: `streak:60:${phB.id}`, xp: 0, standing: 0, reason: "fixture streak marker" },
    })
    const phBharvest = await prisma.growDiary.create({
      data: { title: "__av phb harvested", description: "x", growType: "INDOOR", startDate: new Date(), authorId: phB.id, harvested: true, harvestedAt: new Date(), visibility: "PUBLIC" },
      select: { id: true },
    })
    r = await callApi("/api/profile", { method: "PATCH", body: pinBody(phBharvest.id), cookie: phCookieB })
    const bPinned = await prisma.profile.findUnique({ where: { userId: phB.id }, select: { pinnedDiaryId: true } })
    pinCheck(r.status === 200 && bPinned?.pinnedDiaryId === phBharvest.id, "pin: 60-day streak, low XP → 200, pinned", { status: r.status, data: r.data })

    // ══ Data export completeness (M-04) ══════════════════════════════
    // One fixture row per previously-missing model family; the export must
    // include all user-owned rows and strip staff-internal fields.
    const { cookie: expCookie } = await login(expU.username, expU.password)
    const expThread = await prisma.thread.create({
      data: { title: "__av exp thread", slug: `__av-exp-${Date.now().toString(36)}`, content: "0123456789", authorId: expU.id, categoryId: validCat.id },
    })
    const expPost = await prisma.post.create({
      data: { content: "0123456789", threadId: expThread.id, authorId: expU.id },
    })
    await prisma.postImage.create({ data: { url: "https://blob.test/post.png", threadId: expThread.id, postId: expPost.id } })
    const expPoll = await prisma.poll.create({
      data: { threadId: expThread.id, question: "exp poll?", options: { create: [{ text: "opt-a", order: 0 }] } },
      include: { options: true },
    })
    await prisma.pollVote.create({ data: { pollId: expPoll.id, optionId: expPoll.options[0].id, userId: expU.id } })
    const expDiary = await prisma.growDiary.create({
      data: { title: "__av exp diary", description: "x", growType: "INDOOR", startDate: new Date(), authorId: expU.id, visibility: "PRIVATE" },
    })
    const expUpdate = await prisma.diaryUpdate.create({
      data: { title: "exp update", content: "0123456789", stage: "VEGETATIVE", diaryId: expDiary.id, authorId: expU.id },
    })
    const expDiaryImg = await prisma.diaryImage.create({ data: { url: "https://blob.test/diary.png", updateId: expUpdate.id } })
    await prisma.growExperiment.create({
      data: { diaryId: expDiary.id, authorId: expU.id, title: "exp experiment", change: "raised light", category: "LIGHTING", status: "ACTIVE" },
    })
    const expSetup = await prisma.growSetup.create({ data: { title: "__av exp setup", description: "x", authorId: expU.id } })
    await prisma.setupImage.create({ data: { url: "https://blob.test/setup.png", setupId: expSetup.id } })
    const expStrain = await prisma.strain.create({ data: { name: `__av exp strain ${Date.now().toString(36)}`, createdById: expU.id } })
    await prisma.strainPhoto.create({ data: { kind: "PLANT", imageUrl: "data:image/png;base64,eA==", strainId: expStrain.id, userId: expU.id } })
    const expAch = await prisma.achievement.create({
      data: { key: `__av-ach-${Date.now().toString(36)}`, family: "LEGACY", name: "__av ach", description: "fixture" },
    })
    await prisma.userAchievement.create({ data: { userId: expU.id, achievementId: expAch.id } })
    await prisma.masteryProgress.upsert({
      where: { userId_mastery: { userId: expU.id, mastery: "RECORDS" } },
      create: { userId: expU.id, mastery: "RECORDS", xp: 10 },
      update: { xp: 10 },
    })
    await prisma.feedback.create({
      data: { authorId: expU.id, type: "BUG", title: "exp bug", message: "repro", adminNotes: "internal-note", priority: "HIGH" },
    })
    await prisma.botEvent.create({ data: { type: "COMMAND_SLASH", key: `__av-bot-${Date.now().toString(36)}`, userId: expU.id, command: "status" } })

    r = await callApi("/api/profile/export")
    r.status === 401 ? pass("export: anonymous → 401") : fail("export: anonymous → 401", r.status)
    r = await callApi("/api/profile/export", { cookie: expCookie })
    const ex = r.data ?? {}
    const exOk = r.status === 200
      && ex.achievements?.some((a) => a.achievementId === expAch.id)
      && ex.masteryProgress?.some((m) => m.mastery === "RECORDS")
      && ex.content?.postImages?.length === 1
      && ex.content?.diaryImages?.length === 1
      && ex.content?.setupImages?.length === 1
      && ex.content?.strainPhotos?.length === 1
      && ex.content?.experiments?.length === 1
      && ex.content?.polls?.length === 1
      && ex.content?.pollVotes?.[0]?.option?.text === "opt-a"
    exOk ? pass("export: all user-owned model families present") : fail("export completeness", { status: r.status, keys: Object.keys(ex) })
    const expFb = ex.activity?.feedback?.[0]
    expFb && !("adminNotes" in expFb) && !("priority" in expFb) && !("resolvedById" in expFb)
      ? pass("export: feedback strips staff-internal fields")
      : fail("export feedback redaction", expFb)
    const expBe = ex.activity?.botEvents?.[0]
    expBe && expBe.command === "status" && !("key" in expBe)
      ? pass("export: bot events scoped + key stripped")
      : fail("export botEvents", expBe)
    // Privacy invariant: private-diary image rows are still the owner's data.
    // The export serializes the authorization-aware media path, not the
    // underlying blob URL — a private-blob URL would not resolve anyway.
    ex.content?.diaryImages?.[0]?.url === `/api/media/diary/${expDiaryImg.id}`
      ? pass("export: private-diary image included via owner-scoped proxy URL")
      : fail("export diaryImage", ex.content?.diaryImages)
    // Rate-limit bucket for this user is spent by the fixtures above? No —
    // only one export call so far; verify the endpoint is the gated one.
    ex.exportedAt ? pass("export: shape carries exportedAt") : fail("export shape", Object.keys(ex))

    // ══ Registration CAPTCHA (HTTP) ══════════════════════════════════
    // Headroom: 5 attempts/15min per IP — clear fixture-stale buckets.
    await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "register:" } } }).catch(() => {})
    const mkCaptcha = (answer, expiresAt = new Date(Date.now() + 10 * 60 * 1000)) =>
      prisma.captcha.create({ data: { answer, expiresAt } }).then((c) => { captchaIds.push(c.id); return c })
    const regName = (t) => `__avr_${t}_${Date.now().toString(36)}`.slice(0, 20)
    const regBody = (username, captchaId, captchaAnswer) => ({
      username, password: "VerifyPass123!", ageVerified: true, captchaId, captchaAnswer,
    })

    const cap1 = await mkCaptcha("7")
    const u1 = regName("a")
    r = await callApi("/api/auth/register", { method: "POST", body: regBody(u1, cap1.id, "7") })
    r.status === 201 ? pass("register: valid captcha → 201") : fail("register: valid captcha → 201", { status: r.status, data: r.data })
    if (r.status === 201) registeredUsernames.push(u1)

    const u2 = regName("b")
    r = await callApi("/api/auth/register", { method: "POST", body: regBody(u2, cap1.id, "7") })
    r.status === 400 ? pass("register: replayed captcha → 400") : fail("register: replayed captcha → 400", r.status)
    if (r.status === 201) registeredUsernames.push(u2)

    const capExpired = await mkCaptcha("3", new Date(Date.now() - 60_000))
    r = await callApi("/api/auth/register", { method: "POST", body: regBody(regName("c"), capExpired.id, "3") })
    r.status === 400 ? pass("register: expired captcha → 400") : fail("register: expired captcha → 400", r.status)

    const capWrong = await mkCaptcha("5")
    r = await callApi("/api/auth/register", { method: "POST", body: regBody(regName("d"), capWrong.id, "9") })
    r.status === 400 ? pass("register: wrong answer → 400") : fail("register: wrong answer → 400", r.status)
    r = await callApi("/api/auth/register", { method: "POST", body: regBody(regName("e"), capWrong.id, "5") })
    r.status === 400 ? pass("register: wrong answer consumes captcha (retry fails)") : fail("register: wrong-answer consume", r.status)

    // The per-IP bucket (5/15min) is spent — refresh headroom for the last case.
    await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "register:" } } }).catch(() => {})
    r = await callApi("/api/auth/register", {
      method: "POST",
      body: { username: regName("f"), password: "VerifyPass123!", ageVerified: true, captchaId: 123, captchaAnswer: "1" },
    })
    r.status === 400 ? pass("register: non-string captchaId → 400") : fail("register: non-string captchaId → 400", r.status)

    console.log(`\n${results.filter(([s]) => s === "PASS").length} passed, ${results.filter(([s]) => s === "FAIL").length} failed`)
  } finally {
    // Export fixtures — rows that outlive their user (Feedback SetNull,
    // BotEvent bare userId, Achievement catalog, Strain.createdBy SetNull).
    await prisma.feedback.deleteMany({ where: { authorId: expU.id } }).catch(() => {})
    await prisma.botEvent.deleteMany({ where: { userId: expU.id } }).catch(() => {})
    await prisma.achievement.deleteMany({ where: { key: { startsWith: "__av-ach-" } } }).catch(() => {})
    await prisma.strain.deleteMany({ where: { createdById: expU.id } }).catch(() => {})
    for (const u of [userA, userB, userC, userD, dmA, dmB, dmC, dmD, delE, rlF, phA, phB, expU]) {
      await prisma.user.delete({ where: { id: u.id } }).catch(() => {})
    }
    for (const username of registeredUsernames) {
      const p = await prisma.profile.findUnique({ where: { username }, select: { userId: true } }).catch(() => null)
      if (p) await prisma.user.delete({ where: { id: p.userId } }).catch(() => {})
    }
    await prisma.captcha.deleteMany({ where: { id: { in: captchaIds } } }).catch(() => {})
    await prisma.rateLimit.deleteMany({
      where: {
        OR: [
          ...[dmA, dmB, dmC, dmD, rlF].map((u) => ({ key: { startsWith: `messages-read:${u.id}` } })),
          ...[dmA, dmB, dmC, dmD, rlF].map((u) => ({ key: `dm:${u.id}` })),
          { key: `account-delete:${delE.id}` },
          { key: `account-delete:${rlF.id}` },
        ],
      },
    }).catch(() => {})
    await prisma.$disconnect()
  }
}

main()
  .then(() => process.exit(results.some(([s]) => s === "FAIL") ? 1 : 0))
  .catch((e) => { console.error(e); process.exit(1) })
