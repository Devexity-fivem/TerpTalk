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

  console.log("All TerpBot registry/parser tests passed.")
}

run()
