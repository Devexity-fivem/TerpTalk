// TerpBot 2.0 Phase E — deterministic NL parser tests (pure, no DB).
// Pin the observation matrix: synonyms, misspellings, locations,
// stages, trends, negation, compounds, false positives, measurements.
// The parser NEVER diagnoses — it only produces observations.
// Run: tsx scripts/terpbot-nl-tests.mts

import { strict as assert } from "node:assert"
import { normalizeGrowText, parseGrowText } from "@/lib/terpbot-nl-parse"
import { CANDIDATES } from "@/lib/terpbot-intel-knowledge"

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
    assert.equal(m.metric, "ec", "ppm implies EC-family")
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
    const m = parseGrowText("run-off ph 6.8").measurements[0]
    assert.equal(m.metric, "runoffPh")
    assert.equal(m.value, 6.8)
  }
  {
    const m = parseGrowText("the runoff ph is 5.9").measurements[0]
    assert.equal(m.metric, "runoffPh")
    assert.equal(m.value, 5.9)
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

  // ── normalization ─────────────────────────────────────────────────
  assert.equal(normalizeGrowText("Hello!! World???"), "hello world")
  assert.equal(normalizeGrowText("a,b;c"), "a ¶ b c", "comma → clause split, semicolon stripped")

  console.log("All TerpBot NL-parser tests passed.")
}

run()
