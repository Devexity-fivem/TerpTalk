import type { KnowledgeSource } from "@/lib/terpbot-intel-types"
// TerpBot intelligence — provenance registry.
// Every rule carrying horticultural interpretation references ≥1 entry
// here by id. `cannabisSpecific:false` means general plant science —
// the renderer must not present it as cannabis-established fact.
// Tier order (strongest first): PEER_REVIEWED > EXTENSION > GOVERNMENT
// > PROFESSIONAL > COMMUNITY > INTERNAL_DATA.


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
    author: "Vernon, Kouzani, Webb & Adams",
    publication: "IEEE Access 11:62077–62090",
    url: "https://doi.org/10.1109/access.2023.3285242",
    year: 2023,
    tier: "PEER_REVIEWED",
    cannabisSpecific: true,
  },
  "chandra-2008-photosynthesis": {
    id: "chandra-2008-photosynthesis",
    title: "Photosynthetic response of Cannabis sativa L. to variations in PPFD, temperature and CO2",
    author: "Chandra et al.",
    publication: "Physiology and Molecular Biology of Plants 14(4)",
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
  "punja-ni-2025-budrot": {
    id: "punja-ni-2025-budrot",
    title: "The epidemiology and management of Botrytis cinerea causing bud rot on greenhouse cultivated cannabis",
    author: "Punja, Ni",
    publication: "Canadian Journal of Plant Pathology",
    url: "https://doi.org/10.1080/07060661.2025.2478250",
    year: 2025,
    tier: "PEER_REVIEWED",
    cannabisSpecific: true,
    // infection sets weeks 2–5 of flower; visible mycelium ~weeks 5–6
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
  // ── Phase E additions ─────────────────────────────────────────────
  "cockson-2019-nutrient-disorders": {
    id: "cockson-2019-nutrient-disorders",
    title: "Characterization of Nutrient Disorders of Cannabis sativa",
    author: "Cockson, Landis, Smith, Hicks, Whipker",
    publication: "Applied Sciences 9(20):4432",
    url: "https://doi.org/10.3390/app9204432",
    year: 2019,
    tier: "PEER_REVIEWED",
    cannabisSpecific: true,
    // single cultivar ('T1'), silica-sand culture — location-based
    // deficiency mapping is the primary source but stays capped in
    // weight per the single-study honesty convention
  },
  "saloner-bernstein-2020-n": {
    id: "saloner-bernstein-2020-n",
    title: "Response of Medical Cannabis (Cannabis sativa L.) to Nitrogen Supply Under Long Photoperiod",
    author: "Saloner, Bernstein",
    publication: "Frontiers in Plant Science 11:572293",
    url: "https://doi.org/10.3389/fpls.2020.572293",
    year: 2020,
    tier: "PEER_REVIEWED",
    cannabisSpecific: true,
  },
  "bevan-2021-npk-dwc": {
    id: "bevan-2021-npk-dwc",
    title: "Optimisation of Nitrogen, Phosphorus, and Potassium for Soilless Production of Cannabis sativa Using Response Surface Analysis",
    author: "Bevan, Jones, Zheng",
    publication: "Frontiers in Plant Science 12:764103",
    url: "https://doi.org/10.3389/fpls.2021.764103",
    year: 2021,
    tier: "PEER_REVIEWED",
    cannabisSpecific: true,
  },
  "hershkowitz-2025-ec": {
    id: "hershkowitz-2025-ec",
    title: "Elevated root-zone P and nutrient concentration do not increase yield or cannabinoids in medical cannabis",
    author: "Hershkowitz, Westmoreland, Bugbee",
    publication: "Frontiers in Plant Science 16:1433985",
    url: "https://doi.org/10.3389/fpls.2025.1433985",
    year: 2025,
    tier: "PEER_REVIEWED",
    cannabisSpecific: true,
    // SINGLE-STUDY — cannabis tolerated EC 4.0 mS/cm in closed hydro;
    // counter-evidence against aggressive "high EC = burn" claims
  },
  "whipker-ph-micro": {
    id: "whipker-ph-micro",
    title: "Impact of substrate pH and micronutrient fertility rates on Cannabis sativa",
    author: "Whipker group (NCSU)",
    publication: "Agrosystems, Geosciences & Environment",
    url: "https://doi.org/10.1002/agg2.70044",
    year: 2025,
    tier: "PEER_REVIEWED",
    cannabisSpecific: true,
    // hemp cultivars — drug-type extrapolation caveat; growth inhibited
    // below pH 5.0; cannabis not prone to Fe chlorosis even near pH 7
  },
  "morad-bernstein-2023-mg": {
    id: "morad-bernstein-2023-mg",
    title: "Response of Medical Cannabis to Magnesium (Mg) Supply at the Vegetative Growth Phase",
    author: "Morad, Bernstein et al.",
    publication: "Plants 12(14):2676",
    url: "https://doi.org/10.3390/plants12142676",
    year: 2023,
    tier: "PEER_REVIEWED",
    cannabisSpecific: true,
    // antagonism anchor: high Mg competitively inhibited Ca/K uptake
  },
  "postharvest-review-2022": {
    id: "postharvest-review-2022",
    title: "Postharvest Operations of Cannabis and Their Effect on Cannabinoid Content: A Review",
    author: "Das, Vista, Tabil, Baik",
    publication: "Bioengineering 9(8):364",
    url: "https://doi.org/10.3390/bioengineering9080364",
    year: 2022,
    tier: "PEER_REVIEWED",
    cannabisSpecific: true,
  },
  "purdue-hydro-nutrition": {
    id: "purdue-hydro-nutrition",
    title: "Fertilizer for Hydroponics — nutrient solution pH/EC management",
    author: "Langenhoven",
    publication: "Purdue Extension CEA",
    url: "https://www.purdue.edu/hla/sites/cea/wp-content/uploads/sites/15/2018/10/PetrusLangenhoven9-5-18.pdf",
    year: 2018,
    tier: "EXTENSION",
    cannabisSpecific: false, // general plant science — not cannabis fact
  },
  "ncsu-pourthru-2009": {
    id: "ncsu-pourthru-2009",
    title: "The Pour-Through Extraction Procedure: A Nutrient Management Tool for Nursery Crops",
    author: "LeBude, Bilderback",
    publication: "North Carolina Cooperative Extension AG-717-W",
    url: "https://www.ncagr.gov/ncsu-pour-through-extraction-procedure/download?attachment=",
    year: 2009,
    tier: "EXTENSION",
    cannabisSpecific: false, // leachate EC/pH interpretation — substrate science, not cannabis
  },
  "terptalk-strain-catalog": {
    id: "terptalk-strain-catalog",
    title: "TerpTalk strain catalog — curated cultivar metadata",
    author: "TerpTalk",
    publication: "docs/data/strain-research.md (per-strain provenance)",
    url: "",
    year: 2026,
    tier: "INTERNAL_DATA",
    cannabisSpecific: true,
    // breeder/database/community-reported catalog facts — expectations,
    // never horticultural verdicts; lowest evidence tier by design
  },
}

// ── Candidate registry ──────────────────────────────────────────────
// The hypotheses the engine can reason about. Versioned TypeScript data
// — code-reviewed, diffable, no DB table. Wizard-migrated candidates keep
// the bare wizard result id so Thread.wizardResultId / SYMPTOM_TAGS /
// solve-rate stats never see a namespace change.
//
// MIGRATED entries carry name/mechanism/recommendedActions/severity
// verbatim from the legacy WIZARD_RESULTS literal — the wizard result
// is now generated from these entries (problem-wizard.ts), so the
// question-driven UI and the data/symptom-driven engine share one
// knowledge record. Engine honesty lives in evidence states and
// measurement recommendations, not in altered literal text.
//
// requiredInputs semantics: a candidate missing ALL listed metrics can
// still appear as POSSIBLE (from reported symptoms) but is clamped —
// it can never reach STRONG without the data.
