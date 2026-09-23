// TerpBot BOT_ASSIST trigger tests.
// Pure logic: evaluateAssists over hand-built contexts — no DB.
// Per-trigger coverage: positive fire, near-miss negatives, key
// idempotency (same evidence → same key), evidence-epoch re-arm
// (changed evidence → new key), closure (state clears → no fire).
// Run: npx tsx scripts/terpbot-assist-tests.mts

import assert from "node:assert"
import { evaluateAssists, type AssistFire } from "@/lib/terpbot-assist-triggers"
import { interventionKey } from "@/lib/terpbot-session"
import { detectChange, seriesStats } from "@/lib/terpbot-intel-calc"
import { buildSnapshot } from "@/lib/terpbot-intel-snapshot"
import { buildCultivationDecisions } from "@/lib/terpbot-intel-decisions"
import { emptySeries as EMPTY_SERIES } from "./lib/terpbot-fixtures"
import type {
  CandidateResult,
  Diagnosis,
  GrowContextView,
  IntelSeries,
  InterventionRecord,
  MetricId,
  SessionSnapshot,
  StructuredObservation,
  SymptomEpisode,
} from "@/lib/terpbot-intel-types"

const DAY = 86400000
const NOW = Date.UTC(2026, 0, 30)

const emptySeries = EMPTY_SERIES

const mkCtx = (over: Partial<GrowContextView> = {}): GrowContextView => ({
  scope: "owner",
  diary: {
    id: "d1", slug: "d1-slug", title: "My private grow", stage: "FLOWER",
    visibility: "PRIVATE", startDate: new Date(NOW - 30 * DAY), harvested: false,
    mediumType: "COCO", lightType: "LED", growType: "INDOOR", techniques: [],
  },
  setup: { present: false, medium: null, capabilities: [] },
  now: NOW,
  day: 31, week: 5,
  stageDays: 10, stageStartCensored: false,
  stageTransitions: [],
  updateCount: 5, daysSinceUpdate: 1,
  envCoverage: 1,
  series: {
    temperature: emptySeries, humidity: emptySeries, ph: emptySeries,
    ec: emptySeries, height: emptySeries, vpdEntered: emptySeries,
    vpdComputed: emptySeries, runoffPh: emptySeries, runoffEc: emptySeries,
  },
  vpdDivergence: null,
  missing: [],
  freshness: {},
  observations: [],
  baselines: {},
  ...over,
})

const mkCandidate = (id: string, state: CandidateResult["state"] = "possible"): CandidateResult => ({
  id: id as CandidateResult["id"],
  name: id,
  domain: "environment",
  kind: "condition",
  severity: "moderate",
  state,
  forScore: 2, againstScore: 0, independentSignals: 1,
  signals: [], supporting: [], opposing: [], info: [],
  ruleIds: [], requiredMissing: [], sourceIds: [],
})

const mkDiag = (candidates: CandidateResult[] = []): Diagnosis => ({ candidates, findings: [] })

const ep = (over: Partial<SymptomEpisode>): SymptomEpisode => ({
  symptom: "LEAF_YELLOWING" as SymptomEpisode["symptom"],
  firstSeen: NOW - 6 * DAY,
  lastSeen: NOW - 1 * DAY,
  status: "active",
  statusAt: NOW - 1 * DAY,
  episodeCount: 1,
  ...over,
})

const obsAt = (daysAgo: number, over: Partial<StructuredObservation> = {}): StructuredObservation => ({
  symptom: "LEAF_YELLOWING" as StructuredObservation["symptom"],
  t: NOW - daysAgo * DAY,
  source: "nl",
  feeds: [],
  ...over,
})

const evaluate = (
  ctx: GrowContextView,
  diagnosis = mkDiag(),
  episodes: SymptomEpisode[] = [],
  snapshot?: SessionSnapshot
): AssistFire[] =>
  evaluateAssists({
    ctx,
    diagnosis,
    // canonical decision set — derived from the same ctx the triggers
    // see (snapshot's own evaluation; the mock diagnosis above only
    // feeds candidate-driven trigger conditions)
    decisions: buildCultivationDecisions(buildSnapshot(ctx)),
    episodes,
    snapshot,
  })

const fire = (
  ctx: GrowContextView,
  triggerId: string,
  diagnosis = mkDiag(),
  episodes: SymptomEpisode[] = [],
  snapshot?: SessionSnapshot
): AssistFire | undefined => evaluate(ctx, diagnosis, episodes, snapshot).find((f) => f.triggerId === triggerId)

function section(name: string) {
  console.log(`\n── ${name} ──`)
}

// ── T1 · stale critical measurement ────────────────────────────────
section("stale-measurement")

const staleSeries = (daysOld: number, approx = false): IntelSeries => ({
  ...emptySeries,
  n: 1, latest: 6.1, mean: 6.1, min: 6.1, max: 6.1,
  points: [{ t: NOW - daysOld * DAY, v: 6.1, tApproximate: approx }],
})

const withPh = (daysOld: number, approx = false) =>
  mkCtx({ freshness: { ph: daysOld }, series: { ...mkCtx().series, ph: staleSeries(daysOld, approx) } })

{
  const diag = mkDiag([mkCandidate("ph_drift")])
  const ctx = withPh(12)

  const f = fire(ctx, "stale-measurement", diag)!
  assert.ok(f, "stale metric backing a live candidate fires")
  assert.equal(f.actionClass, "VERIFY")
  assert.equal(f.severity, "INFO")
  assert.equal(f.stepId, "ph")
  assert.match(f.key, /assist:stale-metric:d1:ph:r\d+:w1$/)
  assert.match(f.title, /pH/)
  assert.ok(!/ph_drift|d1-slug|My private grow/.test(f.title + f.content), "no internal ids or diary text")

  // near misses
  assert.ok(!fire(withPh(5), "stale-measurement", diag), "fresh reading: no fire")
  assert.ok(!fire(withPh(12), "stale-measurement", mkDiag()), "no live candidate: no fire")
  assert.ok(
    !fire(mkCtx({ freshness: { humidity: 12 }, series: { ...mkCtx().series, humidity: staleSeries(12) } }), "stale-measurement", diag),
    "stale metric that backs nothing live: no fire"
  )
  assert.ok(
    !fire(withPh(12), "stale-measurement", mkDiag([mkCandidate("ph_drift", "insufficient")])),
    "insufficient-only candidate: no fire"
  )
  // a fuzzy unbounded-past report must not mint a fabricated age
  assert.ok(!fire(withPh(30, true), "stale-measurement", diag), "tApproximate-only point: no fire")

  // idempotent + evidence-epoch re-arm
  const again = fire(withPh(12), "stale-measurement", diag)!
  assert.equal(again.key, f.key, "same evidence → same key (absorbed by claim)")
  const older = fire(withPh(22), "stale-measurement", diag)!
  assert.notEqual(older.key, f.key, "a materially worse staleness epoch re-keys")
  assert.equal(older.severity, "ATTENTION", "≥21d stale escalates severity")
  // a NEW stale episode (different last-reading anchor) re-arms instead
  // of replaying the dead w1 key
  const nextEpisode = fire(mkCtx({
    freshness: { ph: 12 },
    series: { ...mkCtx().series, ph: staleSeries(12) },
  }), "stale-measurement", diag)!
  assert.equal(nextEpisode.key, f.key, "same anchor → same key")
  const laterAnchor: IntelSeries = {
    ...emptySeries, n: 2, latest: 6.0, mean: 6.0, min: 6.0, max: 6.1,
    // newest point a day later → different r-anchor → new key family
    points: [{ t: NOW - 40 * DAY, v: 6.1 }, { t: NOW - 13 * DAY, v: 6.0 }],
  }
  const restale = fire(mkCtx({
    freshness: { ph: 13 },
    series: { ...mkCtx().series, ph: laterAnchor },
  }), "stale-measurement", diag)!
  assert.notEqual(restale.key, f.key, "re-stale after a new reading gets a new key family")
}

// ── T2 · persistent unresolved issue ───────────────────────────────
section("persistent-symptom")

{
  // span is measured across real observations, not episode timestamps —
  // a synthetic unbounded-history point must not inflate it
  const obs = [obsAt(6), obsAt(3), obsAt(1)]
  const ctx = mkCtx({ observations: obs })
  const f = fire(ctx, "persistent-symptom", mkDiag(), [ep({})])!
  assert.ok(f, "multi-day active episode fires")
  assert.equal(f.severity, "ATTENTION")
  assert.equal(f.key, "assist:persist:d1:LEAF_YELLOWING|", "once ever per episode instance")
  assert.match(f.content, /yellow/i)

  // escalation band — ≥7d real-report span
  const longObs = [obsAt(9), obsAt(4), obsAt(1)]
  const long = fire(mkCtx({ observations: longObs }), "persistent-symptom", mkDiag(), [ep({ firstSeen: NOW - 9 * DAY })])!
  assert.equal(long.severity, "CHECK", "≥7d span escalates")

  // negatives
  assert.ok(!fire(mkCtx({ observations: [obsAt(1), obsAt(0)] }), "persistent-symptom", mkDiag(), [ep({ firstSeen: NOW - 1 * DAY, lastSeen: NOW })]),
    "single-day span: no fire")
  assert.ok(!fire(mkCtx({ observations: obs }), "persistent-symptom", mkDiag(), [ep({ status: "resolved" })]), "resolved: no fire")
  assert.ok(!fire(mkCtx({ observations: obs }), "persistent-symptom", mkDiag(), [ep({ status: "improving" })]), "improving: no fire")
  assert.ok(!fire(mkCtx({ observations: obs }), "persistent-symptom", mkDiag(), [ep({ approximate: true })]), "approximate episode: no fire")
  assert.ok(!fire(mkCtx({ observations: obs }), "persistent-symptom", mkDiag(), [ep({ status: "recurred", episodeCount: 2 })]), "recurred is T5's job")
  assert.ok(!fire(mkCtx(), "persistent-symptom", mkDiag(), [ep({})]),
    "episode without backing observations: no fire")

  // synthetic far-past point doesn't manufacture a long span
  const approxObs = [obsAt(1), obsAt(0), obsAt(30, { tApproximate: true })]
  assert.ok(!fire(mkCtx({ observations: approxObs }), "persistent-symptom", mkDiag(), [ep({})]),
    "approximate reports don't inflate the span")

  // dedupe: identical evidence → identical key every scan
  assert.equal(
    fire(mkCtx({ observations: obs }), "persistent-symptom", mkDiag(), [ep({})])!.key,
    f.key,
    "same episode → same key across scans"
  )
}

// ── T3 · meaningful baseline shift ─────────────────────────────────
section("baseline-shift")

const shiftSeries = (dir: "up" | "down", durationDays: number): IntelSeries => ({
  ...emptySeries,
  n: 8,
  latest: 70,
  // T3 requires a live reading behind the shift claim — points are
  // what the recency gate inspects
  points: [
    { t: NOW - 1 * DAY, v: 70 },
    { t: NOW - 2 * DAY, v: 70 },
    { t: NOW - 3 * DAY, v: 70 },
  ],
  change: {
    direction: dir,
    vsBaselineDelta: dir === "up" ? 8 : -8,
    magnitude: 8,
    durationDays,
    recentN: 3,
    baselineN: 5,
  },
})
const establishedBaseline = {
  n: 8, tier: "established" as const, median: 62, spanDays: 20, ageDays: 2,
  distinctDays: 8, windowDays: 20, lo: 58, hi: 66,
}

{
  const ctx = mkCtx({
    series: { ...mkCtx().series, humidity: shiftSeries("up", 4) },
    baselines: { humidity: establishedBaseline },
  })
  const f = fire(ctx, "baseline-shift")!
  assert.ok(f, "established baseline + held shift fires")
  assert.equal(f.severity, "INFO")
  assert.match(f.key, /assist:bshift:d1:humidity:up:m\d+$/)
  assert.match(f.content, /higher than your own recent baseline/)
  assert.ok(!/wrong|should be|correct/.test(f.content), "baseline copy never asserts correctness")

  // negatives
  assert.ok(!fire(mkCtx({
    series: { ...mkCtx().series, humidity: shiftSeries("up", 4) },
    baselines: { humidity: { ...establishedBaseline, tier: "insufficient" as const } },
  }), "baseline-shift"), "insufficient tier: no fire")
  assert.ok(!fire(mkCtx({
    series: { ...mkCtx().series, humidity: shiftSeries("up", 1) },
    baselines: { humidity: establishedBaseline },
  }), "baseline-shift"), "shift held <2d: no fire")
  // readings stopped 15d ago — "running higher for Nd" can't describe
  // data that isn't arriving; silence is T1's lane
  const staleShift: IntelSeries = {
    ...shiftSeries("up", 4),
    points: [{ t: NOW - 15 * DAY, v: 70 }, { t: NOW - 16 * DAY, v: 70 }],
  }
  assert.ok(!fire(mkCtx({
    series: { ...mkCtx().series, humidity: staleShift },
    baselines: { humidity: establishedBaseline },
  }), "baseline-shift"), "shift on stale data: no fire")

  // re-arm: direction flip re-keys; identical state doesn't
  const f2 = fire(mkCtx({
    series: { ...mkCtx().series, humidity: shiftSeries("down", 4) },
    baselines: { humidity: establishedBaseline },
  }), "baseline-shift")!
  assert.notEqual(f2.key, f.key, "direction flip = new evidence")
  assert.equal(
    fire(mkCtx({
      series: { ...mkCtx().series, humidity: shiftSeries("up", 4) },
      baselines: { humidity: establishedBaseline },
    }), "baseline-shift")!.key,
    f.key,
    "same shift → same key"
  )
}

// ── T4 · post-intervention follow-up ───────────────────────────────
section("intervention-followup")

const iv = (over: Partial<InterventionRecord> = {}): InterventionRecord => ({
  type: "RH_DOWN",
  at: NOW - 3 * DAY,
  eventT: NOW - 3 * DAY,
  direction: "down",
  targetMetric: "humidity",
  ...over,
})
const humidityWith = (pts: { t: number; v: number }[]): IntelSeries => ({
  ...emptySeries,
  ...seriesStats(pts),
  points: pts.map((p) => ({ ...p })),
  change: detectChange(pts, 1, { now: NOW }),
})

{
  const ctx = mkCtx({ interventions: [iv()] })
  const f = fire(ctx, "intervention-followup")!
  assert.ok(f, "pending intervention in the follow-up window fires")
  assert.equal(f.actionClass, "MEASURE")
  assert.equal(f.severity, "INFO")
  assert.equal(f.stepId, "humidity")
  assert.equal(f.key, `assist:ivfup:d1:${interventionKey(iv())}`)
  assert.match(f.content, /moved the way you intended/)
  assert.ok(!/worked|fixed|improved/.test(f.content), "never claims the adjustment worked")

  // negatives — window edges + resolution
  assert.ok(!fire(mkCtx({ interventions: [iv({ at: NOW - DAY, eventT: NOW - DAY })] }), "intervention-followup"),
    "<2d old: too soon to read")
  assert.ok(!fire(mkCtx({ interventions: [iv({ at: NOW - 9 * DAY, eventT: NOW - 9 * DAY })] }), "intervention-followup"),
    ">7d old: window lapsed — silence, not nagging")
  assert.ok(!fire(mkCtx({
    interventions: [iv()],
    series: { ...mkCtx().series, humidity: humidityWith([{ t: NOW - 4 * DAY, v: 62 }, { t: NOW - DAY, v: 51 }]) },
  }), "intervention-followup"), "after-reading exists: closed")
  assert.ok(!fire(mkCtx({ interventions: [iv({ pastUnresolved: true })] }), "intervention-followup"),
    "unbounded-historical claim: no fire")
  assert.ok(!fire(mkCtx({ interventions: [iv({ targetMetric: undefined })] }), "intervention-followup"),
    "no target metric: no fire")

  // approximate points don't close the loop
  const approxSeries = humidityWith([{ t: NOW - DAY, v: 51 }])
  approxSeries.points[0].tApproximate = true
  assert.ok(fire(mkCtx({
    interventions: [iv()],
    series: { ...mkCtx().series, humidity: approxSeries },
  }), "intervention-followup"), "approximate after-point doesn't close")
}

// ── T5 · recurring issue ───────────────────────────────────────────
section("recurrence")

{
  const e = ep({ status: "recurred", episodeCount: 2, lastResolvedAt: NOW - 10 * DAY })
  const f = fire(mkCtx(), "recurrence", mkDiag(), [e])!
  assert.ok(f, "recurred episode fires")
  assert.equal(f.severity, "ATTENTION")
  assert.equal(f.actionClass, "OBSERVE")
  assert.match(f.key, /assist:recur:d1:LEAF_YELLOWING\|:ep2$/)
  assert.match(f.content, /similar episode/)
  assert.ok(!/caused|because of/.test(f.content), "correlation copy, never causation")

  // negatives
  assert.ok(!fire(mkCtx(), "recurrence", mkDiag(), [ep({})]), "first occurrence: no fire")
  assert.ok(!fire(mkCtx(), "recurrence", mkDiag(), [ep({ status: "recurred", episodeCount: 2, approximate: true })]),
    "approximate recurrence: no fire")

  // re-arm: a further recurrence is new evidence
  const e3 = ep({ status: "recurred", episodeCount: 3, lastResolvedAt: NOW - 10 * DAY })
  assert.notEqual(fire(mkCtx(), "recurrence", mkDiag(), [e3])!.key, f.key, "each recurrence re-keys")
}

// ── T6 · fresh evidence closing an old gap ─────────────────────────
section("gap-filled")

{
  const snap: SessionSnapshot = {
    at: NOW - 2 * DAY,
    stage: "FLOWER",
    updateCount: 4,
    latest: {},
    symptoms: [],
    missing: ["ph" as MetricId, "ec" as MetricId],
  }
  const f = fire(mkCtx({ freshness: { ph: 1 } }), "gap-filled", mkDiag(), [], snap)!
  assert.ok(f, "previously-missing metric with a fresh point fires")
  assert.equal(f.severity, "INFO")
  assert.equal(f.stepId, "ph")
  assert.match(f.key, /assist:gapfill:d1:ph:d\d+$/)

  // negatives
  assert.ok(!fire(mkCtx({ freshness: {} }), "gap-filled", mkDiag(), [], snap), "still missing: no fire")
  assert.ok(!fire(mkCtx({ freshness: { ph: 6 } }), "gap-filled", mkDiag(), [], snap), "stale fill: no fire")
  assert.ok(!fire(mkCtx({ freshness: { ph: 1 } }), "gap-filled", mkDiag(), [], { ...snap, missing: [] }),
    "nothing was missing: no fire")
  assert.ok(!fire(mkCtx({ freshness: { ph: 1 } }), "gap-filled"), "no snapshot: no fire")
  // a snapshot taken on a different diary must not fire here
  assert.ok(
    !fire(mkCtx({ freshness: { ph: 1 } }), "gap-filled", mkDiag(), [], { ...snap, diaryId: "d9" }),
    "snapshot bound to another diary: no fire"
  )
  // same-diary binding still fires
  assert.ok(
    fire(mkCtx({ freshness: { ph: 1 } }), "gap-filled", mkDiag(), [], { ...snap, diaryId: "d1" }),
    "snapshot bound to this diary: fires"
  )
}

// ── ranking + adversarial ──────────────────────────────────────────
section("ranking + adversarial")

{
  // several triggers eligible at once → highest severity first
  const ctx = mkCtx({
    freshness: { ph: 12 },
    series: { ...mkCtx().series, ph: staleSeries(12) },
    interventions: [iv()],
    observations: [obsAt(9), obsAt(4), obsAt(1)],
  })
  const diag = mkDiag([mkCandidate("ph_drift")])
  const eps = [ep({ firstSeen: NOW - 9 * DAY })] // real-report span 9d → CHECK
  const fires = evaluate(ctx, diag, eps)
  assert.ok(fires.length >= 3, "multiple triggers fire")
  assert.equal(fires[0].severity, "CHECK", "CHECK outranks ATTENTION/INFO")
  assert.equal(fires[0].triggerId, "persistent-symptom")

  // no trigger ever emits ADJUST or urgency vocabulary
  for (const f of fires) {
    assert.notEqual(f.actionClass, "ADJUST", `${f.triggerId}: no proactive adjustments`)
    assert.ok(!/critical|emergency|danger|urgent/i.test(f.title + f.content), `${f.triggerId}: no urgency vocabulary`)
    assert.ok(f.content.length <= 500, `${f.triggerId}: within notification content cap`)
    assert.ok(f.title.length <= 200, `${f.triggerId}: within title cap`)
  }

  // privacy: no diary title, no internal ids, no room/user ids in copy
  for (const f of fires) {
    const blob = `${f.title} ${f.content} ${f.reason}`
    assert.ok(!/My private grow|d1-slug/.test(blob), `${f.triggerId}: no diary text leak`)
    assert.ok(!/ph_drift|salt_buildup|humidity_high/.test(f.title + f.content), `${f.triggerId}: no candidate ids in copy`)
  }

  // determinism: identical inputs → identical output
  assert.deepEqual(evaluate(ctx, diag, eps), fires, "same context → same fires")
}

// ── invariants across the whole registry ───────────────────────────
section("registry invariants")

{
  // every trigger id is distinct and kebab-cased (BotEvent.command)
  const ctx = mkCtx({
    freshness: { ph: 12, humidity: 15 },
    interventions: [iv()],
    observations: [obsAt(8), obsAt(4), obsAt(1)],
    baselines: { humidity: establishedBaseline },
    series: {
      ...mkCtx().series,
      ph: staleSeries(12),
      humidity: shiftSeries("up", 5),
    },
  })
  const eps = [
    ep({ firstSeen: NOW - 8 * DAY }),
    ep({ symptom: "CURL_UP" as SymptomEpisode["symptom"], status: "recurred", episodeCount: 2 }),
  ]
  const snap: SessionSnapshot = {
    at: NOW - DAY, stage: "FLOWER", updateCount: 4, latest: {}, symptoms: [],
    missing: ["ph" as MetricId],
  }
  const fires = evaluate(ctx, mkDiag([mkCandidate("ph_drift")]), eps, snap)
  const ids = new Set(fires.map((f) => f.triggerId))
  assert.ok(ids.size >= 4, "registry covers the trigger set")
  for (const f of fires) {
    assert.match(f.key, /^assist:[a-z-]+:d1:/, `${f.triggerId}: key carries diary scope`)
    assert.match(f.triggerId, /^[a-z-]+$/, `${f.triggerId}: kind is a clean slug`)
    assert.ok(f.reason.length > 0, `${f.triggerId}: auditable reason`)
  }
}

console.log("\nAll BOT_ASSIST trigger tests passed.")
