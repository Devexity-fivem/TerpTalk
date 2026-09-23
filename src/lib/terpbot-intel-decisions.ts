// TerpBot intelligence — deterministic cultivation decision engine (Phase J).
//
// THE canonical answer to "given everything known about this grow, what
// should the grower do next — and why". Derived purely from the Grow
// Intelligence Snapshot — no I/O, no randomness, no raw user text, no
// re-evaluation. /next, /check, /plan, /status, /changes and the
// BOT_ASSIST scan all consume this one set instead of re-deriving
// priorities (Phase J audit: four parallel next-step selectors and five
// pending-intervention implementations existed before this module).
//
// Decision classes, in ranked order (CLASS_RANK below):
//   COMPARE — resolve a live evidence dispute; it blocks everything else
//   VERIFY  — re-measure stale data, or evaluate a reported change
//   MEASURE — highest-value missing input
//   OBSERVE — a visual inspection
//   WAIT    — pending intervention; time is the discriminator
//   MONITOR — recovery/cooldown watch; observe, don't change
//   ADJUST  — allowlisted low-risk environmental move at STRONG only
//   LOG     — the data itself is the bottleneck
//   HOLD    — nothing needs changing right now (a first-class answer)

import { MEASUREMENT_INFO, INSPECTION_INFO, FIELD_ADJUST } from "@/lib/terpbot-intel"
import { REPORTABLE_METRICS } from "@/lib/terpbot-intel-merge"
import { SYMPTOM_LABELS } from "@/lib/terpbot-nl-vocab"
import {
  capabilityOf,
  type GrowIntelligenceSnapshot,
  type SnapshotIntervention,
} from "@/lib/terpbot-intel-snapshot"
import type {
  ActionRequest,
  MetricId,
  NextStepId,
  RiskTier,
} from "@/lib/terpbot-intel-types"

// ── Types ───────────────────────────────────────────────────────────

export type DecisionClass =
  | "COMPARE"
  | "VERIFY"
  | "MEASURE"
  | "OBSERVE"
  | "WAIT"
  | "MONITOR"
  | "ADJUST"
  | "LOG"
  | "HOLD"

/** Explicit feasibility — spec §11. Capabilities modify what the grower
 *  can do; they never change the diagnosis. */
export type DecisionFeasibility =
  | "feasible" // series data or a matching setup capability exists
  | "partially_feasible" // manual/procedural path exists, no equipment evidence
  | "not_available" // structurally excluded (outdoor env control, DWC runoff)
  | "unknown" // no evidence either way — missing data ≠ missing equipment

export type DecisionStrength = "strong" | "moderate" | "weak" | "none"

export interface CultivationDecision {
  class: DecisionClass
  /** metric or inspect:* id when the decision asks for data */
  stepId?: NextStepId
  /** canonical one-line ask — canonical labels only, never raw text */
  title: string
  /** why this decision exists at all */
  reason: string
  /** why this is FIRST — set on the top decision after ranking */
  whyFirst?: string
  /** WAIT: what unblocks the cooldown */
  waitingOn?: string
  /** declared evidence level — never a fake probability */
  strength: DecisionStrength
  /** independent signals backing the decision */
  signals: number
  feasibility: DecisionFeasibility
  candidateIds: string[]
  riskTier: RiskTier
  /** VERIFY: the reading evaluates a reported intervention (vs stale
   *  data) — phrasing and posture differ */
  evaluatesIntervention?: boolean
}

/** The overall stance — derived from the top decision, not from a
 *  count of problems. "wait" means a change is still being evaluated;
 *  "stable" means the honest answer is nothing-needs-changing. */
export type DecisionPosture = "act" | "wait" | "monitor" | "collect" | "stable"

export interface CultivationDecisionSet {
  posture: DecisionPosture
  /** always non-null — HOLD when there is nothing meaningful to do */
  top: CultivationDecision
  /** ranked, ≤6 */
  decisions: CultivationDecision[]
  /** what the engine is waiting for ("a humidity reading", …) */
  waitingOn: string[]
}

// ── Ranking ─────────────────────────────────────────────────────────
// Fixed class precedence, documented rather than opaque:
//   1. COMPARE — a live dispute blocks all other reasoning
//   2. VERIFY  — stale data and intervention follow-ups: the result of
//      the LAST change must be known before the next one is suggested
//   3. MEASURE — highest-value missing input
//   4. OBSERVE — inspections
//   5. WAIT    — cooldown context (ranks below the follow-up it needs,
//      so /next answers with the follow-up action, not just "wait")
//   6. MONITOR — recovery/settling watch
//   7. ADJUST  — deliberately last: a change is recommended only after
//      measurement and verification have had their say
//   8. LOG     — data collection
//   9. HOLD    — nothing needs changing

const CLASS_RANK: Record<DecisionClass, number> = {
  COMPARE: 0,
  VERIFY: 1,
  MEASURE: 2,
  OBSERVE: 3,
  WAIT: 4,
  MONITOR: 5,
  ADJUST: 6,
  LOG: 7,
  HOLD: 8,
}

const MAX_DECISIONS = 6

// ── Labels ──────────────────────────────────────────────────────────

const metricLabel = (m: string) => MEASUREMENT_INFO[m as MetricId]?.label ?? m
const stepLabel = (id: string) =>
  id.startsWith("inspect:")
    ? INSPECTION_INFO[id]?.label ?? "inspection"
    : metricLabel(id)

const symptomLabel = (s: string) =>
  SYMPTOM_LABELS[s as keyof typeof SYMPTOM_LABELS] ?? s.toLowerCase().replace(/_/g, " ")

/** Canonical intervention ids → short render-safe labels. Unknown ids
 *  degrade to a lowercased enum — still canonical, never raw text. */
const IV_LABELS: Record<string, string> = {
  RH_DOWN: "humidity change",
  RH_UP: "humidity change",
  TEMP_DOWN: "temperature change",
  TEMP_UP: "temperature change",
  EC_DOWN: "feed-strength change",
  EC_UP: "feed-strength change",
  PH_ADJUST: "pH correction",
  LIGHT_RAISED: "light move",
  LIGHT_LOWERED: "light move",
  LIGHT_DIMMED: "light dimming",
  LIGHT_BRIGHTER: "light intensity change",
  WATER_LESS: "watering change",
  WATER_MORE: "watering change",
  FLUSH: "flush",
  AIRFLOW: "airflow change",
  DEFOLIATE: "leaf removal",
  REPOT: "transplant",
  PEST_ACTION: "pest response",
}
const ivLabel = (iv: SnapshotIntervention) =>
  IV_LABELS[iv.type] ?? iv.type.toLowerCase().replace(/_/g, " ")

const ageText = (d: number) => (d <= 0 ? "today" : `${d}d ago`)

// ── Feasibility ─────────────────────────────────────────────────────

function stepFeasibility(snap: GrowIntelligenceSnapshot, stepId: NextStepId): DecisionFeasibility {
  const cap = capabilityOf(snap, stepId)
  if (!cap) return "unknown"
  switch (cap.feasibility) {
    case "proven":
    case "plausible":
      return "feasible"
    case "excluded":
    case "unreportable":
      return "not_available"
    default:
      return "unknown"
  }
}

/** What the grow needs in order to perform each allowlisted adjustment.
 *  Any-of semantics: one matching capability makes it feasible; none
 *  leaves it partially_feasible (manual paths exist — opening a vent,
 *  moving a fan — but there's no equipment evidence). */
export const ADJUST_NEED: Record<string, string[]> = {
  heat_stress: [], // raising/dimming a fixture needs no claimed equipment
  humidity_high: ["humidity-down", "airflow"],
  humidity_low: ["humidity-up"],
  wind_or_dry: ["airflow"],
  "env.cold-stress": [], // insulation/heat mat — procedural
  "env.dry-quality-risk": ["humidity-down", "humidity-up"],
  "post.dry-too-fast": ["humidity-up"],
  "post.cure-moisture": [], // burping jars — procedural
}

// FIELD_ADJUST is imported from intel.ts — single source so the gate
// and this feasibility label can never drift apart.

function adjustFeasibility(snap: GrowIntelligenceSnapshot, candidateId: string): DecisionFeasibility {
  if (snap.setup.growType === "OUTDOOR" && FIELD_ADJUST.has(candidateId)) return "not_available"
  const need = ADJUST_NEED[candidateId] ?? []
  if (!need.length) return "partially_feasible"
  const have = new Set(snap.setup.adjusts.map((a) => a.id))
  return need.some((n) => have.has(n)) ? "feasible" : "partially_feasible"
}

// ── Action memory ───────────────────────────────────────────────────
// A reported intervention IS the memory of "this was already tried".
// Without it the engine loops: adjust → wait → adjust the same thing
// → wait → …  14d is the memory window — older attempts are stale
// context, not a live constraint. This is not a permanent suppression
// and not an ever-growing cooldown: fresh contradictory evidence
// re-opens the suggestion immediately.

const ATTEMPT_MEMORY_DAYS = 14

/** Which intervention vocabulary constitutes "this adjustment was
 *  already tried" for each allowlisted candidate, plus the metric
 *  whose adverse drift counts as NEW evidence re-opening it. */
const ADJUST_ATTEMPTS: Record<
  string,
  { ivTypes: string[]; metric?: MetricId; adverse?: "up" | "down" }
> = {
  heat_stress: {
    ivTypes: ["TEMP_DOWN", "LIGHT_RAISED", "LIGHT_DIMMED"],
    metric: "temperature",
    adverse: "up",
  },
  humidity_high: {
    ivTypes: ["RH_DOWN", "AIRFLOW"],
    metric: "humidity",
    adverse: "up",
  },
  humidity_low: { ivTypes: ["RH_UP"], metric: "humidity", adverse: "down" },
  wind_or_dry: { ivTypes: ["AIRFLOW"], metric: "humidity", adverse: "down" },
  "env.cold-stress": {
    ivTypes: ["TEMP_UP"],
    metric: "temperature",
    adverse: "down",
  },
  "env.dry-quality-risk": {
    ivTypes: ["RH_DOWN", "RH_UP", "TEMP_DOWN", "TEMP_UP"],
  },
  "post.dry-too-fast": { ivTypes: ["RH_UP"], metric: "humidity", adverse: "down" },
  "post.cure-moisture": { ivTypes: ["AIRFLOW"] },
}

/** If this adjustment was already attempted recently, returns the
 *  decision that should REPLACE it — a different discriminator, never
 *  the same suggestion again. Returns null when the suggestion is
 *  genuinely fresh, or when new evidence (a recurred episode, or an
 *  adverse drift on the target metric after the attempt) justifies
 *  re-suggesting it. */
function adjustmentRetry(
  snap: GrowIntelligenceSnapshot,
  candidateId: string
): CultivationDecision | null {
  const mem = ADJUST_ATTEMPTS[candidateId]
  if (!mem) return null
  const attempt = snap.interventions
    .filter((iv) => mem.ivTypes.includes(iv.type) && iv.ageDays <= ATTEMPT_MEMORY_DAYS)
    .sort((a, b) => a.ageDays - b.ageDays)[0]
  if (!attempt || attempt.state === "pending") return null // fresh, or the cooldown path already owns it

  const recurred = snap.episodes.some((e) => e.status === "recurred")
  const reading = mem.metric
    ? snap.readings.find((r) => r.metric === mem.metric && !r.stale)
    : undefined
  if (recurred || (!!mem.adverse && reading?.changeDirection === mem.adverse))
    return null // new evidence — the suggestion is legitimately live again

  const attemptLabel = ivLabel(attempt)
  const metric = attempt.targetMetric ?? mem.metric
  // Untracked attempts have no targetMetric, so interventionState can
  // never mark them "answered" — but the grower may still have logged
  // the metric after the change. A post-attempt reading IS the
  // follow-up: claiming "never logged" would be factually wrong and
  // would suppress a legitimate suggestion. Route those to the same
  // different-discriminator path as answered attempts.
  const followed =
    attempt.state === "answered" ||
    (!!metric &&
      snap.readings.some((r) => r.metric === metric && r.ageDays < attempt.ageDays))
  if (!followed) {
    // Lapsed/untracked with genuinely no follow-up — the honest next
    // step is the measurement that was skipped, not a repeat.
    const cap = metric ? capabilityOf(snap, metric) : null
    if (
      metric &&
      REPORTABLE_METRICS.has(metric) &&
      cap &&
      cap.feasibility !== "excluded" &&
      cap.feasibility !== "unreportable"
    ) {
      return {
        class: "VERIFY",
        stepId: metric,
        title: `Re-measure ${metricLabel(metric)}`,
        reason:
          `You reported a ${attemptLabel} ${ageText(attempt.ageDays)} but never logged a follow-up ` +
          `${metricLabel(metric)} reading — verify what the change did before adjusting again.`,
        strength: "moderate",
        signals: 1,
        feasibility: stepFeasibility(snap, metric),
        candidateIds: [candidateId],
        riskTier: "none",
        evaluatesIntervention: true,
      }
    }
    return {
      class: "OBSERVE",
      title: `Check the result of your ${attemptLabel}`,
      reason:
        `You reported a ${attemptLabel} ${ageText(attempt.ageDays)} with no logged follow-up — ` +
        `check the response before changing the same variable again.`,
      strength: "moderate",
      signals: 1,
      feasibility: "feasible",
      candidateIds: [candidateId],
      riskTier: "none",
      evaluatesIntervention: true,
    }
  }

  // Answered — the change was measured and the picture still points the
  // same way. Repeating the move needs a DIFFERENT discriminator first:
  // an unmeasured required input, then a plain look for another cause.
  const cand = snap.diagnosis.candidates.find((c) => c.id === candidateId)
  const other = cand?.requiredMissing.find(
    (m) => m !== attempt.targetMetric && snap.missingReportable.includes(m)
  )
  if (other) {
    return {
      class: "MEASURE",
      stepId: other,
      title: `Measure ${metricLabel(other)}`,
      reason:
        `The ${attemptLabel} ${ageText(attempt.ageDays)} didn't resolve this — ` +
        `${metricLabel(other)} is the next discriminator before trying the same adjustment again.`,
      strength: "moderate",
      signals: 1,
      feasibility: stepFeasibility(snap, other),
      candidateIds: [candidateId],
      riskTier: "none",
    }
  }
  return {
    class: "OBSERVE",
    title: "Look for another cause",
    reason:
      `You already tried a ${attemptLabel} ${ageText(attempt.ageDays)} and this still points the same way — ` +
      `inspect the plant and setup for a cause the adjustment couldn't reach before repeating it.`,
    strength: "moderate",
    signals: 1,
    feasibility: "feasible",
    candidateIds: [candidateId],
    riskTier: "none",
  }
}

// ── Action → decision mapping ───────────────────────────────────────

function titleOf(a: ActionRequest): string {
  switch (a.actionClass) {
    case "MEASURE":
      return `Measure ${a.stepId ? stepLabel(a.stepId) : "readings"}`
    case "OBSERVE":
      return `Check ${a.stepId ? stepLabel(a.stepId) : "the plant"}`
    case "COMPARE":
      return `Measure ${a.stepId ? stepLabel(a.stepId) : "readings"}`
    case "VERIFY":
      return `Re-measure ${a.stepId ? stepLabel(a.stepId) : "the reading"}`
    case "ADJUST":
      return a.actionText ?? "Adjust"
    case "WAIT":
      return "Wait"
    case "LOG":
      return "Log more data"
  }
}

function strengthOf(a: ActionRequest): DecisionStrength {
  switch (a.confidence) {
    case "strong":
    case "confirmed":
      return "strong"
    case "possible":
    case "conflicting":
      return "moderate"
    default:
      return "weak"
  }
}

function fromAction(a: ActionRequest, snap: GrowIntelligenceSnapshot): CultivationDecision {
  const signals = a.candidateIds.reduce(
    (n, id) => n + (snap.diagnosis.candidates.find((c) => c.id === id)?.independentSignals ?? 0),
    0
  )
  return {
    class: a.actionClass as DecisionClass,
    stepId: a.stepId,
    title: titleOf(a),
    reason: a.reason,
    strength: strengthOf(a),
    signals,
    feasibility:
      a.actionClass === "ADJUST"
        ? adjustFeasibility(snap, a.candidateIds[0] ?? "")
        : a.stepId
          ? stepFeasibility(snap, a.stepId)
          : "feasible",
    candidateIds: a.candidateIds,
    riskTier: a.riskTier,
  }
}

// ── Why-first templates ─────────────────────────────────────────────
// The central trust surface: every top decision explains why it comes
// before everything else, in deterministic wording tied to its class.

/** What the runner-up IS, in grower terms — no internal ids. */
const CLASS_PHRASE: Record<DecisionClass, string> = {
  COMPARE: "the comparison reading",
  VERIFY: "the verification",
  MEASURE: "the next measurement",
  OBSERVE: "the direct look",
  WAIT: "waiting out the recent change",
  MONITOR: "monitoring the settling change",
  ADJUST: "the adjustment",
  LOG: "logging more data",
  HOLD: "holding steady",
}

/** Why the top outranks THIS runner-up — one clause, appended to the
 *  class template. Deterministic on (top.class, next.class). */
function runnerUpReason(top: CultivationDecision, next: CultivationDecision): string {
  const nr = CLASS_PHRASE[next.class]
  switch (top.class) {
    case "COMPARE":
      return `${nr} can't resolve the conflict — this reading can`
    case "VERIFY":
      return `${nr} comes after confirming what the data actually shows now`
    case "MEASURE":
      return `${nr} would add less diagnostic information with the current data`
    case "OBSERVE":
      return `${nr} waits behind a direct look`
    case "WAIT":
      return `${nr} is deferred so the recent change can be evaluated cleanly`
    case "MONITOR":
      return `${nr} is deferred — acting while things settle blurs attribution`
    case "ADJUST":
      return `${nr} — the evidence supports acting, not just collecting more`
    case "LOG":
      return `${nr} can't be interpreted meaningfully until the data exists`
    case "HOLD":
      return `${nr} isn't warranted — nothing active needs doing`
  }
}

function whyFirst(d: CultivationDecision, next?: CultivationDecision): string {
  const head = (() => {
    switch (d.class) {
      case "COMPARE":
        return "first because evidence conflicts — this reading separates the live possibilities before anything else is worth doing"
      case "VERIFY":
        return d.evaluatesIntervention
          ? "first because it evaluates the change you already made"
          : "first because the data backing this is old enough to have changed"
      case "MEASURE":
        return "first because it's the highest-value missing input — it unblocks or discriminates the most"
      case "OBSERVE":
        return "first because a direct look settles it faster than another number"
      case "WAIT":
        return "recommended because you changed something recently and there isn't enough new data to evaluate the result"
      case "MONITOR":
        return "recommended because things are settling — another change now would blur what worked"
      case "ADJUST":
        return "strong evidence with no opposing signals, and the action is reversible and low-risk"
      case "LOG":
        return "first because the picture is too thin to reason about — more data before interpretation"
      case "HOLD":
        return "first because no finding, missing input, or open intervention outranks staying the course"
    }
  })()
  return next ? `${head}; ${runnerUpReason(d, next)}` : head
}

// ── Engine ──────────────────────────────────────────────────────────

/** Snapshot → the canonical decision set. Deterministic: identical
 *  snapshot → identical set. Zero I/O; bounded output. */
export function buildCultivationDecisions(
  snap: GrowIntelligenceSnapshot
): CultivationDecisionSet {
  const out: CultivationDecision[] = []

  // ── 1. Engine actions → decisions ─────────────────────────────────
  //    snap.actions is the scored/ranked action-engine output — the
  //    decision layer re-labels and re-gates it, never re-scores it.
  //    WAIT is skipped here: cooldown decisions are rebuilt below with
  //    explicit intervention state (the engine's WAIT carries no
  //    waitingOn and can't distinguish answered-vs-lapsed). A metric
  //    owed by a pending intervention is skipped too — the §2 follow-up
  //    VERIFY owns it with the intervention-aware reason.
  const pendingTargets = new Set<string>(
    snap.interventions
      .filter((i) => i.state === "pending" && i.targetMetric)
      .map((i) => i.targetMetric!)
  )
  for (const a of snap.actions) {
    if (a.actionClass === "WAIT") continue
    if (a.stepId && pendingTargets.has(a.stepId)) continue
    if (
      a.actionClass === "ADJUST" &&
      adjustFeasibility(snap, a.candidateIds[0] ?? "") === "not_available"
    )
      continue // structurally impossible for this grow — not a suggestion
    if (a.actionClass === "ADJUST") {
      const retry = adjustmentRetry(snap, a.candidateIds[0] ?? "")
      if (retry) {
        out.push(retry) // already tried — emit the different discriminator
        continue
      }
    }
    out.push(fromAction(a, snap))
  }

  // ── 2. Pending interventions → WAIT + explicit follow-up VERIFY ───
  //    A reported change with no after-reading produces two decisions:
  //    the cooldown context (WAIT) and the action that evaluates the
  //    change (VERIFY on the target). The VERIFY outranks the WAIT —
  //    the follow-up IS the next step; the WAIT explains the posture.
  const pending = snap.interventions.filter((i) => i.state === "pending")
  const seenWaitTargets = new Set<string>()
  for (const iv of pending) {
    const tKey = iv.targetMetric ?? iv.type
    if (seenWaitTargets.has(tKey)) continue
    seenWaitTargets.add(tKey)
    const label = iv.targetMetric ? metricLabel(iv.targetMetric) : "a follow-up reading"
    // Can the grower actually answer with a number? An unreportable or
    // structurally-excluded metric makes the wait honest only as "a
    // follow-up update" — never an implicitly unanswerable ask.
    const cap = iv.targetMetric ? capabilityOf(snap, iv.targetMetric) : null
    const askable =
      !!iv.targetMetric &&
      REPORTABLE_METRICS.has(iv.targetMetric) &&
      !!cap &&
      cap.feasibility !== "excluded" &&
      cap.feasibility !== "unreportable"
    out.push({
      class: "WAIT",
      title: `Wait — evaluate the ${ivLabel(iv)} first`,
      reason:
        `You reported an adjustment ${ageText(iv.ageDays)} — ${label} hasn't been logged since. ` +
        `A second change now would make the result unreadable.`,
      waitingOn: askable ? `${label} reading` : "a follow-up update",
      strength: "moderate",
      signals: 1,
      feasibility: "feasible",
      candidateIds: [],
      riskTier: "none",
    })
    if (askable && iv.targetMetric && !out.some((d) => d.stepId === iv.targetMetric)) {
      out.push({
        class: "VERIFY",
        stepId: iv.targetMetric,
        title: `Re-measure ${metricLabel(iv.targetMetric)}`,
        reason:
          iv.beforeValue != null
            ? `evaluate your reported ${ivLabel(iv)} — ${metricLabel(iv.targetMetric)} was ${iv.beforeValue} when you adjusted`
            : `evaluate your reported ${ivLabel(iv)} — no ${metricLabel(iv.targetMetric)} reading since`,
        strength: "moderate",
        signals: 1,
        feasibility: stepFeasibility(snap, iv.targetMetric),
        candidateIds: [],
        riskTier: "none",
        evaluatesIntervention: true,
      })
    }
  }

  // ── 3. Recent untracked interventions → cooldown MONITOR ─────────
  //    "I raised the light" has no target series — nothing can verify
  //    it — but a variable still changed. Multiple recent changes get
  //    the explicit anti-stacking note.
  const recentAll = snap.interventions.filter((i) => i.state !== "answered" && i.ageDays <= 3)
  const untrackedRecent = recentAll.filter((i) => i.state === "untracked")
  if (recentAll.length >= 2) {
    out.push({
      class: "MONITOR",
      title: "Several variables changed recently",
      reason:
        `${recentAll.length} adjustments inside ~3 days — change one variable at a time where practical, ` +
        `then observe the response. Stacked changes can't be attributed.`,
      strength: "moderate",
      signals: recentAll.length,
      feasibility: "feasible",
      candidateIds: [],
      riskTier: "none",
    })
  } else if (untrackedRecent.length) {
    const iv = untrackedRecent[untrackedRecent.length - 1]
    out.push({
      class: "MONITOR",
      title: `Recent ${ivLabel(iv)} still settling`,
      reason:
        `You reported an adjustment ${ageText(iv.ageDays)} — no logged series can verify it, so observation ` +
        `is the follow-up. Hold off on another change until the response is clear.`,
      strength: "weak",
      signals: 1,
      feasibility: "feasible",
      candidateIds: [],
      riskTier: "none",
    })
  }

  // ── 4. Episodes → MONITOR (improving) / OBSERVE (recurred) ───────
  const improving = snap.episodes.find((e) => e.status === "improving")
  if (improving) {
    out.push({
      class: "MONITOR",
      title: `${symptomLabel(improving.symptom)} is improving`,
      reason:
        "The symptom has not progressed in the latest reports — continue monitoring rather than changing " +
        "multiple variables at once.",
      strength: "weak",
      signals: 1,
      feasibility: "feasible",
      candidateIds: [],
      riskTier: "none",
    })
  }
  const recurred = snap.episodes.find((e) => e.status === "recurred")
  if (recurred) {
    out.push({
      class: "OBSERVE",
      title: `Compare with the earlier ${symptomLabel(recurred.symptom)} episode`,
      reason:
        `This symptom returned (episode ${recurred.episodeCount}) — check whether current conditions match ` +
        `the previous episode. Recurrence is a pattern hint, not proof of cause.`,
      strength: "moderate",
      signals: 1,
      feasibility: "feasible",
      candidateIds: [],
      riskTier: "none",
    })
  }

  // ── 5. Baseline shift → VERIFY ────────────────────────────────────
  //    A personal baseline is a comparison reference, never a verdict:
  //    the ask is to check whether the shift was intentional, not to
  //    treat the new level as wrong.
  const shift = snap.readings.find(
    (r) =>
      r.changeDirection &&
      r.baseline &&
      !r.stale &&
      !out.some((d) => d.stepId === r.metric)
  )
  if (shift && shift.baseline) {
    out.push({
      class: "VERIFY",
      stepId: shift.metric,
      title: `Verify the ${metricLabel(shift.metric)} shift`,
      reason:
        `${metricLabel(shift.metric)} moved ${shift.changeDirection} vs your usual ` +
        `${shift.baseline.lo}–${shift.baseline.hi} — check whether the shift was intentional ` +
        `before treating it as a problem.`,
      strength: "moderate",
      signals: 1,
      feasibility: stepFeasibility(snap, shift.metric),
      candidateIds: [],
      riskTier: "none",
    })
  }

  // ── 6. Data quality → LOG / OBSERVE ───────────────────────────────
  //    Sometimes the best action is more data — without pretending the
  //    plant has a problem.
  if (!snap.diaryLinked) {
    out.push({
      class: "LOG",
      title: "Link a public diary",
      reason:
        "I'm reasoning on what you've told me in chat only — a linked diary turns one-off reports " +
        "into a timeline I can compare against.",
      strength: "none",
      signals: 0,
      feasibility: "feasible",
      candidateIds: [],
      riskTier: "none",
    })
  } else {
    if (snap.stage === "UNKNOWN" && !out.some((d) => d.stepId === "inspect:stage")) {
      out.push({
        class: "OBSERVE",
        stepId: "inspect:stage",
        title: "Set the diary stage",
        reason:
          "Stage is unknown — stage-aware bands and checklists can't engage until it's set.",
        strength: "none",
        signals: 0,
        feasibility: "feasible",
        candidateIds: [],
        riskTier: "none",
      })
    }
    if (snap.updateCount === 0) {
      out.push({
        class: "LOG",
        title: "Log a first update",
        reason: "No diary updates yet — temp/RH plus a note unlocks the most reasoning.",
        strength: "none",
        signals: 0,
        feasibility: "feasible",
        candidateIds: [],
        riskTier: "none",
      })
    }
  }

  // ── 7. HOLD — the "optimization addiction" brake ─────────────────
  //    A stable grow is allowed to produce nothing. When no decision
  //    qualifies, the honest answer is "nothing needs changing".
  if (!out.length) {
    out.push({
      class: "HOLD",
      title: "No change",
      reason: "Recent data is stable and nothing is unresolved — keep doing what you're doing.",
      strength: "none",
      signals: 0,
      feasibility: "feasible",
      candidateIds: [],
      riskTier: "none",
    })
  }

  // ── Rank: fixed class precedence, then derivation order ──────────
  const ranked = out
    .map((d, i) => ({ d, i }))
    .sort((a, b) => CLASS_RANK[a.d.class] - CLASS_RANK[b.d.class] || a.i - b.i)
    .map((x) => x.d)
    .slice(0, MAX_DECISIONS)

  const top = ranked[0]
  top.whyFirst = whyFirst(top, ranked[1])

  const waitingOn = ranked
    .filter((d) => d.class === "WAIT" && d.waitingOn)
    .map((d) => d.waitingOn!)

  // Posture: a pending intervention casts a wait shadow over
  // measurement/verification tops — the follow-up action is still the
  // right next step, but the stance is "evaluating a change", not
  // "acting on a problem". A live dispute or inspection need overrides.
  const posture: DecisionPosture =
    top.class === "HOLD"
      ? "stable"
      : top.class === "LOG"
        ? "collect"
        : top.class === "MONITOR"
          ? "monitor"
          : pending.length &&
              (top.class === "WAIT" ||
                top.class === "VERIFY" ||
                top.class === "MEASURE")
            ? "wait"
            : top.class === "WAIT"
              ? "wait"
              : "act"

  return { posture, top, decisions: ranked, waitingOn }
}

// ── Selectors for downstream consumers ──────────────────────────────

/** The first reportable metric a decision asks for — the pendingAsk a
 *  bare reading in chat should answer. Inspect steps never qualify:
 *  they can't be answered with a number. */
export function topAskableMetric(set: CultivationDecisionSet): MetricId | null {
  const d = set.decisions.find(
    (d) =>
      (d.class === "MEASURE" || d.class === "VERIFY" || d.class === "COMPARE") &&
      d.stepId &&
      !d.stepId.startsWith("inspect:") &&
      REPORTABLE_METRICS.has(d.stepId as MetricId)
  )
  return (d?.stepId as MetricId) ?? null
}

/** Bounded one-line render of a decision — shared by /next, /check,
 *  /plan and /status so every surface phrases the same decision the
 *  same way. */
export function decisionLine(d: CultivationDecision): string {
  switch (d.class) {
    case "HOLD":
      return `No change — ${d.reason}`
    case "WAIT":
      return `Wait — ${d.reason}`
    case "MONITOR":
      return `Keep watching — ${d.title.toLowerCase()}: ${d.reason}`
    case "LOG":
      return `${d.title} — ${d.reason}`
    case "ADJUST":
      return `${d.title} (strong evidence, no opposing signals${
        d.feasibility === "partially_feasible"
          ? "; no matching equipment in setup — manual methods apply"
          : ""
      })`
    default:
      return `${d.title} — ${d.reason}`
  }
}
