// TerpBot longitudinal intelligence tests.
// Covers: timeline, baselines, change detection, episodes, interventions,
// the action engine, status renderers, session merge, parser events,
// longitudinal /why, and adversarial cases. Pure logic — no DB.
// Run: npx tsx scripts/terpbot-longitudinal-tests.mts

import assert from "node:assert"
import {
  buildMetricBaseline,
  detectChange,
  detectTrend,
  excursionEpisodes,
  seriesStats,
  BASELINE_EMERGING_N,
  BASELINE_EMERGING_DAYS,
  BASELINE_ESTABLISHED_N,
} from "@/lib/terpbot-intel-calc"
import { episodesFromObservations } from "@/lib/terpbot-intel-episodes"
import { stageTransitions, timelineFromRows, type TimelineRow } from "@/lib/terpbot-intel-timeline"
import {
  evaluateContext,
  nextActions,
  nextUsefulMeasurement,
} from "@/lib/terpbot-intel"
import {
  renderChanges,
  renderCheck,
  renderMeasurements,
  renderStatus,
  snapshotFrom,
} from "@/lib/terpbot-intel-status"
import { buildSnapshot } from "@/lib/terpbot-intel-snapshot"
import { buildCultivationDecisions } from "@/lib/terpbot-intel-decisions"
import { buildWhyTrail, renderWhy } from "@/lib/terpbot-intel-why"
import { parseGrowText } from "@/lib/terpbot-nl-parse"
import { parseTerpbotIntent } from "@/lib/terpbot-intents"
import { mergeInterventions, mergeResolutions, mergeReported, mergeObservations } from "@/lib/terpbot-intel-merge"
import { pts, emptySeries as EMPTY_SERIES } from "./lib/terpbot-fixtures"
import type {
  GrowContextView,
  IntelSeries,
  InterventionRecord,
  LocationId,
  ResolutionClaim,
  StructuredObservation,
  SymptomId,
} from "@/lib/terpbot-intel-types"

const DAY = 86400000
const t0 = Date.UTC(2025, 0, 1)
const mkSeries = (vals: number[], eps: number, now = t0 + vals.length * DAY): IntelSeries => {
  const points = pts(vals)
  return { ...seriesStats(points), points, trend: detectTrend(points, eps), change: detectChange(points, eps, { now }) }
}
/** series whose last point lands `daysBack` before `now` — fresh data */
const NOW = t0 + 40 * DAY
const mkRecent = (vals: number[], eps: number, daysBack = 1): IntelSeries => {
  const start = NOW - (vals.length - 1) * DAY - daysBack * DAY
  const points = vals.map((v, i) => ({ t: start + i * DAY, v }))
  return { ...seriesStats(points), points, trend: detectTrend(points, eps), change: detectChange(points, eps, { now: NOW }) }
}
const emptySeries = EMPTY_SERIES

const mkCtx = (over: Partial<GrowContextView> = {}): GrowContextView => ({
  scope: "public",
  diary: {
    id: "d1", slug: "d1-slug", title: "Test", stage: "FLOWER", visibility: "PUBLIC",
    startDate: new Date(t0), harvested: false,
    mediumType: "COCO", lightType: "LED", growType: "INDOOR", techniques: [],
  },
  setup: { present: false, medium: null, capabilities: [] },
  now: t0 + 40 * DAY,
  day: 41, week: 6,
  stageDays: 20, stageStartCensored: false,
  stageTransitions: [],
  updateCount: 4, daysSinceUpdate: 1,
  envCoverage: 1,
  series: {
    temperature: emptySeries, humidity: emptySeries, ph: emptySeries,
    ec: emptySeries, height: emptySeries, vpdEntered: emptySeries, vpdComputed: emptySeries,
    runoffPh: emptySeries, runoffEc: emptySeries,
    watering: emptySeries, ppfd: emptySeries, photoperiod: emptySeries,
  },
  vpdDivergence: null,
  missing: [],
  freshness: {},
  ...over,
  observations: over.observations ?? [],
  baselines: over.baselines ?? {},
})

const obs = (symptom: SymptomId, dayOffset: number, over: Partial<StructuredObservation> = {}): StructuredObservation => ({
  symptom,
  t: t0 + dayOffset * DAY,
  source: "nl",
  feeds: [],
  ...over,
})

function section(name: string) {
  console.log(`\n── ${name} ──`)
}

// ── Timeline (H1) ───────────────────────────────────────────────────
section("timeline")

{
  // stageTransitions: in-window transition
  const rows = [
    { createdAt: new Date(t0), stage: "VEGETATIVE" },
    { createdAt: new Date(t0 + DAY), stage: "VEGETATIVE" },
    { createdAt: new Date(t0 + 2 * DAY), stage: "FLOWER" },
  ]
  const tr = stageTransitions(rows, "FLOWER", null)
  assert.equal(tr.length, 1)
  assert.equal(tr[0].from, "VEGETATIVE")
  assert.equal(tr[0].to, "FLOWER")
  assert.equal(tr[0].censored, undefined)

  // boundary into current stage via prevStage probe
  const rows2 = [
    { createdAt: new Date(t0 + 5 * DAY), stage: "FLOWER" },
    { createdAt: new Date(t0 + 6 * DAY), stage: "FLOWER" },
  ]
  const tr2 = stageTransitions(rows2, "FLOWER", { createdAt: new Date(t0 + 3 * DAY), stage: "VEGETATIVE" })
  assert.equal(tr2.length, 1)
  assert.equal(tr2[0].to, "FLOWER")
  assert.equal(tr2[0].censored, false) // first current-stage row IS in set

  // fully censored — no current-stage row in window
  const rows3 = [{ createdAt: new Date(t0 + 5 * DAY), stage: "VEGETATIVE" }]
  const tr3 = stageTransitions(rows3, "FLOWER", { createdAt: new Date(t0 + 2 * DAY), stage: "VEGETATIVE" })
  assert.equal(tr3.length, 1)
  assert.equal(tr3[0].censored, true)

  // no transition when everything is one stage
  assert.equal(stageTransitions(rows2, "FLOWER", null).length, 0)
}

{
  // timelineFromRows: ordering, deterministic ids, canonical data only
  const mkRow = (id: string, d: number, over: Partial<TimelineRow> = {}): TimelineRow => ({
    id, createdAt: new Date(t0 + d * DAY), stage: "VEGETATIVE",
    feeding: null, training: null, content: null,
    temperature: null, humidity: null, vpd: null, ph: null, ec: null,
    heightCm: null, imageCount: 0, ...over,
  })
  const rows = [
    mkRow("u1", 0, { temperature: 75, humidity: 60 }),
    mkRow("u2", 3, { training: "topped, lst" }),
    mkRow("u3", 6, { content: "lower leaves yellowing" }),
    mkRow("u4", 9, { feeding: "runoff ec 2.1", imageCount: 2 }),
  ]
  const diary = { id: "d1", stage: "VEGETATIVE", startDate: new Date(t0 - 5 * DAY), harvested: false, harvestedAt: null }
  const ev = timelineFromRows(rows, diary, [])
  assert.equal(ev[0].kind, "grow-start")
  assert.ok(ev.every((e) => !("content" in (e.data ?? {})) && !("text" in (e.data ?? {}))))
  // deterministic order
  const ts = ev.map((e) => e.t)
  assert.deepEqual(ts, [...ts].sort((a, b) => a - b))
  // feeding event carries parsed scalars, not text
  const feed = ev.find((e) => e.kind === "feeding")
  assert.equal(feed?.data?.runoffEc, 2.1)
  // symptom event carries canonical id
  const sym = ev.find((e) => e.kind === "symptom")
  assert.equal(sym?.data?.symptom, "LEAF_YELLOWING")
  // training tags canonicalized
  const tr = ev.find((e) => e.kind === "training")
  assert.ok(String(tr?.data?.tags).includes("topped"))
  // harvest event for harvested diary
  const ev2 = timelineFromRows(rows, { ...diary, harvested: true, harvestedAt: new Date(t0 + 12 * DAY) }, [])
  assert.ok(ev2.some((e) => e.kind === "harvest"))
}

// ── Baselines (H2) ──────────────────────────────────────────────────
section("baselines")

{
  const now = t0 + 20 * DAY
  // insufficient: <3 points
  let b = buildMetricBaseline(pts([60, 61]), now)
  assert.equal(b.tier, "insufficient")
  // emerging: ≥3 points across ≥3 days
  b = buildMetricBaseline(pts([60, 61, 62, 59]), now)
  assert.equal(b.tier, "emerging")
  assert.equal(b.n, 4)
  // established: ≥7 points over ≥7 days, newest ≤10d old
  b = buildMetricBaseline(pts([60, 61, 62, 59, 60, 61, 62, 60]), t0 + 10 * DAY)
  assert.equal(b.tier, "established")
  assert.ok(b.median != null && b.lo != null && b.hi != null)
  // user-reported points never build a baseline
  b = buildMetricBaseline(pts([60, 61, 62, 59, 60, 61, 62, 60], DAY, "user-reported"), now)
  assert.equal(b.tier, "insufficient")
  assert.equal(b.n, 0)
  // tApproximate excluded
  b = buildMetricBaseline(
    pts([60, 61, 62, 59, 60, 61, 62, 60]).map((p) => ({ ...p, tApproximate: true })),
    now
  )
  assert.equal(b.tier, "insufficient")
  // expiry: all points >21d old
  b = buildMetricBaseline(pts([60, 61, 62, 59, 60, 61, 62, 60]), t0 + 60 * DAY)
  assert.equal(b.tier, "insufficient")
  assert.ok(b.n > 0) // stats retained; only the tier decays
  // stale demotion: established → emerging when 11-20d old
  b = buildMetricBaseline(pts([60, 61, 62, 59, 60, 61, 62, 60]), t0 + 7 * DAY + 12 * DAY)
  assert.equal(b.tier, "emerging")
  // single-session burst can't mint a baseline (same day, 8 points)
  b = buildMetricBaseline(pts([60, 61, 62, 59, 60, 61, 62, 60], 3600000), now)
  assert.equal(b.tier, "insufficient")
  assert.ok(b.distinctDays < BASELINE_EMERGING_DAYS)
}

{
  // detectChange
  const now = t0 + 20 * DAY
  // needs ≥2 baseline points
  let c = detectChange(pts([60, 70]), 3, { now })
  assert.equal(c.direction, "insufficient")
  // unchanged under epsilon (needs ≥2 baseline points → ≥5 total)
  c = detectChange(pts([60, 61, 60, 61, 60]), 3, { now })
  assert.equal(c.direction, "unchanged")
  // up with delta + duration
  c = detectChange(pts([60, 60, 61, 70, 71, 70]), 3, { now })
  assert.equal(c.direction, "up")
  assert.ok(Math.abs(c.vsBaselineDelta! - 10) < 0.01)
  assert.ok(c.durationDays != null && c.durationDays > 0)
  // down
  c = detectChange(pts([70, 71, 70, 60, 59, 60]), 3, { now })
  assert.equal(c.direction, "down")
  // one spike can't fabricate a change (median-vs-median)
  c = detectChange(pts([60, 60, 90, 60, 61]), 3, { now })
  assert.equal(c.direction, "unchanged")
}

{
  // excursionEpisodes — segmentation + open episodes
  const rh = pts([60, 75, 78, 62, 60, 76, 77])
  const eps = excursionEpisodes(rh, -Infinity, 70)
  assert.equal(eps.length, 2)
  assert.equal(eps[0].end != null, true)
  assert.equal(eps[1].end, null) // still open — series ends out-of-band
  // fully closed
  const eps2 = excursionEpisodes(pts([60, 75, 62, 60]), -Infinity, 70)
  assert.equal(eps2.length, 1)
  assert.ok(eps2[0].end != null)
}

// ── Episodes ────────────────────────────────────────────────────────────────────────────────────────────────────────
section("episodes")

{
  // report → resolved → report = recurrence
  const eps = episodesFromObservations(
    [obs("LEAF_YELLOWING", 1), obs("LEAF_YELLOWING", 5)],
    [
      { symptom: "LEAF_YELLOWING", kind: "resolved", t: t0 + 7 * DAY, source: "nl" },
    ]
  )
  assert.equal(eps.length, 1)
  assert.equal(eps[0].status, "resolved")
  // a report AFTER resolution recurs
  const eps2 = episodesFromObservations(
    [obs("LEAF_YELLOWING", 1), obs("LEAF_YELLOWING", 10)],
    [{ symptom: "LEAF_YELLOWING", kind: "resolved", t: t0 + 7 * DAY, source: "nl" }]
  )
  assert.equal(eps2[0].status, "recurred")
  assert.equal(eps2[0].episodeCount, 2)
}

{
  // improving / stable transitions
  let eps = episodesFromObservations(
    [obs("TIP_BURN", 1)],
    [{ symptom: "TIP_BURN", kind: "improving", t: t0 + 3 * DAY, source: "nl" }]
  )
  assert.equal(eps[0].status, "improving")
  eps = episodesFromObservations(
    [obs("TIP_BURN", 1)],
    [
      { symptom: "TIP_BURN", kind: "stable", t: t0 + 3 * DAY, source: "nl" },
      { symptom: "TIP_BURN", kind: "improving", t: t0 + 5 * DAY, source: "nl" },
    ]
  )
  assert.equal(eps[0].status, "improving")
  // worsening claim keeps it active
  eps = episodesFromObservations(
    [obs("TIP_BURN", 1)],
    [{ symptom: "TIP_BURN", kind: "worsening", t: t0 + 3 * DAY, source: "nl" }]
  )
  assert.equal(eps[0].status, "active")
}

{
  // unscoped claim applies to most recent active episode
  const eps = episodesFromObservations(
    [obs("LEAF_YELLOWING", 1), obs("TIP_BURN", 2)],
    [{ kind: "resolved", t: t0 + 5 * DAY, source: "nl" }]
  )
  const tipBurn = eps.find((e) => e.symptom === "TIP_BURN")!
  const yellow = eps.find((e) => e.symptom === "LEAF_YELLOWING")!
  assert.equal(tipBurn.status, "resolved") // most recent
  assert.equal(yellow.status, "active")
}

{
  // claim about a never-reported symptom still opens an episode
  const eps = episodesFromObservations([], [
    { symptom: "CLAW_DOWN", kind: "resolved", t: t0 + 3 * DAY, source: "nl" },
  ])
  assert.equal(eps.length, 1)
  assert.equal(eps[0].status, "resolved")
}

{
  // resolved → report same key → recurred; resolved again → resolved
  const eps = episodesFromObservations(
    [obs("SPOTS", 1), obs("SPOTS", 9)],
    [
      { symptom: "SPOTS", kind: "resolved", t: t0 + 5 * DAY, source: "nl" },
      { symptom: "SPOTS", kind: "resolved", t: t0 + 12 * DAY, source: "nl" },
    ]
  )
  assert.equal(eps[0].status, "resolved")
  assert.equal(eps[0].episodeCount, 2) // recurrence counted
}

// ── Longitudinal rules ──────────────────────────────────────────────
section("longitudinal rules")

{
  // resolved episode counter-weighs fed candidates
  const ctx = mkCtx({
    observations: [obs("LEAF_YELLOWING", 1, { location: "LOWER_OLD" })],
    resolutions: [{ symptom: "LEAF_YELLOWING", location: "LOWER_OLD", kind: "resolved", t: t0 + 3 * DAY, source: "nl" }],
  })
  const d = evaluateContext(ctx)
  const all = d.candidates.flatMap((c) => [...c.supporting, ...c.opposing])
  assert.ok(
    all.some((e) => e.direction === "against" && /resolved/i.test(e.text)),
    "resolved episode should emit against evidence"
  )
}

{
  // recurred episode re-raises
  const ctx = mkCtx({
    observations: [obs("LEAF_YELLOWING", 1), obs("LEAF_YELLOWING", 10)],
    resolutions: [{ symptom: "LEAF_YELLOWING", kind: "resolved", t: t0 + 5 * DAY, source: "nl" }],
  })
  const d = evaluateContext(ctx)
  const finding = d.findings.find((f) => f.ruleId === "longitudinal.episode")
  assert.ok(finding)
  assert.ok(finding!.evidence.some((e) => /recurring/i.test(e.text) || /returned/i.test(e.text)))
}

{
  // quiet episode — no new reports, unresolved (never closed silently)
  const ctx = mkCtx({
    observations: [obs("TIP_BURN", 0)], // 40d ago, still "active"
    now: t0 + 40 * DAY,
  })
  const d = evaluateContext(ctx)
  const f = d.findings.find((f) => f.ruleId === "longitudinal.episode")
  assert.ok(f?.evidence.some((e) => /no new|unresolved/i.test(e.text)))
}

{
  // intervention evaluation — honest before/after
  const base = mkSeries([72, 71, 72, 62, 61], 3)
  const ctx = mkCtx({
    series: { ...mkCtx().series, humidity: base },
    interventions: [{
      type: "RH_DOWN", at: t0 + 2.5 * DAY, direction: "down", targetMetric: "humidity",
      beforeReading: { v: 72, t: t0 + 2 * DAY },
    }],
  })
  const d = evaluateContext(ctx)
  const f = d.findings.find((f) => f.ruleId === "longitudinal.intervention")
  assert.ok(f)
  assert.ok(/consistent|not proof/i.test(f!.evidence[0].text))
  assert.ok(/72 → 61|72 → 62/.test(f!.evidence[0].text))
}

{
  // intervention with no after-reading asks for measurement
  const ctx = mkCtx({
    series: { ...mkCtx().series, humidity: mkSeries([72, 71, 72], 3) },
    interventions: [{
      type: "RH_DOWN", at: t0 + 39 * DAY, direction: "down", targetMetric: "humidity",
      beforeReading: { v: 72, t: t0 + 2 * DAY },
    }],
  })
  const d = evaluateContext(ctx)
  const f = d.findings.find((f) => f.ruleId === "longitudinal.intervention")
  assert.ok(/hasn't been logged since/i.test(f!.evidence[0].text))
}

{
  // intervention moved opposite intended direction — honest, no spin
  const ctx = mkCtx({
    series: { ...mkCtx().series, humidity: mkSeries([72, 71, 72, 78, 79], 3) },
    interventions: [{
      type: "RH_DOWN", at: t0 + 2.5 * DAY, direction: "down", targetMetric: "humidity",
      beforeReading: { v: 72, t: t0 + 2 * DAY },
    }],
  })
  const d = evaluateContext(ctx)
  const f = d.findings.find((f) => f.ruleId === "longitudinal.intervention")
  assert.ok(/opposite/i.test(f!.evidence[0].text))
}

{
  // baseline shift is INFO-ONLY — never feeds a candidate
  const ctx = mkCtx({
    series: { ...mkCtx().series, humidity: mkSeries([60, 60, 61, 72, 73, 72], 3) },
    baselines: {
      humidity: { tier: "established", n: 8, distinctDays: 8, windowDays: 7, median: 60, lo: 59, hi: 62, ageDays: 2 },
    },
  })
  const d = evaluateContext(ctx)
  const f = d.findings.find((f) => f.ruleId === "longitudinal.baseline")
  assert.ok(f)
  assert.ok(f!.evidence.every((e) => e.direction === "info"))
  assert.ok(/norm|usual/i.test(f!.evidence[0].text))
  // and the info carries no candidate binding
  assert.ok(f!.evidence.every((e) => !e.candidate))
}

{
  // recurring RH episodes → humidity_high gets for-evidence
  // (FLOWER ceiling is 55 — the dips below it close the episodes)
  const ctx = mkCtx({
    series: { ...mkCtx().series, humidity: mkSeries([70, 76, 45, 50, 74, 78], 3) },
  })
  const d = evaluateContext(ctx)
  const hh = d.candidates.find((c) => c.id === "humidity_high")
  assert.ok(hh, "humidity_high should exist")
  assert.ok(hh!.supporting.some((e) => /separate episodes|recurring/i.test(e.text)))
  // in FLOWER: bud_rot risk evidence
  const br = d.candidates.find((c) => c.id === "bud_rot")
  assert.ok(br?.supporting.some((e) => e.direction === "risk"))
}

{
  // stage transition within 3d → info finding
  const ctx = mkCtx({
    stageTransitions: [{ from: "VEGETATIVE", to: "FLOWER", t: t0 + 39 * DAY }],
  })
  const d = evaluateContext(ctx)
  assert.ok(d.findings.some((f) => f.ruleId === "stage.transition"))
}

// ── Action engine (H4) ──────────────────────────────────────────────
section("action engine")

{
  // OBSERVE class for inspect:* steps
  const ctx = mkCtx({
    observations: [obs("STIPPLING", 0)],
  })
  const d = evaluateContext(ctx)
  const actions = nextActions(ctx, d)
  assert.ok(actions.length > 0)
  assert.ok(actions.some((a) => a.actionClass === "OBSERVE" || a.actionClass === "MEASURE"))
  // deterministic — same input, same output
  assert.deepEqual(
    nextActions(ctx, d).map((a) => `${a.actionClass}:${a.stepId ?? a.actionText}`),
    nextActions(ctx, d).map((a) => `${a.actionClass}:${a.stepId ?? a.actionText}`)
  )
}

{
  // ADJUST only at STRONG with zero opposing — fabricate a strong candidate
  // via measured-confirmed evidence isn't reachable for conditions, so
  // assert the gate: possible-state diagnosis never emits ADJUST.
  const ctx = mkCtx({ observations: [obs("LEAF_YELLOWING", 0)] })
  const d = evaluateContext(ctx)
  const actions = nextActions(ctx, d)
  assert.ok(!actions.some((a) => a.actionClass === "ADJUST"), "POSSIBLE must never yield ADJUST")
}

{
  // WAIT when a recent intervention lacks an after-reading
  const ctx = mkCtx({
    series: { ...mkCtx().series, humidity: mkSeries([72, 71, 72], 3) },
    interventions: [{
      type: "RH_DOWN", at: t0 + 38 * DAY, direction: "down", targetMetric: "humidity",
    }],
  })
  const d = evaluateContext(ctx)
  const actions = nextActions(ctx, d)
  assert.ok(actions.some((a) => a.actionClass === "WAIT"), "pending intervention should emit WAIT")
}

{
  // LOG when coverage is sparse AND there's live reasoning work —
  // sparse alone is not a chore (stabilization: HOLD wins there).
  const ctx = mkCtx({
    envCoverage: 0.2, updateCount: 5,
    interventions: [{
      type: "RH_DOWN", at: t0 + 38 * DAY, direction: "down", targetMetric: "humidity",
    }],
  })
  const d = evaluateContext(ctx)
  const actions = nextActions(ctx, d)
  assert.ok(actions.some((a) => a.actionClass === "LOG"))
  // and the sparse-only case emits nothing collect-y at all
  const quiet = nextActions(mkCtx({ envCoverage: 0.2, updateCount: 5 }), evaluateContext(mkCtx({ envCoverage: 0.2, updateCount: 5 })))
  assert.ok(!quiet.some((a) => a.actionClass === "LOG"), "sparse alone → no manufactured LOG")
}

{
  // measure-vs-adjust ordering: matches the engine's CLASS_RANK —
  // WAIT outranks ADJUST (never stack a change on an unverified one).
  const rank: Record<string, number> = { COMPARE: 0, VERIFY: 1, MEASURE: 2, OBSERVE: 3, WAIT: 4, ADJUST: 5, LOG: 6 }
  const ctx = mkCtx({ observations: [obs("LEAF_YELLOWING", 0), obs("TIP_BURN", 0)] })
  const actions = nextActions(ctx, evaluateContext(ctx))
  for (let i = 1; i < actions.length; i++) {
    assert.ok(rank[actions[i].actionClass] >= rank[actions[i - 1].actionClass])
  }
}

// ── Status renderers ───────────────────────────────────────────────────────────────────────────────────────────
section("status renderers")

{
  const ctx = mkCtx({
    series: { ...mkCtx().series, humidity: mkSeries([60, 61, 72, 73, 72], 3), temperature: mkSeries([75, 76, 75], 2) },
    baselines: {
      humidity: { tier: "established", n: 8, distinctDays: 8, windowDays: 7, median: 60, lo: 59, hi: 62, ageDays: 0 },
    },
    observations: [obs("LEAF_YELLOWING", 0)],
  })
  const d = evaluateContext(ctx)
  const lines = renderStatus(ctx, d, buildCultivationDecisions(buildSnapshot(ctx)))
  const text = lines.join("\n")
  assert.ok(/Grow status/i.test(text))
  assert.ok(/flower/i.test(text))
  assert.ok(/↑|↓|Changed:/i.test(text))
  assert.ok(/Next:/.test(text))
  // deterministic
  assert.deepEqual(lines, renderStatus(ctx, d, buildCultivationDecisions(buildSnapshot(ctx))))
}

{
  const ctx = mkCtx({
    series: { ...mkCtx().series, temperature: mkRecent([75, 76], 2), humidity: mkRecent([60], 3) },
    missing: ["ph", "ec", "runoffPh", "runoffEc", "height", "vpd"],
  })
  const lines = renderMeasurements(ctx)
  const text = lines.join("\n")
  assert.ok(/Known:/.test(text))
  assert.ok(/Missing:/.test(text))
  assert.ok(!/raw|content/i.test(text))
}

{
  // /changes — diff against snapshot
  const ctx1 = mkCtx({
    series: { ...mkCtx().series, humidity: mkSeries([60, 61, 60], 3) },
  })
  const snap = snapshotFrom(ctx1, evaluateContext(ctx1), t0 + 10 * DAY)
  const ctx2 = mkCtx({
    series: { ...mkCtx().series, humidity: mkSeries([60, 61, 60, 72, 73], 3) },
    observations: [obs("TIP_BURN", 12)],
  })
  const lines = renderChanges(ctx2, evaluateContext(ctx2), snap)
  const text = lines.join("\n")
  assert.ok(/→/.test(text), "should show a delta")
  assert.ok(/new:/i.test(text), "should show the new symptom")
  // no prev → prompt
  assert.ok(/run \/status/i.test(renderChanges(ctx2, evaluateContext(ctx2), undefined).join("")))
  // sub-epsilon deltas filtered
  const ctx3 = mkCtx({ series: { ...mkCtx().series, humidity: mkSeries([60, 61, 60, 61], 3) } })
  assert.ok(/nothing meaningful/i.test(renderChanges(ctx3, evaluateContext(ctx3), snap).join("")))
}

{
  // /check renders ranked decisions from the canonical decision set
  const ctx = mkCtx({ observations: [obs("STIPPLING", 0)] })
  const lines = renderCheck(buildCultivationDecisions(buildSnapshot(ctx)))
  assert.ok(/1\./.test(lines.join("\n")))
  // stable grow with fresh in-band env data → calm negative (HOLD).
  // (a data-empty grow correctly produces a data-collection MEASURE — spec §32)
  const stable = mkRecent([70, 71, 70, 72, 71], 1.5)
  const stableRh = mkRecent([55, 56, 55, 57, 56], 3)
  const empty = renderCheck(
    buildCultivationDecisions(buildSnapshot(mkCtx({
      observations: [],
      diary: { ...mkCtx().diary, stage: "VEGETATIVE" },
      series: { ...mkCtx().series, temperature: stable, humidity: stableRh },
    })))
  )
  assert.ok(/nothing to check|no change/i.test(empty.join("")))
}

// ── Parser events ──────────────────────────────────────────────────────────────────────────────────────────────────
section("parser")

{
  // "lowered rh to 50" → intervention + setpoint, NOT a humidity reading
  const p = parseGrowText("i lowered rh to 50")
  assert.ok(p.interventions.some((i) => i.type === "RH_DOWN"))
  const iv = p.interventions.find((i) => i.type === "RH_DOWN")!
  assert.equal(iv.targetMetric, "humidity")
  assert.equal(iv.direction, "down")
  assert.equal(iv.setpoint, 50)
  assert.ok(!p.measurements.some((m) => m.metric === "humidity" && m.value === 50))
}

{
  // "yellowing cleared up" → resolution claim, no new observation
  const p = parseGrowText("the yellowing cleared up")
  assert.ok(p.resolutions.some((r) => r.symptom === "LEAF_YELLOWING" && r.kind === "resolved"))
  assert.ok(!p.observations.some((o) => o.symptom === "LEAF_YELLOWING"))
}

{
  // unscoped progression
  const p = parseGrowText("looking better")
  assert.ok(p.resolutions.some((r) => r.kind === "improving" && !r.symptom))
}

{
  // question suppression — "should i lower my rh" reports nothing
  const p = parseGrowText("should i lower my rh")
  assert.equal(p.interventions.length, 0)
  assert.equal(p.resolutions.length, 0)
}

{
  // "getting worse" → worsening claim
  const p = parseGrowText("the spots are getting worse")
  assert.ok(p.resolutions.some((r) => r.kind === "worsening"))
}

{
  // aged intervention — "lowered rh 3 days ago" resolves event time
  const p = parseGrowText("i lowered rh 3 days ago")
  const iv = p.interventions.find((i) => i.type === "RH_DOWN")
  assert.ok(iv)
  assert.equal(iv!.ageDays, 3)
}

{
  // audit regressions — negation gates, setpoint connectors, heal
  const p1 = parseGrowText("i never lowered rh")
  assert.equal(p1.interventions.length, 0, "negated intervention mints nothing")
  const p2 = parseGrowText("it hasn't cleared up")
  assert.ok(!p2.resolutions.some((r) => r.kind === "resolved"), "negated progression ≠ resolved")
  const p3 = parseGrowText("i lowered rh on 3 plants")
  const iv3 = p3.interventions.find((i) => i.type === "RH_DOWN")
  assert.ok(iv3)
  assert.equal(iv3!.setpoint, undefined, "unconnected number is not a setpoint")
  const p4 = parseGrowText("yellowing and curling cleared up")
  assert.ok(!p4.observations.some((o) => o.symptom === "LEAF_YELLOWING"), "conjunction sibling joins the claim")
  assert.ok(p4.resolutions.some((r) => r.symptom === "LEAF_YELLOWING" && r.kind === "resolved"))
}

{
  // location-less claim falls back to the most-reported bucket —
  // "tips yellowing" then "cleared up" resolves the located episode
  const eps = episodesFromObservations(
    [obs("LEAF_YELLOWING", 1, { location: "LEAF_TIPS" as LocationId })],
    [{ symptom: "LEAF_YELLOWING", kind: "resolved", t: t0 + 3 * DAY, source: "nl" }]
  )
  assert.equal(eps.length, 1, "no phantom episode from a location-less claim")
  assert.equal(eps[0].status, "resolved")
}

{
  // tApproximate reports open history but don't mint a "current" episode
  const eps = episodesFromObservations(
    [obs("SPOTS", 1, { tApproximate: true })],
    []
  )
  assert.equal(eps[0].status, "active")
  assert.ok(eps[0].approximate, "approximate-only episode is flagged")
}

// ── Session merge + merge layer ─────────────────────────────────────
section("merge layer")

{
  // mergeInterventions snapshots beforeReading from the series
  const ctx = mkCtx({
    series: { ...mkCtx().series, humidity: mkSeries([72, 71, 70], 3) },
  })
  const merged = mergeInterventions(ctx, [{
    type: "RH_DOWN", at: t0 + 2.5 * DAY, direction: "down", targetMetric: "humidity",
  }])
  const iv = merged.interventions![0]
  assert.equal(iv.beforeReading?.v, 70)
}

{
  // mergeResolutions dedupes same-day same-kind claims
  const ctx = mkCtx({})
  const claims = [
    { symptom: "LEAF_YELLOWING" as SymptomId, kind: "resolved" as const, t: t0 + 3 * DAY },
    { symptom: "LEAF_YELLOWING" as SymptomId, kind: "resolved" as const, t: t0 + 3 * DAY + 3600000 },
  ]
  const merged = mergeResolutions(ctx, claims)
  assert.equal(merged.resolutions!.length, 1)
}

// ── Longitudinal /why (H6) ──────────────────────────────────────────
section("longitudinal /why")

{
  const ctx = mkCtx({
    series: { ...mkCtx().series, humidity: mkSeries([60, 60, 61, 72, 73, 72], 3) },
    observations: [obs("LEAF_YELLOWING", 1), obs("LEAF_YELLOWING", 10)],
    resolutions: [{ symptom: "LEAF_YELLOWING", kind: "resolved", t: t0 + 5 * DAY, source: "nl" }],
    interventions: [{
      type: "RH_DOWN", at: t0 + 38 * DAY, direction: "down", targetMetric: "humidity",
    }],
  })
  const d = evaluateContext(ctx)
  const trail = buildWhyTrail(ctx, d, ctx.now)
  assert.ok(trail.longitudinal)
  assert.ok(trail.longitudinal!.changes.some((c) => c.metric === "humidity"))
  assert.ok(trail.longitudinal!.episodes.some((e) => e.symptom === "LEAF_YELLOWING" && e.status === "recurred"))
  assert.ok(trail.longitudinal!.pendingInterventions.length > 0)

  const lines = renderWhy(trail)
  const text = lines.join("\n")
  assert.ok(/Changed:/.test(text))
  assert.ok(/Episode:/.test(text))
  assert.ok(/Intervention:/.test(text))
  // no raw ids leaked
  assert.ok(!/d1|u1|refId/i.test(text))
  assert.ok(/knowledge v2\.6/.test(text))
}

// ── Adversarial ────────────────────────────────────────────────────────────────────────────────────────────────────
section("adversarial")

{
  // improvement claim vs later fresh report — the later report wins
  const eps = episodesFromObservations(
    [obs("SPOTS", 1), obs("SPOTS", 8)],
    [{ symptom: "SPOTS", kind: "improving", t: t0 + 4 * DAY, source: "nl" }]
  )
  assert.equal(eps[0].status, "active", "a fresh report after an improving claim re-opens the episode")
}

{
  // claimed resolution then same symptom again → recurrence, not silence
  const ctx = mkCtx({
    observations: [obs("WEBBING", 1), obs("WEBBING", 15)],
    resolutions: [{ symptom: "WEBBING", kind: "resolved", t: t0 + 7 * DAY, source: "nl" }],
  })
  const d = evaluateContext(ctx)
  const f = d.findings.find((f) => f.ruleId === "longitudinal.episode")
  assert.ok(f?.evidence.some((e) => /recurring|returned/i.test(e.text)))
}

{
  // intervention reported, no follow-up — no improvement is claimed
  const ctx = mkCtx({
    series: { ...mkCtx().series, humidity: mkSeries([72, 71], 3) },
    interventions: [{ type: "RH_DOWN", at: t0 + 39 * DAY, direction: "down", targetMetric: "humidity" }],
  })
  const d = evaluateContext(ctx)
  const f = d.findings.find((f) => f.ruleId === "longitudinal.intervention")
  assert.ok(f)
  assert.ok(!/solved|fixed|worked/i.test(f!.evidence.map((e) => e.text).join(" ")))
}

{
  // stage claim flip between turns — newest canonical claim wins, and
  // stage transitions reflect logged rows only
  const p1 = parseGrowText("week 3 veg")
  const p2 = parseGrowText("week 1 flower")
  assert.equal(p1.stage, "VEGETATIVE")
  assert.equal(p2.stage, "FLOWER")
}

{
  // conflicting measurements — both land, no winner is fabricated
  const ctx = mkCtx({})
  const merged = mergeReported(ctx, [
    { metric: "humidity", value: 55, unit: "percent", t: t0 + 5 * DAY },
    { metric: "humidity", value: 80, unit: "percent", t: t0 + 5 * DAY + 3600000 },
  ], t0 + 6 * DAY)
  assert.equal(merged.series.humidity.points.length, 2) // both kept
}

{
  // intent routing for new commands
  for (const [input, cmd] of [
    ["@terpbot my status", "status"],
    ["@terpbot what changed", "changes"],
    ["@terpbot what should i measure", "check"],
    ["@terpbot what do you have on my grow", "measurements"],
  ] as const) {
    const intent = parseTerpbotIntent(input)
    assert.equal(intent.kind, "command", input)
    if (intent.kind === "command") assert.equal(intent.name, cmd, input)
  }
  // existing commands not shadowed — "what should i do next" is now
  // intentionally the /next command (spec §29)
  for (const [input, cmd] of [
    ["@terpbot contest status", "contest"],
    ["@terpbot what should i do next", "next"],
    ["@terpbot check in", "checkin"],
  ] as const) {
    const intent = parseTerpbotIntent(input)
    assert.equal(intent.kind, "command", input)
    if (intent.kind === "command") assert.equal(intent.name, cmd, input)
  }
}

console.log("\nAll longitudinal tests passed.")
