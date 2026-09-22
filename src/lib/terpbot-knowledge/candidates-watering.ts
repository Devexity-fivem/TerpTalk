// TerpBot knowledge — watering candidates. Part of the shared
// candidate registry; assembled in terpbot-intel-knowledge.ts.

import type { CandidateDef } from "@/lib/terpbot-intel-types"

export const WATERING_CANDIDATES: Record<string, CandidateDef> = {
  // ══ WIZARD-MIGRATED — watering / root zone ═══════════════════════
  overwater: {
    id: "overwater",
    domain: "watering",
    kind: "condition",
    name: "Overwatering",
    mechanism: "Droopy, soft leaves right after watering; pot stays heavy; roots are suffocating.",
    severity: "moderate",
    maxState: "strong",
    requiredInputs: [],
    discriminatingInputs: ["substrateMoisture", "watering"],
    recommendedActions: [
      "Let the medium dry until the pot feels light",
      "Lift the pot before each water — water by weight",
      "Add perlite or improve drainage if it stays soggy",
    ],
    sourceIds: ["cornell-cannabis-guidebook", "bc-cannabis-diseases"],
    wizardResultId: "overwater",
  },

  underwater: {
    id: "underwater",
    domain: "watering",
    kind: "condition",
    name: "Underwatering",
    mechanism: "Droop when dry, perk up within an hour of watering — the plant is simply thirsty.",
    severity: "watch",
    maxState: "strong",
    requiredInputs: [],
    discriminatingInputs: ["substrateMoisture", "watering"],
    recommendedActions: [
      "Water slowly until 10–20% runoff",
      "Check more often as the canopy grows",
      "Hydrophobic soil needs a slow soak, not a fast pour",
    ],
    sourceIds: ["fao56-svp", "cornell-cannabis-guidebook"],
    wizardResultId: "underwater",
  },

  overwater_burst: {
    id: "overwater_burst",
    domain: "watering",
    kind: "condition",
    name: "Stem splitting from overwater",
    mechanism: "Cells swell and crack after a sudden heavy watering — the stem can't keep up.",
    severity: "watch",
    maxState: "strong",
    requiredInputs: [],
    discriminatingInputs: ["watering", "substrateMoisture"],
    recommendedActions: [
      "Water more often in smaller amounts",
      "Let the pot dry more between waterings",
      "Keep humidity low while the split calluses over",
    ],
    sourceIds: ["cornell-cannabis-guidebook"],
    wizardResultId: "overwater_burst",
  },

  root_bound: {
    id: "root_bound",
    domain: "watering",
    kind: "condition",
    name: "Root bound",
    mechanism: "Roots circle the pot, grow through drainage holes, and growth slows — the plant is out of room.",
    severity: "watch",
    maxState: "strong",
    requiredInputs: [],
    discriminatingInputs: ["inspect:roots", "watering"],
    recommendedActions: [
      "Transplant into a pot 2–3x larger",
      "Gently loosen circling roots before potting up",
      "Make sure the new pot has drainage",
    ],
    sourceIds: ["cornell-cannabis-guidebook", "terptalk-stage-tips"],
    wizardResultId: "root_bound",
  },

  air_pruning: {
    id: "air_pruning",
    domain: "watering",
    kind: "condition",
    name: "Air pruning / surface roots",
    mechanism: "Roots grow out of the soil — usually from a pot that is too small or watering unevenly.",
    severity: "watch",
    maxState: "strong",
    requiredInputs: [],
    discriminatingInputs: ["inspect:roots", "watering"],
    recommendedActions: [
      "Pot up to a larger container",
      "Bury surface roots under fresh medium",
      "Water evenly across the whole pot surface",
    ],
    sourceIds: ["cornell-cannabis-guidebook"],
    wizardResultId: "air_pruning",
  },
}
