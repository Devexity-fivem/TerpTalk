// TerpBot knowledge — pest candidates. Part of the shared
// candidate registry; assembled in terpbot-intel-knowledge.ts.

import type { CandidateDef } from "@/lib/terpbot-intel-types"

export const PEST_CANDIDATES: Record<string, CandidateDef> = {
  // ══ WIZARD-MIGRATED — pests & disease ════════════════════════════
  pests: {
    id: "pests",
    domain: "pest",
    kind: "condition",
    name: "Pest damage",
    mechanism: "Holes, stippling, speckles, or distorted growth — inspect undersides with a loupe to confirm before treating.",
    severity: "urgent",
    maxState: "strong",
    requiredInputs: [],
    discriminatingInputs: ["inspect:leaf-undersides", "inspect:sticky-cards"],
    recommendedActions: [
      "Identify the pest first with a magnifier or macro photo",
      "IPM: sticky traps, neem/azadirachtin, beneficial insects",
      "Avoid foliar sprays after week 2–3 of flower",
    ],
    sourceIds: ["bc-cannabis-diseases", "cornell-cannabis-guidebook"],
    wizardResultId: "pests",
  },

  spider_mites: {
    id: "spider_mites",
    domain: "pest",
    kind: "condition",
    name: "Spider mites",
    mechanism: "Tiny moving dots and fine webbing, usually under leaves and near veins.",
    severity: "urgent",
    maxState: "strong",
    requiredInputs: [],
    discriminatingInputs: ["inspect:leaf-undersides", "inspect:sticky-cards"],
    recommendedActions: [
      "Spray undersides with insecticidal soap or neem",
      "Release predatory mites (Phytoseiulus persimilis)",
      "Increase humidity slightly and repeat treatment every 3–5 days",
    ],
    sourceIds: ["bc-cannabis-diseases"],
    wizardResultId: "spider_mites",
  },

  fungus_gnats: {
    id: "fungus_gnats",
    domain: "pest",
    kind: "condition",
    name: "Fungus gnats",
    mechanism: "Small black flies around the soil — larvae eat fine roots in over-wet medium.",
    severity: "moderate",
    maxState: "strong",
    requiredInputs: [],
    discriminatingInputs: ["inspect:sticky-cards", "substrateMoisture"],
    recommendedActions: [
      "Let the top 2–3 cm of soil dry before watering",
      "Top-dress with diatomaceous earth or sand",
      "Use Bacillus thuringiensis (BT) or sticky traps",
    ],
    sourceIds: ["bc-cannabis-diseases"],
    wizardResultId: "fungus_gnats",
  },

  aphids: {
    id: "aphids",
    domain: "pest",
    kind: "condition",
    name: "Aphids",
    mechanism: "Soft, pear-shaped insects clustered on new growth and leaf undersides.",
    severity: "urgent",
    maxState: "strong",
    requiredInputs: [],
    discriminatingInputs: ["inspect:leaf-undersides"],
    recommendedActions: [
      "Blast off with a strong water spray",
      "Use insecticidal soap or pyrethrin",
      "Release ladybugs or lacewings for long-term control",
    ],
    sourceIds: ["bc-cannabis-diseases"],
    wizardResultId: "aphids",
  },

  slugs_snails: {
    id: "slugs_snails",
    domain: "pest",
    kind: "condition",
    name: "Slugs / snails",
    mechanism: "Shiny slime trails and large, irregular holes in leaves.",
    severity: "watch",
    maxState: "strong",
    requiredInputs: [],
    discriminatingInputs: ["inspect:leaf-undersides"],
    recommendedActions: [
      "Hand-pick at night with a flashlight",
      "Place beer traps or diatomaceous earth around pots",
      "Keep the floor and saucers clean and dry",
    ],
    sourceIds: ["bc-cannabis-diseases"],
    wizardResultId: "slugs_snails",
  },

  caterpillars: {
    id: "caterpillars",
    domain: "pest",
    kind: "condition",
    name: "Caterpillars / loopers",
    mechanism: "Large ragged holes in leaves and sometimes black droppings left behind.",
    severity: "urgent",
    maxState: "strong",
    requiredInputs: [],
    discriminatingInputs: ["inspect:leaf-undersides", "inspect:bud-interior"],
    recommendedActions: [
      "Check undersides of leaves and buds for caterpillars",
      "Use Bacillus thuringiensis (BT) spray",
      "Treat immediately in flower — they can burrow into buds",
    ],
    sourceIds: ["bc-cannabis-diseases"],
    wizardResultId: "caterpillars",
  },

  whiteflies: {
    id: "whiteflies",
    domain: "pest",
    kind: "condition",
    name: "Whiteflies",
    mechanism: "Tiny white flying insects that swarm when the plant is disturbed.",
    severity: "urgent",
    maxState: "strong",
    requiredInputs: [],
    discriminatingInputs: ["inspect:sticky-cards", "inspect:leaf-undersides"],
    recommendedActions: [
      "Sticky traps near the canopy",
      "Insecticidal soap every 3–5 days",
      "Release Encarsia formosa parasitic wasps",
    ],
    sourceIds: ["bc-cannabis-diseases"],
    wizardResultId: "whiteflies",
  },

  thrips: {
    id: "thrips",
    domain: "pest",
    kind: "condition",
    name: "Thrips",
    mechanism: "Silvery, streaked leaves and black specks of frass — fast breeders.",
    severity: "urgent",
    maxState: "strong",
    requiredInputs: [],
    discriminatingInputs: ["inspect:leaf-undersides", "inspect:sticky-cards"],
    recommendedActions: [
      "Spray with spinosad or insecticidal soap",
      "Use blue sticky traps",
      "Beneficial mites (Amblyseius swirskii) work well",
    ],
    sourceIds: ["bc-cannabis-diseases"],
    wizardResultId: "thrips",
  },
}
