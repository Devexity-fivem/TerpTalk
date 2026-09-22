// TerpBot knowledge — growth candidates. Part of the shared
// candidate registry; assembled in terpbot-intel-knowledge.ts.

import type { CandidateDef } from "@/lib/terpbot-intel-types"

export const GROWTH_CANDIDATES: Record<string, CandidateDef> = {
  stretch: {
    id: "stretch",
    domain: "growth",
    kind: "condition",
    name: "Stretching / etiolation",
    mechanism: "Plants are reaching for more light — weak light, wrong spectrum, or not enough blue / UV.",
    severity: "watch",
    maxState: "strong",
    requiredInputs: [],
    discriminatingInputs: ["ppfd", "photoperiod"],
    recommendedActions: [
      "Lower the light or raise intensity",
      "Increase blue / white light during veg",
      "Support branches with stakes or a net as they harden off",
    ],
    sourceIds: ["rodriguez-morrison-2021-light", "terptalk-stage-tips"],
    wizardResultId: "stretch",
  },

  weak_stem: {
    id: "weak_stem",
    domain: "growth",
    kind: "condition",
    name: "Weak / unsupported branches",
    mechanism: "Heavy buds, weak stems, or lack of airflow — branches can't hold their own weight.",
    severity: "watch",
    maxState: "strong",
    requiredInputs: [],
    discriminatingInputs: ["inspect:stem-base"],
    recommendedActions: [
      "Add stakes, yo-yos, or a trellis net",
      "Improve circulation to strengthen stems",
      "Consider silica or potassium silicate in veg",
    ],
    sourceIds: ["terptalk-stage-tips"],
    wizardResultId: "weak_stem",
  },

  stunt: {
    id: "stunt",
    domain: "growth",
    kind: "condition",
    name: "Stunted growth",
    mechanism: "Plants just won't grow — roots, pH, pests, cold, or genetics can all stall things.",
    severity: "watch",
    maxState: "strong",
    requiredInputs: [],
    discriminatingInputs: ["ppfd", "leafTemp", "runoffPh", "watering"],
    recommendedActions: [
      "Check roots first — are they white and spreading?",
      "Check pH and EC of runoff",
      "Check for pests and root-zone temperature",
    ],
    sourceIds: ["chandra-2008-photosynthesis", "cornell-cannabis-guidebook"],
    wizardResultId: "stunt",
  },

  insufficient_light: {
    id: "insufficient_light",
    domain: "growth",
    kind: "condition",
    name: "Insufficient light / airy buds",
    mechanism: "Buds are loose, fluffy, and small — not enough photons or too far from the canopy.",
    severity: "watch",
    maxState: "strong",
    requiredInputs: [],
    discriminatingInputs: ["ppfd", "photoperiod"],
    recommendedActions: [
      "Move the light closer or increase intensity",
      "Defoliate only lower fans to improve penetration",
      "Make sure DLI is hitting 20–40 mol/m²/day in flower",
    ],
    sourceIds: ["rodriguez-morrison-2021-light"],
    wizardResultId: "insufficient_light",
  },

  bud_nutrient: {
    id: "bud_nutrient",
    domain: "growth",
    kind: "condition",
    name: "Late-flower nutrient fade / senescence",
    mechanism: "Sugar leaves yellow and die as the plant uses stored nutrients to finish buds.",
    severity: "watch",
    maxState: "strong",
    requiredInputs: [],
    discriminatingInputs: ["ph", "runoffPh"],
    recommendedActions: [
      "Make sure pH is in range — lockout late in flower is common",
      "Top-dress with bloom nutrients if fading is premature",
      "Don't panic-remove every yellow fan at once",
    ],
    sourceIds: ["cockson-2019-nutrient-disorders", "terptalk-stage-tips"],
    wizardResultId: "bud_nutrient",
  },
}
