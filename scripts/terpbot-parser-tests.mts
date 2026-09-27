// TerpBot input-layer tests (pure, no DB).
// Pin the observation matrix: synonyms, misspellings, locations,
// stages, trends, negation, compounds, false positives, measurements.
// The parser NEVER diagnoses — it only produces observations.
// Plus the command registry + @terpbot intent routing suite
// (consolidated from terpbot-commands-tests.mts).
// Run: tsx scripts/terpbot-parser-tests.mts

import { strict as assert } from "node:assert"
import { normalizeGrowText, parseGrowText } from "@/lib/terpbot-nl-parse"
import { CANDIDATES } from "@/lib/terpbot-intel-knowledge"
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

const obs = (raw: string) => parseGrowText(raw).observations
const syms = (raw: string) => obs(raw).map((o) => o.symptom)

function run() {
  // ── canonical symptoms + synonyms ─────────────────────────────────
  assert.deepEqual(syms("yellowing"), ["LEAF_YELLOWING"])
  assert.deepEqual(syms("leaves turning yellow"), ["LEAF_YELLOWING"])
  assert.deepEqual(syms("chlorosis on the leaves"), ["LEAF_YELLOWING"])
  assert.deepEqual(syms("the claw"), ["CLAW_DOWN"], "grower slang resolves")
  assert.deepEqual(syms("leaves are tacoing"), ["CURL_UP"], "tacoing → upward curl")
  assert.deepEqual(syms("rusty spots"), ["RUST_SPOTS"])
  assert.deepEqual(syms("silvery trails"), ["SLIME_TRAIL"], "silvery trails = slug mucus")
  assert.deepEqual(syms("silver streaks on the leaves"), ["SILVERING"], "silvering foliage → thrips")
  assert.deepEqual(syms("nanners on the plant"), ["HERMIE"], "nanners → hermie (weak-conf needs plant noun)")
  assert.equal(syms("nanners").length, 0, "bare weak term without plant context is dropped")
  assert.deepEqual(syms("saw mites on the plant"), ["PEST_MITES"])
  assert.deepEqual(syms("sticky traps caught 3 gnats"), ["PEST_FUNGUS_GNATS"], "real sighting outside guard span")

  // ── capitalization + misspellings ─────────────────────────────────
  assert.deepEqual(syms("YELLOWING"), ["LEAF_YELLOWING"])
  assert.deepEqual(syms("a seedlng is stretching"), ["STRETCHED", "STRETCHED"].slice(0, 1).map(() => "STRETCHED"), "misspelled stage still parses")
  {
    const p = parseGrowText("a seedlng is stretching")
    assert.equal(p.stage, "SEEDLING", "misspelled stage token resolves")
    assert.equal(p.observations[0]?.feeds[0], "seedling_stretch", "stage refinement routes to seedling_stretch")
  }
  assert.deepEqual(syms("humidty keeps climbing"), ["ENV_HUMID"], "misspelled metric + trend → synthesized observation")
  {
    const o = obs("yellowing between viens")[0]
    assert.equal(o.location, "INTERVEINAL", "misspelled location token resolves")
  }

  // ── location refinement ───────────────────────────────────────────
  {
    const o = obs("lower leaves yellowing")[0]
    assert.equal(o.symptom, "LEAF_YELLOWING")
    assert.equal(o.location, "LOWER_OLD")
    assert.ok(o.feeds.includes("nitrogen_def"), "lower yellowing feeds mobile-nutrient candidates")
    assert.ok(o.refined)
  }
  {
    const o = obs("new growth yellowing")[0]
    assert.equal(o.location, "UPPER_NEW")
    assert.ok(o.feeds.includes("iron_def"), "new-growth yellowing feeds immobile candidates")
  }
  {
    const o = obs("yellowing between veins")[0]
    assert.equal(o.location, "INTERVEINAL")
    assert.ok(o.feeds.includes("magnesium_def"))
  }
  {
    const o = obs("week 6 flower, sugar leaves yellowing")[1] ?? obs("week 6 flower, sugar leaves yellowing")[0]
    const yellow = obs("week 6 flower, sugar leaves yellowing").find((x) => x.symptom === "LEAF_YELLOWING")!
    assert.equal(yellow.location, "SUGAR_LEAVES")
    assert.deepEqual(yellow.feeds, ["bud_nutrient"], "sugar-leaf yellowing → bud_nutrient only")
    assert.equal(yellow.stage, "FLOWER", "utterance stage attaches")
    void o
  }

  // ── stage refinement ──────────────────────────────────────────────
  {
    const o = obs("seedling tips burned")[0]
    assert.equal(o.symptom, "TIP_BURN")
    assert.equal(o.stage, "SEEDLING")
    assert.deepEqual(o.feeds, ["seedling_burn"], "seedling tip burn routes to seedling_burn, not nutrient_burn")
  }

  // ── compound clauses — no generic swallow ─────────────────────────
  {
    const s = syms("lower leaves yellowing, tips burned, plant is drooping")
    assert.ok(s.includes("LEAF_YELLOWING"))
    assert.ok(s.includes("TIP_BURN"))
    assert.ok(s.includes("DROOPING"))
    assert.equal(s.length, 3, "three observations, one per clause")
  }
  {
    const s = syms("dark green and clawing")
    assert.ok(s.includes("LEAF_DARK_GREEN"))
    assert.ok(s.includes("CLAW_DOWN"), "conjunction split: both symptoms kept")
  }

  // ── negation ──────────────────────────────────────────────────────
  assert.equal(obs("no yellowing").length, 0, "negated symptom dropped")
  assert.equal(obs("not clawing anymore").length, 0, "not + symptom dropped")
  assert.equal(obs("leaves aren't curling").length, 0, "aren't + symptom dropped")
  assert.equal(
    obs("i don't think it's nutrient burn").length,
    0,
    "negator three tokens back — 'i don't think it's X'"
  )

  // ── trend/period + metric-trend synthesis ─────────────────────────
  {
    const p = parseGrowText("humidity keeps climbing at night")
    const o = p.observations.find((x) => x.symptom === "ENV_HUMID")!
    assert.ok(o, "rising humidity synthesizes ENV_HUMID")
    assert.equal(o.period, "NIGHT")
  }
  {
    // lights-off droop is nyctinasty — parsed, engine downgrades it
    const o = obs("plant drooping right after dark")[0]
    assert.equal(o.symptom, "DROOPING")
    assert.equal(o.period, "LIGHTS_OFF")
  }

  // ── measurements ──────────────────────────────────────────────────
  {
    const m = parseGrowText("ph 5.2").measurements[0]
    assert.equal(m.metric, "ph")
    assert.equal(m.value, 5.2)
  }
  {
    const m = parseGrowText("runoff 1400ppm").measurements[0]
    assert.equal(m.metric, "runoffEc", "runoff prefix + ppm → runoff EC")
    assert.equal(m.unit, "ppm")
    assert.equal(m.value, 1400)
  }
  {
    const m = parseGrowText("72f and dropping").measurements[0]
    assert.equal(m.metric, "temperature")
    assert.equal(m.value, 72)
    assert.equal(m.trend, "FALLING")
  }
  {
    const m = parseGrowText("ec 1.4 stable").measurements[0]
    assert.equal(m.metric, "ec")
    assert.equal(m.trend, "STABLE")
  }
  {
    // bare number with no metric and no unit → never guessed
    assert.equal(parseGrowText("week 6 looking good").measurements.length, 0)
  }

  // ── extended negation ─────────────────────────────────────────────
  assert.equal(obs("leaves are no longer yellowing").length, 0, "phrase negation: no longer")
  assert.equal(obs("no sign of yellowing").length, 0, "phrase negation: no sign of")
  assert.equal(obs("i don't have yellow leaves").length, 0, "negator two tokens back")
  assert.equal(obs("haven't seen webbing").length, 0, "phrase negation: haven't seen")
  assert.equal(obs("free of pests").length, 0, "phrase negation: free of")
  assert.equal(obs("not seeing any clawing").length, 0, "phrase negation: not seeing")
  {
    const s = syms("not yellow but pale")
    assert.deepEqual(s, ["LEAF_PALE"], "negated first clause, second survives")
  }
  {
    // "but only the oldest ones" — a location-only second half does not
    // soft-split, so the location refines the yellowing observation
    const o = obs("my leaves are yellow but only the oldest ones")[0]
    assert.equal(o.symptom, "LEAF_YELLOWING")
    assert.equal(o.location, "LOWER_OLD", "'oldest ones' resolves to lower/older leaves")
    assert.ok(o.feeds.includes("nitrogen_def"), "lower/older yellowing feeds mobile-nutrient candidates")
  }

  // ── question / comparison flags ───────────────────────────────────
  {
    const p = parseGrowText("why are my leaves yellow?")
    assert.equal(p.question, true, "question-led text flagged")
    assert.equal(p.observations.length, 0, "question suppresses observation")
  }
  {
    const p = parseGrowText("my leaves are yellow.")
    assert.equal(p.question, false)
    assert.equal(p.comparison, false)
    assert.deepEqual(syms("my leaves are yellow."), ["LEAF_YELLOWING"])
  }
  {
    const p = parseGrowText("my plants are greener than last week")
    assert.equal(p.comparison, true, "comparative 'greener than' flagged")
    assert.equal(p.question, false)
    assert.equal(p.observations.length, 0)
  }
  {
    const p = parseGrowText("greener than last week")
    assert.equal(p.comparison, true)
    assert.equal(p.observations.length, 0)
  }
  {
    const p = parseGrowText("light burn vs nutrient burn which is worse")
    assert.equal(p.comparison, true)
    assert.equal(p.observations.length, 0)
  }

  // ── measurement units + runoff + guards ───────────────────────────
  {
    const m = parseGrowText("81 F").measurements[0]
    assert.equal(m.metric, "temperature")
    assert.equal(m.value, 81)
    assert.equal(m.unit, "degF")
  }
  {
    const m = parseGrowText("24 C").measurements[0]
    assert.equal(m.metric, "temperature")
    assert.equal(m.value, 24)
    assert.equal(m.unit, "degC", "celsius preserved, no conversion")
  }
  {
    const m = parseGrowText("68% RH").measurements[0]
    assert.equal(m.metric, "humidity")
    assert.equal(m.unit, "percent")
  }
  {
    const ms = parseGrowText("my tent is 84f and 40% rh").measurements
    assert.equal(ms.length, 2, "two measurements in one sentence")
    assert.equal(ms[0].metric, "temperature")
    assert.equal(ms[1].metric, "humidity")
  }
  {
    const m = parseGrowText("room is 80 degrees").measurements[0]
    assert.equal(m.metric, "temperature")
    assert.equal(m.value, 80)
    assert.equal(m.unit, undefined, "bare 'degrees' implies no unit")
  }
  {
    const m = parseGrowText("runoff ec was 2.4").measurements[0]
    assert.equal(m.metric, "runoffEc")
    assert.equal(m.value, 2.4)
    assert.equal(m.unit, undefined, "runoff EC does not invent mscm")
  }
  {
    const m = parseGrowText("runoff ec was 2.9").measurements[0]
    assert.equal(m.metric, "runoffEc")
    assert.equal(m.value, 2.9)
  }
  {
    // unit-implied EC right after "runoff" — no metric word needed
    const m = parseGrowText("runoff 2.4 ms/cm").measurements[0]
    assert.equal(m.metric, "runoffEc")
    assert.equal(m.value, 2.4)
    assert.equal(m.unit, "mscm")
  }
  {
    const m = parseGrowText("the runoff is 2.4 ms/cm").measurements[0]
    assert.equal(m.metric, "runoffEc")
    assert.equal(m.value, 2.4)
    assert.equal(m.unit, "mscm")
  }
  {
    // a runoff ppm measurement is minted but stamped ppm — downstream
    // (accept()/runoffMeasurement) rejects it, never converts to mS/cm
    const m = parseGrowText("runoff ppm 4").measurements[0]
    assert.equal(m.metric, "runoffEc")
    assert.equal(m.unit, "ppm", "ppm stays ppm — never silently mS/cm")
    assert.equal(m.value, 4)
  }
  assert.equal(
    parseGrowText("checked runoff ec on 2 plants").measurements.length,
    0,
    "runoff ec on N plants — 'on' is not a value connector"
  )
  assert.equal(
    parseGrowText("should runoff ec be under 3?").measurements.length,
    0,
    "question about runoff ec mints no measurement"
  )
  {
    // a number binds to the metric phrase whose edge is nearest —
    // preceding phrase wins ties over a following one
    const ms = parseGrowText("runoff ph 5.6 ec 2.4").measurements
    assert.equal(ms[0].metric, "runoffPh")
    assert.equal(ms[0].value, 5.6)
    assert.equal(ms[1].metric, "ec")
    assert.equal(ms[1].value, 2.4)
  }
  {
    const ms = parseGrowText("my runoff ph is 5.9 and ec is 2.8").measurements
    assert.equal(ms[0].metric, "runoffPh")
    assert.equal(ms[1].metric, "ec")
  }
  {
    const m = parseGrowText("run-off ph 6.8").measurements[0]
    assert.equal(m.metric, "runoffPh")
    assert.equal(m.value, 6.8)
  }
  {
    const m = parseGrowText("the runoff ph is 5.9").measurements[0]
    assert.equal(m.metric, "runoffPh")
    assert.equal(m.value, 5.9)
  }
  {
    // explicitMetric marks a grower-named metric; a bare unit implies one
    const named = parseGrowText("ph 5.2").measurements[0]
    assert.equal(named.explicitMetric, true, "metric phrase → explicit")
    const implied = parseGrowText("72f").measurements[0]
    assert.ok(!implied.explicitMetric, "unit-implied metric → not explicit")
    const runoff = parseGrowText("runoff 2.4 ms/cm").measurements[0]
    assert.equal(runoff.explicitMetric, true, "runoff prefix counts as explicit")
  }
  assert.equal(
    parseGrowText("i don't actually know my runoff ec").measurements.length,
    0,
    "negated runoff mention → no measurement"
  )
  assert.equal(
    parseGrowText("lights are at 70%").measurements.length,
    0,
    "dimmer % is not a humidity measurement"
  )
  {
    // humidity phrase present in the clause → % is still RH
    const ms = parseGrowText("lights dimmed and rh is 40%").measurements
    assert.ok(ms.some((m) => m.metric === "humidity"), "rh phrase wins over light guard")
  }

  // ── false positives ───────────────────────────────────────────────
  assert.equal(obs("yellow sticky traps are working").length, 0, "guard kills 'yellow sticky traps'")
  assert.equal(obs("what's for dinner").length, 0)
  assert.equal(obs("what's trending").length, 0)
  assert.equal(obs("hot threads").length, 0)
  assert.equal(obs("light burn vs nutrient burn which is worse").length, 0, "comparison suppressed")
  assert.equal(obs("what pm level").length, 0, "question-led lookup suppressed")
  assert.equal(obs("web search for curing").length, 0, "'web' ≠ webbing; 'curing' is stage not symptom")
  assert.equal(obs("any tips for feeding").length, 0, "'tips' in question text → not leaf tips")

  // ── determinism + bounds ──────────────────────────────────────────
  {
    const a = parseGrowText("lower leaves yellowing, tips burned, plant is drooping")
    const b = parseGrowText("lower leaves yellowing, tips burned, plant is drooping")
    assert.deepEqual(a, b, "same input → same output")
  }
  {
    const long = "yellowing ".repeat(500) + "clawing ".repeat(500)
    const p = parseGrowText(long)
    assert.ok(p.observations.length <= 4, "200-char cap bounds output")
  }
  {
    // every emitted feed id resolves to a real candidate
    const texts = [
      "yellowing", "the claw", "tacoing", "rusty spots", "silvery trails",
      "nanners", "webbing under leaves", "powder on leaves", "bud rot",
      "seedling collapsed", "no sprout", "ph keeps drifting", "ec rising",
      "white crust on soil", "plant is drooping", "stunted growth",
      "stretching hard", "airy buds", "slime trails", "mites on the plant",
      "aphids", "thrips", "fungus gnats", "whiteflies", "caterpillars in buds",
    ]
    for (const t of texts) {
      for (const o of parseGrowText(t).observations) {
        for (const f of o.feeds) {
          assert.ok(f in CANDIDATES, `${t} → ${o.symptom} feeds ${f} must resolve`)
        }
      }
    }
  }

  // ── temporal extraction ───────────────────────────────────────────
  // Recency phrases resolve to ageDays / pastUnresolved AND consume
  // their digits — a temporal number can never mint a measurement.
  {
    const p = parseGrowText("ph 6.5 3 days ago")
    assert.equal(p.measurements.length, 1, "one measurement, no phantom")
    assert.equal(p.measurements[0].metric, "ph")
    assert.equal(p.measurements[0].value, 6.5)
    assert.equal(p.measurements[0].ageDays, 3, "resolved age")
  }
  {
    const p = parseGrowText("runoff 2.1 ms/cm two weeks ago")
    assert.equal(p.measurements.length, 1)
    assert.equal(p.measurements[0].metric, "runoffEc")
    assert.equal(p.measurements[0].ageDays, 14)
  }
  {
    const p = parseGrowText("ph 5.8 week 6 flower")
    assert.equal(p.measurements.length, 1, "week digit consumed — no phantom ph=6")
    assert.equal(p.measurements[0].value, 5.8)
    assert.equal(p.stage, "FLOWER")
  }
  {
    const p = parseGrowText("rh was 72% a while back")
    assert.equal(p.measurements.length, 1)
    assert.equal(p.measurements[0].value, 72)
    assert.ok(p.measurements[0].pastUnresolved, "unbounded past marked")
    assert.equal(p.measurements[0].ageDays, undefined, "no invented age")
  }
  {
    const p = parseGrowText("temp 84 and rh 40 yesterday")
    assert.equal(p.measurements.length, 2, "utterance-level age covers both clauses")
    assert.ok(p.measurements.every((m) => m.ageDays === 1))
  }
  {
    const o = obs("leaves were yellowing last week")[0]
    assert.equal(o.symptom, "LEAF_YELLOWING")
    assert.equal(o.ageDays, 7, "observation carries the age too")
  }
  {
    const p = parseGrowText("ph 6.5 yesterday but ec 1.8 today")
    const ph = p.measurements.find((m) => m.metric === "ph")
    const ec = p.measurements.find((m) => m.metric === "ec")
    assert.equal(ph?.ageDays, 1, "per-clause age beats utterance mix")
    assert.equal(ec?.ageDays, 0)
  }
  {
    // "earlier" alone is ambiguous (hours? days?) → approximate, not current
    const p = parseGrowText("rh was around 70 earlier")
    assert.ok(p.measurements[0].pastUnresolved, "bare 'earlier' stays unbounded")
  }
  {
    const p = parseGrowText("temp is 84f right now")
    assert.equal(p.measurements[0].ageDays, 0, "same-day anchor resolves current")
  }
  {
    // no temporal phrase → no age fields at all
    const p = parseGrowText("ph 6.5")
    assert.equal(p.measurements[0].ageDays, undefined)
    assert.equal(p.measurements[0].pastUnresolved, undefined)
  }

  // ── normalization ─────────────────────────────────────────────────
  assert.equal(normalizeGrowText("Hello!! World???"), "hello world")
  assert.equal(normalizeGrowText("a,b;c"), "a ¶ b c", "comma → clause split, semicolon stripped")

  // ════════════════════════════════════════════════════════════════════
  // Command registry + @terpbot intent routing
  // (consolidated from terpbot-commands-tests.mts)
  // ════════════════════════════════════════════════════════════════════
  {
    // ── Registry ────────────────────────────────────────────────────────
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

    // New-command registry entries (grow intelligence + community)
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

    // ── Intent parser: positive routes ──────────────────────────────────
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

      // ── Thread-context intents ──────────────────────────────────────
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
      ["@terpbot what should I do next", "next"],
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

      // ── Setup intents ──────────────────────────────────────────────
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

    // ── Intent parser: moderation hard-block ────────────────────────────
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

    // ── Setup intents must not capture unrelated phrasing ──────────────
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

    // ── Thread-ref extraction (context resolver, pure part) ───────────
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
  }

  console.log("All TerpBot NL-parser + command/intent tests passed.")
}

run()
