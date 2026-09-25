// TerpBot knowledge validator — structural lint over the shared
// registries (candidates, rules, sources, contra, refinements, vocab
// feeds, wizard bridge) plus a behavioral sweep that evaluates every
// rule against fixture contexts and checks the ids it emits. Prints
// each error; exits 1 when any exist.
// Run: npm run validate:knowledge

import { detectTrend, seriesStats } from "@/lib/terpbot-intel-calc"
import { feedsForSymptom } from "@/lib/terpbot-nl-parse"
import { validateKnowledge, validateRuleEmissions } from "@/lib/terpbot-intel-validate"
import type {
  GrowContextView,
  IntelSeries,
  StructuredObservation,
} from "@/lib/terpbot-intel-types"
import { SYMPTOM_IDS } from "@/lib/terpbot-intel-types"

const now = Date.UTC(2025, 6, 1)
const empty: IntelSeries = {
  n: 0, latest: null, mean: null, min: null, max: null,
  medianIntervalDays: null, points: [], trend: "insufficient",
}
const ser = (vals: number[], eps: number, stale = false): IntelSeries => {
  const points = vals.map((v, i) => ({
    t: now - (stale ? 20 : vals.length - 1 - i) * 86400000,
    v,
  }))
  return { ...seriesStats(points), points, trend: detectTrend(points, eps) }
}

// Every metric populated, both fresh and stale variants — the sweep
// should reach every series-dependent rule. Values deliberately span
// out-of-band readings so branch-heavy rules exercise more than the
// happy path.
const seriesFor = (stale: boolean): GrowContextView["series"] => ({
  temperature: ser([70, 88, 70], 3, stale),
  humidity: ser([85, 45, 80], 3, stale),
  ph: ser([6.0, 7.2, 4.8], 0.15, stale),
  ec: ser([0.5, 2.8, 1.2], 0.2, stale),
  height: ser([30, 34, 39], 0.5, stale),
  vpdEntered: ser([1.1, 1.9, 0.9], 0.1, stale),
  vpdComputed: ser([1.0, 1.8, 0.8], 0.1, stale),
  runoffPh: ser([6.4, 5.2], 0.15, stale),
  runoffEc: ser([2.9, 3.4], 0.2, stale),
  watering: ser([0.5, 2.5, 1.0], 0.5, stale),
  ppfd: ser([200, 900, 450], 50, stale),
  photoperiod: ser([24, 12, 18], 0.5, stale),
})

// Broad symptom coverage at varied locations — every observation-gated
// rule should get a chance to run. feeds via the same refinement
// pipeline the merge layer uses.
const observationsFor = (stage: string): StructuredObservation[] =>
  SYMPTOM_IDS.map((symptom, i) => ({
    symptom,
    location: i % 3 === 0 ? "UPPER_NEW" : i % 3 === 1 ? "LOWER_OLD" : "UNDERSIDE",
    stage,
    t: now - (i % 4) * 86400000,
    source: "diary-text" as const,
    feeds: feedsForSymptom(symptom, i % 3 === 0 ? "UPPER_NEW" : i % 3 === 1 ? "LOWER_OLD" : "UNDERSIDE", stage).feeds,
  }))

const STAGES = [
  "GERMINATION", "SEEDLING", "VEGETATIVE", "FLOWER",
  "HARVEST", "DRYING", "CURING", "UNKNOWN",
] as const

const fixtureCtx = (stage: string, medium: string | null, stale: boolean): GrowContextView => ({
  scope: "public",
  diary: {
    id: "fixture", slug: null, title: "fixture", stage, visibility: "PUBLIC",
    startDate: new Date(now - 60 * 86400000), harvested: stage === "DRYING" || stage === "CURING",
    mediumType: medium, lightType: "LED", growType: "INDOOR", techniques: [],
  },
  strain: null,
  setup: { present: true, medium, capabilities: ["exhaust", "oscillating fan"] },
  now,
  day: 60,
  week: 9,
  stageDays: stage === "FLOWER" ? 56 : 14,
  stageStartCensored: false,
  stageTransitions: [],
  baselines: {},
  updateCount: 20,
  daysSinceUpdate: stale ? 20 : 1,
  envCoverage: 0.9,
  series: seriesFor(stale),
  vpdDivergence: 0.3,
  missing: [],
  freshness: stale
    ? {}
    : { temperature: 0, humidity: 0, ph: 0, ec: 0, height: 0, vpd: 0, runoffPh: 0, runoffEc: 0 },
  observations: observationsFor(stage),
})

const contexts: GrowContextView[] = []
for (const stage of STAGES) {
  contexts.push(fixtureCtx(stage, "COCO", false))
  contexts.push(fixtureCtx(stage, "SOIL", false))
  contexts.push(fixtureCtx(stage, null, true))
}

const errors = [...validateKnowledge(), ...validateRuleEmissions(contexts)]
if (errors.length) {
  for (const e of errors) console.error(`✗ ${e}`)
  console.error(`validate:knowledge — ${errors.length} error(s)`)
  process.exit(1)
}
console.log("validate:knowledge — all registries consistent")
