// TerpBot knowledge — disease candidates. Part of the shared
// candidate registry; assembled in terpbot-intel-knowledge.ts.

import type { CandidateDef } from "@/lib/terpbot-intel-types"

export const DISEASE_CANDIDATES: Record<string, CandidateDef> = {
  root_rot: {
    id: "root_rot",
    domain: "disease",
    kind: "condition",
    name: "Root rot",
    mechanism: "Brown, slimy roots with a bad smell — caused by low oxygen, overwatering, or pathogens like Pythium.",
    severity: "urgent",
    maxState: "strong",
    requiredInputs: [],
    discriminatingInputs: ["inspect:roots", "substrateMoisture", "watering"],
    recommendedActions: [
      "Cut dead roots and transplant into fresh, dry medium",
      "Add an enzymatic cleaner or beneficial bacteria",
      "Reduce watering and increase oxygenation",
    ],
    sourceIds: ["bc-cannabis-diseases"],
    wizardResultId: "root_rot",
  },

  stem_rot: {
    id: "stem_rot",
    domain: "disease",
    kind: "condition",
    name: "Stem rot / damping off",
    mechanism: "Stem turns soft and collapses, often at the base — fungal infection from over-wet conditions.",
    severity: "urgent",
    maxState: "strong",
    requiredInputs: [],
    discriminatingInputs: ["inspect:stem-base", "substrateMoisture"],
    recommendedActions: [
      "Stop overwatering and let the top layer dry",
      "Improve airflow around the base",
      "If advanced, remove the plant to protect the rest of the tent",
    ],
    sourceIds: ["bc-cannabis-diseases", "punja-2022-botrytis"],
    wizardResultId: "stem_rot",
  },

  damping_off: {
    id: "damping_off",
    domain: "disease",
    kind: "condition",
    name: "Damping off",
    mechanism: "Seedling collapses at the base — a fungus in wet, cool, stagnant conditions.",
    severity: "urgent",
    maxState: "strong",
    requiredInputs: [],
    discriminatingInputs: ["inspect:stem-base", "humidity", "temperature"],
    recommendedActions: [
      "Remove affected seedlings immediately",
      "Let topsoil dry between waterings",
      "Increase airflow and keep temps above 20°C",
    ],
    sourceIds: ["punja-2022-botrytis", "bc-cannabis-diseases"],
    wizardResultId: "damping_off",
  },

  pm: {
    id: "pm",
    domain: "disease",
    kind: "condition",
    name: "Powdery mildew",
    mechanism: "White, flour-like coating on leaves — high humidity, poor airflow, and cool nights are the usual triggers.",
    severity: "urgent",
    maxState: "strong",
    requiredInputs: [],
    discriminatingInputs: ["inspect:leaf-surfaces", "humidity"],
    recommendedActions: [
      "Remove infected fan leaves immediately",
      "Drop humidity and increase circulation",
      "Foliar potassium bicarbonate or H2O2 in veg / early flower only",
    ],
    sourceIds: ["utia-pm-hemp", "bc-cannabis-diseases"],
    wizardResultId: "pm",
  },

  bud_rot: {
    id: "bud_rot",
    domain: "disease",
    kind: "condition",
    name: "Bud rot (Botrytis / gray mold)",
    mechanism: "Brown/gray fuzz inside dense buds — high humidity and poor airflow during flower.",
    severity: "urgent",
    maxState: "strong",
    requiredInputs: [],
    discriminatingInputs: ["inspect:bud-interior", "humidity"],
    recommendedActions: [
      "Remove infected buds and surrounding tissue",
      "Drop humidity below 50% in flower",
      "Increase airflow and avoid wetting buds",
    ],
    sourceIds: ["punja-2022-botrytis", "punja-ni-2025-budrot", "bc-cannabis-diseases"],
    wizardResultId: "bud_rot",
  },

  // Combination target: flower stage + elevated RH + low VPD accumulate
  // RISK evidence here. Renders as a hazard warning, never a diagnosis.
  "env.moisture-disease-risk": {
    id: "env.moisture-disease-risk",
    domain: "disease",
    kind: "risk",
    name: "Moisture-related disease risk",
    mechanism:
      "Sustained high humidity with weak transpiration in flower favors botrytis and powdery mildew — this is a risk assessment, not a disease diagnosis.",
    severity: "urgent",
    maxState: "strong",
    requiredInputs: ["humidity"],
    discriminatingInputs: ["leafTemp", "substrateMoisture", "inspect:bud-interior"],
    recommendedActions: [
      "Drop RH toward 40–50% — exhaust first, dehumidifier if needed",
      "Increase airflow through the canopy; thin lower growth only",
      "Inspect dense colas weekly with a loupe from mid-flower",
    ],
    sourceIds: ["punja-2022-botrytis", "punja-ni-2025-budrot", "utia-pm-hemp", "bc-cannabis-diseases"],
  },
}
