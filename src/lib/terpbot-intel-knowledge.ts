// TerpBot intelligence — provenance registry.
// Every rule carrying horticultural interpretation references ≥1 entry
// here by id. `cannabisSpecific:false` means general plant science —
// the renderer must not present it as cannabis-established fact.
// Tier order (strongest first): PEER_REVIEWED > EXTENSION > GOVERNMENT
// > PROFESSIONAL > COMMUNITY > INTERNAL_DATA.

import type { CandidateDef, KnowledgeSource } from "@/lib/terpbot-intel-types"

export const SOURCES: Record<string, KnowledgeSource> = {
  "fao56-svp": {
    id: "fao56-svp",
    title: "Crop evapotranspiration — guidelines for computing crop water requirements",
    author: "Allen, Pereira, Raes, Smith",
    publication: "FAO Irrigation and Drainage Paper 56",
    url: "https://www.fao.org/4/x0490e/x0490e00.htm",
    year: 1998,
    tier: "GOVERNMENT",
    cannabisSpecific: false,
  },
  "cs-vpd-ranges": {
    id: "cs-vpd-ranges",
    title: "Understanding VPD and Transpiration Rates for Cannabis Cultivation Operations",
    author: "Breit, Leavitt, Boyd",
    publication: "Cannabis Science and Technology 2(2)",
    url: "https://www.cannabissciencetech.com/view/understanding-vpd-and-transpiration-rates-for-cannabis-cultivation-operations",
    year: 2019,
    tier: "PROFESSIONAL",
    cannabisSpecific: true,
  },
  "ieee-greenhouse-survey": {
    id: "ieee-greenhouse-survey",
    title: "A Survey of Modern Greenhouse Technologies and Practices for Commercial Cannabis Cultivation",
    author: "IEEE Access",
    publication: "IEEE Access 11",
    url: "https://doi.org/10.1109/access.2023.3285242",
    year: 2023,
    tier: "PEER_REVIEWED",
    cannabisSpecific: true,
  },
  "chandra-2008-photosynthesis": {
    id: "chandra-2008-photosynthesis",
    title: "Photosynthetic response of Cannabis sativa L. to variations in PPFD, temperature and CO2",
    author: "Chandra et al.",
    publication: "Journal of Industrial Hemp / PMC3550641",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC3550641/",
    year: 2008,
    tier: "PEER_REVIEWED",
    cannabisSpecific: true,
  },
  "punja-2022-botrytis": {
    id: "punja-2022-botrytis",
    title: "Understanding bud rot development, caused by Botrytis cinerea, on cannabis grown under greenhouse conditions",
    author: "Punja",
    publication: "Canadian Journal of Botany",
    url: "https://doi.org/10.1139/cjb-2022-0139",
    year: 2022,
    tier: "PEER_REVIEWED",
    cannabisSpecific: true,
  },
  "utia-pm-hemp": {
    id: "utia-pm-hemp",
    title: "Fungicide Recommendations for Controlling Hemp Powdery Mildew in the Greenhouse",
    author: "University of Tennessee Extension",
    publication: "UTIA W1132",
    url: "https://utia.tennessee.edu/publications/wp-content/uploads/sites/269/2023/10/w1132.pdf",
    year: 2023,
    tier: "EXTENSION",
    cannabisSpecific: true,
  },
  "bc-cannabis-diseases": {
    id: "bc-cannabis-diseases",
    title: "Diseases of Cannabis in British Columbia",
    author: "BC Ministry of Agriculture",
    publication: "BC plant health factsheet",
    url: "https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/agriculture-and-seafood/animal-and-crops/plant-health/disease-factsheets/specialty-crops/diseases_of_cannabis_in_british_columbia.pdf",
    year: 2021,
    tier: "GOVERNMENT",
    cannabisSpecific: true,
  },
  "canna-coco-ph": {
    id: "canna-coco-ph",
    title: "Using CANNA COCO — substrate pH/EC targets",
    author: "CANNA",
    publication: "Commercial cultivation guidance",
    url: "https://www.canna.ca/articles/using-canna-coco",
    year: 2024,
    tier: "PROFESSIONAL",
    cannabisSpecific: true,
  },
  "terptalk-stage-tips": {
    id: "terptalk-stage-tips",
    title: "TerpTalk stage-tips targets (in-repo curated values)",
    author: "TerpTalk",
    publication: "src/lib/stage-tips.ts",
    url: "",
    year: 2025,
    tier: "INTERNAL_DATA",
    cannabisSpecific: true,
  },
  "cornell-cannabis-guidebook": {
    id: "cornell-cannabis-guidebook",
    title: "Cornell Hemp / Cannabis sativa Production Guidebook (NYS)",
    author: "Cornell University College of Agriculture and Life Sciences",
    publication: "Cornell extension production manual",
    url: "https://hemp.cals.cornell.edu/",
    year: 2024,
    tier: "EXTENSION",
    cannabisSpecific: true,
  },
  "rodriguez-morrison-2021-light": {
    id: "rodriguez-morrison-2021-light",
    title: "Cannabis yield, potency, and leaf photosynthesis respond differently to increasing light levels",
    author: "Rodriguez-Morrison et al.",
    publication: "Frontiers in Plant Science 12:646020",
    url: "https://doi.org/10.3389/fpls.2021.646020",
    year: 2021,
    tier: "PEER_REVIEWED",
    cannabisSpecific: true,
  },
}

// ── Candidate registry ──────────────────────────────────────────────
// The hypotheses the engine can reason about. Versioned TypeScript data
// — code-reviewed, diffable, no DB table (see TERPBOT-2.0-ARCHITECTURE
// §5). Wizard-migrated candidates keep the bare wizard result id so
// Thread.wizardResultId / SYMPTOM_TAGS / solve-rate stats never see a
// namespace change (arch §17.1).

export const CANDIDATES: Record<string, CandidateDef> = {
  // ── Wizard-migrated branch: env → "Humidity is too high" ──────────
  // name/mechanism/actions/severity reproduce WIZARD_RESULTS.humidity_high
  // verbatim — the wizard literal is now generated from this entry
  // (see problem-wizard.ts), so the question-driven UI and the
  // data-driven engine share one knowledge record.
  humidity_high: {
    id: "humidity_high",
    domain: "environment",
    kind: "condition",
    name: "High humidity",
    mechanism:
      "Condensation, slow growth, and mold risk — usually lack of extraction or overwatering.",
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

  // Combination target: flower stage + elevated RH + low VPD accumulate
  // RISK evidence here. Renders as a hazard warning, never a diagnosis.
  "env.moisture-disease-risk": {
    id: "env.moisture-disease-risk",
    domain: "environment",
    kind: "risk",
    name: "Moisture-related disease risk",
    mechanism:
      "Sustained high humidity with weak transpiration in flower favors botrytis and powdery mildew — this is a risk assessment, not a disease diagnosis.",
    severity: "urgent",
    maxState: "strong",
    requiredInputs: ["humidity"],
    discriminatingInputs: ["leafTemp", "substrateMoisture"],
    recommendedActions: [
      "Drop RH toward 40–50% — exhaust first, dehumidifier if needed",
      "Increase airflow through the canopy; thin lower growth only",
      "Inspect dense colas weekly with a loupe from mid-flower",
    ],
    sourceIds: ["punja-2022-botrytis", "utia-pm-hemp", "bc-cannabis-diseases"],
  },

  "env.heat-stress": {
    id: "env.heat-stress",
    domain: "environment",
    kind: "condition",
    name: "Heat / high-VPD stress",
    mechanism:
      "Sustained canopy temperature above ~30°C depresses photosynthesis; high VPD compounds it by driving excess transpiration.",
    severity: "moderate",
    maxState: "strong",
    requiredInputs: ["temperature"],
    discriminatingInputs: ["leafTemp", "ppfd"],
    recommendedActions: [
      "Raise or dim lights 10–20%",
      "Improve exhaust and air circulation",
      "Keep canopy under ~82°F where possible",
    ],
    sourceIds: ["chandra-2008-photosynthesis", "cs-vpd-ranges"],
    // Intended wizard bridge: "heat_stress" — not yet migrated;
    // wizardResultId is set only when the literal is generated here.
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

  ph_lockout: {
    id: "ph_lockout",
    domain: "chemistry",
    kind: "condition",
    name: "pH outside medium band / nutrient lockout",
    mechanism:
      "Root-zone pH outside the medium-appropriate band locks nutrients out — deficiencies appear even when feed is correct.",
    severity: "moderate",
    maxState: "strong",
    requiredInputs: ["ph"],
    discriminatingInputs: ["runoffPh", "runoffEc"],
    recommendedActions: [
      "Verify with runoff pH before changing feed — input pH can lie",
      "Correct gradually toward band; don't swing more than ~0.3 per feed",
    ],
    sourceIds: ["canna-coco-ph", "cornell-cannabis-guidebook", "terptalk-stage-tips"],
    // Intended wizard bridge: "ph_drift" — not yet migrated.
  },

  salt_buildup: {
    id: "salt_buildup",
    domain: "chemistry",
    kind: "condition",
    name: "Salt accumulation / rising EC",
    mechanism:
      "Fertilizer salts accumulate in the medium faster than watering removes them — runoff EC separates this from simple under-watering.",
    severity: "moderate",
    maxState: "strong",
    requiredInputs: ["ec"],
    discriminatingInputs: ["runoffEc", "watering", "substrateMoisture"],
    recommendedActions: [
      "Check runoff EC — separates buildup from under-watering before acting",
      "Flush with plain pH'd water if runoff EC runs well above input",
      "Ensure runoff at each feed; pots must not sit in drainage",
    ],
    sourceIds: ["canna-coco-ph"],
    // Intended wizard bridge: "salt_buildup" — not yet migrated.
  },

  stunted_growth: {
    id: "stunted_growth",
    domain: "growth",
    kind: "condition",
    name: "Stalled vegetative growth",
    mechanism:
      "Flat height over a week+ of veg — training can mask it, but light limits, cold roots, and pH drift all stall growth.",
    severity: "watch",
    maxState: "strong",
    requiredInputs: ["height"],
    discriminatingInputs: ["ppfd", "leafTemp", "runoffPh", "watering"],
    recommendedActions: [
      "Rule out light first — log canopy PPFD before changing anything else",
      "Check root-zone temperature and runoff pH — cold roots and drift both stall",
    ],
    sourceIds: ["chandra-2008-photosynthesis", "rodriguez-morrison-2021-light"],
    // Intended wizard bridge: "stunt" — not yet migrated.
  },
}
