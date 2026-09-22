// TerpBot knowledge — stage candidates. Part of the shared
// candidate registry; assembled in terpbot-intel-knowledge.ts.

import type { CandidateDef } from "@/lib/terpbot-intel-types"

export const STAGE_CANDIDATES: Record<string, CandidateDef> = {
  early_harvest: {
    id: "early_harvest",
    domain: "stage",
    kind: "condition",
    name: "Early harvest / grassy smell",
    mechanism: "Buds were cut before the trichomes fully matured, leaving a chlorophyll / hay odor.",
    severity: "watch",
    maxState: "possible", // hay smell can also be a bad dry — attribution stays hedged
    requiredInputs: [],
    discriminatingInputs: ["inspect:trichomes"],
    recommendedActions: [
      "A longer, slower dry (10–14 days) can help a little",
      "A proper cure in jars for 2–4 weeks",
      "Next run, wait for milky / amber trichomes before chop",
    ],
    sourceIds: ["postharvest-review-2022"],
    wizardResultId: "early_harvest",
  },

  bad_germ: {
    id: "bad_germ",
    domain: "stage",
    kind: "condition",
    name: "Failed germination",
    mechanism: "Seeds never pop — too deep, too wet, too cold, too old, or low viability.",
    severity: "watch",
    maxState: "strong",
    requiredInputs: [],
    discriminatingInputs: ["temperature", "substrateMoisture"],
    recommendedActions: [
      "Check temp 21–26°C, moisture but not soaked",
      "Don't plant more than 1 cm deep",
      "Soak in water for 12–24h or use a paper towel first",
    ],
    sourceIds: ["cornell-cannabis-guidebook", "terptalk-stage-tips"],
    wizardResultId: "bad_germ",
  },

  seedling_stretch: {
    id: "seedling_stretch",
    domain: "stage",
    kind: "condition",
    name: "Seedling stretching",
    mechanism: "Too little light or too far from the source — the seedling reaches for photons.",
    severity: "watch",
    maxState: "strong",
    requiredInputs: [],
    discriminatingInputs: ["ppfd", "leafTemp"],
    recommendedActions: [
      "Lower the light to 30–60 cm",
      "Use more blue / white light in seedling stage",
      "Bury part of the long stem when transplanting",
    ],
    sourceIds: ["terptalk-stage-tips"],
    wizardResultId: "seedling_stretch",
  },

  seedling_light: {
    id: "seedling_light",
    domain: "stage",
    kind: "condition",
    name: "Seedling light / overwater issue",
    mechanism: "Cotyledons yellowing — usually too wet, too dim, or a seed that was never viable.",
    severity: "watch",
    maxState: "strong",
    requiredInputs: [],
    discriminatingInputs: ["ppfd", "substrateMoisture"],
    recommendedActions: [
      "Water very lightly; seedlings need less than you think",
      "Make sure the light is close but not hot",
      "If only one seedling fails, it's probably the seed, not the environment",
    ],
    sourceIds: ["terptalk-stage-tips"],
    wizardResultId: "seedling_light",
  },

  seedling_chem: {
    id: "seedling_chem",
    domain: "stage",
    kind: "condition",
    name: "Seedling chemical / pH damage",
    mechanism: "Crinkled, twisted new leaves — too strong nutrients, wrong pH, or contaminated water.",
    severity: "watch",
    maxState: "strong",
    requiredInputs: [],
    discriminatingInputs: ["ph", "runoffPh", "ec"],
    recommendedActions: [
      "Use plain water or 1/4-strength nutrients only",
      "Verify pH is 5.5–6.5",
      "Make sure water is not chlorinated — let tap water sit 24h",
    ],
    sourceIds: ["terptalk-stage-tips", "canna-coco-ph"],
    wizardResultId: "seedling_chem",
  },

  seedling_burn: {
    id: "seedling_burn",
    domain: "stage",
    kind: "condition",
    name: "Seedling nutrient burn",
    mechanism: "First true leaves get brown tips — the medium already has nutrients or feed is too strong.",
    severity: "watch",
    maxState: "strong",
    requiredInputs: [],
    discriminatingInputs: ["ec", "runoffEc"],
    recommendedActions: [
      "Use seedling mix or coco with no pre-loaded nutrients",
      "Feed at 1/4 strength or plain pH'd water",
      "Wait for 3 sets of true leaves before ramping nutrients",
    ],
    sourceIds: ["canna-coco-ph", "terptalk-stage-tips"],
    wizardResultId: "seedling_burn",
  },

  hermie: {
    id: "hermie",
    domain: "stage",
    kind: "condition",
    name: "Hermaphroditism / seeds in buds",
    mechanism: "Plants developed male flowers from stress: light leaks, heat, bad genetics, or late-stage.",
    severity: "urgent",
    maxState: "strong",
    requiredInputs: [],
    discriminatingInputs: ["inspect:flowers", "photoperiod"],
    recommendedActions: [
      "Remove male pollen sacs / nanners with tweezers",
      "Check for light leaks during the dark period",
      "Separate the plant if it continues throwing nanners",
    ],
    sourceIds: ["terptalk-stage-tips"],
    wizardResultId: "hermie",
  },
}
