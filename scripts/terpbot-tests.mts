// Pure unit tests for the TerpBot command registry and @terpbot intent
// parser — no database required. Run: npm run test:terpbot
import { strict as assert } from "node:assert"
import {
  CHAT_COMMANDS,
  getChatCommand,
  canUseCommand,
  isMentionCommand,
  listCommandsForRole,
  buildHelpText,
  suggestCommand,
} from "@/lib/chat-commands"
import { parseTerpbotIntent, extractTerpbotQuery } from "@/lib/terpbot-intents"
import { extractThreadRef } from "@/lib/terpbot-context"
import { isReservedUsername } from "@/lib/security"
import { tokenizeSearchText } from "@/lib/search-terms"
import {
  vpdFromTempRh,
  vpdDivergence,
  dliFromPpfd,
  ecToPpm,
  fToC,
  cToF,
  seriesStats,
  detectTrend,
  countExcursions,
  growthRateCmPerDay,
} from "@/lib/terpbot-intel-calc"
import {
  evaluateContext,
  findingStateFor,
  nextUsefulMeasurement,
  renderIntelLines,
} from "@/lib/terpbot-intel"
import type { GrowContextView, IntelSeries } from "@/lib/terpbot-intel-types"

function run() {
  console.log("Starting TerpBot registry/parser tests...")

  // ── Registry ──────────────────────────────────────────────────────────
  assert.ok(getChatCommand("rep"), "rep registered")
  assert.equal(getChatCommand("LEADERBOARD")?.name, "top", "alias leaderboard → top")
  assert.equal(getChatCommand("threads")?.name, "thread", "alias threads → thread")
  assert.equal(getChatCommand("guides")?.name, "guide", "alias guides → guide")
  assert.equal(getChatCommand("nonsense"), undefined, "unknown command → undefined")

  // Permission metadata
  assert.equal(canUseCommand(getChatCommand("rep")!, "MEMBER"), true, "public command usable by member")
  assert.equal(canUseCommand(getChatCommand("rep")!, null), true, "public command usable without role")
  assert.equal(canUseCommand(getChatCommand("warn")!, "MEMBER"), false, "mod command blocked for member")
  assert.equal(canUseCommand(getChatCommand("warn")!, "SUPPORT"), false, "mod command blocked for support")
  assert.equal(canUseCommand(getChatCommand("warn")!, "MODERATOR"), true, "mod command allowed for moderator")
  assert.equal(canUseCommand(getChatCommand("ban")!, "MODERATOR"), false, "admin command blocked for moderator")
  assert.equal(canUseCommand(getChatCommand("ban")!, "ADMINISTRATOR"), true, "admin command allowed for admin")

  // Mention surface — the @terpbot parser may only ever reach these
  for (const c of CHAT_COMMANDS) {
    if (c.permission !== "public") {
      assert.ok(!c.surfaces.includes("mention"), `staff command ${c.name} must not expose mention surface`)
    }
    if (c.handledBy === "route") {
      assert.ok(!c.surfaces.includes("mention"), `route command ${c.name} must not expose mention surface`)
    }
  }
  assert.equal(isMentionCommand("rep"), true, "rep mention-eligible")
  assert.equal(isMentionCommand("summarize"), true, "summarize mention-eligible")
  assert.equal(isMentionCommand("answered"), true, "answered mention-eligible")
  assert.equal(isMentionCommand("about"), true, "about mention-eligible")
  assert.equal(getChatCommand("tldr")?.name, "summarize", "alias tldr → summarize")
  assert.equal(getChatCommand("recap")?.name, "summarize", "alias recap → summarize")
  assert.equal(getChatCommand("solved")?.name, "answered", "alias solved → answered")
  assert.equal(isMentionCommand("ban"), false, "ban never mention-eligible")
  assert.equal(isMentionCommand("warn"), false, "warn never mention-eligible")
  assert.equal(isMentionCommand("me"), false, "me never mention-eligible")
  assert.equal(isMentionCommand("doesnotexist"), false, "unknown never mention-eligible")

  // Role-scoped lists
  const memberCmds = listCommandsForRole("MEMBER").map((c) => c.name)
  assert.ok(!memberCmds.includes("ban") && !memberCmds.includes("warn"), "member sees no staff commands")
  const supportCmds = listCommandsForRole("SUPPORT").map((c) => c.name)
  assert.ok(!supportCmds.includes("warn"), "SUPPORT sees no mod commands (fixes the 403 drift bug)")
  const adminCmds = listCommandsForRole("ADMINISTRATOR").map((c) => c.name)
  assert.ok(adminCmds.includes("ban") && adminCmds.includes("unban"), "admin sees admin commands")

  // New-command registry entries (Sprint: grow intelligence + community)
  for (const n of ["grow", "grows", "checkin", "growhelp", "milestones", "related", "hot", "new", "unanswered", "active", "weekly", "mydigest"]) {
    assert.ok(getChatCommand(n), `${n} registered`)
    assert.equal(getChatCommand(n)!.permission, "public", `${n} is public`)
    assert.equal(getChatCommand(n)!.handledBy, "bot", `${n} is bot-handled`)
    assert.ok(getChatCommand(n)!.surfaces.includes("mention"), `${n} mention-eligible`)
  }
  assert.equal(getChatCommand("diaries")?.name, "grows", "alias diaries → grows")

  // /setup — public entity lookup, mention-eligible like the other lookups.
  {
    const setup = getChatCommand("setup")
    assert.ok(setup, "setup registered")
    assert.equal(setup!.permission, "public", "setup is public")
    assert.equal(setup!.handledBy, "bot", "setup is bot-handled")
    assert.ok(setup!.surfaces.includes("mention"), "setup mention-eligible")
    assert.equal(setup!.category, "knowledge", "setup categorized knowledge")
    assert.equal(getChatCommand("setups")?.name, "setup", "alias setups → setup")
    assert.equal(isMentionCommand("setup"), true, "setup mention command")
  }

  // Every command carries a category; staff commands are "staff".
  const CATEGORIES = new Set(["grow", "community", "knowledge", "profile", "utility", "staff"])
  for (const c of CHAT_COMMANDS) {
    assert.ok(CATEGORIES.has(c.category), `${c.name} has a valid category`)
    if (c.permission !== "public") assert.equal(c.category, "staff", `${c.name} categorized staff`)
  }

  // Did-you-mean (deterministic edit distance over the registry)
  assert.equal(suggestCommand("diari")?.name, "diary", "diari → diary")
  assert.equal(suggestCommand("repp")?.name, "rep", "repp → rep")
  assert.equal(suggestCommand("growse")?.name, "grows", "growse → grows")
  assert.equal(suggestCommand("streal")?.name, "streak", "streal → streak")
  assert.equal(suggestCommand("asdkfjqwer"), null, "gibberish → no suggestion")
  assert.equal(suggestCommand("warnn", "MEMBER"), null, "staff command not suggested to member")
  assert.equal(suggestCommand("warnn", "MODERATOR")?.name, "warn", "staff command suggested to moderator")
  assert.equal(suggestCommand("threads")?.name, "thread", "exact alias resolves")

  // Help text — compact categorized index, role-filtered, under the
  // CHAT_MESSAGE_MAX cap (bot posts truncate at 1000 chars).
  const memberHelp = buildHelpText("MEMBER")
  assert.ok(memberHelp.length < 1000, `member help fits message cap (${memberHelp.length})`)
  assert.ok(memberHelp.includes("/rep"), "help lists /rep")
  assert.ok(memberHelp.includes("/nextbadges"), "help lists /nextbadges")
  assert.ok(!memberHelp.includes("/ban"), "member help hides /ban")
  for (const cat of ["Grow:", "Community:", "Knowledge:", "Profile:", "Utility:"]) {
    assert.ok(memberHelp.includes(cat), `member help has ${cat} category`)
  }
  for (const n of ["/grow", "/grows", "/checkin", "/milestones", "/related", "/hot", "/unanswered", "/mydigest"]) {
    assert.ok(memberHelp.includes(n), `member help lists ${n}`)
  }
  assert.ok(!memberHelp.includes("Staff:"), "member help has no staff section")
  const adminHelp = buildHelpText("ADMINISTRATOR")
  assert.ok(adminHelp.includes("/ban") && adminHelp.includes("Staff:"), "admin help lists staff section")

  // /help <topic> — command detail card, category one-liners, role gate.
  const growHelp = buildHelpText("MEMBER", "grow")
  assert.ok(growHelp.includes("/grow") && growHelp.includes("-"), "/help grow → command detail")
  const commHelp = buildHelpText("MEMBER", "community")
  assert.ok(commHelp.includes("/stats") && commHelp.includes("-"), "/help community → category one-liners")
  const memberBanHelp = buildHelpText("MEMBER", "ban")
  assert.ok(!memberBanHelp.includes("/ban <@user>"), "member /help ban reveals nothing")
  const adminBanHelp = buildHelpText("ADMINISTRATOR", "ban")
  assert.ok(adminBanHelp.includes("/ban <@user> <reason>"), "admin /help ban → staff detail")

  // ── Intent parser: positive routes ────────────────────────────────────
  const cases: [string, string, string[]?][] = [
    ["@terpbot what's my reputation?", "rep"],
    ["@terpbot what is my rep", "rep"],
    ["@terpbot rep", "rep"],
    ["@terpbot rep @pablo", "rep", ["@pablo"]],
    ["@terpbot how much rep does @pablo have", "rep", ["@pablo"]],
    ["@terpbot how close am I to the next tier?", "progress"],
    ["@terpbot show my tier progress", "progress"],
    ["@terpbot what's my rank", "rank"],
    ["@terpbot rank of @pablo", "rank", ["@pablo"]],
    ["@terpbot what's my grow streak", "streak"],
    ["@terpbot streak", "streak"],
    ["@terpbot show my badges", "badge"],
    ["@terpbot what badges can I earn", "nextbadges"],
    ["@terpbot what's the next badge", "nextbadges"],
    ["@terpbot show my diary", "diary"],
    ["@terpbot diary", "diary"],
    ["@terpbot @pablo's diary", "diary", ["@pablo"]],
    ["@terpbot find threads about nutrient burn", "thread", ["nutrient burn"]],
    ["@terpbot any threads on drying and curing", "thread", ["drying and curing"]],
    ["@terpbot has anyone posted about light burn", "thread", ["light burn"]],
    ["@terpbot find cloning guides", "guide", ["cloning"]],
    ["@terpbot guides about topping", "guide", ["topping"]],
    ["@terpbot how do i flush my plants", "guide", ["flush my plants"]],
    ["@terpbot strain blue dream", "strain", ["blue dream"]],
    ["@terpbot tell me about the og kush strain", "strain"],
    ["@terpbot who's online?", "online"],
    ["@terpbot anyone around", "online"],
    ["@terpbot digest", "digest"],
    ["@terpbot what happened yesterday", "digest"],
    ["@terpbot contest status", "contest"],
    ["@terpbot site stats", "stats"],
    ["@terpbot leaderboard", "top"],
    ["@terpbot top growers", "top"],
    ["@terpbot rules", "rules"],
    ["@terpbot grow tip", "tip"],
    ["@terpbot flip a coin", "flip"],
    ["@terpbot roll a d20", "roll", ["20"]],
    ["@terpbot what is a trichome", "ask", ["a trichome"]],
    ["@terpbot find spider mites", "ask", ["spider mites"]],
    ["hey @terpbot, what's my rep?", "rep"],
    ["@TERPBOT MY STREAK", "streak"],

    // ── Thread-context intents (Phase 3) ────────────────────────────────
    ["@terpbot summarize this", "summarize"],
    ["@terpbot summarize this thread", "summarize"],
    ["@terpbot tl;dr", "summarize"],
    ["@terpbot tldr please", "summarize"],
    ["@terpbot recap this", "summarize"],
    ["@terpbot what's this thread about", "summarize"],
    ["@terpbot what do people recommend here", "summarize"],
    ["@terpbot what do they say about it", "summarize"],
    ["@terpbot summarize /forum/thread/nutrient-burn-help", "summarize"],
    ["@terpbot did anyone answer this?", "answered"],
    ["@terpbot is this answered?", "answered"],
    ["@terpbot was this solved", "answered"],
    ["@terpbot any accepted answer?", "answered"],
    ["@terpbot anyone reply yet?", "answered"],
    ["@terpbot what about nutrient burn?", "about", ["nutrient burn"]],
    ["@terpbot how about flushing", "about", ["flushing"]],
    ["@terpbot any thoughts on dwc buckets", "about", ["dwc buckets"]],

    // ── Grow intelligence intents ────────────────────────────────────
    ["@terpbot my grow", "grow"],
    ["@terpbot how's my grow", "grow"],
    ["@terpbot grow status", "grow"],
    ["@terpbot my diaries", "grows"],
    ["@terpbot my grows", "grows"],
    ["@terpbot show my diaries", "grows"],
    ["@terpbot diaries", "grows"],
    ["@terpbot check in", "checkin"],
    ["@terpbot what should I update", "checkin"],
    ["@terpbot is my diary up to date", "checkin"],
    ["@terpbot help with my grow", "growhelp"],
    ["@terpbot my grow needs help", "growhelp"],
    ["@terpbot milestones", "milestones"],
    ["@terpbot what am I close to", "milestones"],
    ["@terpbot what's my next milestone", "milestones"],
    ["@terpbot what should I do next", "milestones"],
    ["@terpbot my digest", "mydigest"],
    ["@terpbot what did I miss", "mydigest"],
    ["@terpbot catch me up", "mydigest"],

    // ── Community intelligence intents ───────────────────────────────
    ["@terpbot hot threads", "hot"],
    ["@terpbot what's trending", "hot"],
    ["@terpbot latest discussions", "new"],
    ["@terpbot newest threads", "new"],
    ["@terpbot unanswered threads", "unanswered"],
    ["@terpbot who needs help", "unanswered"],
    ["@terpbot what's going on", "active"],
    ["@terpbot weekly recap", "weekly"],
    ["@terpbot this week's activity", "weekly"],
    ["@terpbot related to fungus gnats", "related", ["fungus gnats"]],
    ["@terpbot more about dwc", "related", ["dwc"]],

    // ── Setup intents (Sprint 1) ────────────────────────────────────
    ["@terpbot what lights does @pablo run", "setup", ["@pablo"]],
    ["@terpbot what setup does @pablo use", "setup", ["@pablo"]],
    ["@terpbot show me @pablo's setup", "setup", ["@pablo"]],
    ["@terpbot @pablo's setup", "setup", ["@pablo"]],
    ["@terpbot what tent is @pablo using", "setup", ["@pablo"]],
    ["@terpbot what light does @pablo have", "setup", ["@pablo"]],
    ["@terpbot what nutrients does @pablo run", "setup", ["@pablo"]],
    ["@terpbot my setup", "setup", ["me"]],
    ["@terpbot my grow setup", "setup", ["me"]],
    ["@terpbot setup", "setup"],
    ["@terpbot grow setup", "setup"],
    ["@terpbot setups for a 4x4 tent", "setup", ["4x4 tent"]],
    ["@terpbot find setups using led", "setup", ["led"]],
    ["@terpbot show grow setups", "setup"],
    ["@terpbot setups running coco", "setup", ["coco"]],
  ]
  for (const [input, expected, args] of cases) {
    const intent = parseTerpbotIntent(input)
    assert.equal(intent.kind, "command", `"${input}" should route to a command`)
    if (intent.kind === "command") {
      assert.equal(intent.name, expected, `"${input}" should route to /${expected} (got /${intent.name})`)
      if (args) assert.deepEqual(intent.args, args, `"${input}" args`)
    }
  }

  // ── Intent parser: moderation hard-block ──────────────────────────────
  const refusals = [
    "@terpbot ban @someone",
    "@terpbot ban nutrient burn", // "ban" + gardening words still refuses
    "@terpbot warn this guy",
    "@terpbot warn @user for spam",
    "@terpbot lock the chat",
    "@terpbot unlock please",
    "@terpbot mute @troll",
    "@terpbot clear the chat",
    "@terpbot delete my messages",
    "@terpbot unban @friend",
    "@terpbot announce something",
    "@terpbot report this post",
    "@terpbot set slowmode to 60",
    "@terpbot dm @someone",
    "@terpbot promote me to admin",
    "@terpbot kick @user",
  ]
  for (const input of refusals) {
    const intent = parseTerpbotIntent(input)
    assert.equal(intent.kind, "refusal", `"${input}" should be refused (got ${JSON.stringify(intent)})`)
  }

  // ── Setup intents must not capture unrelated phrasing ────────────────
  {
    // "set up" (two words) is never a setup lookup — stays on guide/ask paths.
    const guideIntent = parseTerpbotIntent("@terpbot how do i set up a tent")
    assert.equal(guideIntent.kind, "command", "set up a tent → a command")
    if (guideIntent.kind === "command") {
      assert.equal(guideIntent.name, "guide", "set up a tent → guide, not setup")
      assert.deepEqual(guideIntent.args, ["set up a tent"], "guide keeps the full query")
    }
    // Diary lookups keep their routing — setup matcher must not steal them.
    const diaryIntent = parseTerpbotIntent("@terpbot show me @pablo's diary")
    assert.equal(diaryIntent.kind, "command")
    if (diaryIntent.kind === "command") {
      assert.equal(diaryIntent.name, "diary", "@user's diary still → diary")
      assert.deepEqual(diaryIntent.args, ["@pablo"])
    }
    const growIntent = parseTerpbotIntent("@terpbot show me @pablo's grow")
    if (growIntent.kind === "command") {
      assert.equal(growIntent.name, "diary", "@user's grow still → diary")
    }
    // A light question with no @user is a question, not a setup lookup.
    assert.equal(parseTerpbotIntent("@terpbot what light should i use").kind, "fallback", "unowned light question → fallback")
    assert.equal(parseTerpbotIntent("@terpbot what's the best tent for seedlings").kind, "fallback", "recommendation question → fallback")
    // Staff vocabulary inside setup phrasing still hard-blocks.
    assert.equal(parseTerpbotIntent("@terpbot ban @pablo's setup").kind, "refusal", "setup phrasing can't launder staff words")
    assert.equal(parseTerpbotIntent("@terpbot delete @pablo's setup").kind, "refusal", "delete + setup → refusal")
  }

  // ── Intent parser: help / fallback / edge cases ───────────────────────
  assert.equal(parseTerpbotIntent("@terpbot").kind, "help", "bare ping → help")
  assert.equal(parseTerpbotIntent("@terpbot   ").kind, "help", "bare ping with spaces → help")
  assert.equal(parseTerpbotIntent("@terpbot asdkfjqwer").kind, "fallback", "gibberish → fallback")
  assert.equal(parseTerpbotIntent("no mention here").kind, "fallback", "no mention → fallback")
  assert.equal(parseTerpbotIntent("@terpbotx what's my rep").kind, "fallback", "@terpbotx is not a mention")

  // Only text after the FIRST mention is parsed
  const multi = parseTerpbotIntent("@terpbot what's my rep @terpbot ban everyone")
  assert.equal(multi.kind, "refusal", "second mention's staff word still hard-blocks")

  // Long input bounded
  const long = `@terpbot ${"spam ".repeat(500)}`
  assert.ok(extractTerpbotQuery(long).length <= 200, "query bounded to 200 chars")

  // ── Reserved usernames (lookalike defense) ────────────────────────────
  assert.equal(isReservedUsername("terpbot"), true)
  assert.equal(isReservedUsername("TerpBot"), true)
  assert.equal(isReservedUsername("terpb0t"), true, "leetspeak lookalike")
  assert.equal(isReservedUsername("terpbot1"), true, "digit-suffix lookalike")
  assert.equal(isReservedUsername("terp_bot"), true, "separator collapses to reserved")
  assert.equal(isReservedUsername("adm1n"), true, "admin lookalike")
  assert.equal(isReservedUsername("modern"), false, "real name containing 'mod' allowed")
  assert.equal(isReservedUsername("helper"), false, "real name containing 'help' allowed")
  assert.equal(isReservedUsername("terpfan"), false, "unrelated name allowed")

  // ── Thread-ref extraction (Phase 3 context resolver, pure part) ───────
  assert.deepEqual(
    extractThreadRef("check this out /forum/thread/nutrient-burn-help"),
    { slug: "nutrient-burn-help", postId: undefined },
    "bare thread link extracts slug"
  )
  assert.deepEqual(
    extractThreadRef("/forum/thread/my-grow?post=abcdefghijklmnopqrstuvwxy more text"),
    { slug: "my-grow", postId: "abcdefghijklmnopqrstuvwxy" },
    "?post= deep-link captured"
  )
  assert.equal(extractThreadRef("no link here"), null, "no link → null")
  // An external URL containing the path extracts a slug candidate — safety
  // is enforced by loadThreadContext's visibility gate, not the extractor.
  assert.deepEqual(
    extractThreadRef("https://evil.example/forum/thread/fake-slug"),
    { slug: "fake-slug", postId: undefined },
    "external lookalike extracts slug only (loader gates it)"
  )
  assert.equal(extractThreadRef("/forum/thread/x"), null, "slug shorter than 2 chars rejected")
  assert.equal(extractThreadRef("/forum/threads/list"), null, "non-thread forum path ignored")

  // ── Shared tokenizer ──────────────────────────────────────────────────
  assert.deepEqual(tokenizeSearchText("how do I fix nutrient burn?"), ["fix", "nutrient", "burn"])
  assert.deepEqual(tokenizeSearchText("the and or"), [], "all stop words → empty")
  assert.ok(tokenizeSearchText("one two three four five six seven eight nine ten").length <= 8, "token cap")

  // ── Intelligence: pure calculations ─────────────────────────────────

  // VPD — FAO-56 Magnus form. Reference vectors computed from the formula:
  // 25°C/50% → SVP≈3.167 → 1.58 kPa; 77°F is exactly 25°C.
  const v1 = vpdFromTempRh(77, 50)
  assert.ok(v1.valid && Math.abs(v1.value! - 1.58) < 0.02, "VPD 77°F/50% ≈ 1.58 kPa")
  assert.ok(v1.assumptions.some((a) => /leaf/i.test(a)), "VPD declares leaf-temp assumption")
  assert.equal(vpdFromTempRh(86, 60).valid, true, "VPD 86°F/60% computable")
  assert.deepEqual(vpdFromTempRh(null, 50).missing, ["temperature"], "VPD missing temp reported")
  assert.deepEqual(vpdFromTempRh(77, null).missing, ["humidity"], "VPD missing RH reported")
  assert.equal(vpdFromTempRh(77, 50).valid, true)
  assert.equal(vpdFromTempRh(200, 50).valid, false, "impossible temp rejected")
  assert.equal(vpdFromTempRh(77, 120).valid, false, "impossible RH rejected")
  assert.equal(vpdFromTempRh(77, 0).value, vpdFromTempRh(77, 0).value, "deterministic")
  // Monotonic sanity: lower RH → higher VPD
  assert.ok(vpdFromTempRh(77, 30).value! > vpdFromTempRh(77, 70).value!, "VPD falls as RH rises")

  // Entered vs computed divergence — finding material, never resolved silently
  assert.ok(Math.abs(vpdDivergence(0.8, 1.1)! - -0.3) < 0.01, "divergence sign = entered−computed")
  assert.equal(vpdDivergence(null, 1.1), null, "divergence needs both sides")
  assert.equal(vpdDivergence(1.1, null), null)

  // DLI — 800 μmol × 18h = 51.84 mol/m²/day
  const dli = dliFromPpfd(800, 18)
  assert.ok(dli.valid && Math.abs(dli.value! - 51.8) < 0.1, "DLI 800×18h ≈ 51.8")
  assert.deepEqual(dliFromPpfd(null, 18).missing, ["ppfd"], "DLI reports missing PPFD")
  assert.equal(dliFromPpfd(800, 30).valid, false, "impossible photoperiod rejected")

  // Units
  assert.equal(ecToPpm(1.5, 500).value, 750, "EC→ppm 500 scale")
  assert.equal(ecToPpm(1.5, 700).value, 1050, "EC→ppm 700 scale — caller picks, never guessed")
  assert.equal(ecToPpm(-1, 500).valid, false, "negative EC rejected")
  assert.ok(Math.abs(cToF(fToC(80)) - 80) < 0.001, "F↔C round-trip")

  // seriesStats
  const t0 = Date.UTC(2025, 0, 1)
  const pts = (vals: number[], stepMs = 86400000) => vals.map((v, i) => ({ t: t0 + i * stepMs, v }))
  const ss = seriesStats(pts([10, 20, 30]))
  assert.equal(ss.n, 3)
  assert.equal(ss.latest, 30)
  assert.equal(ss.mean, 20)
  assert.equal(ss.min, 10)
  assert.equal(ss.max, 30)
  assert.equal(ss.medianIntervalDays, 1)
  assert.equal(seriesStats([]).latest, null, "empty series safe")

  // detectTrend — eps = noise floor
  assert.equal(detectTrend(pts([50, 55, 60, 65]), 3), "rising", "steady climb → rising")
  assert.equal(detectTrend(pts([65, 60, 55, 50]), 3), "falling", "steady drop → falling")
  assert.equal(detectTrend(pts([50, 51, 50, 51]), 3), "stable", "sub-epsilon wiggle → stable")
  assert.equal(detectTrend(pts([50, 60, 50, 60, 50]), 3), "volatile", "alternating swings → volatile")
  assert.equal(detectTrend(pts([50, 60]), 3), "insufficient", "2 points → insufficient, not a trend")
  assert.equal(detectTrend([], 3), "insufficient", "empty → insufficient")

  // countExcursions
  const exc = countExcursions(pts([7, 9, 9, 9, 7]), 6, 8)
  assert.equal(exc.count, 3)
  assert.equal(exc.longestRun, 3)
  assert.equal(exc.latestOutside, false)
  assert.equal(countExcursions(pts([9]), 6, 8).latestOutside, true, "single point out → flagged")

  // growthRate
  const gr = growthRateCmPerDay(pts([20, 30], 10 * 86400000))
  assert.ok(gr.valid && Math.abs(gr.value! - 1) < 0.01, "10cm/10d = 1 cm/day")
  assert.equal(growthRateCmPerDay(pts([20])).valid, false, "single height → invalid")
  assert.deepEqual(growthRateCmPerDay(pts([20])).missing, ["heightHistory"])

  // ── Intelligence: rule engine over fabricated contexts ────────────────
  const mkSeries = (vals: number[], eps: number): IntelSeries => {
    const points = pts(vals)
    return { ...seriesStats(points), points, trend: detectTrend(points, eps) }
  }
  const emptySeries: IntelSeries = { n: 0, latest: null, mean: null, min: null, max: null, medianIntervalDays: null, points: [], trend: "insufficient" }
  const mkCtx = (over: Partial<GrowContextView> = {}): GrowContextView => ({
    scope: "public",
    diary: {
      id: "d1", slug: "d1-slug", title: "Test", stage: "FLOWER", visibility: "PUBLIC",
      startDate: new Date(t0), harvested: false,
      mediumType: "COCO", lightType: "LED", growType: "INDOOR", techniques: [],
    },
    setup: { present: false, medium: null, capabilities: [] },
    now: t0 + 40 * 86400000,
    day: 41, week: 6,
    stageDays: 20, stageStartCensored: false,
    updateCount: 4, daysSinceUpdate: 1, medianUpdateIntervalDays: 7,
    envCoverage: 1,
    series: {
      temperature: emptySeries, humidity: emptySeries, ph: emptySeries,
      ec: emptySeries, height: emptySeries, vpdEntered: emptySeries, vpdComputed: emptySeries,
    runoffPh: emptySeries, runoffEc: emptySeries,
    },
    vpdDivergence: null,
    missing: [],
    freshness: {},
    ...over,
    observations: over.observations ?? [],
  })

  const findCandidate = (ctx: GrowContextView, id: string) =>
    evaluateContext(ctx).candidates.find((c) => c.id === id)
  const findFinding = (ctx: GrowContextView, ruleId: string) =>
    evaluateContext(ctx).findings.find((f) => f.ruleId === ruleId)

  // vpd-divergence → CONFIRMED (measured fact) — standalone finding
  {
    const ctx = mkCtx({
      vpdDivergence: -0.5,
      series: { ...mkCtx().series, vpdEntered: mkSeries([0.8, 0.8], 0.15), vpdComputed: mkSeries([1.3, 1.3], 0.15) },
    })
    const f = findFinding(ctx, "data.vpd-divergence")!
    assert.equal(f.state, "confirmed", "vpd divergence → CONFIRMED")
    assert.equal(f.nextMeasurement?.id, "leafTemp", "divergence asks for leaf temp")
  }
  {
    const f = findFinding(mkCtx({ vpdDivergence: 0.1 }), "data.vpd-divergence")
    assert.equal(f, undefined, "small divergence < 0.3 → no finding")
  }

  // env.vpd-band — persistent high in flower → heat_stress candidate
  {
    const ctx = mkCtx({ series: { ...mkCtx().series, vpdComputed: mkSeries([1.7, 1.8, 1.9, 1.8], 0.15) } })
    const c = findCandidate(ctx, "heat_stress")!
    assert.equal(c.state, "possible", "persistent high VPD → possible (single moderate evidence)")
    assert.match(c.supporting[0].text, /above the 1–1\.5/, "text names the band")
    assert.ok(c.ruleIds.includes("env.vpd-band"), "contributing rule recorded")
    assert.ok(c.sourceIds.includes("cs-vpd-ranges"), "provenance attached")
  }
  {
    const ctx = mkCtx({ series: { ...mkCtx().series, vpdComputed: mkSeries([1.1, 1.2, 1.1], 0.15) } })
    assert.equal(findCandidate(ctx, "heat_stress"), undefined, "in-band VPD → no candidate")
    assert.equal(findCandidate(ctx, "humidity_high"), undefined, "in-band VPD → no humidity candidate either")
  }
  {
    const ctx = mkCtx({ series: { ...mkCtx().series, vpdComputed: mkSeries([1.8, 1.8], 0.15) } })
    assert.equal(findCandidate(ctx, "heat_stress"), undefined, "2 points → rule gated off (n≥3)")
  }

  // env.rh-flower-high — FLOWER + ≥3 of last 5 ≥65% feeds two candidates
  {
    const ctx = mkCtx({ series: { ...mkCtx().series, humidity: mkSeries([60, 66, 70, 68], 3) } })
    const risk = findCandidate(ctx, "env.moisture-disease-risk")!
    // moderate (flower-high) + weak (rising trend) share the "humidity"
    // signal → one group, capped at possible
    assert.equal(risk.state, "possible")
    assert.match(risk.supporting[0].text, /bud-rot|powdery/i)
    const hum = findCandidate(ctx, "humidity_high")!
    assert.ok(hum, "same observation also supports the humidity_high candidate")
  }
  {
    const ctx = mkCtx({
      diary: { ...mkCtx().diary, stage: "VEGETATIVE" },
      series: { ...mkCtx().series, humidity: mkSeries([64, 65, 66], 3) },
    })
    assert.equal(findCandidate(ctx, "env.moisture-disease-risk"), undefined, "same RH in veg → disease-risk rule gated off")
  }

  // env.temp-high — ≥60% of ≥3 readings > 86°F → heat_stress
  {
    const ctx = mkCtx({ series: { ...mkCtx().series, temperature: mkSeries([88, 90, 87, 89], 2) } })
    assert.ok(findCandidate(ctx, "heat_stress"), "persistent heat flagged")
  }
  {
    const ctx = mkCtx({ series: { ...mkCtx().series, temperature: mkSeries([75, 90, 75, 76], 2) } })
    assert.equal(findCandidate(ctx, "heat_stress"), undefined, "single spike ≠ sustained")
  }

  // chem.ph-band — coco band 5.5–6.2 → ph_lockout candidate
  {
    const ctx = mkCtx({ series: { ...mkCtx().series, ph: mkSeries([6.0, 6.1, 7.0], 0.15) } })
    const c = findCandidate(ctx, "ph_lockout")!
    assert.equal(c.state, "possible")
    assert.equal(c.nextMeasurement?.id, "runoffPh", "asks for runoff pH")
  }
  {
    const ctx = mkCtx({
      diary: { ...mkCtx().diary, mediumType: "SOIL" },
      series: { ...mkCtx().series, ph: mkSeries([6.4, 6.5], 0.15) },
    })
    assert.equal(findCandidate(ctx, "ph_lockout"), undefined, "pH 6.5 fine in soil")
  }
  {
    const ctx = mkCtx({
      diary: { ...mkCtx().diary, mediumType: null },
      series: { ...mkCtx().series, ph: mkSeries([6.6], 0.15) },
    })
    assert.equal(findCandidate(ctx, "ph_lockout"), undefined, "pH 6.6 inside wide unknown-medium band")
  }

  // chem.ec-drift — rising EC → salt_buildup candidate, runoff EC hint
  {
    const ctx = mkCtx({ series: { ...mkCtx().series, ec: mkSeries([1.2, 1.5, 1.9, 2.3], 0.2) } })
    const c = findCandidate(ctx, "salt_buildup")!
    assert.equal(c.nextMeasurement?.id, "runoffEc")
  }

  // growth.stalled — veg, ≥3 heights, ≥7d span, |rate|<0.2 → stunt
  {
    const ctx = mkCtx({
      diary: { ...mkCtx().diary, stage: "VEGETATIVE" },
      series: { ...mkCtx().series, height: mkSeries([30, 30.5, 30.2], 2) },
    })
    // pts default step = 1 day → span 2d < 7d → gated off
    assert.equal(findCandidate(ctx, "stunt"), undefined, "short span gated")
    const wide = { ...seriesStats(pts([30, 30.5, 30.2], 4 * 86400000)), points: pts([30, 30.5, 30.2], 4 * 86400000), trend: "stable" as const }
    const ctx2 = mkCtx({
      diary: { ...mkCtx().diary, stage: "VEGETATIVE" },
      series: { ...mkCtx().series, height: wide },
    })
    const c = findCandidate(ctx2, "stunt")!
    assert.equal(c.state, "possible", "flat 8-day veg → stall flagged")
    assert.match(c.supporting[0].text, /training can mask/i, "honest caveat included")
  }

  // gap rules → INSUFFICIENT, drive next-measurement
  {
    const ctx = mkCtx({ envCoverage: 0.25 })
    const f = findFinding(ctx, "data.sparse-env")!
    assert.equal(f.state, "insufficient", "sparse env → INSUFFICIENT")
  }
  {
    const ctx = mkCtx()
    const f = findFinding(ctx, "data.no-env")!
    assert.equal(f.state, "insufficient", "no env at all → INSUFFICIENT")
    assert.equal(f.nextMeasurement?.id, "temperature")
  }

  // ── Classifier — all five states pinned directly ──────────────────────
  assert.equal(findingStateFor("gap", [{ direction: "for", strength: "strong", text: "x" }]), "insufficient")
  assert.equal(findingStateFor("assessment", [{ direction: "for", strength: "strong", text: "x", confirmed: true }]), "confirmed")
  assert.equal(
    findingStateFor("risk", [
      { direction: "for", strength: "strong", text: "x" },
      { direction: "against", strength: "strong", text: "y" },
    ]),
    "conflicting"
  )
  assert.equal(findingStateFor("risk", [{ direction: "risk", strength: "strong", text: "x" }]), "strong")
  assert.equal(findingStateFor("risk", [{ direction: "risk", strength: "moderate", text: "x" }]), "possible")
  assert.equal(findingStateFor("assessment", []), "insufficient")
  assert.equal(
    findingStateFor("risk", [
      { direction: "risk", strength: "weak", text: "x" },
      { direction: "against", strength: "strong", text: "y" },
    ]),
    "possible",
    "weak-for + strong-against → possible (not conflicting — asymmetric)"
  )

  // nextUsefulMeasurement — discriminating a live hypothesis outranks a
  // hint on a confirmed fact (confirmed = no residual uncertainty)
  {
    const ctx = mkCtx({
      vpdDivergence: -0.5,
      series: {
        ...mkCtx().series,
        vpdEntered: mkSeries([0.8, 0.8], 0.15),
        vpdComputed: mkSeries([1.3, 1.3], 0.15),
        ec: mkSeries([1.2, 1.5, 1.9], 0.2),
      },
    })
    const diag = evaluateContext(ctx)
    assert.equal(nextUsefulMeasurement(ctx, diag)?.id, "runoffEc", "salt_buildup discriminating input wins")
    // …but if the EC series were already logged as unavailable-vs-known,
    // available metrics are never recommended:
    const diag2 = evaluateContext(mkCtx())
    assert.equal(nextUsefulMeasurement(mkCtx(), diag2)?.id, "temperature", "no-env gap asks for temp+RH")
  }

  // ── Rendering — OBSERVED/CALCULATED/interpretation/missing split ──────
  {
    const ctx = mkCtx({
      series: {
        ...mkCtx().series,
        temperature: mkSeries([77, 78, 79], 2),
        humidity: mkSeries([60, 64, 68, 70], 3),
        ph: mkSeries([6.0, 6.1, 7.0], 0.15),
        vpdComputed: mkSeries([1.0, 1.05, 1.1], 0.15),
      },
    })
    const lines = renderIntelLines(ctx, evaluateContext(ctx)).join("\n")
    assert.match(lines, /Observed: 79°F · 70% RH · pH 7/, "observed line shows latest logged values")
    assert.match(lines, /Calculated: VPD ≈1\.1 kPa/, "calculated line shows derived VPD")
    assert.match(lines, /leaf temp not logged/, "assumption disclosed")
    assert.match(lines, /Worth watching:/, "findings rendered")
    // The top candidate here is a condition — renders "Assessment:".
    assert.match(lines, /Assessment: pH drift \/ instability — POSSIBLE/, "condition candidate renders as assessment")
    assert.match(lines, /Next useful measurement:/, "next measurement rendered")
  }
  {
    // A risk candidate on top renders "Risk:", never "Assessment:" —
    // humidity rising in flower surfaces moisture-disease risk first.
    const ctx = mkCtx({
      series: {
        ...mkCtx().series,
        temperature: mkSeries([77, 78, 79], 2),
        humidity: mkSeries([60, 64, 68, 70], 3),
      },
    })
    const lines = renderIntelLines(ctx, evaluateContext(ctx)).join("\n")
    assert.match(lines, /Risk: Moisture-related disease risk — POSSIBLE/, "risk candidate renders as warning")
    assert.doesNotMatch(lines, /Assessment:/, "risk candidate does not render as diagnosis")
  }
  {
    // Sparse diary with zero readings → engine declines gracefully
    const ctx = mkCtx({ updateCount: 0, envCoverage: 0 })
    const lines = renderIntelLines(ctx, evaluateContext(ctx))
    // next-measurement hint may still render (that's honest), but no
    // observed/calculated lines may be fabricated
    assert.ok(!lines.some((l) => l.startsWith("Observed:")), "no fabricated observations")
    assert.ok(!lines.some((l) => l.startsWith("Calculated:")), "no fabricated calculations")
  }

  console.log("All TerpBot registry/parser tests passed.")
}

run()
