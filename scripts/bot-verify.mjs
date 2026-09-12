// TerpBot boundary verification — exercises the bot exclusions and chat
// protections end-to-end against a running dev server. Temp fixtures use
// `__bv_<ts>` markers and are fully cleaned up.
// Run: node scripts\bot-verify.mjs   (requires `npm run dev` on :3000)
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const BASE = process.env.VERIFY_URL || "http://localhost:3000"
const prisma = new PrismaClient()
const results = []
function pass(n) { results.push(["PASS", n]); console.log(`  PASS ${n}`) }
function fail(n, i) { results.push(["FAIL", n]); console.log(`  FAIL ${n} — ${JSON.stringify(i)?.slice(0, 300)}`) }

const TS = Date.now().toString(36)

async function createUser(tag, extra = {}) {
  const password = "VerifyPass123!"
  const user = await prisma.user.create({
    data: {
      name: `__bvuser_${tag}_${TS}`,
      ageVerified: true,
      password: await bcrypt.hash(password, 12),
      sessionVersion: 1,
      onboardingCompletedAt: new Date(),
      profile: { create: { username: `__bv_${TS}_${tag}` } },
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
  return cookies
}

async function api(path, { method = "GET", body, cookie } = {}) {
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

async function main() {
  const bot = await prisma.profile.findUnique({ where: { username: "terpbot" }, select: { userId: true } })
  if (!bot) {
    console.log("SKIP — no terpbot profile in this database")
    process.exit(0)
  }
  const botId = bot.userId

  const member = await createUser("m")
  const mod = await createUser("mod", { role: "MODERATOR" })
  const rooms = []
  try {
    const memberCookie = await login(member.username, member.password)
    const modCookie = await login(mod.username, mod.password)

    // Rate-limit counters are DB-backed and persist between runs — clear the
    // chat keys so a previous run's commands don't consume this run's window.
    await prisma.rateLimit.deleteMany({
      where: { key: { startsWith: "chat" } },
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
    // Give the synchronous bot reply a moment to land.
    await new Promise((r) => setTimeout(r, 500))
    const botReply = await prisma.chatMessage.findFirst({
      where: { roomId: pingRoom.id, authorId: botId, deleted: false, createdAt: { gte: new Date(Date.now() - 10_000) } },
    })
    botReply ? pass("bot answered the @terpbot ping as MEMBER") : fail("bot answered the @terpbot ping", "no bot reply row")

    // The ping must not create a MENTION notification to the bot.
    const mentionRows = await prisma.notification.count({
      where: { userId: botId, type: "MENTION", createdAt: { gte: new Date(Date.now() - 60_000) } },
    })
    mentionRows === 0 ? pass("no MENTION notification delivered to bot") : fail("no MENTION notification delivered to bot", mentionRows)

    // ── Phase 2: registry-dispatched informational commands ─────────
    const cmd = (content, cookie = memberCookie) =>
      api(`/api/chat/commands`, { method: "POST", body: { roomId: publicRoom.id, content }, cookie })

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

    const unknownCmd = await cmd("/definitelynotacommand")
    unknownCmd.status === 400 ? pass("unknown command still 400") : fail("unknown command still 400", { status: unknownCmd.status })

    // Link laundering — a low-trust user must not get a URL echoed by the bot.
    const launder = await cmd("/ask https://malware.example/steal")
    const launderText = launder.data?.message?.content || ""
    launder.status === 200 && !launderText.includes("malware.example")
      ? pass("bot refuses to echo links in command output")
      : fail("bot refuses to echo links in command output", { status: launder.status, data: launder.data })

    // ── Phase 2: @terpbot intent routing ────────────────────────────
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
    await prisma.notification.deleteMany({ where: { userId: member.id } }).catch(() => {})
    await prisma.user.delete({ where: { id: member.id } }).catch(() => {})
    await prisma.user.delete({ where: { id: mod.id } }).catch(() => {})
    await prisma.$disconnect()
  }

  const failed = results.filter(([s]) => s === "FAIL")
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`)
  process.exit(failed.length ? 1 : 0)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
