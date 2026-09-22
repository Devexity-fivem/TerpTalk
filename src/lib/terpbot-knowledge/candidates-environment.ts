// TerpBot knowledge — environment candidates. Part of the shared
// candidate registry; assembled in terpbot-intel-knowledge.ts.

import type { CandidateDef } from "@/lib/terpbot-intel-types"

export const ENVIRONMENT_CANDIDATES: Record<string, CandidateDef> = {
  // ══ WIZARD-MIGRATED — environment / growth ═══════════════════════
  heat_stress: {
    id: "heat_stress",
    domain: "environment",
    kind: "condition",
    name: "Heat stress",
    mechanism: "Canoe-shaped leaves, taco-ing, and drooping during the hot part of the day — canopy is too warm.",
    severity: "moderate",
    maxState: "strong",
    requiredInputs: ["temperature"],
    discriminatingInputs: ["leafTemp", "ppfd"],
    recommendedActions: [
      "Raise or dim lights 10–20%",
      "Improve exhaust and air circulation",
      "Try to keep canopy under 28°C (82°F) and 50% RH",
    ],
    sourceIds: ["chandra-2008-photosynthesis", "cs-vpd-ranges"],
    wizardResultId: "heat_stress",
  },

  humidity_high: {
    id: "humidity_high",
    domain: "environment",
    kind: "condition",
    name: "High humidity",
    mechanism: "Condensation, slow growth, and mold risk — usually lack of extraction or overwatering.",
    severity: "moderate",
    maxState: "strong",
    requiredInputs: ["humidity"],
    discriminatingInputs: ["substrateMoisture", "leafTemp"],
    recommendedActions: [
      "Increase exhaust fan speed",
      "Run a dehumidifier",
      "Defoliate only lower fans to improve airflow",
    ],
    sourceIds: ["bc-cannabis-diseases", "punja-2022-botrytis"],
    wizardResultId: "humidity_high",
  },

  humidity_low: {
    id: "humidity_low",
    domain: "environment",
    kind: "condition",
    name: "Low humidity",
    mechanism: "Crispy leaf edges, fast transpiration, nutrient burn symptoms — VPD is too high.",
    severity: "watch",
    maxState: "strong",
    requiredInputs: ["humidity"],
    discriminatingInputs: ["leafTemp", "vpd"],
    recommendedActions: [
      "Add a humidifier in veg",
      "Mist seedlings if needed (not in flower)",
      "Raise humidity target: 60–70% veg, 40–50% flower",
    ],
    sourceIds: ["cs-vpd-ranges", "terptalk-stage-tips", "fao56-svp"],
    wizardResultId: "humidity_low",
  },

  wind_or_dry: {
    id: "wind_or_dry",
    domain: "environment",
    kind: "condition",
    name: "Wind burn or low humidity",
    mechanism: "Crispy, curling leaf edges from direct fan blast or VPD too high.",
    severity: "watch",
    maxState: "strong",
    requiredInputs: [],
    discriminatingInputs: ["humidity", "leafTemp"],
    recommendedActions: [
      "Point fans at walls, not the canopy",
      "Raise humidity to VPD 0.8–1.2 kPa",
      "Remove only the worst crispy tips — don't over-defoliate",
    ],
    sourceIds: ["cs-vpd-ranges", "fao56-svp"],
    wizardResultId: "wind_or_dry",
  },

  light_burn: {
    id: "light_burn",
    domain: "environment",
    kind: "condition",
    name: "Light burn / bleaching",
    mechanism: "Top leaves bleach, foxtail, or show tan/brown spots — the light is too close or too intense.",
    severity: "urgent",
    maxState: "strong",
    requiredInputs: [],
    discriminatingInputs: ["ppfd", "leafTemp", "inspect:canopy-tops"],
    recommendedActions: [
      "Raise the fixture 15–30 cm",
      "Dial down intensity to 70–80%",
      "Bleached buds won't recover; adjust immediately",
    ],
    sourceIds: ["rodriguez-morrison-2021-light", "chandra-2008-photosynthesis"],
    wizardResultId: "light_burn",
  },

  "env.cold-stress": {
    id: "env.cold-stress",
    domain: "environment",
    kind: "condition",
    name: "Cold root zone / low temperature",
    mechanism:
      "Sustained low temperature slows root uptake and stalls growth — cold roots also reduce phosphorus availability.",
    severity: "watch",
    maxState: "strong",
    requiredInputs: ["temperature"],
    discriminatingInputs: ["leafTemp"],
    recommendedActions: [
      "Raise root-zone temperature toward 68–72°F",
      "Insulate pots off cold floors",
    ],
    sourceIds: ["terptalk-stage-tips", "cornell-cannabis-guidebook"],
  },

  "env.instability": {
    id: "env.instability",
    domain: "environment",
    kind: "risk",
    name: "Unstable environment (volatile swings)",
    mechanism:
      "Large repeated temperature/humidity swings stress plants and hide in single daily readings.",
    severity: "watch",
    maxState: "possible", // thin provenance — internal + survey inference only
    requiredInputs: ["temperature", "humidity"],
    discriminatingInputs: ["leafTemp", "photoperiod"],
    recommendedActions: [
      "Log at lights-on and lights-off — swings hide in single readings",
      "Check controller hysteresis/deadband before adding equipment",
    ],
    sourceIds: ["ieee-greenhouse-survey"],
  },

  "env.dry-quality-risk": {
    id: "env.dry-quality-risk",
    domain: "environment",
    kind: "risk",
    name: "Drying conditions off-target",
    mechanism:
      "Drying too hot or too dry degrades terpenes and burns harsh; too cool or too wet invites mold in the dry room — a risk warning, not a diagnosis.",
    severity: "watch",
    maxState: "strong",
    requiredInputs: ["humidity"],
    discriminatingInputs: ["temperature"],
    recommendedActions: [
      "Hold ~60°F / 60% RH as the baseline",
      "Total darkness, gentle indirect airflow — never fans on the buds",
      "Check stems daily — snap at 7–14 days",
    ],
    sourceIds: ["terptalk-stage-tips", "postharvest-review-2022"],
  },
}
