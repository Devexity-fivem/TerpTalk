import { wizardResultFromCandidate } from "@/lib/terpbot-intel-wizard"

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
  // Every result is generated from the shared CANDIDATES registry —
  // the wizard, Thread.wizardResultId stats, and the diagnostic engine
  // consume the same knowledge record. Output is identical to the
  // literals this replaced (pinned by the snapshot equivalence test).
  nitrogen_def: wizardResultFromCandidate("nitrogen_def"),
  magnesium_def: wizardResultFromCandidate("magnesium_def"),
  iron_def: wizardResultFromCandidate("iron_def"),
  nitrogen_tox: wizardResultFromCandidate("nitrogen_tox"),
  heat_stress: wizardResultFromCandidate("heat_stress"),
  wind_or_dry: wizardResultFromCandidate("wind_or_dry"),
  light_burn: wizardResultFromCandidate("light_burn"),
  cal_mag: wizardResultFromCandidate("cal_mag"),
  potassium_def: wizardResultFromCandidate("potassium_def"),
  overwater: wizardResultFromCandidate("overwater"),
  underwater: wizardResultFromCandidate("underwater"),
  pests: wizardResultFromCandidate("pests"),
  pm: wizardResultFromCandidate("pm"),
  phosphorus_def: wizardResultFromCandidate("phosphorus_def"),
  sulfur_def: wizardResultFromCandidate("sulfur_def"),
  zinc_boron: wizardResultFromCandidate("zinc_boron"),
  nutrient_burn: wizardResultFromCandidate("nutrient_burn"),
  cold_phosphorus: wizardResultFromCandidate("cold_phosphorus"),
  stretch: wizardResultFromCandidate("stretch"),
  weak_stem: wizardResultFromCandidate("weak_stem"),
  stem_rot: wizardResultFromCandidate("stem_rot"),
  overwater_burst: wizardResultFromCandidate("overwater_burst"),
  root_rot: wizardResultFromCandidate("root_rot"),
  root_bound: wizardResultFromCandidate("root_bound"),
  damping_off: wizardResultFromCandidate("damping_off"),
  bad_germ: wizardResultFromCandidate("bad_germ"),
  air_pruning: wizardResultFromCandidate("air_pruning"),
  bud_rot: wizardResultFromCandidate("bud_rot"),
  hermie: wizardResultFromCandidate("hermie"),
  insufficient_light: wizardResultFromCandidate("insufficient_light"),
  bud_nutrient: wizardResultFromCandidate("bud_nutrient"),
  early_harvest: wizardResultFromCandidate("early_harvest"),
  seedling_stretch: wizardResultFromCandidate("seedling_stretch"),
  seedling_light: wizardResultFromCandidate("seedling_light"),
  seedling_chem: wizardResultFromCandidate("seedling_chem"),
  seedling_burn: wizardResultFromCandidate("seedling_burn"),
  humidity_high: wizardResultFromCandidate("humidity_high"),
  humidity_low: wizardResultFromCandidate("humidity_low"),
  ph_drift: wizardResultFromCandidate("ph_drift"),
  salt_buildup: wizardResultFromCandidate("salt_buildup"),
  stunt: wizardResultFromCandidate("stunt"),
  spider_mites: wizardResultFromCandidate("spider_mites"),
  fungus_gnats: wizardResultFromCandidate("fungus_gnats"),
  aphids: wizardResultFromCandidate("aphids"),
  slugs_snails: wizardResultFromCandidate("slugs_snails"),
  caterpillars: wizardResultFromCandidate("caterpillars"),
  whiteflies: wizardResultFromCandidate("whiteflies"),
  thrips: wizardResultFromCandidate("thrips"),
}
