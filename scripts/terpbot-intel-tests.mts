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
  nextStepSatisfied,
  nextUsefulMeasurement,
  rankCandidates,
} from "@/lib/terpbot-intel"
import { CANDIDATES, SOURCES } from "@/lib/terpbot-intel-knowledge"
import { validateKnowledge } from "@/lib/terpbot-intel-validate"
import { mergeObservations, mergeReported } from "@/lib/terpbot-intel-merge"
import { buildWhyTrail, renderWhy } from "@/lib/terpbot-intel-why"
import { parseGrowText } from "@/lib/terpbot-nl-parse"
import type {
  CandidateResult,
  GrowContextView,
  IntelEvidence,
  IntelSeries,
  StructuredObservation,
  WhyTrail,
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
  updateCount: 4, daysSinceUpdate: 1,
  envCoverage: 1,
  series: {
    temperature: emptySeries, humidity: emptySeries, ph: emptySeries,
    ec: emptySeries, height: emptySeries, vpdEntered: emptySeries, vpdComputed: emptySeries,
    runoffPh: emptySeries, runoffEc: emptySeries,
  },
  vpdDivergence: null,
  missing: [],
  freshness: {},
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

  // ── 9. mergeReported — units, ambiguity, pairing, freshness ─────
  {
    const now = t0 + 40 * 86400000
    const ctx = withSeries(
      { temperature: mkSeries([70], 0.5) },
      { missing: ["humidity"] }
    )
    const c2 = mergeReported(
      ctx,
      [
        { metric: "temperature", value: 25, unit: "degC", t: now }, // 77°F
        { metric: "temperature", value: 84, t: now },               // bare → unresolved
        { metric: "ec", value: 700, unit: "ppm", t: now },          // ppm → unresolved
        { metric: "humidity", value: 62, t: now },                  // bare RH accepted
        { metric: "humidity", value: 140, t: now },                 // out of range → unresolved
      ],
      now
    )
    const temps = c2.series.temperature.points
    assert.equal(temps[0].v, 70, "logged points untouched")
    assert.equal(temps[0].provenance, undefined, "logged provenance unset")
    assert.equal(temps[temps.length - 1].v, 77, "degC converts to °F")
    assert.equal(temps[temps.length - 1].provenance, "user-reported")
    assert.equal(c2.series.temperature.latest, 77, "latest by time")
    assert.equal(c2.series.humidity.latest, 62, "bare RH accepted")
    assert.ok(!c2.missing.includes("humidity"), "missing recomputed")
    assert.deepEqual(
      c2.unresolved?.map((u) => u.value).sort((a, b) => a - b),
      [84, 140, 700],
      "ambiguous/out-of-range points unresolved"
    )
    assert.equal(c2.series.ec.latest, null, "ppm EC never converted")
    assert.equal(c2.freshness.temperature, 0, "freshness recomputed")
    assert.ok(c2.series.vpdComputed.latest != null, "VPD from paired reported temp/RH")
    assert.equal(
      c2.series.vpdComputed.points[c2.series.vpdComputed.points.length - 1].provenance,
      "user-reported"
    )
    // original ctx untouched (pure)
    assert.equal(ctx.series.humidity.n, 0)

    const c3 = mergeReported(
      mkCtx(),
      [
        { metric: "height", value: 20, unit: "inch", t: now },
        { metric: "vpd", value: 1.2, unit: "kpa", t: now },
        { metric: "runoffPh", value: 6.1, t: now },
        { metric: "runoffEc", value: 2.4, unit: "mscm", t: now },
        { metric: "runoffEc", value: 2.4, t: now }, // no unit → unresolved
      ],
      now
    )
    assert.equal(Math.round(c3.series.height.points[0].v * 10) / 10, 50.8, "inch→cm")
    assert.equal(c3.series.vpdEntered.latest, 1.2, "kpa VPD accepted")
    assert.equal(c3.series.runoffPh.latest, 6.1)
    assert.equal(c3.series.runoffEc.latest, 2.4)
    assert.equal(c3.unresolved?.length, 1)
  }

  // ── 10. mergeObservations — dedupe + feeds resolution ───────────
  {
    const ctx = mkCtx()
    const merged = mergeObservations(ctx, [
      { symptom: "LEAF_YELLOWING", location: "LOWER_OLD", t: t0 },
      { symptom: "LEAF_YELLOWING", location: "LOWER_OLD", t: t0 + 3600000 }, // same day → dedupe
      { symptom: "CURL_UP", t: t0 + 86400000 },
    ])
    assert.equal(merged.observations.length, 2, "same-day duplicate collapsed")
    assert.equal(merged.observations[0].source, "nl")
    assert.ok(merged.observations[0].feeds.length > 0, "feeds resolved from vocab")
    assert.equal(merged.observations[0].refId, undefined)
    const again = mergeObservations(merged, [
      { symptom: "LEAF_YELLOWING", location: "LOWER_OLD", t: t0 + 7200000 },
    ])
    assert.equal(again.observations.length, 2, "dedupe against existing observations")
  }

  // ── 11. Why trail — provenance, no raw text, determinism ────────
  {
    const ctx = withSeries(
      { humidity: mkSeries([68, 68, 68, 68, 68, 68, 68, 68], 2) },
      { observations: obsFrom("top leaves curling ZEBRA-9931") }
    )
    const diag = evaluateContext(ctx)
    const trail = buildWhyTrail(ctx, diag, ctx.now)
    const trailJson = JSON.stringify(trail)
    assert.ok(!trailJson.includes("ZEBRA-9931"), "raw text never enters the trail")
    assert.ok(!trailJson.includes("d1"), "no diary id in the trail")
    assert.ok(!/refId/.test(trailJson), "no refIds in the trail")
    const out = renderWhy(trail).join("\n")
    assert.ok(!out.includes("ZEBRA-9931"), "raw text never renders")
    assert.ok(out.includes("Why I said that"), "header renders")
    for (const tc of trail.candidates) {
      assert.equal(
        tc.state,
        diag.candidates.find((c) => c.id === tc.id)?.state,
        `trail state matches diagnosis for ${tc.id}`
      )
    }
    assert.equal(
      JSON.stringify(renderWhy(trail)),
      JSON.stringify(renderWhy(structuredClone(trail))),
      "renderWhy deterministic"
    )
    // Attribution labels: a trail containing fao56-svp marks it general
    // horticulture; cannabis-specific sources mark cannabis-specific.
    const windTrail: WhyTrail = {
      knowledgeVersion: "2.1", at: ctx.now, diaryTitle: "t",
      basis: { logged: 0, reported: 0, observations: 0, staleDays: null },
      candidates: [{
        id: "wind_burn", name: "Wind burn or low humidity", kind: "condition",
        state: "possible", independentSignals: 1,
        signals: [{ signal: "symptom:LEAF_CURL", direction: "for", weight: 2, text: "curl reported" }],
        opposing: [], requiredMissing: [], sourceIds: ["fao56-svp"],
      }],
      findings: [],
    }
    const wOut = renderWhy(windTrail).join("\n")
    assert.ok(wOut.includes("general horticulture"), "non-cannabis source labelled")
    const csOut = renderWhy({
      ...windTrail,
      candidates: [{ ...windTrail.candidates[0], sourceIds: ["cs-vpd-ranges"] }],
    }).join("\n")
    assert.ok(csOut.includes("cannabis-specific"), "cannabis source labelled")
  }

  // ── 12. env.snapshot — a single fresh reading contributes ────────
  {
    const now = t0 + 40 * 86400000
    const reportedCtx = (stage: string) =>
      mergeObservations(
        mergeReported(
          mkCtx({ diary: { ...mkCtx().diary, id: "", stage } }),
          [
            { metric: "temperature", value: 84, unit: "degF", t: now },
            { metric: "humidity", value: 40, t: now },
          ],
          now
        ),
        [{ symptom: "CURL_UP", location: "UPPER_NEW", t: now }]
      )

    // Unknown stage → the snapshot item is weak; moderate symptom +
    // weak env = POSSIBLE (one moderate independent signal).
    const diagU = evaluateContext(reportedCtx("UNKNOWN"))
    const hsU = diagU.candidates.find((c) => c.id === "heat_stress")
    assert.ok(hsU, "snapshot feeds heat_stress with no diary")
    assert.equal(hsU!.state, "possible", "weak snapshot + moderate symptom → POSSIBLE")
    assert.ok(
      hsU!.signals.some((s) => s.signal === "env:temp-rh"),
      "snapshot contributes the env:temp-rh signal"
    )
    assert.ok(
      hsU!.signals.some((s) => s.signal === "symptom:CURL_UP"),
      "symptom contributes its own signal"
    )
    // Stage gap finding fires when stage is unknown.
    assert.ok(
      diagU.findings.some((f) => f.ruleId === "data.stage-unknown"),
      "data.stage-unknown gap fires"
    )
    assert.ok(!nextStepSatisfied(reportedCtx("UNKNOWN"), "inspect:stage"))

    // Known FLOWER stage → large VPD excursion → moderate snapshot;
    // two moderate independent signals → STRONG.
    const diagF = evaluateContext(reportedCtx("FLOWER"))
    const hsF = diagF.candidates.find((c) => c.id === "heat_stress")
    assert.equal(hsF?.state, "strong", "moderate snapshot + moderate symptom → STRONG")
    assert.ok(hsF!.independentSignals >= 2)
    assert.ok(!diagF.findings.some((f) => f.ruleId === "data.stage-unknown"))
  }

  // ── 13. Stale degradation — old readings can't hold STRONG ──────
  {
    const oldNow = t0 + 60 * 86400000
    const staleRh = mkSeries([75, 75, 75, 75, 75, 75, 75, 75], 2)
    const ctxStale = mkCtx({
      now: oldNow,
      daysSinceUpdate: 14,
      series: { ...mkCtx().series, humidity: staleRh },
      freshness: { humidity: 14 },
    })
    const diagS = evaluateContext(ctxStale)
    const hh = diagS.candidates.find((c) => c.id === "humidity_high")
    assert.ok(hh, "humidity_high fires on stale RH")
    assert.notEqual(hh!.state, "strong", "stale readings can't hold STRONG")
    assert.equal(hh!.stale, true, "stale flag set")
    assert.ok(
      hh!.info.some((e) => /days old/.test(e.text)),
      "stale info evidence added"
    )
    assert.ok(
      diagS.findings.some((f) => f.ruleId === "data.stale"),
      "data.stale gap fires"
    )

    // One fresh user report lifts the clamp and silences data.stale.
    const ctxFresh = mergeReported(
      ctxStale,
      [{ metric: "humidity", value: 75, t: oldNow }],
      oldNow
    )
    const diagF2 = evaluateContext(ctxFresh)
    const hh2 = diagF2.candidates.find((c) => c.id === "humidity_high")
    assert.equal(hh2?.state, "strong", "fresh report lifts the stale clamp")
    assert.ok(!hh2?.stale)
    assert.ok(
      !diagF2.findings.some((f) => f.ruleId === "data.stale"),
      "fresh report silences data.stale"
    )
  }

  // ── 14. Runoff rules — EC gap and pH shift ──────────────────────
  {
    const now = t0 + 40 * 86400000
    const ctx = withSeries({
      ec: mkSeries([2.6, 2.7, 2.6], 0.1), // ≥3 readings, ≥60% above 2.5 → chem.ec-elevated
      runoffEc: mkSeries([3.9], 0.1),
    })
    const diag = evaluateContext(ctx)
    const salt = diag.candidates.find((c) => c.id === "salt_buildup")
    assert.ok(salt, "runoff EC gap feeds salt_buildup")
    assert.ok(
      salt!.signals.some((s) => s.signal === "runoff" && s.weight === 2),
      "runoff signal group at moderate"
    )
    // with the ec series also feeding it (chem.ec rules), the candidate
    // has ≥2 independent signals
    assert.ok(salt!.independentSignals >= 2, `independentSignals ≥ 2, got ${salt!.independentSignals}`)

    const neg = evaluateContext(
      withSeries({ ec: mkSeries([2.0], 0.1), runoffEc: mkSeries([1.2], 0.1) })
    )
    assert.ok(
      neg.findings.some((f) => f.ruleId === "chem.runoff-ec-gap"),
      "negative gap renders an info finding"
    )

    const phShift = evaluateContext(
      withSeries({ ph: mkSeries([5.8], 0.1), runoffPh: mkSeries([6.7], 0.1) })
    )
    const drift = phShift.candidates.find((c) => c.id === "ph_drift")
    assert.ok(
      drift?.signals.some((s) => s.signal === "runoff"),
      "runoff pH shift feeds ph_drift"
    )
  }

  // ── 15. chem.ph-band — one pH series is ONE signal, never a stack ─
  {
    // Below the COCO band three readings running: chem.ph-band and
    // chem.ph-low-danger both read ONLY the ph series, so both must
    // stamp signal "ph" and collapse into one group — a lone pH series
    // can never reach STRONG.
    const ctx = withSeries({ ph: mkSeries([4.7, 4.8, 4.9], 0.15) })
    const c = cand(ctx, "ph_lockout")!
    assert.ok(c, "low pH series feeds ph_lockout")
    assert.notEqual(c.state, "strong", "one pH series can never stack to STRONG")
    const forSignals = [...new Set(
      c.signals.filter((s) => s.direction === "for").map((s) => s.signal)
    )]
    assert.deepEqual(
      forSignals,
      ["ph"],
      `pH-only evidence collapses to a single "ph" group (got ${forSignals})`
    )
  }

  // ── 16. env.snapshot — a thick series silences its own branch ────
  {
    // temp has n≥3 logged readings at/above the flower band — the trend
    // rule covers it. A fresh user report on top must not re-fire the
    // temperature snapshot branch and stack duplicate env evidence.
    const now = t0 + 40 * 86400000
    const loggedOnly = withSeries({ temperature: mkSeries([89, 90, 91], 2) })
    const withReport = mergeReported(
      loggedOnly,
      [{ metric: "temperature", value: 90, unit: "degF", t: now }],
      now
    )
    const base = cand(loggedOnly, "heat_stress")!.supporting.map((e) => e.text)
    const merged = cand(withReport, "heat_stress")!.supporting.map((e) => e.text)
    assert.ok(
      !merged.some((t) => t.includes("single snapshot")),
      "n≥3 temperature series never emits snapshot evidence"
    )
    assert.equal(
      merged.length,
      base.length,
      "a user report on a thick series adds no stacked env evidence"
    )
  }

  // ── 17. nextUsefulMeasurement — a stale metric can still win ─────
  {
    // runoffEc is present (satisfied), so the ordinary scoring pass can
    // never recommend it. At ≥STALE_DAYS old it still backs salt_buildup —
    // the stale bypass must put re-measuring it back on the table.
    const oldNow = t0 + 60 * 86400000
    const ctx = mkCtx({
      now: oldNow,
      daysSinceUpdate: 14,
      series: {
        ...mkCtx().series,
        ec: mkSeries([2.6, 2.7, 2.6], 0.1),
        runoffEc: mkSeries([3.9], 0.1),
      },
      freshness: { ec: 1, runoffEc: 14 },
    })
    const next = nextUsefulMeasurement(ctx, evaluateContext(ctx))
    assert.equal(
      next?.id,
      "runoffEc",
      "a stale series backing a live candidate is the best re-measurement"
    )

    // Control: same data fresh → satisfied, never recommended.
    const fresh = mkCtx({
      now: oldNow,
      daysSinceUpdate: 1,
      series: {
        ...mkCtx().series,
        ec: mkSeries([2.6, 2.7, 2.6], 0.1),
        runoffEc: mkSeries([3.9], 0.1),
      },
      freshness: { ec: 1, runoffEc: 1 },
    })
    const nextFresh = nextUsefulMeasurement(fresh, evaluateContext(fresh))
    assert.notEqual(
      nextFresh?.id,
      "runoffEc",
      "a fresh satisfied series is never the next ask"
    )
  }

  // ── 18. Validator — bad-tier and orphan sources ──────────────────
  {
    // A source outside the evidence taxonomy is reported even when cited.
    const errors = validateKnowledge({
      sources: {
        ...SOURCES,
        "bad-tier-src": {
          id: "bad-tier-src", title: "x", author: "x", publication: "x",
          url: "https://example.com/page", year: 2024,
          tier: "FORUM_POST" as never, cannabisSpecific: false,
        },
      },
      candidates: {
        ...CANDIDATES,
        citing: {
          ...CANDIDATES.humidity_high,
          id: "citing",
          sourceIds: ["bad-tier-src"],
        },
      },
    })
    assert.ok(
      errors.some((e) => e.includes("bad-tier-src") && e.includes("tier")),
      `bad tier reported: ${errors}`
    )
  }
  {
    // A registered source no rule or candidate cites is dead weight.
    const errors = validateKnowledge({
      sources: {
        ...SOURCES,
        "ghost-src": {
          id: "ghost-src", title: "x", author: "x", publication: "x",
          url: "https://example.com/page", year: 2024,
          tier: "PEER_REVIEWED", cannabisSpecific: false,
        },
      },
    })
    assert.ok(
      errors.some((e) => e.includes("ghost-src") && e.includes("never cited")),
      `orphan source reported: ${errors}`
    )
  }

  console.log("All TerpBot intelligence tests passed.")
}

run()
