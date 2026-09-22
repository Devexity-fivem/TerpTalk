// ── TerpBot controlled vocabulary ───────────────────────────────────
// Pure data — no logic. Consumed by terpbot-nl-parse (deterministic
// parser) and by intel rules (STAGE_REFINEMENTS for engine-side stage
// fallback). Every `feeds` id is a WIZARD_RESULTS / CANDIDATES key so a
// symptom report pools evidence into a real diagnostic candidate.

import type { LocationId, SymptomId } from "./terpbot-intel-types"

export type VocabFamily =
  | "symptom" | "location" | "stage" | "metric" | "unit" | "trend" | "period"
  | "intervention" | "progression"

export interface VocabEntry {
  /** SymptomId for symptom entries; LocationId/MetricId/etc. elsewhere */
  id: string
  family: VocabFamily
  /** normalized phrases — multiword entries are claimed first (longest match) */
  phrases: string[]
  /** wizard result ids this concept supports — symptoms only */
  feeds?: string[]
  /** "weak" entries only match when a plant noun appears in the same
   *  clause — the false-positive gate */
  confidence?: "strong" | "weak"
  /** intervention family: intended direction of the adjustment */
  direction?: "up" | "down"
  /** intervention family: the metric the adjustment targets */
  targetMetric?: string
}

export const VOCAB: VocabEntry[] = [
  // ── leaf color ──────────────────────────────────────────────────
  { id: "LEAF_YELLOWING", family: "symptom", feeds: ["nitrogen_def"], phrases: [
    "turning yellow", "going yellow", "yellowing", "yelloing", "yellowed",
    "yellow", "yelow", "yelllow", "chlorosis", "chlorotic", "yellowish",
    "went yellow" ] },
  { id: "LEAF_PALE", family: "symptom", feeds: ["sulfur_def", "nitrogen_def", "insufficient_light"],
    confidence: "weak", phrases: [
    "light green", "lime green", "lime", "pale", "washed out", "faded",
    "fading", "losing color", "loosing color", "whitish", "paling" ] },
  { id: "LEAF_DARK_GREEN", family: "symptom", feeds: ["nitrogen_tox"], phrases: [
    "dark green", "deep green", "too green", "very dark", "really dark",
    "glossy leaves", "waxy leaves", "shiny leaves" ] },
  { id: "LEAF_PURPLE_RED", family: "symptom", feeds: ["cold_phosphorus", "phosphorus_def"],
    confidence: "weak", phrases: [
    "turning purple", "purple leaves", "purpling", "purple", "reddish",
    "red leaves", "turning red", "going purple", "dark purple" ] },
  { id: "STEM_PURPLE", family: "symptom", feeds: ["cold_phosphorus"], phrases: [
    "purple stems", "red stems", "purple stem", "red stem", "purple stalks",
    "red stalks", "purple petioles", "reddish stems" ] },
  { id: "BROWNING", family: "symptom", feeds: ["potassium_def", "cal_mag", "bud_rot"], phrases: [
    "turning brown", "browning", "browned", "going brown", "brown patches",
    "necrotic", "dead tissue", "dead leaves", "dying leaves", "crispy brown" ] },
  { id: "BLEACHING", family: "symptom", feeds: ["light_burn"], phrases: [
    "bleached", "bleaching", "bleach white", "white tops", "whitened",
    "foxtailing", "fox tailing", "foxtails", "light bleach" ] },

  // ── texture ─────────────────────────────────────────────────────
  { id: "CLAW_DOWN", family: "symptom", feeds: ["nitrogen_tox", "overwater"], phrases: [
    "clawing", "clawed", "claw", "claws", "talon", "talons", "the claw",
    "claw like", "curling down", "curling downward", "curled down",
    "hooking", "hooked", "clawin" ] },
  { id: "CURL_UP", family: "symptom", feeds: ["heat_stress", "light_burn"], phrases: [
    "tacoing", "taco'd", "tacoed", "taco", "tacos", "canoeing", "canoe",
    "canoes", "cupping up", "cupped up", "curling up", "curling upward",
    "curled up", "edges curling up", "leaves cupping", "canoed",
    "curling", "curled", "leaf curl", "leaves curling" ] },
  { id: "CURL_UNDER", family: "symptom", feeds: ["wind_or_dry", "potassium_def"], phrases: [
    "curling under", "curled under", "curling in", "rolled under",
    "rolling in", "edges curling", "edges rolled", "leaf edges curling" ] },
  { id: "CRISPY", family: "symptom", feeds: ["wind_or_dry", "humidity_low", "nutrient_burn", "underwater"], phrases: [
    "crispy", "crisped", "crisp", "brittle", "crunchy", "dry and crispy",
    "crispy edges", "crispy tips", "crumbly" ] },
  { id: "LIMP_SOFT", family: "symptom", feeds: ["overwater", "root_rot"], confidence: "weak", phrases: [
    "limp", "floppy", "soft and limp", "limp leaves", "floppy leaves",
    "mushy leaves", "soft leaves", "squishy" ] },
  { id: "DISTORTED", family: "symptom", feeds: ["zinc_boron", "seedling_chem", "pests"], phrases: [
    "twisted", "twisting", "twisty", "distorted", "deformed", "crinkled",
    "crinkly", "crinkle", "narrow leaves", "misshapen", "weird growth",
    "funky leaves", "contorted", "wonky leaves" ] },

  // ── surface ─────────────────────────────────────────────────────
  { id: "TIP_BURN", family: "symptom", feeds: ["nutrient_burn", "seedling_burn", "potassium_def"], phrases: [
    "burnt tips", "burned tips", "burnt tip", "tip burn", "brown tips",
    "tips are brown", "tips turning brown", "nute burn", "nutes burn",
    "nuteburn", "nutrient burn", "feed burn", "feeding burn",
    "burnt edges", "burned edges", "tips burned", "tips burnt" ] },
  { id: "LIGHT_BURN", family: "symptom", feeds: ["light_burn"], phrases: [
    "light burn", "lightburn", "light burned", "bleached by light",
    "light stress burn" ] },
  { id: "SPOTS", family: "symptom", feeds: ["cal_mag", "pests", "potassium_def"], confidence: "weak", phrases: [
    "spots", "spotting", "spotted", "spot", "lesions", "lesion",
    "marks on leaves" ] },
  { id: "RUST_SPOTS", family: "symptom", feeds: ["cal_mag"], phrases: [
    "rusty spots", "rust spots", "orange spots", "rust colored spots",
    "rust spots on leaves" ] },
  { id: "DARK_SPOTS", family: "symptom", feeds: ["bud_rot", "potassium_def"], phrases: [
    "dark spots", "black spots", "sunken spots", "brown spots",
    "dark brown spots" ] },
  { id: "STIPPLING", family: "symptom", feeds: ["spider_mites", "thrips", "pests"], phrases: [
    "stippling", "stipple", "speckles", "speckled", "tiny dots",
    "little dots", "tiny specks", "flecks", "flecking", "pinpricks",
    "pin points" ] },
  { id: "SILVERING", family: "symptom", feeds: ["thrips"], phrases: [
    "silvery", "silvering", "silver streaks", "silver sheen",
    "silver patches", "shiny streaks" ] },
  { id: "POWDERY", family: "symptom", feeds: ["pm"], confidence: "weak", phrases: [
    "powdery mildew", "white powder", "powdery", "looks like flour",
    "flour like", "white dusty", "dusty white", "powder on leaves",
    "powder" ] }, // bare "pm" deliberately absent — time/DM collision
  { id: "STICKY_RESIDUE", family: "symptom", feeds: ["aphids", "whiteflies"], confidence: "weak", phrases: [
    "sticky leaves", "sticky residue", "honeydew",
    "sticky stuff on leaves" ] },
  { id: "WEBBING", family: "symptom", feeds: ["spider_mites"], confidence: "weak", phrases: [
    "webbing", "webs under", "web under", "spider web", "spiderweb",
    "webs on", "fine webbing", "web" ] },
  { id: "SLIME_TRAIL", family: "symptom", feeds: ["slugs_snails"], phrases: [
    "slime trails", "slime trail", "slimy trails", "slime", "slimy",
    "shiny trails", "silvery trails", "mucus trails" ] },
  { id: "HOLES", family: "symptom", feeds: ["caterpillars", "pests", "slugs_snails"], confidence: "weak", phrases: [
    "holes in leaves", "holes", "hole", "bite marks", "bites", "chewed",
    "chewed leaves", "getting eaten", "being eaten", "eaten leaves",
    "munched", "ragged holes", "something is eating",
    "something's eating" ] },
  { id: "FUZZ_MOLD", family: "symptom", feeds: ["bud_rot", "damping_off"], confidence: "weak", phrases: [
    "gray fuzz", "grey fuzz", "white fuzz", "fuzzy", "fuzz", "mold",
    "mould", "moldy", "moldy buds", "fuzzy growth", "fungus on" ] },

  // ── growth ──────────────────────────────────────────────────────
  { id: "STUNTED", family: "symptom", feeds: ["stunt"], phrases: [
    "stunted", "stunt", "not growing", "stopped growing", "stalled",
    "slow growth", "growing slow", "growing slowly", "barely growing",
    "no growth", "dwarfed", "staying small", "won't grow", "wont grow",
    "isnt growing" ] },
  { id: "STRETCHED", family: "symptom", feeds: ["stretch", "insufficient_light"], phrases: [
    "stretching", "stretched", "stretch", "leggy", "lanky", "spindly",
    "tall and thin", "too tall", "long stems", "reaching for light",
    "stretching tall", "etiolated", "streching" ] },
  { id: "DROOPING", family: "symptom", feeds: ["overwater", "underwater", "heat_stress", "root_rot"], phrases: [
    "drooping", "droopy", "droop", "droopin", "wilting", "wilted",
    "wilt", "wiltin", "sagging", "leaves hanging", "hanging down",
    "sad looking", "sad leaves", "slumped" ] },
  { id: "COLLAPSED", family: "symptom", feeds: ["damping_off", "stem_rot", "weak_stem"], phrases: [
    "collapsed", "collapsing", "fell over", "fell over and died",
    "fell down", "flopped", "flopped over", "keeled over",
    "falling over", "laying down", "leaning over", "fell at the base",
    "toppled" ] },

  // ── root / environment ──────────────────────────────────────────
  { id: "MEDIUM_WET", family: "symptom", feeds: ["overwater", "root_rot", "fungus_gnats"], phrases: [
    "soggy", "soaking wet", "waterlogged", "stays wet", "always wet",
    "wet soil", "soil is wet", "never dries", "never dries out",
    "pot stays heavy", "heavy pot", "sopping" ] },
  { id: "MEDIUM_DRY", family: "symptom", feeds: ["underwater"], phrases: [
    "bone dry", "dry soil", "soil is dry", "dried out", "pot is light",
    "pot feels light", "too dry", "drying out fast", "hydrophobic" ] },
  { id: "OVERWATERED", family: "symptom", feeds: ["overwater"], phrases: [
    "overwatered", "overwatering", "over watered", "over-watered",
    "watering too much", "too much water", "watered too much" ] },
  { id: "UNDERWATERED", family: "symptom", feeds: ["underwater"], phrases: [
    "underwatered", "under watered", "under-watered",
    "not enough water", "forgot to water", "under watering" ] },
  { id: "ENV_HOT", family: "symptom", feeds: ["heat_stress"], confidence: "weak", phrases: [
    "too hot", "running hot", "tent is hot", "hot in the tent",
    "overheating", "heat wave", "getting hot", "hot af", "heat stress" ] },
  { id: "ENV_COLD", family: "symptom", feeds: ["cold_phosphorus", "env.cold-stress"], confidence: "weak", phrases: [
    "too cold", "cold roots", "cold floor", "cold nights", "chilly",
    "freezing", "root zone is cold", "getting cold" ] },
  { id: "ENV_HUMID", family: "symptom", feeds: ["humidity_high"], confidence: "weak", phrases: [
    "too humid", "humidity is high", "high humidity", "humid", "muggy",
    "condensation", "condensation on", "super humid" ] },
  { id: "ENV_DRY", family: "symptom", feeds: ["humidity_low", "wind_or_dry"], phrases: [
    "low humidity", "humidity is low", "dry air", "not humid enough",
    "air is dry" ] },
  { id: "WIND_BURN", family: "symptom", feeds: ["wind_or_dry"], phrases: [
    "wind burn", "fan burn", "fan blowing on", "fan on the plants",
    "windburn", "fan too close" ] },
  { id: "ROOT_ROT", family: "symptom", feeds: ["root_rot"], phrases: [
    "root rot", "rootrot", "slimy roots", "brown roots", "roots smell",
    "smelly roots", "roots stink", "pythium" ] },
  { id: "ROOT_BOUND", family: "symptom", feeds: ["root_bound", "air_pruning"], phrases: [
    "root bound", "rootbound", "circling the pot", "roots circling",
    "roots through drainage", "roots coming out", "surface roots",
    "roots on the surface", "roots out of the soil" ] },
  { id: "BUD_ROT", family: "symptom", feeds: ["bud_rot"], phrases: [
    "bud rot", "budrot", "botrytis", "gray mold", "grey mold",
    "mold in buds", "rot in buds", "bud mold" ] },
  { id: "HERMIE", family: "symptom", feeds: ["hermie"], confidence: "weak", phrases: [
    "hermie", "hermied", "hermaphrodite", "nanners", "bananas on",
    "pollen sacs", "seeds in buds", "seeded buds", "balls on" ] },
  { id: "AIRY_BUDS", family: "symptom", feeds: ["insufficient_light"], phrases: [
    "airy buds", "fluffy buds", "loose buds", "larf", "larfy",
    "small buds", "underdeveloped buds", "popcorn buds" ] },
  { id: "GRASSY_SMELL", family: "symptom", feeds: ["early_harvest"], phrases: [
    "smells like hay", "hay smell", "smells like grass", "grassy smell",
    "hay odor", "chlorophyll smell", "smells grassy" ] },
  { id: "STEM_SPLIT", family: "symptom", feeds: ["overwater_burst", "weak_stem"], phrases: [
    "stem split", "split stem", "stem splitting", "stem cracked",
    "cracked stem", "stem burst", "splitting at the stem" ] },
  { id: "NO_SPROUT", family: "symptom", feeds: ["bad_germ"], phrases: [
    "won't sprout", "wont sprout", "didn't sprout", "didnt sprout",
    "never sprouted", "no sprout", "not sprouting", "seeds didn't pop",
    "seeds didnt pop", "never popped", "won't pop", "wont pop",
    "no germination", "didn't germinate", "didnt germinate",
    "never germinated" ] },
  { id: "PH_UNSTABLE", family: "symptom", feeds: ["ph_drift"], phrases: [
    "ph keeps drifting", "ph drifting", "ph drift", "ph unstable",
    "ph keeps moving", "ph won't hold", "ph wont hold", "ph swinging",
    "ph all over", "ph keeps changing", "ph won't stay" ] },
  { id: "EC_RISING", family: "symptom", feeds: ["salt_buildup", "nutrient_burn"], phrases: [
    "ec keeps rising", "ec rising", "ec climbing", "ppm climbing",
    "ppm rising", "ppm keeps going up", "ec keeps going up",
    "salts building", "salt buildup" ] },
  { id: "SALT_CRUST", family: "symptom", feeds: ["salt_buildup"], phrases: [
    "salt crust", "white crust", "crust on the soil", "crusty soil",
    "salt deposits" ] },

  // ── pests (direct entity names) ─────────────────────────────────
  { id: "PEST_MITES", family: "symptom", feeds: ["spider_mites"], phrases: [
    "spider mites", "spider mite", "spidermites", "mites", "mite",
    "two spotted", "tssm", "mite damage" ] },
  { id: "PEST_MITES_OTHER", family: "symptom", feeds: ["pests"], phrases: [
    "russet mites", "broad mites", "hemp russet" ] },
  { id: "PEST_APHIDS", family: "symptom", feeds: ["aphids"], phrases: [
    "aphids", "aphid", "greenfly", "blackfly", "green fly on" ] },
  { id: "PEST_THRIPS", family: "symptom", feeds: ["thrips"], phrases: [
    "thrips", "thrip" ] },
  { id: "PEST_FUNGUS_GNATS", family: "symptom", feeds: ["fungus_gnats"], phrases: [
    "fungus gnats", "fungas gnats", "gnats", "gnat", "little flies",
    "small flies", "tiny flies", "flies around soil", "soil flies",
    "black flies", "flies in soil" ] },
  { id: "PEST_WHITEFLIES", family: "symptom", feeds: ["whiteflies"], phrases: [
    "whiteflies", "white flies", "whitefly", "white fly" ] },
  { id: "PEST_CATERPILLARS", family: "symptom", feeds: ["caterpillars"], confidence: "weak", phrases: [
    "caterpillars", "caterpillar", "bud worms", "budworms", "loopers",
    "inchworms", "inch worms", "worms in buds", "worms" ] },
  { id: "PEST_SLUGS", family: "symptom", feeds: ["slugs_snails"], phrases: [
    "slugs", "slug", "snails", "snail" ] },
  { id: "PEST_GENERIC", family: "symptom", feeds: ["pests"], confidence: "weak", phrases: [
    "bugs", "bug", "insects", "pest", "pests", "infestation",
    "bugs on leaves", "bugs on my plant" ] },

  // ── locations ───────────────────────────────────────────────────
  { id: "LOWER_OLD", family: "location", phrases: [
    "lower fan leaves", "lower leaves", "bottom leaves", "lower",
    "bottom", "old growth", "older leaves", "older", "old leaves",
    "oldest leaves", "oldest", "old", "bottom of the plant" ] },
  { id: "UPPER_NEW", family: "location", phrases: [
    "new growth", "new leaves", "newest growth", "top leaves",
    "upper leaves", "top of the plant", "top of plant", "tops",
    "upper", "top", "near the light", "closest to the light",
    "under the light", "crown", "growing tips" ] },
  { id: "LEAF_TIPS", family: "location", phrases: [
    "leaf tips", "tips of the leaves", "tips", "tip", "ends of leaves",
    "leaf ends" ] },
  { id: "LEAF_MARGINS", family: "location", phrases: [
    "leaf edges", "edges of leaves", "edges", "edge", "margins",
    "margin", "leaf margins", "sides of leaves", "rim" ] },
  { id: "INTERVEINAL", family: "location", phrases: [
    "between veins", "between the veins", "interveinal",
    "in between veins", "between viens" ] },
  { id: "VEINS", family: "location", phrases: ["veins", "vein"] },
  { id: "STEMS", family: "location", phrases: [
    "stems", "stem", "stalks", "stalk", "branches", "branch",
    "main stem" ] },
  { id: "BUDS", family: "location", phrases: [
    "buds", "bud", "colas", "cola", "nugs", "nug", "bud sites" ] },
  { id: "SUGAR_LEAVES", family: "location", phrases: [
    "sugar leaves", "sugar leaf" ] },
  { id: "ROOTS", family: "location", phrases: [
    "root zone", "rootzone", "roots", "root", "root ball", "rootball",
    "in the res", "reservoir" ] },
  { id: "UNDERSIDE", family: "location", phrases: [
    "undersides", "underside", "under the leaves",
    "underneath the leaves", "leaf undersides" ] },
  { id: "COTYLEDONS", family: "location", phrases: [
    "cotyledons", "cotyledon", "seed leaves", "first leaves" ] },
  { id: "BASE", family: "location", phrases: [
    "at the base", "base of the stem", "soil line", "base of the plant",
    "bottom of the stem" ] },
  { id: "WHOLE_PLANT", family: "location", phrases: [
    "whole plant", "entire plant", "all over", "all the leaves",
    "all leaves", "every leaf", "everywhere", "whole thing",
    "both plants" ] },

  // ── stages (utterance-claimed; engine falls back to diary stage) ──
  { id: "GERMINATION", family: "stage", phrases: [
    "germination", "germinating", "germ", "popping seeds",
    "sprouting" ] },
  { id: "SEEDLING", family: "stage", phrases: [
    "seedling", "seedlings", "sprout", "sprouts", "young plant",
    "baby plant", "seedlng" ] },
  { id: "VEGETATIVE", family: "stage", phrases: [
    "in veg", "veg stage", "vegging", "vegetative", "veg", "vegative",
    "vegatative" ] },
  { id: "FLOWER", family: "stage", phrases: [
    "in flower", "flowering", "flower stage", "bloom", "blooming",
    "flower week", "week of flower", "budding", "flushing",
    "final flush", "flush", "in bloom" ] },
  { id: "HARVEST", family: "stage", phrases: [
    "harvest", "harvesting", "chop", "chop day", "cutting down",
    "chopping" ] },
  { id: "DRYING", family: "stage", phrases: [
    "drying", "dry room", "hanging to dry", "hang drying" ] },
  { id: "CURING", family: "stage", phrases: [
    "curing", "cure", "in the jar", "in jars", "burping", "jar cure",
    "in the jars" ] },

  // ── metrics ─────────────────────────────────────────────────────
  // NOTE: bare "flower"/"bud" are deliberately NOT stage phrases —
  // they're also plant parts. "week 6 flower" is handled by the
  // STAGE_PATTERNS regexes below instead.
  { id: "ph", family: "metric", phrases: [
    "ph", "p.h", "acidity", "ph level" ] },
  { id: "ec", family: "metric", phrases: [
    "ec", "e.c", "ms/cm", "feed strength" ] },
  { id: "ec", family: "metric", phrases: [
    "ppm", "tds", "parts per million" ] },
  { id: "temperature", family: "metric", phrases: [
    "temp", "temps", "temperature", "degrees", "fahrenheit",
    "celsius" ] },
  { id: "humidity", family: "metric", phrases: [
    "rh", "humidity", "relative humidity", "humidty", "rh%" ] },
  { id: "vpd", family: "metric", phrases: [
    "vpd", "vapor pressure deficit", "vapour pressure deficit" ] },
  { id: "height", family: "metric", phrases: [
    "height", "cm tall", "inches tall" ] },
  { id: "runoffPh", family: "metric", phrases: [
    "runoff ph", "run off ph", "run-off ph", "runoff p.h" ] },
  { id: "runoffEc", family: "metric", phrases: [
    "runoff ec", "run off ec", "run-off ec", "runoff e.c",
    "runoff ppm", "runoff tds" ] },

  // ── units (attach to nearest number in the same clause) ─────────
  { id: "degF", family: "unit", phrases: [
    "°f", "degrees f", "fahrenheit", "deg f" ] },
  { id: "degC", family: "unit", phrases: [
    "°c", "celsius", "deg c" ] },
  { id: "percent", family: "unit", phrases: [
    "%", "percent", "pct" ] },
  { id: "ppm", family: "unit", phrases: ["ppm"] },
  { id: "mscm", family: "unit", phrases: ["ms/cm"] },
  { id: "kpa", family: "unit", phrases: ["kpa"] },
  { id: "cm", family: "unit", phrases: ["cm", "centimeters", "centimetres"] },
  { id: "inch", family: "unit", phrases: ["inches", "inch"] },

  // ── trends / periods ────────────────────────────────────────────
  { id: "RISING", family: "trend", phrases: [
    "rising", "climbing", "going up", "keeps rising", "keeps climbing",
    "increasing", "creeping up", "keeps going up", "spiking",
    "on the rise", "shooting up", "trending up" ] },
  { id: "FALLING", family: "trend", phrases: [
    "falling", "dropping", "going down", "keeps dropping",
    "decreasing", "crashing", "plummeting", "coming down",
    "keeps falling", "trending down" ] },
  { id: "STABLE", family: "trend", phrases: [
    "stable", "steady", "holding steady", "constant",
    "staying the same", "rock solid", "holding" ] },
  { id: "SWINGING", family: "trend", phrases: [
    "swinging", "fluctuating", "bouncing", "all over the place",
    "up and down", "erratic", "keeps changing", "unstable",
    "keeps swinging", "swings" ] },
  { id: "NIGHT", family: "period", phrases: [
    "at night", "lights off", "lights out", "dark period",
    "during the night", "nighttime" ] },
  { id: "LIGHTS_ON", family: "period", phrases: [
    "lights on", "during lights on", "when lights are on",
    "during the day", "daytime" ] },
  { id: "LIGHTS_OFF", family: "period", phrases: [
    "when lights go off", "after lights out", "right after dark" ] },

  // ── interventions ─────────────────────────────────────────────────
  // Grower-reported adjustments — "i lowered rh", "raised the light".
  // These record INTENT, never a measured value: a number in the clause
  // binds as a claimed setpoint, not a reading. Phrases stay multiword
  // or verb-led so "i bought ph up" can't mint an intervention.
  { id: "RH_DOWN", family: "intervention", direction: "down", targetMetric: "humidity", phrases: [
    "lowered rh", "lowered the rh", "dropped rh", "brought rh down",
    "reduced humidity", "reduced the humidity", "lowered humidity",
    "lowered the humidity", "rh down", "bumped rh down",
    "turned the dehumidifier on", "added a dehumidifier",
    "running a dehumidifier", "increased exhaust", "turned up the exhaust",
    "dropped the humidity", "brought the humidity down", "dropped humidity" ] },
  { id: "RH_UP", family: "intervention", direction: "up", targetMetric: "humidity", phrases: [
    "raised rh", "raised the rh", "rh up", "brought rh up",
    "added a humidifier", "turned the humidifier on", "running a humidifier",
    "increased humidity", "increased the humidity", "raised humidity",
    "raised the humidity", "bumped rh up" ] },
  { id: "TEMP_DOWN", family: "intervention", direction: "down", targetMetric: "temperature", phrases: [
    "lowered temps", "lowered the temp", "lowered temp", "dropped temps",
    "dropped the temp", "brought temps down", "brought the temp down",
    "turned the ac on", "turned on the ac", "running the ac",
    "cooled it down", "cooling it down", "reduced temps" ] },
  { id: "TEMP_UP", family: "intervention", direction: "up", targetMetric: "temperature", phrases: [
    "raised temps", "raised the temp", "raised temp", "warmed it up",
    "warming it up", "heat mat on", "turned the heater on",
    "increased temps", "brought temps up" ] },
  { id: "EC_DOWN", family: "intervention", direction: "down", targetMetric: "ec", phrases: [
    "lowered ec", "lowered the ec", "reduced ec", "reduced the ec",
    "cut the feed", "cut back the feed", "cut back feed", "weaker feed",
    "diluted the feed", "diluted the res", "backed off the nutes",
    "half strength", "reduced feed", "reduced the feed",
    "lowered feed strength", "lighter feed" ] },
  { id: "EC_UP", family: "intervention", direction: "up", targetMetric: "ec", phrases: [
    "raised ec", "raised the ec", "upped the feed", "increased ec",
    "increased the ec", "stronger feed", "increased feed",
    "bumped the feed up", "heavier feed" ] },
  { id: "PH_ADJUST", family: "intervention", targetMetric: "ph", phrases: [
    "adjusted ph", "corrected ph", "adjusted the ph", "corrected the ph",
    "brought ph down", "brought ph up", "brought the ph down",
    "brought the ph up", "ph'd it down", "ph'd it up", "ph'd it",
    "lowered the ph", "raised the ph", "lowered ph", "raised ph" ] },
  { id: "LIGHT_RAISED", family: "intervention", phrases: [
    "raised the light", "raised the lights", "moved the light up",
    "moved the lights up", "light further away", "lights further away",
    "moved light further", "moved the light further", "hung it higher" ] },
  { id: "LIGHT_LOWERED", family: "intervention", phrases: [
    "lowered the light", "lowered the lights", "moved the light closer",
    "moved light closer", "moved the lights closer", "hung it lower" ] },
  { id: "LIGHT_DIMMED", family: "intervention", phrases: [
    "dimmed the light", "dimmed the lights", "turned the light down",
    "turned the lights down", "turned lights down", "backed off the light",
    "lowered intensity", "reduced intensity", "dimmed" ] },
  { id: "LIGHT_BRIGHTER", family: "intervention", phrases: [
    "turned the light up", "turned the lights up", "turned lights up",
    "increased intensity", "bumped the light up" ] },
  { id: "WATER_LESS", family: "intervention", direction: "down", targetMetric: "watering", phrases: [
    "watering less", "water less", "watering less often",
    "less frequent watering", "longer between waterings",
    "letting it dry out", "letting the medium dry", "waiting longer to water" ] },
  { id: "WATER_MORE", family: "intervention", direction: "up", targetMetric: "watering", phrases: [
    "watering more", "watering more often", "watering more frequently",
    "increased watering", "more frequent watering" ] },
  { id: "FLUSH", family: "intervention", direction: "down", targetMetric: "ec", phrases: [
    "flushed the medium", "flushed the soil", "flushed the coco",
    "flushed the pot", "flushed with plain water", "flushed with water",
    "flushing the medium", "flushing with plain water", "flushing the pot",
    "flushing the soil", "ran plain water through", "leached the medium",
    "leached the pot" ] },
  { id: "AIRFLOW", family: "intervention", phrases: [
    "added a fan", "added another fan", "moved the fan", "moved the fans",
    "pointed the fan away", "pointed the fans away", "increased airflow",
    "opened the vent", "opened a vent", "improved airflow" ] },
  { id: "DEFOLIATE", family: "intervention", phrases: [
    "defoliated", "removed the affected leaves", "removed affected leaves",
    "cut off the burnt leaves", "removed the dead leaves", "pruned" ] },
  { id: "REPOT", family: "intervention", phrases: [
    "transplanted", "repotted", "up-potted", "uppotted", "potted up" ] },
  { id: "PEST_ACTION", family: "intervention", phrases: [
    "sprayed for pests", "released predators", "released beneficials",
    "put out sticky cards", "put up sticky cards", "applied neem",
    "released ladybugs", "hung sticky traps" ] },

  // ── progression ───────────────────────────────────────────────────
  // Grower claims about symptom trajectory — resolution, improvement,
  // worsening, stability. A progression hit co-occurring with a symptom
  // routes the symptom to a resolution claim instead of an observation.
  { id: "RESOLVED", family: "progression", phrases: [
    "cleared up", "cleared", "went away", "gone away", "has stopped",
    "it stopped", "they stopped", "stopped on its own", "resolved",
    "all gone", "is gone", "are gone", "no longer showing", "fixed now" ] },
  { id: "IMPROVING", family: "progression", phrases: [
    "looking better", "geting better", "getting better", "improving",
    "improved", "on the mend", "perking up", "perked up", "bounced back",
    "bouncing back", "recovering", "coming back", "new growth looks good",
    "new growth looks healthy", "new growth is clean",
    "healthy new growth", "new leaves look fine", "new growth is fine",
    "looks healthier", "looking healthier" ] },
  { id: "WORSENING", family: "progression", phrases: [
    "getting worse", "still spreading", "keeps spreading", "spreading",
    "worse now", "more leaves affected", "getting worse not better",
    "keep spreading" ] },
  { id: "STEADY", family: "progression", phrases: [
    "no worse", "not getting worse", "hasn't spread", "hasnt spread",
    "not spreading", "stayed the same", "unchanged", "holding steady",
    "no better no worse", "same as before" ] },
]

/** Numeric stage claims that phrases can't express — "week 6 flower",
 *  "day 40 of veg". Deterministic regexes, applied per-clause. Matched
 *  spans are consumed so "week 6 flower" can never mint a phantom
 *  "6" measurement on a nearby metric. */
export const STAGE_PATTERNS: { re: RegExp; stage: string }[] = [
  { re: /\b(?:week|wk)\s*\d+\s*(?:of\s+)?(?:flower|bloom|budding)\b/, stage: "FLOWER" },
  { re: /\b(?:week|wk)\s*\d+\s*(?:of\s+)?(?:veg|vegetative)\b/, stage: "VEGETATIVE" },
  { re: /\bday\s*\d+\s*(?:of\s+)?(?:flower|bloom)\b/, stage: "FLOWER" },
  { re: /\bf\s*\d+\b/, stage: "FLOWER" }, // grower shorthand: "f6"
  { re: /\bv\s*\d+\b/, stage: "VEGETATIVE" }, // "v4"
]

// ── recency phrases ─────────────────────────────────────────────────
// Deterministic "how long ago" claims — resolved to an integer age in
// days (every staleness threshold is day-granular) or "past" when the
// claim is clearly historical but unbounded. Matched spans are consumed
// WITH their digits so "3 days ago" can never mint a phantom
// measurement. This is a whitelist, not a time engine — anything not
// listed leaves timing unresolved (never invent a timestamp).

/** number words accepted inside "N units ago" phrases */
export const TEMPORAL_NUM_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, couple: 2, few: 3,
}

/** oldest age resolved to a timestamp — anything older collapses to
 *  the cap; the 24h session window doesn't outlive it anyway */
export const TEMPORAL_MAX_AGE_DAYS = 30

const TEMPORAL_NUM = "(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|couple(?:\\s+of)?|few|\\d+)"

export const TEMPORAL_PATTERNS: {
  re: RegExp
  /** fixed days, "past" (unbounded historical), or "capture" (N × unitDays) */
  days: number | "past" | "capture"
  unitDays?: number
}[] = [
  // same-day anchors — "last night" is both a period cue and age 0
  { re: /\b(?:right now|just now|currently|today|tonight|this morning|this afternoon|this evening|earlier today|last night)\b/g, days: 0 },
  { re: /\byesterday\b/g, days: 1 },
  { re: new RegExp(`\\b(?:an?\\s+)?${TEMPORAL_NUM}\\s+days?\\s+ago\\b`, "g"), days: "capture", unitDays: 1 },
  { re: /\blast\s+week\b/g, days: 7 },
  { re: new RegExp(`\\b(?:an?\\s+)?${TEMPORAL_NUM}\\s+weeks?\\s+ago\\b`, "g"), days: "capture", unitDays: 7 },
  { re: /\blast\s+month\b/g, days: 30 },
  { re: new RegExp(`\\b(?:an?\\s+)?${TEMPORAL_NUM}\\s+months?\\s+ago\\b`, "g"), days: "capture", unitDays: 30 },
  // clearly-past but unbounded — never assigned a date. Bare "earlier"
  // lands here: it could mean hours or days, so it stays approximate.
  { re: /\b(?:a\s+while\s+(?:back|ago)|some\s+time\s+ago|a\s+bit\s+ago|back\s+then|earlier)\b/g, days: "past" },
]

// ── refinement tables ─────────────────────────────────────────────
// Stage wins over location (a seedling tip burn is seedling_burn, not
// nutrient_burn); location wins over the symptom's default feeds. The
// mobile-vs-immobile nutrient discriminator lives here: mobile
// deficiencies show on LOWER_OLD leaves, immobile on UPPER_NEW.

export const STAGE_REFINEMENTS: Partial<Record<SymptomId, Partial<Record<string, string[]>>>> = {
  TIP_BURN:   { SEEDLING: ["seedling_burn"], GERMINATION: ["seedling_burn"] },
  STRETCHED:  { SEEDLING: ["seedling_stretch"], GERMINATION: ["seedling_stretch"], FLOWER: ["stretch"] },
  COLLAPSED:  { SEEDLING: ["damping_off"], GERMINATION: ["bad_germ", "damping_off"] },
  LEAF_YELLOWING: { SEEDLING: ["seedling_light", "seedling_chem"], FLOWER: ["bud_nutrient", "nitrogen_def", "magnesium_def"] },
  DISTORTED:  { SEEDLING: ["seedling_chem"], FLOWER: ["zinc_boron", "pests"] },
  CRISPY:     { SEEDLING: ["seedling_burn", "seedling_light"] },
  MEDIUM_WET: { SEEDLING: ["damping_off", "seedling_light"] },
  NO_SPROUT:  { GERMINATION: ["bad_germ"] },
}

export const LOCATION_REFINEMENTS: Partial<Record<SymptomId, Partial<Record<LocationId, string[]>>>> = {
  LEAF_YELLOWING: {
    LOWER_OLD: ["nitrogen_def", "magnesium_def", "potassium_def"],
    UPPER_NEW: ["iron_def", "sulfur_def"],
    WHOLE_PLANT: ["nitrogen_def", "sulfur_def"],
    INTERVEINAL: ["magnesium_def", "iron_def"],
    LEAF_MARGINS: ["potassium_def"],
    SUGAR_LEAVES: ["bud_nutrient"],
    COTYLEDONS: ["seedling_light"],
  },
  LEAF_PALE:      { UPPER_NEW: ["sulfur_def", "iron_def"], LOWER_OLD: ["nitrogen_def"] },
  LEAF_PURPLE_RED: { LOWER_OLD: ["phosphorus_def", "cold_phosphorus"], STEMS: ["cold_phosphorus"] },
  BROWNING: {
    LEAF_TIPS: ["nutrient_burn", "potassium_def"],
    LEAF_MARGINS: ["potassium_def", "wind_or_dry"],
    BUDS: ["bud_rot"],
    INTERVEINAL: ["potassium_def"],
    LOWER_OLD: ["potassium_def", "nitrogen_def"],
  },
  SPOTS:      { LOWER_OLD: ["cal_mag", "potassium_def"], BUDS: ["bud_rot"], UNDERSIDE: ["pests"] },
  DARK_SPOTS: { BUDS: ["bud_rot"], LOWER_OLD: ["potassium_def"] },
  STIPPLING:  { UNDERSIDE: ["spider_mites", "thrips"] },
  CURL_UP:    { UPPER_NEW: ["light_burn", "heat_stress"] },
  CLAW_DOWN:  { WHOLE_PLANT: ["nitrogen_tox", "overwater"] },
  DROOPING:   { WHOLE_PLANT: ["overwater", "underwater", "root_rot"] },
  COLLAPSED:  { BASE: ["damping_off", "stem_rot"], STEMS: ["stem_rot", "weak_stem"] },
  FUZZ_MOLD:  { BUDS: ["bud_rot"], BASE: ["damping_off"], ROOTS: ["root_rot"] },
  HOLES:      { BUDS: ["caterpillars", "bud_rot"], UNDERSIDE: ["caterpillars", "pests"] },
  WEBBING:    { UNDERSIDE: ["spider_mites"] },
  LIMP_SOFT:  { STEMS: ["stem_rot"], BASE: ["stem_rot", "damping_off"] },
  STEM_SPLIT: { STEMS: ["overwater_burst", "weak_stem"] },
  DISTORTED:  { UPPER_NEW: ["zinc_boron", "pests"] },
  BUD_ROT:    { BUDS: ["bud_rot"] },
  GRASSY_SMELL: { BUDS: ["early_harvest"] },
}

// ── guards ──────────────────────────────────────────────────────────
// Consumed spans: matched FIRST; tokens inside can never produce
// matches. Kills "yellow sticky traps" → LEAF_YELLOWING class of bug.

export const GUARD_PHRASES = [
  "yellow sticky", "sticky trap", "sticky traps", "sticky card",
  "sticky cards", "yellow trap", "yellow traps", "blue sticky",
  "blue trap", "blue traps", "light meter", "ph pen", "ph meter",
  "ec pen", "ec meter", "tds meter", "taco tuesday",
]

export const NEGATION_TOKENS = new Set([
  "no", "not", "never", "without", "isnt", "isn't", "arent", "aren't",
  "dont", "don't", "doesnt", "doesn't", "wont", "won't",
])

/** Multi-word negations — checked against the up-to-4-token window
 *  preceding a hit ("leaves are no longer yellowing", "no sign of
 *  yellowing", "free of pests"). */
export const NEGATION_PHRASES = [
  "no sign of", "no signs of", "no longer", "not seeing", "haven't seen",
  "havent seen", "don't see", "dont see", "do not see", "free of",
  "none of", "no trace of", "not any",
]

/** Question-led text is a lookup, not a report — "what is chlorosis"
 *  must stay on the /ask path even though it names a symptom. */
export const QUESTION_LEAD =
  /^(what|whats|what's|how|why|when|where|which|who|is|are|does|do|can|should|could|would|any|find|show|search|tell|explain|define|meaning of)\b/

/** Comparison/lookup text anywhere in the clause — "light burn vs
 *  nutrient burn", "which is worse" — suppresses symptom observations
 *  the same way a leading question word does. */
export const COMPARISON_RE =
  /\b(vs|versus|which is worse|which is better)\b|\b(\w+er|more|less|worse|better)\s+than\b|\bthan (last|yesterday|before)\b/

// ── metric + trend → observation synthesis ──────────────────────────
// A clause like "humidity keeps climbing at night" names a metric and
// a trend but no symptom — synthesize the matching symptom observation
// so the engine sees it. Value-free: the logged series stays the
// authority; this only records that the grower REPORTED the movement.
export const METRIC_TREND_OBSERVATIONS: Partial<Record<string, Partial<Record<string, { symptom: SymptomId; feeds: string[] }>>>> = {
  humidity: {
    RISING:  { symptom: "ENV_HUMID", feeds: ["humidity_high"] },
    FALLING: { symptom: "ENV_DRY", feeds: ["humidity_low", "wind_or_dry"] },
  },
  temperature: {
    RISING:  { symptom: "ENV_HOT", feeds: ["heat_stress"] },
    FALLING: { symptom: "ENV_COLD", feeds: ["cold_phosphorus", "env.cold-stress"] },
  },
  ec: {
    RISING:  { symptom: "EC_RISING", feeds: ["salt_buildup", "nutrient_burn"] },
  },
  ph: {
    RISING:   { symptom: "PH_UNSTABLE", feeds: ["ph_drift"] },
    FALLING:  { symptom: "PH_UNSTABLE", feeds: ["ph_drift"] },
    SWINGING: { symptom: "PH_UNSTABLE", feeds: ["ph_drift"] },
  },
  vpd: {
    RISING:  { symptom: "ENV_DRY", feeds: ["humidity_low", "wind_or_dry"] },
    FALLING: { symptom: "ENV_HUMID", feeds: ["humidity_high"] },
  },
}

// ── display labels ─────────────────────────────────────────────────
// Canonical render names — evidence lines say "Reported: yellowing on
// lower leaves", never the raw free text.

export const SYMPTOM_LABELS: Record<string, string> = {
  LEAF_YELLOWING: "yellowing",
  LEAF_PALE: "pale/faded leaves",
  LEAF_DARK_GREEN: "dark glossy green leaves",
  LEAF_PURPLE_RED: "purple/red leaf color",
  STEM_PURPLE: "purple stems",
  BROWNING: "browning tissue",
  BLEACHING: "bleached tops",
  CLAW_DOWN: "downward clawing",
  CURL_UP: "upward cupping/taco-ing",
  CURL_UNDER: "edges curling under",
  CRISPY: "crispy/brittle tissue",
  LIMP_SOFT: "limp, soft leaves",
  DISTORTED: "twisted/distorted growth",
  TIP_BURN: "burnt tips",
  LIGHT_BURN: "light burn",
  SPOTS: "leaf spots",
  RUST_SPOTS: "rusty spots",
  DARK_SPOTS: "dark/sunken spots",
  STIPPLING: "stippling/tiny dots",
  SILVERING: "silvery streaks",
  POWDERY: "white powdery coating",
  STICKY_RESIDUE: "sticky residue/honeydew",
  WEBBING: "fine webbing",
  SLIME_TRAIL: "slime trails",
  HOLES: "holes/chewed leaves",
  FUZZ_MOLD: "fuzzy mold growth",
  STUNTED: "stalled growth",
  STRETCHED: "stretching",
  DROOPING: "drooping/wilt",
  COLLAPSED: "collapsed stems",
  MEDIUM_WET: "stays wet / soggy medium",
  MEDIUM_DRY: "bone-dry medium",
  OVERWATERED: "reported overwatering",
  UNDERWATERED: "reported underwatering",
  ENV_HOT: "running hot",
  ENV_COLD: "running cold",
  ENV_HUMID: "high humidity",
  ENV_DRY: "low humidity",
  WIND_BURN: "fan/wind burn",
  ROOT_ROT: "rotting roots",
  ROOT_BOUND: "roots outgrowing the pot",
  BUD_ROT: "rot inside buds",
  HERMIE: "male flowers / nanners",
  AIRY_BUDS: "airy buds",
  GRASSY_SMELL: "hay/grass smell",
  STEM_SPLIT: "splitting stem",
  NO_SPROUT: "seeds not sprouting",
  PH_UNSTABLE: "unstable pH",
  EC_RISING: "rising EC/PPM",
  SALT_CRUST: "salt crust on medium",
  PEST_MITES: "spider mites",
  PEST_MITES_OTHER: "russet/broad mites",
  PEST_APHIDS: "aphids",
  PEST_THRIPS: "thrips",
  PEST_FUNGUS_GNATS: "fungus gnats",
  PEST_WHITEFLIES: "whiteflies",
  PEST_CATERPILLARS: "caterpillars",
  PEST_SLUGS: "slugs/snails",
  PEST_GENERIC: "unidentified bugs",
}

export const LOCATION_LABELS: Record<string, string> = {
  LOWER_OLD: "lower/older leaves",
  UPPER_NEW: "new growth",
  LEAF_TIPS: "leaf tips",
  LEAF_MARGINS: "leaf edges",
  VEINS: "veins",
  INTERVEINAL: "between the veins",
  STEMS: "stems",
  BUDS: "buds",
  SUGAR_LEAVES: "sugar leaves",
  ROOTS: "root zone",
  UNDERSIDE: "leaf undersides",
  COTYLEDONS: "cotyledons",
  BASE: "stem base",
  WHOLE_PLANT: "the whole plant",
}

/** weak-confidence matches need one of these in the same clause */
export const PLANT_NOUNS = new Set([
  "leaf", "leaves", "plant", "plants", "buds", "bud", "stem", "stems",
  "stalk", "foliage", "growth", "tips", "edges", "cola", "colas",
  "canopy", "girl", "girls", "seedling", "roots", "medium", "soil",
  "coco", "tent", "grow", "flower", "flowers",
])
