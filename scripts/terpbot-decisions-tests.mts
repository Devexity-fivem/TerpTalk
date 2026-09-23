// TerpBot 2.0 Phase J — deterministic cultivation decision engine tests
// (pure, no DB).
//
// Behavioral coverage:
//   HOLD — stable grows produce a first-class "no change" answer
//   WAIT — pending interventions produce cooldown + a follow-up VERIFY
//   MONITOR — recent untracked changes + improving symptoms + stacking
//   VERIFY — intervention follow-up, baseline shift
//   ADJUST — allowlist gate: reversible env only, never feed/flush/chem
//   feasibility — setup capabilities shape ADJUST feasibility; excluded
//     steps never surface; outdoor field-adjusts are not_available
//   ranking — deterministic total order; VERIFY > WAIT; ADJUST last
//   episodes — improving → MONITOR; recurred → compare-prior OBSERVE
//   data quality — no diary / unknown stage / empty grow → LOG/OBSERVE
//   adversarial — stale candidate, many weak candidates, multiple
//     interventions, deleted/no-diary
//   (private-scope coverage lives in terpbot-pipeline-tests — this
//     suite is pure and cannot exercise the DB scope boundary)
//   loop prevention — after the follow-up lands, the decision moves on
//   renderers — /next bounded; /check consumes the same set; intents
//   gate centralization — renderIntelLines suppresses Suggested on
//     pending intervention (the H7 divergence class)
//
// Run: npx tsx scripts/terpbot-decisions-tests.mts

import { strict as assert } from "node:assert"
import { detectTrend, detectChange, seriesStats } from "@/lib/terpbot-intel-calc"
import {
  evaluateContext,
  isAdjustSafe,
  nextActions,
  pendingInterventions,
  recentInterventions,
  interventionState,
  renderIntelLines,
  ADJUST_ELIGIBLE,
} from "@/lib/terpbot-intel"
import { buildSnapshot } from "@/lib/terpbot-intel-snapshot"
import {
  ADJUST_NEED,
  buildCultivationDecisions,
  decisionLine,
  topAskableMetric,
  type CultivationDecisionSet,
} from "@/lib/terpbot-intel-decisions"
import { renderCheck, renderChanges, renderNext, renderPlan, renderStatus, snapshotFrom } from "@/lib/terpbot-intel-status"
import { activeChecklist } from "@/lib/terpbot-intel-checklist"
import { CANDIDATES, KNOWLEDGE_VERSION } from "@/lib/terpbot-intel-knowledge"
import { parseTerpbotIntent } from "@/lib/terpbot-intents"
import { getChatCommand } from "@/lib/chat-commands"
import { mergeSessionState } from "@/lib/terpbot-intel-merge"
import { episodesFromObservations } from "@/lib/terpbot-intel-episodes"
import type {
  CandidateResult,
  Diagnosis,
  GrowContextView,
  IntelSeries,
  InterventionRecord,
} from "@/lib/terpbot-intel-types"

const DAY = 86400000
const t0 = Date.UTC(2025, 0, 1)
const NOW = t0 + 40 * DAY

// ── Fixtures ────────────────────────────────────────────────────────

const emptySeries: IntelSeries = {
  n: 0, latest: null, mean: null, min: null, max: null,
  medianIntervalDays: null, points: [], trend: "insufficient",
}

// series whose newest point lands 1d before NOW — fresh, current data
const freshSeries = (vals: number[], eps: number, stepMs = DAY): IntelSeries => {
  const points = vals.map((v, i) => ({ t: NOW - (vals.length - i) * stepMs, v }))
  return { ...seriesStats(points), points, trend: detectTrend(points, eps) }
}
// series ending daysAgo before NOW — stale-able fixtures
const agedSeries = (vals: number[], eps: number, endDaysAgo: number): IntelSeries => {
  const points = vals.map((v, i) => ({ t: NOW - endDaysAgo * DAY - (vals.length - 1 - i) * DAY, v }))
  return { ...seriesStats(points), points, trend: detectTrend(points, eps) }
}

const mkCtx = (over: Partial<GrowContextView> = {}): GrowContextView => ({
  scope: "public",
  diary: {
    id: "d1", slug: "d1-slug", title: "Test", stage: "FLOWER", visibility: "PUBLIC",
    startDate: new Date(t0), harvested: false,
    mediumType: "COCO", lightType: "LED", growType: "INDOOR", techniques: [],
  },
  setup: { present: false, medium: null, capabilities: [] },
  now: NOW,
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

const withSeries = (
  over: Partial<GrowContextView["series"]>,
  ctxOver: Partial<GrowContextView> = {}
) => mkCtx({ series: { ...mkCtx().series, ...over }, ...ctxOver })

const iv = (over: Partial<InterventionRecord>): InterventionRecord => ({
  type: "RH_DOWN",
  at: NOW - 2 * DAY,
  ...over,
})

/** Hand-built diagnosis — isolates the gate/ranking from rule details. */
const mkCandidate = (over: Partial<CandidateResult>): CandidateResult => ({
  id: "humidity_high",
  name: "High humidity",
  domain: "environment",
  kind: "condition",
  severity: "moderate",
  state: "strong",
  forScore: 5,
  againstScore: 0,
  independentSignals: 2,
  signals: [],
  supporting: [],
  opposing: [],
  info: [],
  ruleIds: [],
  requiredMissing: [],
  sourceIds: [],
  ...over,
})
const mkDiag = (candidates: CandidateResult[] = []): Diagnosis => ({ candidates, findings: [] })

const decisions = (ctx: GrowContextView) => buildCultivationDecisions(buildSnapshot(ctx))
const klass = (set: CultivationDecisionSet) => set.top.class

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ✓ ${name}`) }

function run() {
  // ══ 1. Registry hygiene + allowlist content safety ══════════════
  {
    const SAFE_DOMAINS = new Set(["environment", "postharvest"])
    for (const id of ADJUST_ELIGIBLE) {
      assert.ok(CANDIDATES[id], `ADJUST_ELIGIBLE id "${id}" must exist in CANDIDATES`)
      const def = CANDIDATES[id]
      assert.ok(def.recommendedActions[0], `${id} needs a first authored action`)
      assert.notEqual(def.severity, "urgent", `${id} must not be urgent — the gate would never fire`)
      // Content safety: only reversible environmental/procedural moves.
      // A disease/chemistry/nutrition/pest candidate on this list means
      // an unsafe action can ship — fail loudly if one ever lands here.
      assert.ok(
        SAFE_DOMAINS.has(def.domain),
        `${id} domain "${def.domain}" is not an allowlist-safe domain`
      )
    }
    // Membership is pinned — a new entry must be deliberately added
    // AND justified against the safety contract, not slipped in.
    assert.deepEqual(
      [...ADJUST_ELIGIBLE].sort(),
      [
        "env.cold-stress", "env.dry-quality-risk", "heat_stress",
        "humidity_high", "humidity_low", "post.cure-moisture",
        "post.dry-too-fast", "wind_or_dry",
      ],
      "ADJUST_ELIGIBLE membership changed — justify the new entry's reversibility"
    )
    // ADJUST_NEED (feasibility table) is keyed off the same ids — a stale
    // entry there would outlive a removed allowlist member.
    for (const id of Object.keys(ADJUST_NEED)) {
      assert.ok(ADJUST_ELIGIBLE.has(id), `ADJUST_NEED key "${id}" is not in ADJUST_ELIGIBLE — drift`)
    }
    ok("ADJUST_ELIGIBLE ⊆ CANDIDATES, non-urgent, safe domains, pinned")
  }

  // ══ 2. Determinism ══════════════════════════════════════════════
  {
    const ctx = withSeries({ humidity: freshSeries([68, 70, 72, 73], 4) })
    const a = decisions(structuredClone(ctx))
    const b = decisions(structuredClone(ctx))
    assert.equal(JSON.stringify(a), JSON.stringify(b), "identical snapshot → identical set")
    ok("determinism — same snapshot, same decisions")
  }

  // ══ 3. HOLD — stable grow produces "nothing needs changing" ══════
  {
    const ctx = withSeries(
      {
        temperature: freshSeries([72, 73, 72, 73], 2),
        humidity: freshSeries([55, 56, 55, 56], 3),
        ph: freshSeries([5.9, 6.0], 0.15),
        ec: freshSeries([1.2, 1.3], 0.3),
      },
      { diary: { ...mkCtx().diary, stage: "VEGETATIVE" }, stageDays: 20 }
    )
    const set = decisions(ctx)
    assert.equal(klass(set), "HOLD", `stable grow → HOLD, got ${klass(set)}`)
    assert.equal(set.posture, "stable")
    assert.match(decisionLine(set.top), /no change/i)
    assert.equal(set.decisions.length, 1)
    ok("stable grow → HOLD 'no change needed'")
  }

  // ══ 4. Pending intervention → WAIT + follow-up VERIFY + wait posture
  {
    const ctx = withSeries(
      { humidity: agedSeries([74, 73], 4, 9) }, // last reading 9d ago, before the intervention
      { interventions: [iv({ type: "RH_DOWN", targetMetric: "humidity", direction: "down", at: NOW - 2 * DAY, eventT: NOW - 2 * DAY })] }
    )
    const set = decisions(ctx)
    const wait = set.decisions.find((d) => d.class === "WAIT")
    assert.ok(wait, "pending intervention → WAIT decision exists")
    assert.match(wait!.waitingOn ?? "", /humidity/i)
    const followup = set.decisions.find((d) => d.class === "VERIFY" && d.stepId === "humidity")
    assert.ok(followup, "pending intervention → follow-up VERIFY on the target")
    // the follow-up IS the next step — VERIFY outranks WAIT so /next
    // answers with the action, not just "wait"
    assert.equal(klass(set), "VERIFY")
    assert.equal(set.posture, "wait", "cooldown → wait posture")
    assert.ok(set.waitingOn.length >= 1)
    assert.match(set.top.whyFirst ?? "", /evaluates the change/i)
    ok("pending intervention → VERIFY follow-up + WAIT context + wait posture")
  }

  // ══ 5. Answered intervention → no WAIT, no cooldown ══════════════
  {
    const ctx = withSeries(
      { humidity: freshSeries([74, 73, 68, 62], 4) },
      { interventions: [iv({ type: "RH_DOWN", targetMetric: "humidity", at: NOW - 3 * DAY, eventT: NOW - 3 * DAY })] }
    )
    const snap = buildSnapshot(ctx)
    assert.equal(snap.interventions[0].state, "answered")
    const set = buildCultivationDecisions(snap)
    assert.ok(!set.decisions.some((d) => d.class === "WAIT"), "answered → no WAIT")
    assert.equal(set.posture !== "wait", true)
    ok("answered intervention → no cooldown")
  }

  // ══ 6. Lapsed intervention → history, not a live gate ════════════
  {
    const ctx = mkCtx({
      interventions: [iv({ type: "RH_DOWN", targetMetric: "humidity", at: NOW - 10 * DAY, eventT: NOW - 10 * DAY })],
    })
    const snap = buildSnapshot(ctx)
    assert.equal(snap.interventions[0].state, "lapsed")
    const set = buildCultivationDecisions(snap)
    assert.ok(!set.decisions.some((d) => d.class === "WAIT"), "lapsed → no WAIT")
    ok("lapsed intervention (>7d unanswered) → not a live gate")
  }

  // ══ 7. Recent untracked intervention → MONITOR cooldown ══════════
  {
    const ctx = mkCtx({
      interventions: [iv({ type: "LIGHT_RAISED", targetMetric: undefined, at: NOW - 1 * DAY })],
    })
    const snap = buildSnapshot(ctx)
    assert.equal(snap.interventions[0].state, "untracked", "no targetMetric → untracked")
    const set = buildCultivationDecisions(snap)
    const mon = set.decisions.find((d) => d.class === "MONITOR")
    assert.ok(mon, "untracked recent change → MONITOR")
    assert.match(mon!.reason, /observation/i)
    // and it suppresses ADJUST at the gate even with a strong candidate
    const diag = mkDiag([mkCandidate({})])
    assert.equal(isAdjustSafe(ctx, diag), false, "recent change → ADJUST suppressed")
    ok("untracked recent intervention → MONITOR + ADJUST suppressed")
  }

  // ══ 8. Stacking prevention — multiple recent changes ═════════════
  {
    const ctx = mkCtx({
      interventions: [
        iv({ type: "LIGHT_RAISED", at: NOW - 1 * DAY }),
        iv({ type: "AIRFLOW", at: NOW - 2 * DAY }),
      ],
    })
    const set = decisions(ctx)
    const mon = set.decisions.find((d) => d.class === "MONITOR")
    assert.ok(mon, "two recent changes → stacking MONITOR")
    assert.match(mon!.reason, /one variable at a time/i)
    assert.equal(mon!.signals, 2)
    ok("multiple recent interventions → anti-stacking MONITOR")
  }

  // ══ 9. ADJUST — allowlisted env candidate at STRONG, real rules ═══
  {
    // sustained RH ≥70 with the newest still high, flower stage →
    // env.rh-sustained-high strong + env.rh-flower-high moderate
    const ctx = withSeries({ humidity: freshSeries([72, 73, 74, 71], 4) })
    const diag = evaluateContext(ctx)
    const top = diag.candidates[0]
    assert.equal(top?.id, "humidity_high", `expected humidity_high on top, got ${top?.id}`)
    assert.equal(top?.state, "strong", `expected strong, got ${top?.state}`)
    assert.equal(isAdjustSafe(ctx, diag), true)
    const set = decisions(ctx)
    const adj = set.decisions.find((d) => d.class === "ADJUST")
    assert.ok(adj, "strong allowlisted candidate → ADJUST decision")
    assert.match(adj!.title, /exhaust|dehumidifier/i)
    assert.equal(adj!.strength, "strong")
    // no setup → partially feasible (manual methods exist)
    assert.equal(adj!.feasibility, "partially_feasible")
    // ADJUST ranks below measurement classes — never first
    assert.notEqual(klass(set), "ADJUST")
    ok("strong allowlisted candidate → gated ADJUST, partially_feasible without setup")
  }

  // ══ 10. ADJUST feasibility — setup capabilities shape it ═════════
  {
    const ctx = withSeries(
      { humidity: freshSeries([72, 73, 74, 71], 4) },
      { setup: { present: true, medium: "coco", capabilities: ["dehumidifier"] } }
    )
    const set = decisions(ctx)
    const adj = set.decisions.find((d) => d.class === "ADJUST")
    assert.ok(adj)
    assert.equal(adj!.feasibility, "feasible", "dehumidifier in setup → feasible")
    ok("setup capability → ADJUST feasible")
  }

  // ══ 11. ADJUST — non-allowlisted candidates NEVER adjust ═════════
  {
    // hand-built strong ph_drift — feeding/flush actions must not surface
    const diag = mkDiag([mkCandidate({ id: "ph_drift", name: "pH drift", domain: "chemistry" })])
    const ctx = mkCtx()
    assert.equal(isAdjustSafe(ctx, diag), false, "ph_drift not on allowlist → unsafe")
    const acts = nextActions(ctx, diag)
    assert.ok(!acts.some((a) => a.actionClass === "ADJUST"), "no ADJUST for non-allowlisted")
    // and feed/flush/pest actions likewise
    for (const id of ["nutrient_burn", "salt_buildup", "spider_mites", "nitrogen_def", "root_bound", "overwater"]) {
      const d = mkDiag([mkCandidate({ id, name: id, domain: "nutrition" as never })])
      assert.equal(isAdjustSafe(ctx, d), false, `${id} must never auto-adjust`)
    }
    ok("non-allowlisted candidates (feed/flush/pest/structural) → never ADJUST")
  }

  // ══ 12. ADJUST — pending intervention suppresses (gate + renderer) ═
  {
    const ctx = mkCtx({
      interventions: [iv({ type: "RH_DOWN", targetMetric: "humidity", at: NOW - 2 * DAY })],
    })
    const diag = mkDiag([mkCandidate({})])
    assert.equal(isAdjustSafe(ctx, diag), false, "pending intervention → gate closed")
    // the /checkin renderer uses the same gate — no Suggested line
    const lines = renderIntelLines(ctx, diag)
    assert.ok(!lines.some((l) => /^Suggested:/.test(l)), "renderIntelLines must not bypass the gate")
    ok("pending intervention → ADJUST suppressed in engine AND /checkin renderer")
  }

  // ══ 13. ADJUST — opposing evidence / urgent / weak state blocks ═══
  {
    const ctx = mkCtx()
    assert.equal(
      isAdjustSafe(ctx, mkDiag([mkCandidate({ againstScore: 2 })])),
      false, "opposing evidence → unsafe"
    )
    assert.equal(
      isAdjustSafe(ctx, mkDiag([mkCandidate({ state: "possible" })])),
      false, "possible → measure, not adjust"
    )
    // an urgent-severity candidate can never adjust — the allowlist
    // contains none by construction (asserted in test 1), and a real
    // urgent id like light_burn is doubly excluded
    assert.equal(
      isAdjustSafe(ctx, mkDiag([mkCandidate({ id: "light_burn", name: "Light burn" })])),
      false, "urgent → verify first, always"
    )
    ok("ADJUST gate — opposing/weak/urgent all blocked")
  }

  // ══ 14. Outdoor — field adjustments not_available ════════════════
  {
    const ctx = withSeries(
      { humidity: freshSeries([72, 73, 74, 71], 4) },
      { diary: { ...mkCtx().diary, growType: "OUTDOOR" } }
    )
    const diag = evaluateContext(ctx)
    assert.equal(isAdjustSafe(ctx, diag), false, "outdoor field-adjust → gate closed")
    const set = decisions(ctx)
    assert.ok(!set.decisions.some((d) => d.class === "ADJUST"), "outdoor → no field ADJUST decision")
    ok("outdoor grow → field ADJUST never surfaces")
  }

  // ══ 15. Improving episode → MONITOR ══════════════════════════════
  {
    const ctx = mkCtx({
      episodes: [{
        symptom: "LEAF_SPOTS", status: "improving", firstSeen: NOW - 8 * DAY,
        lastSeen: NOW - 1 * DAY, episodeCount: 1, observations: [],
      }] as never,
    })
    const set = decisions(ctx)
    const mon = set.decisions.find((d) => d.class === "MONITOR")
    assert.ok(mon, "improving episode → MONITOR")
    assert.match(mon!.reason, /not progressed|monitoring/i)
    assert.ok(!set.decisions.some((d) => d.class === "ADJUST"), "improving → never adjust")
    ok("improving symptom → MONITOR (recovery-aware)")
  }

  // ══ 16. Recurred episode → compare-prior OBSERVE ═════════════════
  {
    const ctx = mkCtx({
      episodes: [{
        symptom: "LEAF_SPOTS", status: "recurred", firstSeen: NOW - 20 * DAY,
        lastSeen: NOW - 1 * DAY, episodeCount: 2, observations: [],
      }] as never,
    })
    const set = decisions(ctx)
    const ob = set.decisions.find((d) => d.class === "OBSERVE" && /earlier|previous/i.test(d.reason))
    assert.ok(ob, "recurred episode → compare-with-prior OBSERVE")
    assert.match(ob!.reason, /not proof/i)
    ok("recurrence → compare prior episode (no causation claim)")
  }

  // ══ 17. Missing data → LOG / OBSERVE, not panic ══════════════════
  {
    // no diary at all
    const noDiary = decisions(mkCtx({ diary: { ...mkCtx().diary, id: "" } }))
    assert.ok(noDiary.decisions.some((d) => d.class === "LOG"), "no diary → LOG link-diary")
    // unknown stage
    const noStage = decisions(mkCtx({ diary: { ...mkCtx().diary, stage: "UNKNOWN" } }))
    assert.ok(
      noStage.decisions.some((d) => d.stepId === "inspect:stage"),
      "unknown stage → inspect:stage OBSERVE"
    )
    // empty grow
    const empty = decisions(mkCtx({ updateCount: 0, envCoverage: 0 }))
    assert.ok(empty.decisions.some((d) => d.class === "LOG"), "empty grow → data-collection LOG")
    ok("data quality → LOG/OBSERVE without pretending a plant problem")
  }

  // ══ 17b. Baseline shift → VERIFY (never "the new level is wrong") ═
  {
    const base = [55, 56, 55, 57, 56]
    const recent = [70, 71, 70]
    const points = [...base, ...recent].map((v, i) => ({
      t: NOW - (8 - i) * DAY,
      v,
    }))
    const humidity: IntelSeries = {
      ...seriesStats(points),
      points,
      trend: detectTrend(points, 4),
      change: detectChange(points, 4, { now: NOW }),
    }
    const ctx = withSeries(
      { humidity },
      {
        baselines: {
          humidity: {
            tier: "established", n: 8, distinctDays: 8, windowDays: 9,
            median: 56, lo: 54, hi: 58, ageDays: 1,
          },
        },
      }
    )
    const set = decisions(ctx)
    const v = set.decisions.find((d) => d.class === "VERIFY" && d.stepId === "humidity")
    assert.ok(v, "a real shift vs own baseline → VERIFY")
    assert.match(v!.reason, /intentional|check whether/i)
    assert.ok(!/wrong|problem is|too high/i.test(v!.reason), "baseline is a reference, not a verdict")
    ok("baseline shift → VERIFY without declaring the level wrong")
  }

  // ══ 18. Excluded/unavailable steps never surface (DWC runoff) ════
  {
    const ctx = withSeries(
      { ph: freshSeries([7.2, 7.3, 7.4], 0.15) }, // way out of band → wants runoff
      { diary: { ...mkCtx().diary, mediumType: "DWC" } }
    )
    const set = decisions(ctx)
    assert.ok(
      !set.decisions.some((d) => d.stepId === "runoffPh" || d.stepId === "runoffEc"),
      "DWC → runoff never asked"
    )
    // and nothing unreportable
    for (const d of set.decisions) {
      assert.notEqual(d.feasibility, "not_available", "no not_available decision should render")
    }
    ok("structurally excluded metrics never requested")
  }

  // ══ 19. Ranking — VERIFY beats WAIT, ADJUST last ═════════════════
  {
    const ctx = withSeries(
      { humidity: agedSeries([74, 73], 4, 9) },
      { interventions: [iv({ type: "RH_DOWN", targetMetric: "humidity", at: NOW - 2 * DAY, eventT: NOW - 2 * DAY })] }
    )
    const set = decisions(ctx)
    const classes = set.decisions.map((d) => d.class)
    const vi = classes.indexOf("VERIFY")
    const wi = classes.indexOf("WAIT")
    assert.ok(vi >= 0 && wi >= 0)
    assert.ok(vi < wi, "follow-up VERIFY ranks above its WAIT")
    // determinism of full order
    const again = decisions(structuredClone(ctx))
    assert.deepEqual(classes, again.decisions.map((d) => d.class))
    ok("ranking — follow-up VERIFY above WAIT; order deterministic")
  }

  // ══ 20. Recommendation loop prevention ════════════════════════════
  {
    // State A: pending intervention → follow-up VERIFY on humidity
    const before = decisions(withSeries(
      { humidity: agedSeries([74, 73], 4, 9) },
      { interventions: [iv({ type: "RH_DOWN", targetMetric: "humidity", at: NOW - 2 * DAY, eventT: NOW - 2 * DAY })] }
    ))
    assert.equal(klass(before), "VERIFY")
    // State B: the grower logged the follow-up — the decision MUST move
    // on (answered → no WAIT, no repeat of the same ask)
    const after = decisions(withSeries(
      { humidity: freshSeries([74, 73, 68, 62], 4) },
      { interventions: [iv({ type: "RH_DOWN", targetMetric: "humidity", at: NOW - 3 * DAY, eventT: NOW - 3 * DAY })] }
    ))
    assert.ok(
      !(klass(after) === "VERIFY" && after.top.stepId === "humidity"),
      "same follow-up must not loop after the reading lands"
    )
    ok("no recommendation loops — follow-up lands → decision moves on")
  }

  // ══ 21. Adversarial — many weak candidates, stale top, no overreact ═
  {
    // one vague symptom only → at most measurement-level decisions,
    // never ADJUST, never alarm
    const ctx = mkCtx({
      observations: [{ symptom: "LEAF_SPOTS", t: NOW - DAY } as never],
    })
    const set = decisions(ctx)
    assert.ok(!set.decisions.some((d) => d.class === "ADJUST"), "weak evidence → no ADJUST")
    assert.ok(set.decisions.length <= 6, "bounded output")
    // a stale intervention + stale series must not produce phantom WAIT
    const staleCtx = mkCtx({
      interventions: [iv({ type: "RH_DOWN", targetMetric: "humidity", at: NOW - 30 * DAY, eventT: NOW - 30 * DAY })],
    })
    const staleSet = decisions(staleCtx)
    assert.ok(!staleSet.decisions.some((d) => d.class === "WAIT"), "30d-old intervention → no WAIT")
    ok("adversarial — weak evidence and stale state produce no overreaction")
  }

  // ══ 22. topAskableMetric — pendingAsk binding ═════════════════════
  {
    const pending = decisions(withSeries(
      { humidity: agedSeries([74, 73], 4, 9) },
      { interventions: [iv({ type: "RH_DOWN", targetMetric: "humidity", at: NOW - 2 * DAY, eventT: NOW - 2 * DAY })] }
    ))
    assert.equal(topAskableMetric(pending), "humidity", "follow-up metric is the askable one")
    const hold = decisions(withSeries(
      {
        temperature: freshSeries([72, 73, 72, 73], 2),
        humidity: freshSeries([55, 56, 55, 56], 3),
      },
      { diary: { ...mkCtx().diary, stage: "VEGETATIVE" } }
    ))
    assert.equal(topAskableMetric(hold), null, "HOLD → no pendingAsk")
    ok("topAskableMetric — reportable step only, null on HOLD")
  }

  // ══ 23. Renderers — /next bounded, consumes same set ═════════════
  {
    const ctx = withSeries(
      { humidity: agedSeries([74, 73], 4, 9) },
      { interventions: [iv({ type: "RH_DOWN", targetMetric: "humidity", at: NOW - 2 * DAY, eventT: NOW - 2 * DAY })] }
    )
    const set = decisions(ctx)
    const lines = renderNext(set)
    assert.ok(lines.length <= 4, "/next is compact")
    assert.match(lines[0], /^➡ Next:/)
    assert.ok(lines.some((l) => /^Why first:/.test(l)), "why-first always present")
    assert.ok(lines.some((l) => /^Waiting on:/.test(l)), "waitingOn surfaces")
    // /check consumes the same set
    const check = renderCheck(set)
    assert.ok(check.some((l) => /1\./.test(l)))
    // /status takes the decision set — priority + waitingOn lines
    const status = renderStatus(ctx, evaluateContext(ctx), set)
    assert.ok(status.some((l) => /^Next: /.test(l)))
    // /plan top-priority section
    const snap = buildSnapshot(ctx)
    const plan = renderPlan(snap, activeChecklist(snap), set)
    assert.ok(plan.some((l) => /^Top priority:/.test(l)), "/plan shows top priority")
    assert.ok(plan.some((l) => /^Waiting on:/.test(l)))
    // HOLD renders calm
    const holdSet = decisions(withSeries(
      {
        temperature: freshSeries([72, 73, 72, 73], 2),
        humidity: freshSeries([55, 56, 55, 56], 3),
      },
      { diary: { ...mkCtx().diary, stage: "VEGETATIVE" } }
    ))
    assert.match(renderNext(holdSet)[0], /no change/i)
    ok("renderers — /next, /check, /status, /plan consume the decision set")
  }

  // ══ 23b. /changes — diary-attributed diff + decision layer ═══════
  {
    const before = withSeries({ temperature: freshSeries([70, 71, 70, 71], 2) })
    const prev = snapshotFrom(before, evaluateContext(before), NOW - 3 * DAY)
    // delta on temperature; a pending RH_DOWN keeps a follow-up VERIFY
    // live (humidity's newest point predates the reported change)
    const after = withSeries(
      {
        temperature: freshSeries([70, 71, 70, 78], 2),
        humidity: agedSeries([72, 73, 74], 4, 4),
      },
      { interventions: [iv({ type: "RH_DOWN", targetMetric: "humidity", at: NOW - 2 * DAY, eventT: NOW - 2 * DAY })] }
    )
    const set = decisions(after)
    const lines = renderChanges(after, evaluateContext(after), prev, set)
    const text = lines.join("\n")
    assert.match(text, /→/, "the delta is shown")
    assert.match(text, /Worth verifying:/, "decision layer contributes the verify pointer")
    // a snapshot from a DIFFERENT diary must never diff — privacy guard
    const other = snapshotFrom(
      mkCtx({ diary: { ...mkCtx().diary, id: "d2" } }),
      evaluateContext(mkCtx({ diary: { ...mkCtx().diary, id: "d2" } })),
      NOW - 3 * DAY
    )
    assert.match(
      renderChanges(after, evaluateContext(after), other, set).join(""),
      /No earlier snapshot/,
      "mismatched-diary snapshot rejected"
    )
    ok("/changes — delta + verify pointer + diary-attribution guard")
  }

  // ══ 24. Intents + registry — /next reachable, no collisions ══════
  {
    assert.ok(getChatCommand("next"), "/next registered")
    const cmd = getChatCommand("next")!
    assert.equal(cmd.permission, "public")
    for (const [text, name] of [
      ["next", "next"],
      ["what should i do next", "next"],
      ["what's the next step", "next"],
      ["what now", "next"],
      ["what should i check", "check"],
      ["what's the plan for my grow", "plan"],
      ["my grow", "grow"],
    ] as [string, string][]) {
      const i = parseTerpbotIntent(`@terpbot ${text}`)
      assert.equal(
        i.kind === "command" ? i.name : i.kind,
        name,
        `"${text}" should route to ${name}, got ${JSON.stringify(i)}`
      )
    }
    ok("intents — /next routes; check/plan/grow unaffected")
  }

  // ══ 25. Intervention state — canonical helper contract ═══════════
  {
    const base = iv({ type: "RH_DOWN", targetMetric: "humidity", at: NOW - 2 * DAY, eventT: NOW - 2 * DAY })
    // no series at all → untracked? no — humidity series EXISTS in ctx
    // (empty series → no after-points → pending within window)
    const ctxPending = mkCtx({ interventions: [base] })
    assert.equal(interventionState(ctxPending, base), "pending")
    assert.equal(pendingInterventions(ctxPending).length, 1)
    // after-reading → answered
    const ctxAnswered = withSeries(
      { humidity: freshSeries([70, 65], 4) },
      { interventions: [base] }
    )
    assert.equal(interventionState(ctxAnswered, base), "answered")
    // >7d → lapsed
    const old = iv({ ...base, at: NOW - 9 * DAY, eventT: NOW - 9 * DAY })
    assert.equal(interventionState(mkCtx({ interventions: [old] }), old), "lapsed")
    // untracked — no targetMetric
    const light = iv({ type: "LIGHT_RAISED", targetMetric: undefined, at: NOW - DAY })
    assert.equal(interventionState(mkCtx({ interventions: [light] }), light), "untracked")
    // pastUnresolved → untracked (history, not a live change)
    const past = iv({ ...base, pastUnresolved: true })
    assert.equal(interventionState(mkCtx({ interventions: [past] }), past), "untracked")
    // recentInterventions catches untargeted
    assert.equal(recentInterventions(mkCtx({ interventions: [light] }), 3).length, 1)
    ok("interventionState — pending/answered/lapsed/untracked contract")
  }

  // ══ 26. Knowledge version pin ════════════════════════════════════
  {
    assert.equal(KNOWLEDGE_VERSION, "2.6")
    ok("knowledge version 2.6")
  }

  // ══ 27. HOLD — stable sparse-data grow is not given a chore ══════
  {
    // Text/photo-only logger: low envCoverage, quiet diary, nothing live.
    // The sparse-env gap finding exists but is insufficient-state — it
    // must not circularly justify a LOG.
    const sparse = mkCtx({
      diary: { ...mkCtx().diary, stage: "VEGETATIVE" },
      stageDays: 20,
      envCoverage: 0.3,
    })
    assert.equal(klass(decisions(sparse)), "HOLD", "stable sparse grow → HOLD, not manufactured LOG")
    // A covered but quiet (≥4d) grow holds too.
    const quiet = mkCtx({
      diary: { ...mkCtx().diary, stage: "VEGETATIVE" },
      stageDays: 20,
      daysSinceUpdate: 6,
    })
    assert.equal(klass(decisions(quiet)), "HOLD", "stable quiet grow → HOLD")
    ok("stable sparse/quiet grows → HOLD, no manufactured logging chore")
  }

  // ══ 28. LOG stays purposeful when data blocks live reasoning ═════
  {
    const ctx = mkCtx({
      diary: { ...mkCtx().diary, stage: "VEGETATIVE" },
      stageDays: 20,
      envCoverage: 0.3,
      interventions: [iv({ type: "RH_DOWN", targetMetric: "humidity", at: NOW - 2 * DAY })],
    })
    const set = decisions(ctx)
    assert.ok(
      set.decisions.some((d) => d.class === "LOG"),
      "sparse data + pending intervention → LOG is purposeful and stays"
    )
    assert.notEqual(klass(set), "HOLD")
    ok("sparse data + live work → LOG retained (purposeful collection)")
  }

  // ══ 29. Action memory — attempted adjustment is not re-suggested ═
  {
    const strongRh = { humidity: freshSeries([72, 73, 74, 71], 4) }
    // Control: no attempt → the adjustment IS suggested.
    const fresh = decisions(withSeries(strongRh))
    assert.ok(fresh.decisions.some((d) => d.class === "ADJUST"), "control: fresh suggestion fires")
    // An untracked AIRFLOW attempt 5d ago is past the 3d gate — without
    // memory this is the exact adjust→wait→adjust loop.
    const tried = decisions(
      withSeries(strongRh, {
        interventions: [iv({ type: "AIRFLOW", targetMetric: undefined, at: NOW - 5 * DAY })],
      })
    )
    assert.ok(
      !tried.decisions.some((d) => d.class === "ADJUST"),
      "recently-attempted adjustment must not resurface unchanged"
    )
    const verify = tried.decisions.find(
      (d) => d.class === "VERIFY" && d.stepId === "humidity"
    )
    assert.ok(verify, "attempted + unfollowed → VERIFY the skipped follow-up")
    assert.match(verify!.reason, /never logged a follow-up|before adjusting again/i)
    ok("action memory — attempted adjustment → VERIFY, not repeat ADJUST")
  }

  // ══ 30. Re-suggestion — new contradictory evidence re-enables ════
  {
    // Same attempt as #29, but humidity has now drifted UP vs the
    // grow's own baseline — new evidence, the suggestion is live again.
    const points = [...[55, 56, 55], ...[72, 73, 74, 71, 73]].map((v, i) => ({
      t: NOW - (8 - i) * DAY,
      v,
    }))
    const humidity: IntelSeries = {
      ...seriesStats(points),
      points,
      trend: detectTrend(points, 4),
      change: detectChange(points, 4, { now: NOW }),
    }
    const ctx = withSeries(
      { humidity },
      {
        interventions: [iv({ type: "AIRFLOW", targetMetric: undefined, at: NOW - 5 * DAY })],
        baselines: {
          humidity: {
            tier: "established", n: 8, distinctDays: 8, windowDays: 9,
            median: 56, lo: 54, hi: 58, ageDays: 1,
          },
        },
      }
    )
    assert.equal(
      ctx.series.humidity.change?.direction, "up",
      "fixture sanity — adverse drift present"
    )
    const set = decisions(ctx)
    assert.ok(
      set.decisions.some((d) => d.class === "ADJUST"),
      "adverse drift after the attempt → re-suggestion is justified"
    )
    ok("action memory — new adverse evidence re-enables the adjustment")
  }

  // ══ 31. whyFirst — explains the runner-up deferral ═══════════════
  {
    const ctx = mkCtx({
      interventions: [iv({ type: "RH_DOWN", targetMetric: "humidity", at: NOW - 2 * DAY })],
    })
    const set = decisions(ctx)
    assert.equal(klass(set), "VERIFY", "pending intervention → follow-up VERIFY first")
    const runnerUp = set.decisions[1]
    assert.ok(runnerUp, "a runner-up exists to defer")
    // The top must say WHY it outranks — a second clause naming what
    // was deferred, not just the class template.
    const wf = set.top.whyFirst ?? ""
    assert.ok(/;/.test(wf), "whyFirst carries the runner-up clause")
    assert.match(
      wf,
      /measurement|waiting|verification|adjustment|direct look|monitoring|logging|holding|comparison/i,
      "whyFirst names the deferred runner-up"
    )
    ok("whyFirst — top decision explains the runner-up deferral")
  }

  // ══ 32. Episodes derived once in mergeSessionState ═══════════════
  {
    const ctx = mergeSessionState(
      mkCtx(),
      {
        reported: [],
        observations: [
          { symptom: "LEAF_YELLOWING", t: NOW - 9 * DAY },
          { symptom: "LEAF_YELLOWING", t: NOW - 5 * DAY },
          { symptom: "SPOTS", t: NOW - 1 * DAY },
        ],
        resolutions: [],
        interventions: [],
      },
      NOW
    )
    assert.ok(ctx.episodes, "merged context carries derived episodes")
    assert.deepEqual(
      ctx.episodes,
      episodesFromObservations(ctx.observations, ctx.resolutions ?? []),
      "ctx.episodes is the canonical derivation — no second pass needed"
    )
    // evaluateContext consumes ctx.episodes (identical output either way).
    const a = evaluateContext(ctx)
    const b = evaluateContext({ ...ctx, episodes: undefined })
    assert.equal(JSON.stringify(a), JSON.stringify(b), "precomputed vs derived episodes → identical diagnosis")
    ok("episodes — derived once at merge, reused downstream")
  }
}

run()
console.log(`\n${passed} passed`)
