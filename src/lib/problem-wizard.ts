export interface WizardNode {
  id: string
  question: string
  options: { label: string; next?: string; result?: string }[]
}

export interface WizardResult {
  title: string
  cause: string
  fixes: string[]
  severity: "urgent" | "moderate" | "watch"
}

export const WIZARD_START = "start"

export const WIZARD_NODES: Record<string, WizardNode> = {
  start: {
    id: "start",
    question: "What part of the grow are you worried about?",
    options: [
      { label: "Leaves", next: "leaves" },
      { label: "Stems / branches", next: "stems" },
      { label: "Roots / below soil", next: "roots" },
      { label: "Buds / flowers", next: "buds" },
      { label: "Seedling / seeds", next: "seedling" },
      { label: "Environment / whole plant", next: "env" },
      { label: "Bugs or visible pests", next: "pests_type" },
    ],
  },

  // Leaves (existing paths with extra detail)
  leaves: {
    id: "leaves",
    question: "What is the main leaf symptom?",
    options: [
      { label: "Yellowing", next: "yellow_where" },
      { label: "Curling / clawing", next: "curl_direction" },
      { label: "Brown spots or burnt tips", next: "spots_where" },
      { label: "Drooping / wilting", next: "droop_when" },
      { label: "Holes or bite marks", result: "pests" },
      { label: "White powdery coating", result: "pm" },
      { label: "Purple / dark discoloration", result: "cold_phosphorus" },
      { label: "Twisted / distorted new growth", result: "zinc_boron" },
      { label: "Tip and edge burn while dark green", result: "nutrient_burn" },
    ],
  },
  yellow_where: {
    id: "yellow_where",
    question: "Where did the yellowing start?",
    options: [
      { label: "Bottom / older leaves first", next: "yellow_bottom_pattern" },
      { label: "Top / new growth", result: "iron_def" },
      { label: "All over evenly", result: "nitrogen_def" },
      { label: "Lower leaves with red / purple stems", result: "phosphorus_def" },
      { label: "Pale / lime green new growth", result: "sulfur_def" },
    ],
  },
  yellow_bottom_pattern: {
    id: "yellow_bottom_pattern",
    question: "How is the yellowing spreading?",
    options: [
      { label: "Edges stay green, middle yellows", result: "magnesium_def" },
      { label: "Whole leaf fades evenly", result: "nitrogen_def" },
      { label: "Edges yellow, tips brown", result: "potassium_def" },
    ],
  },
  curl_direction: {
    id: "curl_direction",
    question: "Which way are the leaves curling?",
    options: [
      { label: "Clawing downward like a talon", result: "nitrogen_tox" },
      { label: "Curling upward / canoeing", result: "heat_stress" },
      { label: "Edges crisping up or curling under", result: "wind_or_dry" },
      { label: "Twisted, narrow, new growth distorted", result: "zinc_boron" },
    ],
  },
  spots_where: {
    id: "spots_where",
    question: "Where are the spots or burns appearing?",
    options: [
      { label: "Top of plant, near the light", result: "light_burn" },
      { label: "Rusty / orange spots on middle leaves", result: "cal_mag" },
      { label: "Lower leaves, dead tissue between veins", result: "potassium_def" },
      { label: "Tiny speckles or stippling", result: "pests" },
      { label: "Brown tips spreading inward", result: "nutrient_burn" },
      { label: "Dark brown / black sunken spots", result: "bud_rot" },
    ],
  },
  droop_when: {
    id: "droop_when",
    question: "When do the leaves droop?",
    options: [
      { label: "Right after watering", result: "overwater" },
      { label: "When the pot feels light / dry", result: "underwater" },
      { label: "During lights-on heat peak", result: "heat_stress" },
      { label: "All the time, soft and limp", result: "root_rot" },
    ],
  },

  // Stems / branches
  stems: {
    id: "stems",
    question: "What do the stems or branches look like?",
    options: [
      { label: "Stretching tall and thin", result: "stretch" },
      { label: "Falling over / weak", result: "weak_stem" },
      { label: "Purple / red color", result: "cold_phosphorus" },
      { label: "Soft, mushy, or collapsing", result: "stem_rot" },
      { label: "Splitting or cracking", result: "overwater_burst" },
    ],
  },

  // Roots
  roots: {
    id: "roots",
    question: "What do the roots look like?",
    options: [
      { label: "Brown, slimy, or smell bad", result: "root_rot" },
      { label: "White but circling the pot", result: "root_bound" },
      { label: "Seedling fell over at the base", result: "damping_off" },
      { label: "Not sprouting at all", result: "bad_germ" },
      { label: "Roots growing through top of soil", result: "air_pruning" },
    ],
  },

  // Buds / flowers
  buds: {
    id: "buds",
    question: "What is wrong with the buds or flowers?",
    options: [
      { label: "Brown / gray mold inside buds", result: "bud_rot" },
      { label: "White powdery coating on leaves or sugar leaves", result: "pm" },
      { label: "Seeds forming in the buds", result: "hermie" },
      { label: "Small, airy, or underdeveloped", result: "insufficient_light" },
      { label: "Sugar leaves yellowing and dying", result: "bud_nutrient" },
      { label: "Buds smell like grass / hay", result: "early_harvest" },
    ],
  },

  // Seedling / seeds
  seedling: {
    id: "seedling",
    question: "What is the seedling or seed doing?",
    options: [
      { label: "Seed won't sprout", result: "bad_germ" },
      { label: "Seedling fell over and died", result: "damping_off" },
      { label: "Long thin stem / stretched", result: "seedling_stretch" },
      { label: "Cotyledons yellowing", result: "seedling_light" },
      { label: "Leaves are crinkled or twisted", result: "seedling_chem" },
      { label: "Brown dry tips on first true leaves", result: "seedling_burn" },
    ],
  },

  // Environment / whole plant
  env: {
    id: "env",
    question: "What does the overall environment or growth look like?",
    options: [
      { label: "Canopy is too hot", result: "heat_stress" },
      { label: "Humidity is too high / condensation", result: "humidity_high" },
      { label: "Humidity is too low", result: "humidity_low" },
      { label: "pH keeps drifting up or down", result: "ph_drift" },
      { label: "Runoff is dark / sludgy with high PPM", result: "salt_buildup" },
      { label: "Plants are too tall and thin", result: "stretch" },
      { label: "Plants are stunted / not growing", result: "stunt" },
    ],
  },

  // Pests
  pests_type: {
    id: "pests_type",
    question: "What kind of pest sign do you see?",
    options: [
      { label: "Tiny dots, webbing under leaves", result: "spider_mites" },
      { label: "Small flies around soil / coco", result: "fungus_gnats" },
      { label: "Wingless bugs crawling on leaves", result: "aphids" },
      { label: "Silvery trails or slime", result: "slugs_snails" },
      { label: "Holes chewed in leaves", result: "caterpillars" },
      { label: "Small white flying bugs", result: "whiteflies" },
      { label: "Stippling / silvering but no webbing", result: "thrips" },
      { label: "Not sure, just damage", result: "pests" },
    ],
  },
}

export const WIZARD_RESULTS: Record<string, WizardResult> = {
  nitrogen_def: {
    title: "Nitrogen deficiency",
    cause: "Older growth paling or yellowing from the bottom up — nitrogen is mobile, so the plant moves it to new tips when short.",
    fixes: [
      "Feed a nitrogen-rich grow formula",
      "Check pH runoff — lockouts mimic deficiencies",
      "Don't expect old yellow leaves to re-green; watch new growth",
    ],
    severity: "moderate",
  },
  magnesium_def: {
    title: "Magnesium deficiency",
    cause: "Interveinal yellowing and rusty spots on middle/lower leaves — common in coco, RO water, and heavy LED grows.",
    fixes: [
      "Add Cal-Mag at 1–2 ml/L every watering",
      "Verify pH is 5.8–6.2 (hydro) or 6.2–6.8 (soil)",
      "A foliar Epsom-salt spray (1g/L) gives faster green-up",
    ],
    severity: "moderate",
  },
  iron_def: {
    title: "Iron deficiency / pH lockout",
    cause: "New growth yellows between the veins while older leaves stay green — almost always a pH problem, not a lack of iron.",
    fixes: [
      "Check runoff pH first",
      "Correct pH to 5.5–6.2 (coco/hydro) or 6.0–6.8 (soil)",
      "Use chelated iron only after pH is dialed in",
    ],
    severity: "moderate",
  },
  nitrogen_tox: {
    title: "Nitrogen toxicity",
    cause: "Dark, glossy, clawing leaves — the plant is getting too much nitrogen, usually late veg or early flower.",
    fixes: [
      "Cut nitrogen by 30–50%",
      "Flush with plain pH'd water if leaves are deep green and clawed",
      "Switch to a bloom formula when flowers start forming",
    ],
    severity: "watch",
  },
  heat_stress: {
    title: "Heat stress",
    cause: "Canoe-shaped leaves, taco-ing, and drooping during the hot part of the day — canopy is too warm.",
    fixes: [
      "Raise or dim lights 10–20%",
      "Improve exhaust and air circulation",
      "Try to keep canopy under 28°C (82°F) and 50% RH",
    ],
    severity: "moderate",
  },
  wind_or_dry: {
    title: "Wind burn or low humidity",
    cause: "Crispy, curling leaf edges from direct fan blast or VPD too high.",
    fixes: [
      "Point fans at walls, not the canopy",
      "Raise humidity to VPD 0.8–1.2 kPa",
      "Remove only the worst crispy tips — don't over-defoliate",
    ],
    severity: "watch",
  },
  light_burn: {
    title: "Light burn / bleaching",
    cause: "Top leaves bleach, foxtail, or show tan/brown spots — the light is too close or too intense.",
    fixes: [
      "Raise the fixture 15–30 cm",
      "Dial down intensity to 70–80%",
      "Bleached buds won't recover; adjust immediately",
    ],
    severity: "urgent",
  },
  cal_mag: {
    title: "Calcium / magnesium deficiency",
    cause: "Rusty spots, curled or cupped leaves, and weak stems — common in coco, RO, and high-LED environments.",
    fixes: [
      "Feed Cal-Mag 1–2 ml/L with every watering",
      "Keep pH 5.8–6.2 in coco / hydro",
      "Remove badly damaged leaves to stop mold havens",
    ],
    severity: "moderate",
  },
  potassium_def: {
    title: "Potassium deficiency",
    cause: "Dead or scorched edges between the veins, often on lower leaves in mid-flower when K demand peaks.",
    fixes: [
      "Increase bloom nutrients or PK boosters",
      "Check pH — K locks out below 5.5 and above 7.0",
      "Don't strip every damaged leaf at once",
    ],
    severity: "moderate",
  },
  overwater: {
    title: "Overwatering",
    cause: "Droopy, soft leaves right after watering; pot stays heavy; roots are suffocating.",
    fixes: [
      "Let the medium dry until the pot feels light",
      "Lift the pot before each water — water by weight",
      "Add perlite or improve drainage if it stays soggy",
    ],
    severity: "moderate",
  },
  underwater: {
    title: "Underwatering",
    cause: "Droop when dry, perk up within an hour of watering — the plant is simply thirsty.",
    fixes: [
      "Water slowly until 10–20% runoff",
      "Check more often as the canopy grows",
      "Hydrophobic soil needs a slow soak, not a fast pour",
    ],
    severity: "watch",
  },
  pests: {
    title: "Pest damage",
    cause: "Holes, stippling, speckles, or distorted growth — inspect undersides with a loupe to confirm before treating.",
    fixes: [
      "Identify the pest first with a magnifier or macro photo",
      "IPM: sticky traps, neem/azadirachtin, beneficial insects",
      "Avoid foliar sprays after week 2–3 of flower",
    ],
    severity: "urgent",
  },
  pm: {
    title: "Powdery mildew",
    cause: "White, flour-like coating on leaves — high humidity, poor airflow, and cool nights are the usual triggers.",
    fixes: [
      "Remove infected fan leaves immediately",
      "Drop humidity and increase circulation",
      "Foliar potassium bicarbonate or H2O2 in veg / early flower only",
    ],
    severity: "urgent",
  },
  phosphorus_def: {
    title: "Phosphorus deficiency",
    cause: "Dark green or purple lower leaves with red stems, slow growth, and small flowers — common in late veg/flower or cold roots.",
    fixes: [
      "Add bloom / flowering nutrients",
      "Warm the root zone to 20–22°C (68–72°F)",
      "Check pH is 6.0–6.8 in soil; P becomes unavailable outside range",
    ],
    severity: "moderate",
  },
  sulfur_def: {
    title: "Sulfur deficiency",
    cause: "Overall pale / lime green new growth that eventually yellows — often mistaken for nitrogen deficiency but starts at the top.",
    fixes: [
      "Feed a full-spectrum nutrient — sulfur is in most base feeds",
      "Check pH is not too high; sulfur uptake drops above 7.0",
      "Epsom salts (Mg sulfate) at 0.5g/L can help as a foliar",
    ],
    severity: "watch",
  },
  zinc_boron: {
    title: "Zinc / boron deficiency or toxicity",
    cause: "Twisted, narrow, or stunted new growth, sometimes with dead or yellow spots — often pH-driven.",
    fixes: [
      "Test runoff pH and fix if outside 5.8–6.5",
      "Use a micronutrient supplement at half strength if pH is good",
      "Avoid over-fertilizing; micronutrient burn looks the same",
    ],
    severity: "watch",
  },
  nutrient_burn: {
    title: "Nutrient burn",
    cause: "Dark green, waxy leaves with burnt brown tips that spread inward — feed strength is too high.",
    fixes: [
      "Flush with 2–3x pot volume of pH'd water",
      "Drop EC/PPM to 75% of previous feed",
      "Wait for new growth before adding anything back",
    ],
    severity: "moderate",
  },
  cold_phosphorus: {
    title: "Cold roots / phosphorus lockout",
    cause: "Purple or red stems, and sometimes dark green leaves — the root zone is too cold for phosphorus uptake.",
    fixes: [
      "Raise root-zone temperature to 20–22°C (68–72°F)",
      "Insulate pots or use a heat mat",
      "Only add bloom boosters if pH and temp are in range",
    ],
    severity: "watch",
  },

  // Stems
  stretch: {
    title: "Stretching / etiolation",
    cause: "Plants are reaching for more light — weak light, wrong spectrum, or not enough blue / UV.",
    fixes: [
      "Lower the light or raise intensity",
      "Increase blue / white light during veg",
      "Support branches with stakes or a net as they harden off",
    ],
    severity: "watch",
  },
  weak_stem: {
    title: "Weak / unsupported branches",
    cause: "Heavy buds, weak stems, or lack of airflow — branches can't hold their own weight.",
    fixes: [
      "Add stakes, yo-yos, or a trellis net",
      "Improve circulation to strengthen stems",
      "Consider silica or potassium silicate in veg",
    ],
    severity: "watch",
  },
  stem_rot: {
    title: "Stem rot / damping off",
    cause: "Stem turns soft and collapses, often at the base — fungal infection from over-wet conditions.",
    fixes: [
      "Stop overwatering and let the top layer dry",
      "Improve airflow around the base",
      "If advanced, remove the plant to protect the rest of the tent",
    ],
    severity: "urgent",
  },
  overwater_burst: {
    title: "Stem splitting from overwater",
    cause: "Cells swell and crack after a sudden heavy watering — the stem can't keep up.",
    fixes: [
      "Water more often in smaller amounts",
      "Let the pot dry more between waterings",
      "Keep humidity low while the split calluses over",
    ],
    severity: "watch",
  },

  // Roots
  root_rot: {
    title: "Root rot",
    cause: "Brown, slimy roots with a bad smell — caused by low oxygen, overwatering, or pathogens like Pythium.",
    fixes: [
      "Cut dead roots and transplant into fresh, dry medium",
      "Add an enzymatic cleaner or beneficial bacteria",
      "Reduce watering and increase oxygenation",
    ],
    severity: "urgent",
  },
  root_bound: {
    title: "Root bound",
    cause: "Roots circle the pot, grow through drainage holes, and growth slows — the plant is out of room.",
    fixes: [
      "Transplant into a pot 2–3x larger",
      "Gently loosen circling roots before potting up",
      "Make sure the new pot has drainage",
    ],
    severity: "watch",
  },
  damping_off: {
    title: "Damping off",
    cause: "Seedling collapses at the base — a fungus in wet, cool, stagnant conditions.",
    fixes: [
      "Remove affected seedlings immediately",
      "Let topsoil dry between waterings",
      "Increase airflow and keep temps above 20°C",
    ],
    severity: "urgent",
  },
  bad_germ: {
    title: "Failed germination",
    cause: "Seeds never pop — too deep, too wet, too cold, too old, or low viability.",
    fixes: [
      "Check temp 21–26°C, moisture but not soaked",
      "Don't plant more than 1 cm deep",
      "Soak in water for 12–24h or use a paper towel first",
    ],
    severity: "watch",
  },
  air_pruning: {
    title: "Air pruning / surface roots",
    cause: "Roots grow out of the soil — usually from a pot that is too small or watering unevenly.",
    fixes: [
      "Pot up to a larger container",
      "Bury surface roots under fresh medium",
      "Water evenly across the whole pot surface",
    ],
    severity: "watch",
  },

  // Buds
  bud_rot: {
    title: "Bud rot (Botrytis / gray mold)",
    cause: "Brown/gray fuzz inside dense buds — high humidity and poor airflow during flower.",
    fixes: [
      "Remove infected buds and surrounding tissue",
      "Drop humidity below 50% in flower",
      "Increase airflow and avoid wetting buds",
    ],
    severity: "urgent",
  },
  hermie: {
    title: "Hermaphroditism / seeds in buds",
    cause: "Plants developed male flowers from stress: light leaks, heat, bad genetics, or late-stage.",
    fixes: [
      "Remove male pollen sacs / nanners with tweezers",
      "Check for light leaks during the dark period",
      "Separate the plant if it continues throwing nanners",
    ],
    severity: "urgent",
  },
  insufficient_light: {
    title: "Insufficient light / airy buds",
    cause: "Buds are loose, fluffy, and small — not enough photons or too far from the canopy.",
    fixes: [
      "Move the light closer or increase intensity",
      "Defoliate only lower fans to improve penetration",
      "Make sure DLI is hitting 20–40 mol/m²/day in flower",
    ],
    severity: "watch",
  },
  bud_nutrient: {
    title: "Late-flower nutrient fade / senescence",
    cause: "Sugar leaves yellow and die as the plant uses stored nutrients to finish buds.",
    fixes: [
      "Make sure pH is in range — lockout late in flower is common",
      "Top-dress with bloom nutrients if fading is premature",
      "Don't panic-remove every yellow fan at once",
    ],
    severity: "watch",
  },
  early_harvest: {
    title: "Early harvest / grassy smell",
    cause: "Buds were cut before the trichomes fully matured, leaving a chlorophyll / hay odor.",
    fixes: [
      "A longer, slower dry (10–14 days) can help a little",
      "A proper cure in jars for 2–4 weeks",
      "Next run, wait for milky / amber trichomes before chop",
    ],
    severity: "watch",
  },

  // Seedling
  seedling_stretch: {
    title: "Seedling stretching",
    cause: "Too little light or too far from the source — the seedling reaches for photons.",
    fixes: [
      "Lower the light to 30–60 cm",
      "Use more blue / white light in seedling stage",
      "Bury part of the long stem when transplanting",
    ],
    severity: "watch",
  },
  seedling_light: {
    title: "Seedling light / overwater issue",
    cause: "Cotyledons yellowing — usually too wet, too dim, or a seed that was never viable.",
    fixes: [
      "Water very lightly; seedlings need less than you think",
      "Make sure the light is close but not hot",
      "If only one seedling fails, it's probably the seed, not the environment",
    ],
    severity: "watch",
  },
  seedling_chem: {
    title: "Seedling chemical / pH damage",
    cause: "Crinkled, twisted new leaves — too strong nutrients, wrong pH, or contaminated water.",
    fixes: [
      "Use plain water or 1/4-strength nutrients only",
      "Verify pH is 5.5–6.5",
      "Make sure water is not chlorinated — let tap water sit 24h",
    ],
    severity: "watch",
  },
  seedling_burn: {
    title: "Seedling nutrient burn",
    cause: "First true leaves get brown tips — the medium already has nutrients or feed is too strong.",
    fixes: [
      "Use seedling mix or coco with no pre-loaded nutrients",
      "Feed at 1/4 strength or plain pH'd water",
      "Wait for 3 sets of true leaves before ramping nutrients",
    ],
    severity: "watch",
  },

  // Environment
  humidity_high: {
    title: "High humidity",
    cause: "Condensation, slow growth, and mold risk — usually lack of extraction or overwatering.",
    fixes: [
      "Increase exhaust fan speed",
      "Run a dehumidifier",
      "Defoliate only lower fans to improve airflow",
    ],
    severity: "moderate",
  },
  humidity_low: {
    title: "Low humidity",
    cause: "Crispy leaf edges, fast transpiration, nutrient burn symptoms — VPD is too high.",
    fixes: [
      "Add a humidifier in veg",
      "Mist seedlings if needed (not in flower)",
      "Raise humidity target: 60–70% veg, 40–50% flower",
    ],
    severity: "watch",
  },
  ph_drift: {
    title: "pH drift / instability",
    cause: "Runoff pH keeps moving — salt buildup, coco breakdown, or inconsistent water source.",
    fixes: [
      "Flush with 2–3x pot volume of pH'd water",
      "Use a stable base water — RO + calmag if needed",
      "Test pH of nutrient mix and runoff every feed",
    ],
    severity: "moderate",
  },
  salt_buildup: {
    title: "Salt / nutrient buildup",
    cause: "Runoff is dark, sludgy, and high EC — salts are accumulating in the medium.",
    fixes: [
      "Flush with plain pH'd water until runoff EC drops",
      "Feed at lower strength more often",
      "Check drainage — pots should not sit in runoff",
    ],
    severity: "moderate",
  },
  stunt: {
    title: "Stunted growth",
    cause: "Plants just won't grow — roots, pH, pests, cold, or genetics can all stall things.",
    fixes: [
      "Check roots first — are they white and spreading?",
      "Check pH and EC of runoff",
      "Check for pests and root-zone temperature",
    ],
    severity: "watch",
  },

  // Pests
  spider_mites: {
    title: "Spider mites",
    cause: "Tiny moving dots and fine webbing, usually under leaves and near veins.",
    fixes: [
      "Spray undersides with insecticidal soap or neem",
      "Release predatory mites (Phytoseiulus persimilis)",
      "Increase humidity slightly and repeat treatment every 3–5 days",
    ],
    severity: "urgent",
  },
  fungus_gnats: {
    title: "Fungus gnats",
    cause: "Small black flies around the soil — larvae eat fine roots in over-wet medium.",
    fixes: [
      "Let the top 2–3 cm of soil dry before watering",
      "Top-dress with diatomaceous earth or sand",
      "Use Bacillus thuringiensis (BT) or sticky traps",
    ],
    severity: "moderate",
  },
  aphids: {
    title: "Aphids",
    cause: "Soft, pear-shaped insects clustered on new growth and leaf undersides.",
    fixes: [
      "Blast off with a strong water spray",
      "Use insecticidal soap or pyrethrin",
      "Release ladybugs or lacewings for long-term control",
    ],
    severity: "urgent",
  },
  slugs_snails: {
    title: "Slugs / snails",
    cause: "Shiny slime trails and large, irregular holes in leaves.",
    fixes: [
      "Hand-pick at night with a flashlight",
      "Place beer traps or diatomaceous earth around pots",
      "Keep the floor and saucers clean and dry",
    ],
    severity: "watch",
  },
  caterpillars: {
    title: "Caterpillars / loopers",
    cause: "Large ragged holes in leaves and sometimes black droppings left behind.",
    fixes: [
      "Check undersides of leaves and buds for caterpillars",
      "Use Bacillus thuringiensis (BT) spray",
      "Treat immediately in flower — they can burrow into buds",
    ],
    severity: "urgent",
  },
  whiteflies: {
    title: "Whiteflies",
    cause: "Tiny white flying insects that swarm when the plant is disturbed.",
    fixes: [
      "Sticky traps near the canopy",
      "Insecticidal soap every 3–5 days",
      "Release Encarsia formosa parasitic wasps",
    ],
    severity: "urgent",
  },
  thrips: {
    title: "Thrips",
    cause: "Silvery, streaked leaves and black specks of frass — fast breeders.",
    fixes: [
      "Spray with spinosad or insecticidal soap",
      "Use blue sticky traps",
      "Beneficial mites (Amblyseius swirskii) work well",
    ],
    severity: "urgent",
  },
}
