// TerpBot 2.0 Phase D — diagnostic engine tests (pure, no DB).
// Candidate accumulation, multi-hypothesis reasoning, contradiction
// handling, next-measurement selection, wizard-branch equivalence,
// and determinism. Run: tsx scripts/terpbot2-tests.mts

import { strict as assert } from "node:assert"
import { detectTrend, seriesStats } from "@/lib/terpbot-intel-calc"
import {
  INTEL_RULES,
  assessCandidate,
  evaluateContext,
  nextUsefulMeasurement,
  rankCandidates,
  renderIntelLines,
} from "@/lib/terpbot-intel"
import { CANDIDATES, SOURCES } from "@/lib/terpbot-intel-knowledge"
import { wizardResultFromCandidate } from "@/lib/terpbot-intel-wizard"
import { WIZARD_NODES, WIZARD_RESULTS, WIZARD_START } from "@/lib/problem-wizard"
import { isValidWizardResultId, wizardResultToTag } from "@/lib/symptom-tags"
import type {
  CandidateResult,
  GrowContextView,
  IntelEvidence,
  IntelSeries,
} from "@/lib/terpbot-intel-types"

const t0 = Date.UTC(2025, 0, 1)
const pts = (vals: number[], stepMs = 86400000) => vals.map((v, i) => ({ t: t0 + i * stepMs, v }))
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
})
const withSeries = (over: Partial<GrowContextView["series"]>, ctxOver: Partial<GrowContextView> = {}) =>
  mkCtx({ series: { ...mkCtx().series, ...over }, ...ctxOver })
const cand = (ctx: GrowContextView, id: string) => evaluateContext(ctx).candidates.find((c) => c.id === id)

function run() {
  // ── 1. Knowledge registry integrity ─────────────────────────────────

  for (const [id, def] of Object.entries(CANDIDATES)) {
    assert.equal(def.id, id, `candidate ${id} key matches id`)
    assert.ok(def.name && def.mechanism, `candidate ${id} has name + mechanism`)
    assert.ok(def.sourceIds.length > 0, `candidate ${id} has provenance`)
    for (const s of def.sourceIds) assert.ok(s in SOURCES, `candidate ${id} source ${s} resolves`)
    for (const m of [...def.requiredInputs, ...def.discriminatingInputs]) {
      assert.ok(MEASUREMENT_LABELS.has(m), `candidate ${id} metric ${m} renderable`)
    }
  }
  // Every candidateId emitted by a rule resolves in the registry.
  const emitted = new Set<string>()
  for (const rule of INTEL_RULES) {
    for (const s of rule.sourceIds) assert.ok(s in SOURCES, `rule ${rule.id} source ${s} resolves`)
    // Probe rules against a saturated context to harvest emitted ids.
    for (const e of safeEval(rule)) if (e.candidate) emitted.add(e.candidate)
  }
  for (const id of emitted) assert.ok(id in CANDIDATES, `emitted candidate ${id} is registered`)

  // ── 2. assessCandidate — the five states, deterministic ─────────────

  const def = CANDIDATES.humidity_high
  const ev = (direction: IntelEvidence["direction"], strength: IntelEvidence["strength"], extra: Partial<IntelEvidence> = {}): IntelEvidence =>
    ({ direction, strength, text: "x", ...extra })

  assert.equal(assessCandidate(def, []).state, "insufficient", "no evidence → insufficient")
  assert.equal(assessCandidate(def, [ev("info", "strong")]).state, "insufficient", "info alone never scores")
  assert.equal(assessCandidate(def, [ev("for", "weak")]).state, "possible")
  assert.equal(assessCandidate(def, [ev("risk", "strong")]).state, "strong", "risk counts toward forScore")
  assert.equal(
    assessCandidate(def, [ev("for", "strong"), ev("against", "strong")]).state,
    "conflicting",
    "strong-for + strong-against → conflicting"
  )
  assert.equal(
    assessCandidate(def, [ev("info", "strong", { confirmed: true }), ev("against", "strong")]).state,
    "conflicting",
    "confirmed fact contradicted by strong counter-evidence → conflicting, not confirmed"
  )
  assert.equal(
    assessCandidate(def, [ev("info", "strong", { confirmed: true })]).state,
    "strong", // confirmed → clamped to maxState "strong": condition candidates never CONFIRMED
    "measured fact on a condition candidate clamps to maxState"
  )
  assert.equal(
    assessCandidate({ ...def, maxState: "possible" }, [ev("for", "strong"), ev("for", "strong")]).state,
    "possible",
    "maxState caps thin-provenance candidates"
  )
  assert.equal(
    assessCandidate(def, [ev("for", "weak"), ev("against", "strong")]).state,
    "possible",
    "asymmetric weak-for + strong-against → possible (not conflicting)"
  )

  // ── 3. Candidate pooling — many rules → one candidate ───────────────

  {
    // FLOWER, RH [60,66,69,71]: flower-high rule + rising trend + low VPD
    // all feed the same two candidates.
    const ctx = withSeries({
      humidity: mkSeries([60, 66, 69, 71], 3),
      temperature: mkSeries([76, 77, 78, 78], 2),
      vpdComputed: mkSeries([1.1, 1.0, 0.95, 0.9], 0.15),
    })
    const risk = cand(ctx, "env.moisture-disease-risk")!
    const hum = cand(ctx, "humidity_high")!
    assert.equal(risk.state, "strong", "three rules pool → strong risk")
    assert.ok(risk.ruleIds.length >= 3, `risk candidate carries rule trail (${risk.ruleIds})`)
    assert.equal(hum.state, "strong")
    assert.ok(risk.supporting.every((e) => e.direction !== "against"))
    // shared observation: same RH readings support BOTH hypotheses —
    // candidates coexist, no first-match-wins
    assert.ok(risk && hum, "multi-candidate: both preserved")
  }

  // ── 4. env.rh-sustained-high — stage-agnostic + honest opposition ───

  {
    const ctx = withSeries({ humidity: mkSeries([72, 74, 76, 75], 3) }, { diary: { ...mkCtx().diary, stage: "VEGETATIVE" } })
    const c = cand(ctx, "humidity_high")!
    assert.equal(c.state, "strong", "sustained ≥70% RH in veg → strong")
    assert.equal(c.opposing.length, 0, "still-elevated latest → no opposition")
  }
  {
    // History high but correcting → opposing evidence lands.
    // (VEG stage keeps the flower-specific rules out of the pool so the
    // sustained-high / corrected-latest tension is the whole story.)
    const ctx = withSeries(
      { humidity: mkSeries([72, 74, 76, 73, 58], 3) },
      { diary: { ...mkCtx().diary, stage: "VEGETATIVE" } }
    )
    const c = cand(ctx, "humidity_high")!
    assert.equal(c.state, "conflicting", "sustained-high history vs corrected latest → conflicting")
    assert.ok(c.opposing.length >= 2, "both against items kept")
    const lines = renderIntelLines(ctx, evaluateContext(ctx)).join("\n")
    assert.match(lines, /evidence conflicts/i, "conflict is rendered, not hidden")
    assert.match(lines, /Verify .* first/i, "conflict names the resolving measurement")
  }
  {
    const ctx = withSeries({ humidity: mkSeries([60, 62, 61], 3) })
    assert.equal(cand(ctx, "humidity_high"), undefined, "normal RH → no candidate")
  }

  // ── 5. env.instability — volatile trends ─────────────────────────────

  {
    const ctx = withSeries({ temperature: mkSeries([70, 82, 68, 84, 70], 2) })
    const c = cand(ctx, "env.instability")!
    assert.equal(c.state, "possible", "volatile temp → possible (weak evidence)")
  }
  {
    const ctx = withSeries({
      temperature: mkSeries([70, 82, 68, 84, 70], 2),
      humidity: mkSeries([50, 68, 48, 70, 50], 3),
    })
    const c = cand(ctx, "env.instability")!
    assert.equal(c.state, "possible", "two weak volatile signals → possible")
    assert.equal(c.forScore, 2)
  }

  // ── 6. Multi-hypothesis: salt_buildup vs ph_lockout ──────────────────

  {
    const ctx = withSeries({
      ec: mkSeries([1.4, 1.6, 1.9, 2.1], 0.2),
      ph: mkSeries([6.0, 6.1, 6.6, 6.9], 0.15),
    })
    const diag = evaluateContext(ctx)
    const salt = diag.candidates.find((c) => c.id === "salt_buildup")!
    const lock = diag.candidates.find((c) => c.id === "ph_lockout")!
    assert.ok(salt && lock, "both hypotheses preserved")
    assert.equal(salt.state, "possible")
    assert.equal(lock.state, "possible")
    // the discriminating measurement separates them
    const next = nextUsefulMeasurement(ctx, diag)
    assert.ok(next && /runoff/i.test(next.label), `next measurement is runoff-related (${next?.id})`)
    assert.ok(["runoffEc", "runoffPh"].includes(next!.id))
  }

  // ── 7. Deterministic ranking & tie-breaks ────────────────────────────

  {
    const mk = (id: string, state: CandidateResult["state"], forScore: number): CandidateResult => ({
      id, name: id, domain: "environment", kind: "condition", severity: "watch",
      state, forScore, againstScore: 0,
      supporting: [], opposing: [], info: [], ruleIds: [], requiredMissing: [], sourceIds: [],
    })
    const ranked = rankCandidates([
      mk("b-possible", "possible", 1),
      mk("a-possible", "possible", 1),
      mk("z-strong", "strong", 3),
      mk("m-conflicting", "conflicting", 3),
    ])
    assert.deepEqual(
      ranked.map((c) => c.id),
      ["m-conflicting", "z-strong", "a-possible", "b-possible"],
      "conflicting > strong > possible, id-asc tie-break"
    )
  }
  {
    // Deterministic tie-break: two possible candidates → priority order
    const ctx = withSeries({
      ph: mkSeries([6.0, 6.1, 7.0], 0.15), // ph_lockout possible → runoffPh+runoffEc
      vpdComputed: mkSeries([1.7, 1.8, 1.9], 0.15), // env.heat-stress possible → leafTemp
    })
    const diag = evaluateContext(ctx)
    assert.ok(diag.candidates.length >= 2)
    const next = nextUsefulMeasurement(ctx, diag)
    assert.equal(next?.id, "runoffPh", "equal scores → MEASUREMENT_PRIORITY wins (runoffPh first)")
  }
  {
    // Available measurements are never recommended
    const ctx = withSeries({ humidity: mkSeries([72, 74, 76], 3) })
    const diag = evaluateContext(ctx)
    assert.ok(diag.candidates.some((c) => c.id === "humidity_high"))
    assert.notEqual(nextUsefulMeasurement(ctx, diag)?.id, "humidity", "logged metric never recommended")
  }

  // ── 8. Wizard-branch migration — humidity_high ───────────────────────

  {
    // The generated result is byte-identical to the literal it replaced.
    assert.deepEqual(WIZARD_RESULTS.humidity_high, {
      title: "High humidity",
      cause: "Condensation, slow growth, and mold risk — usually lack of extraction or overwatering.",
      fixes: [
        "Increase exhaust fan speed",
        "Run a dehumidifier",
        "Defoliate only lower fans to improve airflow",
      ],
      severity: "moderate",
    }, "wizard result identical after migration")
    // …and it is literally generated from the shared candidate.
    assert.deepEqual(WIZARD_RESULTS.humidity_high, wizardResultFromCandidate("humidity_high"))
    // Question path and data path converge on the same id.
    let node: string = WIZARD_START
    node = WIZARD_NODES[node].options.find((o) => o.label === "Environment / whole plant")!.next!
    const opt = WIZARD_NODES[node].options.find((o) => o.label === "Humidity is too high / condensation")!
    assert.equal(opt.result, "humidity_high", "wizard path resolves to the same id")
    const ctx = withSeries({ humidity: mkSeries([72, 74, 76, 75], 3) })
    assert.equal(cand(ctx, "humidity_high")?.name, WIZARD_RESULTS.humidity_high.title, "engine candidate shares the wizard title")
    // Downstream contract intact: validation + symptom tag + stats keys.
    assert.ok(isValidWizardResultId("humidity_high"))
    assert.equal(wizardResultToTag("humidity_high")?.slug, "environment-ph")
  }
  {
    // Graph integrity sweep — every wizard path still terminates in a
    // registered result (catches a migration that silently drops edges).
    const reachable = new Set<string>()
    const stack = [WIZARD_START]
    const seen = new Set<string>()
    while (stack.length) {
      const id = stack.pop()!
      if (seen.has(id)) continue
      seen.add(id)
      for (const o of WIZARD_NODES[id].options) {
        if (o.result) reachable.add(o.result)
        if (o.next) stack.push(o.next)
      }
    }
    for (const id of reachable) assert.ok(id in WIZARD_RESULTS, `result ${id} exists`)
    for (const id of Object.keys(WIZARD_RESULTS)) {
      assert.ok(reachable.has(id), `result ${id} still reachable`)
    }
  }

  // ── 9. Safety/uncertainty pins ───────────────────────────────────────

  {
    // No data → nothing to say
    const ctx = mkCtx({ updateCount: 0, envCoverage: 0 })
    const diag = evaluateContext(ctx)
    assert.equal(diag.candidates.length, 0, "empty context → no candidates")
    assert.equal(renderIntelLines(ctx, diag).length, 0, "empty context → silent")
  }
  {
    // One weak signal → POSSIBLE at most
    const ctx = withSeries({ ec: mkSeries([1.2, 1.5, 1.9], 0.2) })
    const c = cand(ctx, "salt_buildup")!
    assert.equal(c.state, "possible", "single weak evidence → possible")
    const lines = renderIntelLines(ctx, evaluateContext(ctx)).join("\n")
    assert.match(lines, /Assessment: Salt accumulation \/ rising EC — POSSIBLE/)
  }
  {
    // Risk candidates render as risk language, never as diagnosis
    const ctx = withSeries({
      humidity: mkSeries([60, 66, 69, 71], 3),
      vpdComputed: mkSeries([1.1, 1.0, 0.95, 0.9], 0.15),
    })
    const lines = renderIntelLines(ctx, evaluateContext(ctx)).join("\n")
    assert.doesNotMatch(lines, /has bud rot|you have/i, "never asserts disease presence")
    assert.match(lines, /risk/i, "risk language used")
  }

  // ── 10. Determinism ─────────────────────────────────────────────────

  {
    const ctx = withSeries({
      humidity: mkSeries([60, 66, 69, 71], 3),
      ec: mkSeries([1.4, 1.6, 1.9, 2.1], 0.2),
      ph: mkSeries([6.0, 6.1, 6.6, 6.9], 0.15),
      vpdComputed: mkSeries([1.1, 1.0, 0.95, 0.9], 0.15),
    })
    assert.deepEqual(evaluateContext(ctx), evaluateContext(ctx), "same context → same diagnosis")
    assert.deepEqual(
      renderIntelLines(ctx, evaluateContext(ctx)),
      renderIntelLines(ctx, evaluateContext(ctx)),
      "same diagnosis → same render"
    )
    // Shuffled point order → identical stats (seriesStats/detectTrend sort)
    const shuffled = [...ctx.series.humidity.points].reverse()
    assert.equal(detectTrend(shuffled, 3), detectTrend(ctx.series.humidity.points, 3), "input order cannot change the trend")
    assert.deepEqual(seriesStats(shuffled), seriesStats(ctx.series.humidity.points))
  }

  console.log("All TerpBot 2.0 diagnostic-engine tests passed.")
}

// Probe helper: run a rule against a context that maximally satisfies
// gates, collecting emitted evidence to lint candidate registration.
function safeEval(rule: (typeof INTEL_RULES)[number]): IntelEvidence[] {
  const full = withSeries({
    temperature: mkSeries([70, 82, 68, 84, 70, 90, 88, 55, 57], 2),
    humidity: mkSeries([50, 68, 72, 74, 76, 48, 70, 73, 60], 3),
    ph: mkSeries([7.0, 7.1, 6.9, 7.0], 0.15),
    ec: mkSeries([2.6, 2.8, 3.0, 2.7], 0.2),
    height: mkSeries([30, 30.5, 30.2, 30.4], 2, 4 * 86400000),
    vpdEntered: mkSeries([0.8, 0.8, 0.8], 0.15),
    vpdComputed: mkSeries([0.5, 0.6, 0.55, 1.8, 1.9, 1.85], 0.15),
  }, {
    vpdDivergence: -0.5,
    envCoverage: 0.2,
    updateCount: 9,
    diary: { ...mkCtx().diary, stage: "VEGETATIVE", mediumType: "COCO" },
  })
  try {
    if (!rule.applies(full)) {
      const flower = mkCtx({ ...full, diary: { ...full.diary, stage: "FLOWER" } })
      if (!rule.applies(flower)) return []
      return rule.evaluate(flower)
    }
    return rule.evaluate(full)
  } catch {
    return []
  }
}

// Label coverage for metric ids referenced by candidates — mirrors the
// renderer's MEASUREMENT_INFO table without importing private symbols.
const MEASUREMENT_LABELS = new Set([
  "temperature", "humidity", "vpd", "ph", "ec", "height",
  "runoffPh", "runoffEc", "substrateMoisture", "leafTemp",
  "watering", "ppfd", "photoperiod",
])

run()
