// Plant problem diagnostic decision tree
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

export const WIZARD_START = "leaves"

export const WIZARD_NODES: Record<string, WizardNode> = {
  leaves: {
    id: "leaves",
    question: "What's happening with the leaves?",
    options: [
      { label: "Yellowing", next: "yellow_where" },
      { label: "Curling / clawing", next: "curl_direction" },
      { label: "Brown spots or burnt tips", next: "spots_where" },
      { label: "Drooping / wilting", next: "droop_when" },
      { label: "Holes or bite marks", result: "pests" },
      { label: "White powdery coating", result: "pm" },
    ],
  },
  yellow_where: {
    id: "yellow_where",
    question: "Where is the yellowing?",
    options: [
      { label: "Bottom / older leaves first", next: "yellow_bottom_pattern" },
      { label: "Top / new growth", result: "iron_def" },
      { label: "All over evenly", result: "nitrogen_def" },
    ],
  },
  yellow_bottom_pattern: {
    id: "yellow_bottom_pattern",
    question: "Are the leaf edges staying green while the middle yellows?",
    options: [
      { label: "Yes, edges stay green", result: "magnesium_def" },
      { label: "No, whole leaf fades", result: "nitrogen_def" },
    ],
  },
  curl_direction: {
    id: "curl_direction",
    question: "Which way are the leaves curling?",
    options: [
      { label: "Clawing downward", result: "nitrogen_tox" },
      { label: "Curling upward / canoeing", result: "heat_stress" },
      { label: "Edges crisping up", result: "wind_or_dry" },
    ],
  },
  spots_where: {
    id: "spots_where",
    question: "Where are the spots appearing?",
    options: [
      { label: "Top of plant, near the light", result: "light_burn" },
      { label: "Scattered, rusty-looking", result: "cal_mag" },
      { label: "Mostly lower leaves", next: "spots_lower" },
    ],
  },
  spots_lower: {
    id: "spots_lower",
    question: "Do the spots look like dead tissue between the veins?",
    options: [
      { label: "Yes, between veins", result: "potassium_def" },
      { label: "More like tiny speckles", result: "pests" },
    ],
  },
  droop_when: {
    id: "droop_when",
    question: "When does the drooping happen?",
    options: [
      { label: "Right after watering", result: "overwater" },
      { label: "When the pot feels light / dry", result: "underwater" },
      { label: "During lights-on heat peak", result: "heat_stress" },
    ],
  },
}

export const WIZARD_RESULTS: Record<string, WizardResult> = {
  nitrogen_def: {
    title: "Nitrogen deficiency",
    cause: "Not enough nitrogen — most common in veg and in depleted soil.",
    fixes: ["Feed a nitrogen-rich nutrient (grow formula)", "Check pH is in range — lockout mimics deficiency", "Yellow leaves won't recover; watch new growth instead"],
    severity: "moderate",
  },
  magnesium_def: {
    title: "Magnesium deficiency",
    cause: "Interveinal yellowing on lower leaves — classic Mg shortage, common in coco and RO water.",
    fixes: ["Add Cal-Mag at 1–2 ml/L", "Check pH — Mg locks out below ~5.5", "Foliar spray gives faster relief"],
    severity: "moderate",
  },
  iron_def: {
    title: "Iron deficiency / pH lockout",
    cause: "New growth yellows while veins stay green — usually a pH problem, not a lack of iron.",
    fixes: ["Check runoff pH first — this is almost always pH, not iron", "Correct pH to 5.8–6.2 (hydro) or 6.0–6.8 (soil)", "Only supplement chelated iron if pH is correct"],
    severity: "moderate",
  },
  nitrogen_tox: {
    title: "Nitrogen toxicity",
    cause: "Too much nitrogen — dark, glossy, clawing leaves.",
    fixes: ["Cut feed strength in half", "Flush with plain pH'd water if severe", "Ease off grow nutrients — clawed leaves recover as new growth comes in"],
    severity: "watch",
  },
  heat_stress: {
    title: "Heat stress",
    cause: "Canoe-ing leaves near the light — canopy is too hot.",
    fixes: ["Raise lights or dim 10–20%", "Improve extraction / add circulation", "Keep canopy under ~28°C (82°F)"],
    severity: "moderate",
  },
  wind_or_dry: {
    title: "Wind burn or low humidity",
    cause: "Crispy edges pointing at a fan, or VPD too high.",
    fixes: ["Aim fans at walls, not the canopy", "Raise humidity — target VPD 0.8–1.2", "Check the env chart on your diary for dry spells"],
    severity: "watch",
  },
  light_burn: {
    title: "Light burn / bleaching",
    cause: "Bleached or spotted top growth — the light is too close or too strong.",
    fixes: ["Raise the light 15–30cm", "Check PPFD if you have a meter", "Bleached buds won't recover potency — adjust now"],
    severity: "urgent",
  },
  cal_mag: {
    title: "Calcium/magnesium deficiency",
    cause: "Rusty spots on middle growth — common in coco, RO water, or under LED.",
    fixes: ["Add Cal-Mag 1–2 ml/L every feed", "Verify pH in range", "Remove badly damaged leaves to redirect energy"],
    severity: "moderate",
  },
  potassium_def: {
    title: "Potassium deficiency",
    cause: "Dead tissue between veins on lower leaves — often appears in flower when K demand spikes.",
    fixes: ["Bump bloom nutrients — K demand is highest mid-flower", "Check pH", "Don't strip all damaged leaves at once"],
    severity: "moderate",
  },
  overwater: {
    title: "Overwatering",
    cause: "Droopy right after watering, heavy pot, slow growth — roots are suffocating.",
    fixes: ["Let the medium dry out fully before the next water", "Check drainage — roots need oxygen", "Water by pot weight, not by schedule"],
    severity: "moderate",
  },
  underwater: {
    title: "Underwatering",
    cause: "Droop when dry, perk up after watering — simple thirst.",
    fixes: ["Water until 10–20% runoff", "Check more often — pots dry faster as roots fill in", "Severe dry-downs can cause hydrophobic soil — water slowly"],
    severity: "watch",
  },
  pests: {
    title: "Pest damage",
    cause: "Holes, speckles, or stippling — inspect leaf undersides with a loupe for mites, thrips, or caterpillars.",
    fixes: ["Identify the pest first — undersides + a magnifier", "IPM: sticky traps, neem/BT, beneficial insects", "Never spray past week 2–3 of flower"],
    severity: "urgent",
  },
  pm: {
    title: "Powdery mildew",
    cause: "White flour-like coating — fungal, spreads fast in stagnant humid air.",
    fixes: ["Remove infected leaves, isolate if possible", "Increase airflow + drop humidity", "Foliar: potassium bicarbonate or diluted H2O2 (early flower or veg only)"],
    severity: "urgent",
  },
}
