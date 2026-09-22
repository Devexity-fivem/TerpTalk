// TerpBot 2.0 Phase D — diagnostic engine tests (pure, no DB).
// Candidate accumulation, multi-hypothesis reasoning, contradiction
// handling, next-measurement selection, wizard-branch equivalence,
// and determinism. Run: tsx scripts/terpbot2-tests.mts

import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { detectTrend, seriesStats } from "@/lib/terpbot-intel-calc"
import {
  INSPECTION_INFO,
  INTEL_RULES,
  assessCandidate,
  evaluateContext,
  nextUsefulMeasurement,
  rankCandidates,
  renderIntelLines,
} from "@/lib/terpbot-intel"
import { CANDIDATES, SOURCES } from "@/lib/terpbot-intel-knowledge"
import { validateKnowledge } from "@/lib/terpbot-intel-validate"
import { wizardResultFromCandidate } from "@/lib/terpbot-intel-wizard"
import { WIZARD_NODES, WIZARD_RESULTS, WIZARD_START } from "@/lib/problem-wizard"
import type { WizardResult } from "@/lib/problem-wizard"
import { isValidWizardResultId, wizardResultToTag } from "@/lib/symptom-tags"
import { parseGrowText } from "@/lib/terpbot-nl-parse"
import type {
  CandidateResult,
  GrowContextView,
  IntelEvidence,
  IntelSeries,
  MetricId,
  StructuredObservation,
} from "@/lib/terpbot-intel-types"

const t0 = Date.UTC(2025, 0, 1)
const pts = (vals: number[], stepMs = 86400000) => vals.map((v, i) => ({ t: t0 + i * stepMs, v }))
const mkSeries = (vals: number[], eps: number, stepMs = 86400000): IntelSeries => {
  const points = pts(vals, stepMs)
  return { ...seriesStats(points), points, trend: detectTrend(points, eps) }
}
// Same values, re-timed so the latest point lands ~now — needed for
// rules that only claim CURRENT state (latestIsCurrent guard).
const fresh = (s: IntelSeries): IntelSeries => {
  const now = t0 + 40 * 86400000
  const points = s.points.map((p, i) => ({ ...p, t: now - (s.points.length - 1 - i) * 86400000 }))
  return { ...s, points }
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
  stageTransitions: [],
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
  baselines: over.baselines ?? {},
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
      if (m.startsWith("inspect:")) {
        assert.ok(m in INSPECTION_INFO, `candidate ${id} inspection ${m} renderable`)
      } else {
        assert.ok(MEASUREMENT_LABELS.has(m as MetricId), `candidate ${id} metric ${m} renderable`)
      }
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

  // Full structural lint — superset of the checks above.
  assert.deepEqual(validateKnowledge(), [], "knowledge registries validate clean")

  // ── 2. assessCandidate — the five states, deterministic ─────────────

  const def = CANDIDATES.humidity_high
  const ev = (direction: IntelEvidence["direction"], strength: IntelEvidence["strength"], extra: Partial<IntelEvidence> = {}): IntelEvidence =>
    ({ direction, strength, text: "x", ...extra })

  assert.equal(assessCandidate(def, []).state, "insufficient", "no evidence → insufficient")
  assert.equal(assessCandidate(def, [ev("info", "strong")]).state, "insufficient", "info alone never scores")
  assert.equal(assessCandidate(def, [ev("for", "weak")]).state, "possible")
  assert.equal(
    assessCandidate(def, [ev("risk", "strong")]).state,
    "possible",
    "risk evidence into a condition candidate is capped at one predisposing signal"
  )
  assert.equal(
    assessCandidate({ ...def, kind: "risk" }, [ev("risk", "strong")]).state,
    "strong",
    "risk candidates let risk evidence count fully"
  )
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
    // flower-high + trend share the "humidity" signal and the VPD rule is
    // derived from the same RH readings — correlated support stays POSSIBLE
    // even though three rules fired (the rule trail still records all of them).
    assert.equal(risk.state, "possible", "three correlated rules pool → possible, not strong")
    assert.ok(risk.ruleIds.length >= 3, `risk candidate carries rule trail (${risk.ruleIds})`)
    assert.ok(hum.state === "possible" || hum.state === "strong", `humidity_high surfaces (${hum.state})`)
    assert.ok(risk.supporting.every((e) => e.direction !== "against"))
    // shared observation: same RH readings support BOTH hypotheses —
    // candidates coexist, no first-match-wins
    assert.ok(risk && hum, "multi-candidate: both preserved")
  }

  // ── 4. env.rh-sustained-high — stage-agnostic + honest opposition ───

  {
    const ctx = withSeries({ humidity: mkSeries([72, 74, 76, 75], 3) }, { diary: { ...mkCtx().diary, stage: "VEGETATIVE" } })
    const c = cand(ctx, "humidity_high")!
    assert.equal(c.state, "strong", "sustained ≥70% RH is a strong item — one strong signal can still reach STRONG")
    assert.equal(c.independentSignals, 1, "every RH rule shares the 'humidity' signal")
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
    const ctx = withSeries({ humidity: mkSeries([45, 48, 50], 3) })
    assert.equal(cand(ctx, "humidity_high"), undefined, "in-band flower RH → no candidate")
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
    assert.equal(c.state, "possible", "stacked instability evidence stays capped at possible")
    // two signal groups: "env:temp-rh" (instability + co-variation, max 2)
    // + "temperature" (diurnal-swing reads the temp series only, max 2)
    assert.equal(c.forScore, 4)
    assert.equal(c.independentSignals, 2)
  }

  // ── 6. Multi-hypothesis: salt_buildup vs ph_lockout ──────────────────

  {
    const ctx = withSeries({
      ec: fresh(mkSeries([1.4, 1.6, 1.9, 2.1], 0.2)),
      ph: fresh(mkSeries([6.0, 6.1, 6.6, 6.9], 0.15)),
    })
    const diag = evaluateContext(ctx)
    const salt = diag.candidates.find((c) => c.id === "salt_buildup")!
    const lock = diag.candidates.find((c) => c.id === "ph_lockout")!
    assert.ok(salt && lock, "both hypotheses preserved")
    assert.equal(salt.state, "possible")
    // pH out-of-band and the fed-but-locked-out signature both derive
    // from the same pH+EC interplay → one "chem:ph-ec" group → possible
    assert.equal(lock.state, "possible")
    assert.equal(lock.independentSignals, 1)
    // the discriminating measurement separates them
    const next = nextUsefulMeasurement(ctx, diag)
    assert.ok(next && /runoff/i.test(next.label), `next measurement is runoff-related (${next?.id})`)
    assert.ok(["runoffEc", "runoffPh"].includes(next!.id))
  }

  // ── 7. Deterministic ranking & tie-breaks ────────────────────────────

  {
    const mk = (id: string, state: CandidateResult["state"], forScore: number): CandidateResult => ({
      id, name: id, domain: "environment", kind: "condition", severity: "watch",
      state, forScore, againstScore: 0, independentSignals: 0, signals: [],
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
    // Gating inputs outrank discriminating asks: several candidates are
    // blocked on the unlogged humidity series, so that missing required
    // input is the next ask — MEASUREMENT_PRIORITY only breaks ties.
    const ctx = withSeries({
      ph: mkSeries([6.0, 6.1, 7.0], 0.15), // ph_lockout possible → runoffPh+runoffEc
      vpdComputed: mkSeries([1.7, 1.8, 1.9], 0.15), // heat_stress possible → leafTemp
    })
    const diag = evaluateContext(ctx)
    assert.ok(diag.candidates.length >= 2)
    const next = nextUsefulMeasurement(ctx, diag)
    assert.equal(next?.id, "humidity", "missing required input outranks the priority tie-break")
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
    // Phase E full-migration pin: EVERY wizard result must be generated
    // from the shared candidate registry and byte-identical to the
    // pre-migration literal (title/cause/fixes/severity).
    const snapshot = JSON.parse(
      readFileSync(new URL("./fixtures/wizard-results.snapshot.json", import.meta.url), "utf8")
    ) as Record<string, WizardResult>
    const resultIds = Object.keys(WIZARD_RESULTS)
    assert.equal(resultIds.length, 48, `48 wizard results migrated (got ${resultIds.length})`)
    for (const id of resultIds) {
      assert.ok(id in snapshot, `result ${id} existed before migration`)
      assert.deepEqual(WIZARD_RESULTS[id], snapshot[id], `result ${id} identical to pre-migration literal`)
      // …and is literally generated from the shared candidate
      assert.deepEqual(WIZARD_RESULTS[id], wizardResultFromCandidate(id), `result ${id} generated from candidate`)
      // every wizard result has a live engine candidate + symptom tag
      assert.ok(isValidWizardResultId(id), `result ${id} validates`)
      assert.ok(wizardResultToTag(id), `result ${id} has a symptom tag`)
    }
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
    assert.match(lines, /Assessment: Salt \/ nutrient buildup — POSSIBLE/)
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

  // ── 9b. Phase E — reported symptoms + adversarial diagnostics ────────

  const obsFrom = (text: string, t = t0 + 30 * 86400000): StructuredObservation[] =>
    parseGrowText(text).observations.map((o) => ({
      symptom: o.symptom,
      location: o.location,
      stage: o.stage,
      period: o.period,
      t,
      source: "diary-text" as const,
      refId: "u1",
      feeds: o.feeds,
      refined: o.refined,
    }))

  {
    // requiredInputs gate: a symptom report alone can NEVER reach strong
    // when the required metric is unlogged
    const ctx = mkCtx({ observations: obsFrom("lower leaves yellowing") })
    const c = cand(ctx, "nitrogen_def")!
    assert.ok(c, "reported symptom surfaces the candidate")
    assert.equal(c.state, "possible", "symptom + missing pH caps at possible")
    assert.ok(c.requiredMissing.includes("ph"), "missing required input listed")
    assert.equal(c.nextMeasurement?.id, "runoffPh", "next step asks for the discriminating measurement")
  }
  {
    // senescence adversarial: late-flower lower-leaf yellowing must not
    // read as pure deficiency — bud_nutrient gets support AND
    // deficiencies get honest opposition
    const ctx = mkCtx({
      stageDays: 42,
      observations: obsFrom("lower leaves yellowing"),
      series: { ...mkCtx().series, ph: mkSeries([5.9, 6.0, 5.9], 0.15), ec: mkSeries([1.4, 1.5], 0.2) },
    })
    const sen = cand(ctx, "bud_nutrient")!
    assert.ok(sen, "senescence hypothesis present")
    const n = cand(ctx, "nitrogen_def")
    assert.ok(n, "deficiency hypothesis also present")
    assert.ok((n?.opposing.length ?? 0) > 0, "senescence opposes the deficiency read")
    assert.notEqual(n?.state, "strong", "late-flower yellowing is not a strong deficiency")
  }
  {
    // high EC + NO symptoms → risk/watch, never a burn diagnosis
    const ctx = withSeries({ ec: mkSeries([2.6, 2.7, 2.8], 0.2) })
    assert.equal(cand(ctx, "nutrient_burn"), undefined, "high EC alone is not nutrient burn")
    const ex = cand(ctx, "nutrition.excess")
    if (ex) {
      assert.equal(ex.state, "possible", "EC >2.5 sustained is a watch signal, not a verdict")
    }
  }
  {
    // yellow leaves + perfectly normal pH/EC → possible, never strong
    const ctx = mkCtx({
      observations: obsFrom("lower leaves yellowing"),
      series: { ...mkCtx().series, ph: mkSeries([5.9, 6.0, 5.9], 0.15), ec: mkSeries([1.4, 1.5, 1.5], 0.2) },
    })
    for (const id of ["nitrogen_def", "magnesium_def", "potassium_def"]) {
      const c = cand(ctx, id)
      assert.ok(!c || c.state === "possible", `${id} cannot be strong on one symptom report`)
    }
  }
  {
    // drooping right after lights-off → nyctinasty info, not watering
    const ctx = mkCtx({ observations: obsFrom("plant drooping right after dark") })
    assert.equal(cand(ctx, "overwater"), undefined, "lights-off droop never feeds watering candidates")
  }
  {
    // tip burn + LOW EC → the burn read stays weak; no forced diagnosis
    const ctx = mkCtx({
      observations: obsFrom("leaf tips burned"),
      series: { ...mkCtx().series, ec: mkSeries([1.0, 1.1, 0.9], 0.2) },
    })
    const burn = cand(ctx, "nutrient_burn")
    assert.ok(!burn || burn.state === "possible", "tip burn + low EC stays possible")
  }
  {
    // contradictory readings → CONFLICTING with both sides preserved
    const ctx = withSeries({ temperature: mkSeries([90, 90, 90, 80], 2) })
    const c = cand(ctx, "heat_stress")!
    assert.equal(c.state, "conflicting", "sustained heat + corrected latest → conflicting")
    assert.ok(c.supporting.length > 0 && c.opposing.length > 0, "both sides preserved")
    const lines = renderIntelLines(ctx, evaluateContext(ctx)).join("\n")
    assert.match(lines, /evidence conflicts/, "conflict rendered explicitly")
  }
  {
    // a single environmental measurement → never STRONG (env.snapshot
    // caps at moderate; nothing else fires on n=1)
    const ctx = withSeries({ temperature: mkSeries([92], 2) })
    const c = cand(ctx, "heat_stress")
    assert.ok(!c || c.state !== "strong", "one reading can never be strong")
  }
  {
    // direct sighting → strong, and the next step is an INSPECTION
    const ctx = mkCtx({ observations: obsFrom("webbing under the leaves", t0 + 40 * 86400000) })
    const c = cand(ctx, "spider_mites")!
    assert.ok(c, "webbing sighting surfaces spider_mites")
    assert.equal(c.state, "strong", "direct sighting earns strong")
    assert.ok(c.nextMeasurement?.id.startsWith("inspect:"), "pest next-step is an inspection")
    const lines = renderIntelLines(ctx, evaluateContext(ctx)).join("\n")
    assert.match(lines, /Reported:/, "reported symptoms render (canonical labels)")
    assert.match(lines, /Suggested:/, "strong surfaces a proportional action")
    assert.doesNotMatch(lines, /webbing under the leaves/, "raw diary text never echoes")
  }
  {
    // no raw text leakage — the rendered output only uses canonical labels
    const ctx = mkCtx({ observations: obsFrom("my dog knocked the plant over, lower leaves yellowing") })
    const lines = renderIntelLines(ctx, evaluateContext(ctx)).join("\n")
    assert.doesNotMatch(lines, /dog|knocked/, "raw update text never reaches output")
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
