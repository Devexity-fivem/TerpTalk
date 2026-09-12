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
} from "@/lib/chat-commands"
import { parseTerpbotIntent, extractTerpbotQuery } from "@/lib/terpbot-intents"
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

  // Help text
  const memberHelp = buildHelpText("MEMBER")
  assert.ok(memberHelp.includes("/rep"), "help lists /rep")
  assert.ok(memberHelp.includes("/nextbadges"), "help lists /nextbadges")
  assert.ok(!memberHelp.includes("/ban"), "member help hides /ban")
  const adminHelp = buildHelpText("ADMINISTRATOR")
  assert.ok(adminHelp.includes("/ban") && adminHelp.includes("Staff:"), "admin help lists staff section")

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

  // ── Shared tokenizer ──────────────────────────────────────────────────
  assert.deepEqual(tokenizeSearchText("how do I fix nutrient burn?"), ["fix", "nutrient", "burn"])
  assert.deepEqual(tokenizeSearchText("the and or"), [], "all stop words → empty")
  assert.ok(tokenizeSearchText("one two three four five six seven eight nine ten").length <= 8, "token cap")

  console.log("All TerpBot registry/parser tests passed.")
}

run()
