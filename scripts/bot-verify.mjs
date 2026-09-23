// TerpBot boundary verification — exercises the bot exclusions and chat
// protections end-to-end against a running dev server. Temp fixtures use
// `__bv_<ts>` markers and are fully cleaned up.
// Run: node scripts\bot-verify.mjs   (requires `npm run dev` on :3000)
import { makeHarness } from "./lib/http-harness.mjs"

const { prisma, ts: TS, pass, fail, createUser, login, api, finish } = makeHarness({
  username: (tag, ts) => `__bv_${ts}_${tag}`,
  name: (tag, ts) => `__bvuser_${tag}_${ts}`,
  passMark: "PASS",
  failMark: "FAIL",
  loginShape: "string",
  summary: "counts",
})

async function main() {
  const bot = await prisma.profile.findUnique({ where: { username: "terpbot" }, select: { userId: true } })
  if (!bot) {
    // TerpBot is required infrastructure — master-tests seeds it via
    // terpbot-setup.cjs before this suite runs. Absence is a failure, never
    // a skip: a green run without the bot would silently verify nothing.
    console.error("FAIL — no terpbot profile in this database (run scripts/terpbot-setup.cjs first)")
    process.exit(1)
  }
  const botId = bot.userId

  const member = await createUser("m")
  const mod = await createUser("mod", { role: "MODERATOR" })
  const rooms = []
  const setupIds = []
  const diaryIds = []
  const extraUsers = []
  try {
    const memberCookie = await login(member.username, member.password)
    const modCookie = await login(mod.username, mod.password)

    // Rate-limit counters are DB-backed and persist between runs — clear the
    // chat keys so a previous run's commands don't consume this run's window.
    await prisma.rateLimit.deleteMany({
      where: { key: { startsWith: "chat" } },
    })
    // Registration limiter too — the referral test below consumes a slot.
    await prisma.rateLimit.deleteMany({
      where: { key: { startsWith: "register:" } },
    }).catch(() => {})
    // Bot output budgets (terpbot:out:global 60/hr, per-room 10/min) are
    // DB-backed too — a previous run's replies would otherwise suppress this
    // run's bot answers and cascade into false failures.
    await prisma.rateLimit.deleteMany({
      where: { key: { startsWith: "terpbot:out:" } },
    })

    // ── Identity ────────────────────────────────────────────────────
    const botUser = await prisma.user.findUnique({
      where: { id: botId },
      select: { role: true, password: true, recoveryPhraseHash: true, banned: true },
    })
    botUser?.role === "MEMBER" ? pass("bot role is MEMBER") : fail("bot role is MEMBER", botUser?.role)
    botUser?.password === null ? pass("bot password is null") : fail("bot password is null", "set")
    botUser?.recoveryPhraseHash === null ? pass("bot has no recovery credential") : fail("bot recovery credential", "set")
    const botProfiles = await prisma.profile.count({ where: { username: "terpbot" } })
    botProfiles === 1 ? pass("exactly one bot identity") : fail("exactly one bot identity", botProfiles)

    // ── Discovery exclusions ────────────────────────────────────────
    const us = await api(`/api/users/search?q=terpbot`, { cookie: memberCookie })
    const usHit = (us.data?.users || us.data || []).some?.((u) => u.username === "terpbot" || u.profile?.username === "terpbot")
    us.status === 200 && !usHit ? pass("bot excluded from /api/users/search") : fail("bot excluded from /api/users/search", us.data)

    const gs = await api(`/api/search?q=terpbot`, { cookie: memberCookie })
    const gsUsers = gs.data?.users || []
    gs.status === 200 && !gsUsers.some((u) => u.username === "terpbot")
      ? pass("bot excluded from /api/search users bucket")
      : fail("bot excluded from /api/search users bucket", gsUsers)

    const sg = await api(`/api/search/suggest?q=terp`, { cookie: memberCookie })
    const sgHit = (sg.data?.suggestions || sg.data || []).some?.((s) => s.type === "user" && s.title === "terpbot")
    !sgHit ? pass("bot excluded from /api/search/suggest") : fail("bot excluded from /api/search/suggest", sg.data)

    // ── DM rejection ────────────────────────────────────────────────
    const dm = await api(`/api/messages`, { method: "POST", body: { to: botId, content: "hi bot" }, cookie: memberCookie })
    dm.status === 400 ? pass("bot cannot be DM'd") : fail("bot cannot be DM'd", { status: dm.status, data: dm.data })
    const dmRows = await prisma.directMessage.count({ where: { senderId: member.id, receiverId: botId } })
    dmRows === 0 ? pass("no DM row persisted to bot") : fail("no DM row persisted to bot", dmRows)

    // ── Moderation commands can't target the bot ────────────────────
    const publicRoom = await prisma.chatRoom.create({
      data: { name: `__bv_${TS}`, slug: `__bv_${TS}`, isPrivate: false },
    })
    rooms.push(publicRoom.id)

    const warn = await api(`/api/chat/commands`, {
      method: "POST",
      body: { roomId: publicRoom.id, content: "/warn terpbot testing" },
      cookie: modCookie,
    })
    warn.status === 404 || warn.status === 400
      ? pass("/warn refuses terpbot target")
      : fail("/warn refuses terpbot target", { status: warn.status, data: warn.data })
    const warnActions = await prisma.moderationAction.count({
      where: { targetUserId: botId, createdAt: { gte: new Date(Date.now() - 60_000) } },
    })
    warnActions === 0 ? pass("no moderation action recorded against bot") : fail("no moderation action recorded against bot", warnActions)

    // ── Locked room blocks member commands ──────────────────────────
    const lockedRoom = await prisma.chatRoom.create({
      data: { name: `__bv_${TS}_locked`, slug: `__bv_${TS}_locked`, isPrivate: false, locked: true },
    })
    rooms.push(lockedRoom.id)
    const lockedCmd = await api(`/api/chat/commands`, {
      method: "POST", body: { roomId: lockedRoom.id, content: "/tip" }, cookie: memberCookie,
    })
    lockedCmd.status === 403 ? pass("member command blocked in locked room") : fail("member command blocked in locked room", { status: lockedCmd.status, data: lockedCmd.data })
    // Staff commands still work in a locked room (moderation tools).
    const staffLock = await api(`/api/chat/commands`, {
      method: "POST", body: { roomId: lockedRoom.id, content: "/slowmode 5" }, cookie: modCookie,
    })
    staffLock.status === 200 ? pass("staff command works in locked room") : fail("staff command works in locked room", { status: staffLock.status, data: staffLock.data })
    await prisma.chatRoom.update({ where: { id: lockedRoom.id }, data: { slowModeSeconds: 0 } })

    // ── Slowmode blocks rapid member commands ───────────────────────
    const slowRoom = await prisma.chatRoom.create({
      data: { name: `__bv_${TS}_slow`, slug: `__bv_${TS}_slow`, isPrivate: false, slowModeSeconds: 600 },
    })
    rooms.push(slowRoom.id)
    const slow1 = await api(`/api/chat/commands`, {
      method: "POST", body: { roomId: slowRoom.id, content: "/flip" }, cookie: memberCookie,
    })
    const slow2 = await api(`/api/chat/commands`, {
      method: "POST", body: { roomId: slowRoom.id, content: "/flip" }, cookie: memberCookie,
    })
    slow1.status === 200 && slow2.status === 429
      ? pass("slowmode rate-limits member commands")
      : fail("slowmode rate-limits member commands", { s1: slow1.status, s2: slow2.status, d2: slow2.data })

    // ── CHAT_ENABLED blocks member commands ─────────────────────────
    await prisma.setting.upsert({
      where: { key: "chat_enabled" },
      create: { key: "chat_enabled", value: "false" },
      update: { value: "false" },
    })
    const disabledCmd = await api(`/api/chat/commands`, {
      method: "POST", body: { roomId: publicRoom.id, content: "/tip" }, cookie: memberCookie,
    })
    disabledCmd.status === 403 ? pass("member command blocked while chat disabled") : fail("member command blocked while chat disabled", { status: disabledCmd.status, data: disabledCmd.data })
    // Staff moderation tools remain available during a chat shutdown.
    const staffWhileOff = await api(`/api/chat/commands`, {
      method: "POST", body: { roomId: publicRoom.id, content: "/slowmode 10" }, cookie: modCookie,
    })
    staffWhileOff.status === 200 ? pass("staff command works while chat disabled") : fail("staff command works while chat disabled", { status: staffWhileOff.status, data: staffWhileOff.data })
    await prisma.setting.upsert({
      where: { key: "chat_enabled" },
      create: { key: "chat_enabled", value: "true" },
      update: { value: "true" },
    })
    // The /slowmode 10 staff check left the shared room in slow mode —
    // reset it so subsequent member commands aren't rate-limited.
    await prisma.chatRoom.update({ where: { id: publicRoom.id }, data: { slowModeSeconds: 0 } })

    // ── @terpbot ping still answers as a normal member ──────────────
    // Fresh room — the 60s/room bot floor would suppress the reply if a
    // staff command had just posted a bot message here.
    const pingRoom = await prisma.chatRoom.create({
      data: { name: `__bv_${TS}_ping`, slug: `__bv_${TS}_ping`, isPrivate: false },
    })
    rooms.push(pingRoom.id)
    const ping = await api(`/api/chat/messages`, {
      method: "POST", body: { roomId: pingRoom.id, content: "@terpbot ping" }, cookie: memberCookie,
    })
    ping.status === 201 || ping.status === 200 ? pass("member can post @terpbot ping") : fail("member can post @terpbot ping", { status: ping.status, data: ping.data })
    // The reply is dispatched via after() — poll briefly like mention() does;
    // a single fixed sleep races the async respond() in dev.
    let botReply = null
    for (let i = 0; i < 16 && !botReply; i++) {
      await new Promise((r) => setTimeout(r, 500))
      botReply = await prisma.chatMessage.findFirst({
        where: { roomId: pingRoom.id, authorId: botId, deleted: false, createdAt: { gte: new Date(Date.now() - 15_000) } },
      })
    }
    botReply ? pass("bot answered the @terpbot ping as MEMBER") : fail("bot answered the @terpbot ping", "no bot reply row")

    // The ping must not create a MENTION notification to the bot.
    const mentionRows = await prisma.notification.count({
      where: { userId: botId, type: "MENTION", createdAt: { gte: new Date(Date.now() - 60_000) } },
    })
    mentionRows === 0 ? pass("no MENTION notification delivered to bot") : fail("no MENTION notification delivered to bot", mentionRows)

    // ── Section 2: registry-dispatched informational commands ─────────
    // Per-room bot output cap is 10/min and these commands run back-to-back —
    // clear the room's counter before each command so the budget doesn't
    // suppress replies mid-phase (mention() uses a fresh room for the same
    // reason).
    const cmd = async (content, cookie = memberCookie) => {
      await prisma.rateLimit.deleteMany({
        where: { key: { in: [`terpbot:out:room:${publicRoom.id}`, `chat-bot-out:${publicRoom.id}`] } },
      })
      return api(`/api/chat/commands`, { method: "POST", body: { roomId: publicRoom.id, content }, cookie })
    }

    const helpCmd = await cmd("/help")
    helpCmd.status === 200 && /\/rep/.test(helpCmd.data?.message?.content || "")
      ? pass("/help lists new commands")
      : fail("/help lists new commands", helpCmd.data)

    for (const [content, pattern, label] of [
      ["/rep", /\d+ rep|Seed/i, "/rep answers with reputation"],
      ["/progress", /tier|progress/i, "/progress answers with tier progress"],
      ["/rank", /#\d+|leaderboard/i, "/rank answers with leaderboard position"],
      ["/streak", /streak|updates/i, "/streak answers"],
      ["/badge", /badge/i, "/badge answers"],
      ["/nextbadges", /badge/i, "/nextbadges answers"],
      ["/diary", /diary|diaries/i, "/diary answers"],
      ["/thread nutrient", /thread|forum|no threads/i, "/thread answers"],
      ["/online", /online|active|quiet/i, "/online answers"],
      ["/digest", /24 hours|digest|quiet/i, "/digest answers"],
      ["/leaderboard", /top|growers/i, "alias /leaderboard → /top"],
    ]) {
      const res = await cmd(content)
      const text = res.data?.message?.content || ""
      res.status === 200 && pattern.test(text)
        ? pass(label)
        : fail(label, { status: res.status, data: res.data })
    }

    // Staff commands now 403 for members through the registry gate
    // (previously "Unknown command"); behavior must not grant anything.
    const memberBan = await cmd("/ban @someone spam")
    memberBan.status === 403 ? pass("member /ban gets 403") : fail("member /ban gets 403", { status: memberBan.status })

    // Unknown commands are answered by the bot with a friendly pointer
    // (200 + bot message), not a bare API error.
    const unknownCmd = await cmd("/definitelynotacommand")
    const unknownText = unknownCmd.data?.message?.content || ""
    unknownCmd.status === 200 && /Unknown command/.test(unknownText) && /\/help/.test(unknownText)
      ? pass("unknown command gets bot help pointer")
      : fail("unknown command gets bot help pointer", { status: unknownCmd.status, data: unknownCmd.data })

    // Did-you-mean: a near-miss resolves to the closest registered command.
    const typo = await cmd("/diari")
    const typoText = typo.data?.message?.content || ""
    typo.status === 200 && /did you mean \/diary/.test(typoText)
      ? pass("did-you-mean suggests /diary for /diari")
      : fail("did-you-mean suggests /diary for /diari", { status: typo.status, data: typo.data })

    // Link laundering — a low-trust user must not get a URL echoed by the bot.
    const launder = await cmd("/ask https://malware.example/steal")
    const launderText = launder.data?.message?.content || ""
    launder.status === 200 && !launderText.includes("malware.example")
      ? pass("bot refuses to echo links in command output")
      : fail("bot refuses to echo links in command output", { status: launder.status, data: launder.data })

    // ── Section 2: @terpbot intent routing ────────────────────────────
    // Each mention gets a fresh room — the 60s/room bot floor would
    // otherwise suppress consecutive replies.
    async function mention(content) {
      const r = await prisma.chatRoom.create({
        data: { name: `__bv_${TS}_${Math.random().toString(36).slice(2, 8)}`, slug: `__bv_${TS}_${Math.random().toString(36).slice(2, 8)}`, isPrivate: false },
      })
      rooms.push(r.id)
      const posted = await api(`/api/chat/messages`, {
        method: "POST", body: { roomId: r.id, content }, cookie: memberCookie,
      })
      // respond() is fire-and-forget — poll for up to 5s (first mention may
      // cold-compile the intent/data modules in dev).
      let reply = null
      for (let i = 0; i < 10 && !reply; i++) {
        await new Promise((res) => setTimeout(res, 500))
        reply = await prisma.chatMessage.findFirst({
          where: { roomId: r.id, authorId: botId, deleted: false },
          orderBy: { createdAt: "desc" },
        })
      }
      return { reply, posted }
    }

    const repM = await mention("@terpbot what's my reputation?")
    repM.reply && /\d+ rep|Seed/i.test(repM.reply.content)
      ? pass("intent: reputation")
      : fail("intent: reputation", repM.reply?.content)

    const streakM = await mention("@terpbot what's my grow streak?")
    streakM.reply && /streak|updates/i.test(streakM.reply.content)
      ? pass("intent: grow streak")
      : fail("intent: grow streak", streakM.reply?.content)

    const refuseM = await mention(`@terpbot ban @${member.username}`)
    refuseM.reply && /moderation|staff/i.test(refuseM.reply.content)
      ? pass("intent: moderation request refused")
      : fail("intent: moderation request refused", refuseM.reply?.content)
    const refuseActions = await prisma.moderationAction.count({
      where: { targetUserId: member.id, createdAt: { gte: new Date(Date.now() - 60_000) } },
    })
    refuseActions === 0
      ? pass("refused mention created no moderation action")
      : fail("refused mention created no moderation action", refuseActions)

    const fallbackM = await mention("@terpbot xyzzyqq")
    fallbackM.reply && /not sure|didn't catch|try asking/i.test(fallbackM.reply.content)
      ? pass("intent: unknown input falls back gracefully")
      : fail("intent: unknown input falls back gracefully", fallbackM.reply?.content)

    // ── Section 3: thread-context commands ──────────────────────────
    // Fixtures: a public thread with an accepted answer, plus a hidden-
    // category thread that must never be acknowledged.
    const ctxCat = await prisma.category.create({
      data: { name: `__bvctx_${TS}`, slug: `__bvctx-${TS}`, description: "t" },
    })
    const ctxHidCat = await prisma.category.create({
      data: { name: `__bvctxh_${TS}`, slug: `__bvctxh-${TS}`, description: "t", hidden: true },
    })
    const ctxThread = await prisma.thread.create({
      data: {
        title: `__bvctx thread ${TS}`, slug: `bvctx-${TS}`,
        content: "my leaves are curling up, what gives",
        categoryId: ctxCat.id, authorId: member.id, replyCount: 1,
      },
    })
    const ctxReply = await prisma.post.create({
      data: { content: "sounds like heat stress, raise the light", threadId: ctxThread.id, authorId: mod.id },
    })
    await prisma.thread.update({ where: { id: ctxThread.id }, data: { acceptedAnswerId: ctxReply.id } })
    const ctxHidden = await prisma.thread.create({
      data: { title: "secret thread", slug: `bvctxh-${TS}`, content: "hidden", categoryId: ctxHidCat.id, authorId: member.id },
    })
    try {
      // /summarize via slash command with an inline link.
      const sumCmd = await cmd(`/summarize /forum/thread/${ctxThread.slug}`)
      const sumText = sumCmd.data?.message?.content || ""
      sumCmd.status === 200 && sumText.includes(ctxThread.title) && /accepted answer/i.test(sumText)
        ? pass("/summarize describes the linked thread + accepted answer")
        : fail("/summarize describes the linked thread", { status: sumCmd.status, data: sumCmd.data })

      // Hidden thread → same refusal as a nonexistent one.
      const hidCmd = await cmd(`/summarize /forum/thread/${ctxHidden.slug}`)
      const hidText = hidCmd.data?.message?.content || ""
      hidCmd.status === 200 && /couldn't pull up/i.test(hidText)
        ? pass("hidden thread gets the uniform not-found refusal")
        : fail("hidden thread gets the uniform not-found refusal", { status: hidCmd.status, data: hidCmd.data })

      // @terpbot mention containing a link → summarize intent.
      const linkM = await mention(`@terpbot summarize this /forum/thread/${ctxThread.slug}`)
      linkM.reply && linkM.reply.content.includes(ctxThread.title)
        ? pass("mention: summarize resolves link in the same message")
        : fail("mention: summarize resolves link in the same message", linkM.reply?.content)

      // @terpbot in a REPLY to a link-bearing message → resolved via replyTo.
      const anchorRoom = await prisma.chatRoom.create({
        data: { name: `__bv_${TS}_anchor`, slug: `__bv_${TS}_anchor`, isPrivate: false },
      })
      rooms.push(anchorRoom.id)
      const anchor = await api(`/api/chat/messages`, {
        method: "POST", body: { roomId: anchorRoom.id, content: `can anyone check /forum/thread/${ctxThread.slug}` }, cookie: memberCookie,
      })
      const anchorId = anchor.data?.message?.id
      const replyM = await api(`/api/chat/messages`, {
        method: "POST", body: { roomId: anchorRoom.id, content: "@terpbot did anyone answer this?", replyToId: anchorId }, cookie: memberCookie,
      })
      replyM.status === 201 || replyM.status === 200 ? pass("reply mention posted") : fail("reply mention posted", replyM.data)
      let replyBot = null
      for (let i = 0; i < 10 && !replyBot; i++) {
        await new Promise((r) => setTimeout(r, 500))
        replyBot = await prisma.chatMessage.findFirst({
          where: { roomId: anchorRoom.id, authorId: botId, deleted: false },
          orderBy: { createdAt: "desc" },
        })
      }
      replyBot && /accepted answer/i.test(replyBot.content)
        ? pass("mention: answered resolves thread via replied-to message")
        : fail("mention: answered resolves thread via replied-to message", replyBot?.content)

      // A successful mention records a COMMAND_MENTION BotEvent. The event
      // write is async — poll briefly like the COMMAND_SLASH check below.
      let ev = null
      for (let i = 0; i < 10 && !ev; i++) {
        await new Promise((r) => setTimeout(r, 500))
        ev = await prisma.botEvent.findFirst({
          where: { type: "COMMAND_MENTION", command: "answered", userId: member.id },
        })
      }
      ev ? pass("COMMAND_MENTION BotEvent recorded") : fail("COMMAND_MENTION BotEvent recorded", "missing")

      // Slash command records COMMAND_SLASH with entity links counted.
      // Two summarize events exist (accessible + hidden thread — the hidden
      // one legitimately has entities 0), so filter for the counted one and
      // poll for the async BotEvent write.
      let evSlash = null
      for (let i = 0; i < 10 && !evSlash; i++) {
        await new Promise((r) => setTimeout(r, 500))
        evSlash = await prisma.botEvent.findFirst({
          where: { type: "COMMAND_SLASH", command: "summarize", userId: member.id, entities: { gte: 1 } },
        })
      }
      evSlash
        ? pass("COMMAND_SLASH BotEvent counts the thread link")
        : fail("COMMAND_SLASH BotEvent counts the thread link", "no summarize event with entities >= 1")
    } finally {
      await prisma.post.deleteMany({ where: { threadId: { in: [ctxThread.id, ctxHidden.id] } } }).catch(() => {})
      await prisma.thread.deleteMany({ where: { id: { in: [ctxThread.id, ctxHidden.id] } } }).catch(() => {})
      await prisma.category.deleteMany({ where: { id: { in: [ctxCat.id, ctxHidCat.id] } } }).catch(() => {})
    }

    // ── Section 3: /u/terpbot profile API ───────────────────────────
    const prof = await api(`/api/users/terpbot`, { cookie: memberCookie })
    prof.status === 200 && prof.data?.profile?.isBot === true
      ? pass("profile API marks terpbot as isBot")
      : fail("profile API marks terpbot as isBot", { status: prof.status, isBot: prof.data?.profile?.isBot })
    prof.data?.profile?.role === "MEMBER"
      ? pass("profile API exposes bot role MEMBER")
      : fail("profile API exposes bot role MEMBER", prof.data?.profile?.role)
    const bs = prof.data?.profile?.botStats
    bs && typeof bs.commands === "number" && typeof bs.membersAssisted === "number" && typeof bs.daysActive === "number"
      ? pass("profile API returns real botStats")
      : fail("profile API returns real botStats", bs)

    // ── Section 3: referral hole — the bot can never be a referrer ──
    const refCaptcha = await prisma.captcha.create({
      data: { answer: "7", expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
    })
    const refUsername = `__bvref_${TS}`.slice(0, 20)
    const reg = await api(`/api/auth/register`, {
      method: "POST",
      body: {
        username: refUsername, password: "VerifyPass123!", ageVerified: true,
        referralCode: "terpbot", captchaId: refCaptcha.id, captchaAnswer: "7",
      },
    })
    if (reg.status === 201) {
      const refProfile = await prisma.profile.findUnique({ where: { username: refUsername }, select: { referredById: true } })
      refProfile && refProfile.referredById === null
        ? pass("terpbot referral is ignored at registration")
        : fail("terpbot referral is ignored at registration", refProfile)
      const botRefNotif = await prisma.notification.count({
        where: { userId: botId, type: "REFERRAL", createdAt: { gte: new Date(Date.now() - 60_000) } },
      })
      botRefNotif === 0 ? pass("bot received no referral notification") : fail("bot received no referral notification", botRefNotif)
      const refUser = await prisma.user.findFirst({ where: { name: refUsername }, select: { id: true } })
      if (refUser) await prisma.user.delete({ where: { id: refUser.id } }).catch(() => {})
    } else {
      fail("referral-guard registration returns 201", { status: reg.status, data: reg.data })
    }

    // ── Section 4: /setup command + setup mention intents ────────────
    {
      const ownSetup = await prisma.growSetup.create({
        data: {
          title: `__bv tent ${TS}`, slug: `__bv-tent-${TS}`, description: "t",
          tent: "4x4 AC Infinity", lighting: "Mars Hydro TS1000", medium: "coco",
          authorId: member.id,
        },
      })
      const delSetup = await prisma.growSetup.create({
        data: {
          title: `__bv del ${TS}`, description: "t", tent: "zzbvdeleted",
          authorId: member.id, deleted: true,
        },
      })
      setupIds.push(ownSetup.id, delSetup.id)

      const setupRes = await cmd(`/setup @${member.username}`)
      const setupText = setupRes.data?.message?.content || ""
      setupRes.status === 200 && setupText.includes(`__bv tent ${TS}`) && setupText.includes(`/setups/__bv-tent-${TS}`)
        ? pass("/setup @user returns setup with canonical slug link")
        : fail("/setup @user returns setup with canonical slug link", { status: setupRes.status, data: setupRes.data })

      const setupSearch = await cmd("/setup mars hydro")
      const searchText = setupSearch.data?.message?.content || ""
      setupSearch.status === 200 && searchText.includes(`__bv tent ${TS}`) && /Mars Hydro/i.test(searchText)
        ? pass("/setup equipment search hits")
        : fail("/setup equipment search hits", { status: setupSearch.status, data: setupSearch.data })

      const setupDel = await cmd("/setup zzbvdeleted")
      const delText = setupDel.data?.message?.content || ""
      setupDel.status === 200 && /No setups matching/.test(delText) && delText.includes("/setups")
        ? pass("/setup excludes deleted setups")
        : fail("/setup excludes deleted setups", { status: setupDel.status, data: setupDel.data })

      const setupNone = await cmd("/setup zzz-no-match-zzz")
      const noneText = setupNone.data?.message?.content || ""
      setupNone.status === 200 && /No setups matching/.test(noneText)
        ? pass("/setup no-result response")
        : fail("/setup no-result response", { status: setupNone.status, data: setupNone.data })

      const setupList = await cmd("/setup")
      const listText = setupList.data?.message?.content || ""
      setupList.status === 200 && /setup/i.test(listText)
        ? pass("/setup no-arg lists setups")
        : fail("/setup no-arg lists setups", { status: setupList.status, data: setupList.data })

      // Mention intents hit the same data path.
      const lightsM = await mention(`@terpbot what lights does @${member.username} run`)
      lightsM.reply && lightsM.reply.content.includes(`__bv tent ${TS}`) && /Mars Hydro/i.test(lightsM.reply.content)
        ? pass("intent: what lights does @user run")
        : fail("intent: what lights does @user run", lightsM.reply?.content)

      const tentM = await mention(`@terpbot what tent is @${member.username} using`)
      tentM.reply && tentM.reply.content.includes(`__bv tent ${TS}`)
        ? pass("intent: what tent is @user using")
        : fail("intent: what tent is @user using", tentM.reply?.content)

      const showM = await mention(`@terpbot show me @${member.username}'s setup`)
      showM.reply && showM.reply.content.includes(`/setups/__bv-tent-${TS}`)
        ? pass("intent: show me @user's setup")
        : fail("intent: show me @user's setup", showM.reply?.content)
    }

    // ── Section 4b: stage-flip announcements via the real update path ──
    {
      const general = await prisma.chatRoom.findFirst({ where: { slug: "general" } }) ??
        await prisma.chatRoom.findFirst({ where: { isPrivate: false }, orderBy: { createdAt: "asc" } })
      if (!general) {
        fail("stage announce: public room exists", "no public room")
      } else {
        // Announcements share the bot output budget — reset so the suite
        // itself can't suppress a post and look like a privacy gate.
        await prisma.rateLimit.deleteMany({
          where: { key: { in: ["terpbot:out:global", `terpbot:out:room:${general.id}`] } },
        }).catch(() => {})
        const since = new Date()
        const announcements = async (needle) =>
          prisma.chatMessage.findMany({
            where: { roomId: general.id, authorId: botId, createdAt: { gte: since }, content: { contains: needle } },
            select: { id: true, content: true },
          })
        const waitFor = async (needle, minCount = 1, tries = 12) => {
          for (let i = 0; i < tries; i++) {
            const msgs = await announcements(needle)
            if (msgs.length >= minCount) return msgs
            await new Promise((r) => setTimeout(r, 500))
          }
          return announcements(needle)
        }
        const settle = () => new Promise((r) => setTimeout(r, 2500))
        const mkDiary = (authorId, stage, visibility = "PUBLIC", slug = "") =>
          prisma.growDiary.create({
            data: {
              title: `__bv stage ${TS}`, description: "t", growType: "INDOOR",
              startDate: new Date(), authorId, stage, visibility,
              slug: slug || undefined,
            },
          })
        const postUpdate = (diaryId, stage, cookie = memberCookie) =>
          api(`/api/diaries/updates`, {
            method: "POST",
            body: { diaryId, title: `__bv upd ${TS}`, content: "week update posting", stage },
            cookie,
          })

        // PUBLIC diary: GERMINATION → VEGETATIVE announces once.
        const d1 = await mkDiary(member.id, "GERMINATION", "PUBLIC", `__bv-stg-${TS}`)
        diaryIds.push(d1.id)
        const u1 = await postUpdate(d1.id, "VEGETATIVE")
        u1.status === 201 ? pass("stage update posted") : fail("stage update posted", { status: u1.status, data: u1.data })
        const ann1 = await waitFor(`__bv-stg-${TS}`)
        ann1.length === 1 && /Germination → Vegetative/.test(ann1[0].content) && ann1[0].content.includes(`/diaries/__bv-stg-${TS}`)
          ? pass("stage flip announces once with canonical slug")
          : fail("stage flip announces once with canonical slug", ann1.map((m) => m.content))

        // Same-stage edit → no second announcement.
        await postUpdate(d1.id, "VEGETATIVE")
        await settle()
        const stillOne = await announcements(`__bv-stg-${TS}`)
        stillOne.length === 1
          ? pass("unchanged stage produces no announcement")
          : fail("unchanged stage produces no announcement", stillOne.map((m) => m.content))

        // A further transition announces exactly once — including retries.
        const u2 = await postUpdate(d1.id, "FLOWER")
        u2.status === 201 ? pass("second stage update posted") : fail("second stage update posted", u2.data)
        const ann2 = await waitFor(`__bv-stg-${TS}`, 2)
        ann2.length === 2 && /Vegetative → Flower/.test(ann2[1].content)
          ? pass("subsequent transition announces")
          : fail("subsequent transition announces", ann2.map((m) => m.content))
        await postUpdate(d1.id, "FLOWER")
        await settle()
        const afterDup = await announcements(`__bv-stg-${TS}`)
        afterDup.length === 2
          ? pass("repeated same-stage update does not duplicate")
          : fail("repeated same-stage update does not duplicate", afterDup.map((m) => m.content))

        // PRIVATE + UNLISTED diaries never announce.
        const dPriv = await mkDiary(member.id, "VEGETATIVE", "PRIVATE", `__bv-priv-${TS}`)
        diaryIds.push(dPriv.id)
        await postUpdate(dPriv.id, "FLOWER")
        const dUnl = await mkDiary(member.id, "VEGETATIVE", "UNLISTED", `__bv-unl-${TS}`)
        diaryIds.push(dUnl.id)
        await postUpdate(dUnl.id, "FLOWER")
        await settle()
        const privCount = await announcements(`__bv-priv-${TS}`)
        const unlCount = await announcements(`__bv-unl-${TS}`)
        privCount.length === 0 ? pass("PRIVATE diary stage change silent") : fail("PRIVATE diary stage change silent", privCount.length)
        unlCount.length === 0 ? pass("UNLISTED diary stage change silent") : fail("UNLISTED diary stage change silent", unlCount.length)

        // Opted-out member never announces.
        const opted = await createUser("opt", {})
        extraUsers.push(opted.id)
        await prisma.profile.update({ where: { userId: opted.id }, data: { publicMilestoneOptOut: true } })
        const optedCookie = await login(opted.username, opted.password)
        const dOpt = await mkDiary(opted.id, "VEGETATIVE", "PUBLIC", `__bv-opt-${TS}`)
        diaryIds.push(dOpt.id)
        await postUpdate(dOpt.id, "FLOWER", optedCookie)
        await settle()
        const optCount = await announcements(`__bv-opt-${TS}`)
        optCount.length === 0
          ? pass("opted-out member's stage change silent")
          : fail("opted-out member's stage change silent", optCount.map((m) => m.content))

        // Post-announce visibility flip: the announce lands while PUBLIC,
        // then the real PATCH purge must remove the bot's message so the
        // diary title+link can't outlive the diary's privacy.
        const dStale = await mkDiary(member.id, "VEGETATIVE", "PUBLIC", `__bv-stale-${TS}`)
        diaryIds.push(dStale.id)
        await postUpdate(dStale.id, "FLOWER")
        const staleLanded = await waitFor(`__bv-stale-${TS}`)
        staleLanded.length === 1
          ? pass("announcement posted while PUBLIC")
          : fail("announcement posted while PUBLIC", staleLanded.map((m) => m.content))
        const flip = await api(`/api/diaries/${dStale.id}`, {
          method: "PATCH", body: { visibility: "PRIVATE" }, cookie: memberCookie,
        })
        flip.status === 200 ? pass("visibility flip PATCH accepted") : fail("visibility flip PATCH accepted", { status: flip.status, data: flip.data })
        await settle()
        const staleCount = await announcements(`__bv-stale-${TS}`)
        staleCount.length === 0
          ? pass("visibility flip purges posted announcement")
          : fail("visibility flip purges posted announcement", staleCount.map((m) => m.content))
      }
    }

    // Bot replies must never contain the trigger — no self-loop possible.
    const allBotMsgs = await prisma.chatMessage.findMany({
      where: { authorId: botId, createdAt: { gte: new Date(Date.now() - 120_000) } },
      select: { content: true },
    })
    allBotMsgs.every((m) => !/@terpbot/i.test(m.content))
      ? pass("no bot reply contains @terpbot (no self-loop)")
      : fail("no bot reply contains @terpbot", allBotMsgs.filter((m) => /@terpbot/i.test(m.content)).slice(0, 2))
  } finally {
    for (const roomId of rooms) {
      await prisma.chatMessage.deleteMany({ where: { roomId } }).catch(() => {})
      await prisma.chatRoom.delete({ where: { id: roomId } }).catch(() => {})
    }
    await prisma.growSetup.deleteMany({ where: { id: { in: setupIds } } }).catch(() => {})
    await prisma.diaryUpdate.deleteMany({ where: { diaryId: { in: diaryIds } } }).catch(() => {})
    await prisma.growDiary.deleteMany({ where: { id: { in: diaryIds } } }).catch(() => {})
    await prisma.chatMessage.deleteMany({
      where: { authorId: botId, content: { contains: `__bv` } },
    }).catch(() => {})
    for (const did of diaryIds) {
      await prisma.botEvent.deleteMany({ where: { key: { startsWith: `announce:stage:${did}:` } } }).catch(() => {})
    }
    for (const uid of extraUsers) await prisma.user.delete({ where: { id: uid } }).catch(() => {})
    await prisma.notification.deleteMany({ where: { userId: member.id } }).catch(() => {})
    await prisma.user.delete({ where: { id: member.id } }).catch(() => {})
    await prisma.user.delete({ where: { id: mod.id } }).catch(() => {})
    await prisma.$disconnect()
  }

  process.exit(finish())
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
