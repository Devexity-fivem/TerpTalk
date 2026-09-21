// TerpBot 2.0 Phase F — signal-grouped scoring tests (pure, no DB).
// Correlated evidence can't stack to STRONG; independent signals can.
// Determinism, repetition collapse, risk-direction caps, contradiction,
// required-input gates, validator negatives, ranking tie-breaks.
// Run: tsx scripts/terpbot-intel-tests.mts

import { strict as assert } from "node:assert"
import { detectTrend, seriesStats } from "@/lib/terpbot-intel-calc"
import {
  CONTRA,
  INTEL_RULES,
  assessCandidate,
  evaluateContext,
  nextUsefulMeasurement,
  rankCandidates,
} from "@/lib/terpbot-intel"
import { CANDIDATES } from "@/lib/terpbot-intel-knowledge"
import { validateKnowledge } from "@/lib/terpbot-intel-validate"
import { parseGrowText } from "@/lib/terpbot-nl-parse"
import type {
  CandidateResult,
  GrowContextView,
  IntelEvidence,
  IntelSeries,
  StructuredObservation,
} from "@/lib/terpbot-intel-types"

const t0 = Date.UTC(2025, 0, 1)
const pts = (vals: number[], stepMs = 86400000) =>
  vals.map((v, i) => ({ t: t0 + i * stepMs, v }))
const mkSeries = (vals: number[], eps: number, stepMs = 86400000): IntelSeries => {
  const points = pts(vals, stepMs)
  return { ...seriesStats(points), points, trend: detectTrend(points, eps) }
}
const emptySeries: IntelSeries = {
  n: 0, latest: null, mean: null, min: null, max: null,
  medianIntervalDays: null, points: [], trend: "insufficient",
}
const mkCtx = (over: Partial<GrowContextView> = {}): GrowContextView => ({
  scope: "public",
  diary: {
    id: "d1", slug: "d1-slug", title: "Test", stage: "FLOWER", visibility: "PUBLIC",
    startDate: new Date(t0), harvested: false,
    mediumType: "COCO", lightType: "LED", growType: "INDOOR", techniques: [],
  },
  setup: { present: false, medium: null, capabilities: [] },
  now: t0 + 40 * 86400000,
  day: 41, week: 6,
  stageDays: 20, stageStartCensored: false,
  updateCount: 4, daysSinceUpdate: 1, medianUpdateIntervalDays: 7,
  envCoverage: 1,
  series: {
    temperature: emptySeries, humidity: emptySeries, ph: emptySeries,
    ec: emptySeries, height: emptySeries, vpdEntered: emptySeries, vpdComputed: emptySeries,
  },
  vpdDivergence: null,
  missing: [],
  ...over,
  observations: over.observations ?? [],
})
const withSeries = (
  over: Partial<GrowContextView["series"]>,
  ctxOver: Partial<GrowContextView> = {}
) => mkCtx({ series: { ...mkCtx().series, ...over }, ...ctxOver })
const cand = (ctx: GrowContextView, id: string) =>
  evaluateContext(ctx).candidates.find((c) => c.id === id)

const obsFrom = (
  text: string,
  refId = "u1",
  t = t0 + 30 * 86400000
): StructuredObservation[] =>
  parseGrowText(text).observations.map((o) => ({
    symptom: o.symptom,
    location: o.location,
    stage: o.stage,
    period: o.period,
    t,
    source: "diary-text" as const,
    refId,
    feeds: o.feeds,
    refined: o.refined,
  }))

const ev = (
  direction: IntelEvidence["direction"],
  strength: IntelEvidence["strength"],
  extra: Partial<IntelEvidence> = {}
): IntelEvidence => ({ direction, strength, text: "x", ...extra })

function run() {
  // ── 1. Determinism ────────────────────────────────────────────────
  {
    const ctx = withSeries({
      humidity: mkSeries([66, 68, 67, 66, 68, 67, 66, 68], 3),
      ec: mkSeries([1.4, 1.6, 1.9, 2.1], 0.2),
      ph: mkSeries([6.0, 6.1, 6.6, 6.9], 0.15),
    })
    const a = evaluateContext(structuredClone(ctx))
    const b = evaluateContext(structuredClone(ctx))
    assert.equal(JSON.stringify(a), JSON.stringify(b), "structural clones → identical diagnosis")
  }
  {
    // evidence array order cannot change scoring — groups are order-free
    const def = CANDIDATES.humidity_high
    const evidence = [
      ev("for", "weak", { signal: "a" }),
      ev("for", "moderate", { signal: "b" }),
      ev("against", "weak", { signal: "c" }),
      ev("risk", "weak", { signal: "d" }),
      ev("for", "strong", { signal: "a" }),
    ]
    const fwd = assessCandidate(def, evidence)
    const rev = assessCandidate(def, [...evidence].reverse())
    assert.deepEqual(fwd, rev, "evidence order is irrelevant to the result")
  }

  // ── 2. Correlated series — one signal, never a stack ──────────────
  {
    // RH steady in the 65–70% flower band: every RH rule that fires
    // reads the same series → one "humidity" group of moderate items.
    const ctx = withSeries({ humidity: mkSeries([66, 68, 67, 66, 68, 67, 66, 68], 3) })
    const c = cand(ctx, "humidity_high")!
    assert.equal(c.state, "possible", "correlated RH rules cannot stack to strong")
    assert.equal(c.independentSignals, 1, "all RH evidence shares the 'humidity' signal")
    assert.deepEqual(
      c.signals.filter((s) => s.direction === "for").map((s) => s.signal),
      ["humidity"]
    )
  }
  {
    // …and a sustained ≥70% run IS a single strong signal — still
    // allowed to reach STRONG through hasStrongItem (never by stacking).
    const ctx = withSeries({ humidity: mkSeries([74, 74, 74, 74, 74, 74, 74, 74], 3) })
    const c = cand(ctx, "humidity_high")!
    assert.equal(c.state, "strong", "one strong signal may still be strong")
    assert.equal(c.independentSignals, 1)
  }
  {
    // same RH band + a persistent grower report → a second, independent
    // signal → moderate + moderate support earns STRONG
    const ctx = withSeries(
      { humidity: mkSeries([66, 68, 67, 66, 68, 67, 66, 68], 3) },
      {
        observations: [
          ...obsFrom("humidity keeps climbing", "u1"),
          ...obsFrom("humidity keeps climbing", "u2"),
        ],
      }
    )
    const c = cand(ctx, "humidity_high")!
    assert.ok(c.independentSignals >= 2, `series + reported symptom are independent (${c.independentSignals})`)
    assert.equal(c.state, "strong", "two independent moderate signals reach strong")
    assert.ok(
      c.signals.some((s) => s.signal === "symptom:ENV_HUMID"),
      "the symptom trail is visible in signals"
    )
  }

  // ── 3. Repetition — five reports are one signal ───────────────────
  {
    const observations = ["u1", "u2", "u3", "u4", "u5"].flatMap((ref) =>
      obsFrom("lower leaves yellowing", ref)
    )
    const ctx = mkCtx({ observations })
    let sawSignal = false
    for (const c of evaluateContext(ctx).candidates) {
      const forSignals = c.signals.filter(
        (s) => s.signal === "symptom:LEAF_YELLOWING" && s.direction === "for"
      )
      if (!forSignals.length) continue
      sawSignal = true
      assert.equal(forSignals.length, 1, "five reports collapse into one symptom signal")
      assert.ok(
        c.state === "possible" || c.state === "insufficient",
        `${c.id} capped at possible — repetition is correlation, not independence (got ${c.state})`
      )
    }
    assert.ok(sawSignal, "a deficiency candidate carries the symptom:LEAF_YELLOWING signal")
  }

  // ── 4. Risk-direction cap on condition candidates ─────────────────
  {
    const riskEvidence = [
      ev("risk", "moderate", { signal: "s1" }),
      ev("risk", "moderate", { signal: "s2" }),
      ev("risk", "moderate", { signal: "s3" }),
    ]
    const condition = assessCandidate(CANDIDATES.humidity_high, riskEvidence)
    assert.ok(condition.forScore <= 1, "risk into a condition is one predisposing signal")
    assert.equal(condition.state, "possible")
    const risk = assessCandidate({ ...CANDIDATES.humidity_high, kind: "risk" }, riskEvidence)
    assert.equal(risk.forScore, 6, "risk candidates count risk evidence fully")
    assert.equal(risk.state, "strong")
  }

  // ── 5. Contradiction — conflicting ranks first ────────────────────
  {
    const ctx = withSeries({ temperature: mkSeries([90, 90, 90, 80], 2) })
    const diag = evaluateContext(ctx)
    const c = diag.candidates.find((x) => x.id === "heat_stress")!
    assert.equal(c.state, "conflicting", "sustained heat + corrected latest → conflicting")
    assert.equal(diag.candidates[0].id, "heat_stress", "conflicting candidate ranks first")
  }

  // ── 6. Missing required input ─────────────────────────────────────
  {
    // nutrient_burn requires EC; a refined symptom report supports it
    // but with no EC logged it can never assert.
    const ctx = mkCtx({
      observations: [...obsFrom("tips burned", "u1"), ...obsFrom("tips burned", "u2")],
    })
    const burn = cand(ctx, "nutrient_burn")!
    assert.equal(burn.state, "possible")
    assert.deepEqual(burn.requiredMissing, ["ec"])
    const next = nextUsefulMeasurement(ctx, evaluateContext(ctx))
    assert.equal(next?.id, "ec", "the missing required input is the next ask")
  }

  // ── 7. Validator negatives ────────────────────────────────────────
  {
    const errors = validateKnowledge({
      candidates: {
        ...CANDIDATES,
        bogus: {
          ...CANDIDATES.humidity_high,
          id: "bogus",
          requiredInputs: ["ecc" as never],
          sourceIds: ["nope"],
        },
      },
    })
    assert.ok(errors.some((e) => e.includes("ecc")), `bad metric reported: ${errors}`)
    assert.ok(errors.some((e) => e.includes("nope")), `bad source reported: ${errors}`)
  }
  {
    const errors = validateKnowledge({
      contra: { ...CONTRA, LEAF_YELLOWING: ["no_such"] },
    })
    assert.ok(errors.some((e) => e.includes("no_such")), `bad contra target reported: ${errors}`)
  }
  {
    const errors = validateKnowledge({
      rules: [{ ...INTEL_RULES[0], signal: "rh" as never }],
    })
    assert.ok(errors.some((e) => e.includes('"rh"')), `bad rule signal reported: ${errors}`)
  }

  // ── 8. Ranking tie-break — equal state/score → id asc ────────────
  {
    const mk = (id: string): CandidateResult => ({
      id, name: id, domain: "environment", kind: "condition", severity: "watch",
      state: "possible", forScore: 1, againstScore: 0,
      independentSignals: 1, signals: [],
      supporting: [], opposing: [], info: [], ruleIds: [],
      requiredMissing: [], sourceIds: [],
    })
    assert.deepEqual(
      rankCandidates([mk("b"), mk("a"), mk("c")]).map((c) => c.id),
      ["a", "b", "c"],
      "equal state/score candidates rank by ascending id"
    )
  }

  console.log("All TerpBot intelligence tests passed.")
}

run()
