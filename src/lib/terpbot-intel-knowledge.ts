// TerpBot intelligence — provenance registry.
// Every rule carrying horticultural interpretation references ≥1 entry
// here by id. `cannabisSpecific:false` means general plant science —
// the renderer must not present it as cannabis-established fact.
// Tier order (strongest first): PEER_REVIEWED > EXTENSION > GOVERNMENT
// > PROFESSIONAL > COMMUNITY > INTERNAL_DATA.

import type { KnowledgeSource } from "@/lib/terpbot-intel-types"

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
}
