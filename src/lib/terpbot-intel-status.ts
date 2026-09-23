// TerpBot intelligence — longitudinal status renderers (Phase H5).
// Pure module: no Prisma, no I/O. Every line is built from canonical
// labels + structured values — never raw diary or chat text.
//
// Commands rendered here:
//   /status       — where the grow is right now + what changed vs its
//                   own baseline + open episodes + next action
//   /changes      — diff against the last persisted snapshot
//   /check        — ranked next actions from the action engine
//   /measurements — what the engine actually has: known/derived/
//                   reported/stale/missing + baseline qualification
//
// Chat messages cap at 1000 chars — every renderer is bounded.

import { METRIC_EPSILON } from "@/lib/terpbot-intel-types"
import { MEASUREMENT_INFO, interventionState } from "@/lib/terpbot-intel"
import { episodesFromObservations } from "@/lib/terpbot-intel-episodes"
import { CANDIDATES } from "@/lib/terpbot-intel-knowledge"
import { LOCATION_LABELS, SYMPTOM_LABELS } from "@/lib/terpbot-nl-vocab"
import { stageLabel } from "@/lib/terpbot-constants"
import { REPORTABLE_METRICS } from "@/lib/terpbot-intel-merge"
import { decisionLine } from "@/lib/terpbot-intel-decisions"
import type { CultivationDecisionSet } from "@/lib/terpbot-intel-decisions"
import type { ChecklistItem } from "@/lib/terpbot-intel-checklist"
import type { GrowIntelligenceSnapshot } from "@/lib/terpbot-intel-snapshot"
import type {
  Diagnosis,
  GrowContextView,
  MetricId,
  SessionSnapshot,
  SymptomId,
} from "@/lib/terpbot-intel-types"

const DAY_MS = 86400000
const daysAgo = (ctx: GrowContextView, t: number) =>
  Math.max(0, Math.floor((ctx.now - t) / DAY_MS))
const ageText = (ctx: GrowContextView, t: number) => {
  const d = daysAgo(ctx, t)
  return d === 0 ? "today" : `${d}d ago`
}

const METRIC_ORDER: [MetricId, keyof GrowContextView["series"], string][] = [
  ["temperature", "temperature", "°F"],
  ["humidity", "humidity", "% RH"],
  ["vpd", "vpdComputed", " kPa"],
  ["ph", "ph", ""],
  ["ec", "ec", ""],
  ["runoffPh", "runoffPh", ""],
  ["runoffEc", "runoffEc", ""],
  ["height", "height", " cm"],
]

export const fmt = (metric: MetricId, v: number) =>
  metric === "temperature" ? `${v}°F`
  : metric === "humidity" ? `${v}%`
  : metric === "vpd" ? `≈${v} kPa`
  : metric === "ph" || metric === "runoffPh" ? `pH ${v}`
  : metric === "ec" || metric === "runoffEc" ? `EC ${v}`
  : metric === "height" ? `${v} cm`
  : `${v}`

export const metricLabel = (m: MetricId) => MEASUREMENT_INFO[m]?.label ?? m

/** user-authored free text (diary title) is markup/URL-launderable —
 *  bot messages bypass link-trust checks, so strip it before render.
 *  Same rules as terpbot-data's sanitizeField, kept local so this
 *  module stays Prisma-free. */
const scrub = (s: string, max = 60) =>
  s.replace(/[\r\n]+/g, " ").replace(/[[\]()*`<>\\@]/g, "").replace(/\s+/g, " ").trim().slice(0, max)

/** Episodes derive at read time — same contract as evaluateContext's
 *  internal derivation (ctx.episodes may already be set by the engine;
 *  otherwise derive from observations + resolution claims). */
const episodesOf = (ctx: GrowContextView) =>
  ctx.episodes ?? episodesFromObservations(ctx.observations, ctx.resolutions ?? [])

// ── /measurements ───────────────────────────────────────────────────

/** What the engine actually holds — known values with age + provenance,
 *  derived values, baselines with their qualification tier, and the
 *  gaps. The honesty surface: nothing here is invented. */
export function renderMeasurements(ctx: GrowContextView): string[] {
  const known: string[] = []
  const stale: string[] = []
  const derived: string[] = []
  const baselines: string[] = []
  const missing: string[] = []

  for (const [metric, key] of METRIC_ORDER) {
    const s = ctx.series[key]
    if (!s.n || s.latest == null) {
      if (ctx.missing.includes(metric)) missing.push(metricLabel(metric))
      continue
    }
    const last = s.points[s.points.length - 1]
    const prov = last?.provenance === "user-reported" ? "you" : "logged"
    const age = last ? ageText(ctx, last.t) : null
    const entry = `${metricLabel(metric)} ${fmt(metric, s.latest)} (${prov}${age && age !== "today" ? ` · ${age}` : ""})`
    if (last && daysAgo(ctx, last.t) >= 10) stale.push(entry)
    else if (key === "vpdComputed") derived.push(`${entry} — computed, not measured`)
    else known.push(entry)

    const b = ctx.baselines[metric]
    if (b && b.tier !== "insufficient" && b.lo != null && b.hi != null) {
      baselines.push(
        `${metricLabel(metric)} usual ${b.lo}–${b.hi} (${b.tier}, ${b.n} readings)`
      )
    }
  }

  const lines: string[] = ["📏 What I have on your grow:"]
  if (known.length) lines.push(`Known: ${known.join(" · ")}`)
  if (derived.length) lines.push(`Derived: ${derived.join(" · ")}`)
  if (stale.length) lines.push(`Stale: ${stale.join(" · ")}`)
  if (baselines.length) lines.push(`Your baselines: ${baselines.join(" · ")}`)
  if (missing.length) lines.push(`Missing: ${missing.join(", ")}`)
  if (ctx.unresolved?.length) {
    lines.push(`Unresolved: ${ctx.unresolved.length} reported value${ctx.unresolved.length === 1 ? "" : "s"} I couldn't place (unit/scale unclear)`)
  }
  if (!known.length && !derived.length && !missing.length) {
    lines.push("Nothing logged yet — tell me temp/RH/pH/EC or log a diary update.")
  }
  return lines
}

// ── /status ─────────────────────────────────────────────────────────

/** Cultivation status — stage, current readings, what changed vs the
 *  grow's own baseline, open/resolved symptom episodes, pending
 *  interventions, next action. Compact by design; /progress remains
 *  the reputation view. */
export function renderStatus(
  ctx: GrowContextView,
  diagnosis: Diagnosis,
  decisions: CultivationDecisionSet
): string[] {
  const lines: string[] = []
  const stage = ctx.diary.stage !== "UNKNOWN" ? ctx.diary.stage.toLowerCase() : null
  lines.push(
    `📋 Grow status${ctx.diary.id ? ` — "${scrub(ctx.diary.title)}"` : " (no public diary linked)"}` +
      (stage ? `\nStage: ${stage}${ctx.stageDays != null ? ` · day ${ctx.stageDays}` : ""}${ctx.stageStartCensored ? " (start estimated)" : ""}` : "")
  )

  // current readings — latest per metric with provenance
  const observed: string[] = []
  for (const [metric, key] of METRIC_ORDER.slice(0, 5)) {
    const s = ctx.series[key]
    if (s.latest == null) continue
    const last = s.points[s.points.length - 1]
    const prov = last?.provenance === "user-reported" ? " (you)" : ""
    observed.push(`${fmt(metric, s.latest)}${prov}`)
  }
  if (observed.length) lines.push(`Now: ${observed.join(" · ")}`)

  // Setup — declared diary enums + heuristic capability ids only. Raw
  // GrowSetup free text NEVER renders (it's public-showcase text, not a
  // fact store); keyword hits are labeled as reported, not verified.
  const setupBits: string[] = []
  if (ctx.diary.mediumType) setupBits.push(SETUP_MEDIUM_LABELS[ctx.diary.mediumType] ?? ctx.diary.mediumType.toLowerCase())
  if (ctx.diary.lightType) setupBits.push(SETUP_LIGHT_LABELS[ctx.diary.lightType] ?? ctx.diary.lightType.toLowerCase())
  setupBits.push(SETUP_GROW_LABELS[ctx.diary.growType] ?? ctx.diary.growType.toLowerCase())
  const controls = ctx.setup.capabilities
    .map((c) => CONTROL_LABELS[c] ?? c)
    .slice(0, 4)
  if (ctx.diary.id && (ctx.diary.mediumType || ctx.diary.lightType || ctx.setup.present)) {
    lines.push(
      `Setup: ${setupBits.join(" · ")}` +
        (controls.length ? ` · controls: ${controls.join(", ")} (setup text)` : "")
    )
  }

  // meaningful changes vs own baseline
  const changes: string[] = []
  for (const [metric, key] of METRIC_ORDER) {
    const ch = ctx.series[key].change
    if (!ch || (ch.direction !== "up" && ch.direction !== "down") || ch.vsBaselineDelta == null) continue
    const dur = ch.durationDays != null && ch.durationDays >= 1 ? `, ~${Math.round(ch.durationDays)}d` : ""
    changes.push(`${metricLabel(metric)} ${ch.direction === "up" ? "↑" : "↓"} ${Math.abs(ch.vsBaselineDelta)} vs your earlier readings${dur}`)
  }
  const tr = ctx.stageTransitions[ctx.stageTransitions.length - 1]
  if (tr && daysAgo(ctx, tr.t) <= 7) {
    changes.unshift(`stage ${tr.from.toLowerCase()} → ${tr.to.toLowerCase()}${tr.censored ? " (boundary estimated)" : ""}`)
  }
  if (changes.length) lines.push(`Changed: ${changes.slice(0, 3).join(" · ")}`)

  // episodes — open concerns first, then resolutions
  const open = episodesOf(ctx).filter((e) => e.status === "active" || e.status === "recurred")
  const settled = episodesOf(ctx).filter((e) => e.status === "resolved" || e.status === "improving")
  for (const e of open.slice(0, 2)) {
    const label = SYMPTOM_LABELS[e.symptom] ?? e.symptom.toLowerCase()
    const loc = e.location ? ` (${LOCATION_LABELS[e.location]})` : ""
    lines.push(
      e.status === "recurred"
        ? `⚠ ${label}${loc} — returned after a reported resolution (episode ${e.episodeCount})`
        : e.approximate
          ? `· ${label}${loc} — reported earlier (timing approximate)`
          : `· ${label}${loc} — active since ${ageText(ctx, e.firstSeen)}`
    )
  }
  for (const e of settled.slice(0, 1)) {
    const label = SYMPTOM_LABELS[e.symptom] ?? e.symptom.toLowerCase()
    lines.push(`✓ ${label} — reported ${e.status}`)
  }

  // pending interventions — honest before/after, evaluated through the
  // canonical interventionState contract (Phase J)
  for (const iv of (ctx.interventions ?? []).slice(-1)) {
    const at = iv.eventT ?? iv.at
    const st = interventionState(ctx, iv)
    const label = iv.targetMetric ? metricLabel(iv.targetMetric) : null
    if (st !== "answered") {
      lines.push(`Adjustment: reported ${ageText(ctx, at)}${label ? ` — ${label} not logged since` : ""}`)
    } else if (iv.beforeReading) {
      const key = iv.targetMetric
        ? (METRIC_ORDER.find(([m]) => m === iv.targetMetric)?.[1] ??
          (iv.targetMetric === "vpd" ? "vpdComputed" : undefined))
        : undefined
      const after = key ? ctx.series[key].points.filter((p) => !p.tApproximate && p.t > at) : []
      if (after.length) {
        lines.push(`Adjustment: ${label} ${iv.beforeReading.v} → ${after[after.length - 1].v} since your change — consistent timing, not proof of cause`)
      }
    }
  }

  // top assessment (never a diagnosis) + next action
  const top = diagnosis.candidates[0]
  if (top && top.state !== "insufficient") {
    lines.push(`${top.kind === "risk" ? "Risk" : "Watch"}: ${top.name} — ${top.state.toUpperCase()}`)
  }
  if (decisions) {
    // Canonical decision layer (Phase J): the priority line and the
    // waitingOn state come from the same set /next renders — no second
    // selector.
    const d = decisions.top
    lines.push(`Next: ${decisionLine(d)}`)
    if (decisions.waitingOn.length) {
      lines.push(`Waiting on: ${decisions.waitingOn.join(" · ")}`)
    }
  }
  return lines
}

// ── /check ──────────────────────────────────────────────────────────

/** Ranked next actions from the canonical decision set — the
 *  measure-vs-adjust order is explicit in the class labels, and the
 *  top decision carries its own "why first". */
export function renderCheck(set: CultivationDecisionSet): string[] {
  const top = set.top
  if (top.class === "HOLD") {
    return [
      "✅ Nothing to check right now — measurements are current and nothing is unresolved.",
      `Next: ${decisionLine(top)}`,
    ]
  }
  const lines = ["🔎 What would help most, in order:"]
  set.decisions.slice(0, 4).forEach((d, i) => {
    lines.push(`${i + 1}. ${decisionLine(d)}`)
  })
  if (top.whyFirst) lines.push(`Why first: ${top.whyFirst}`)
  if (set.waitingOn.length) lines.push(`Waiting on: ${set.waitingOn.join(" · ")}`)
  return lines
}

// ── /next (Phase J) ─────────────────────────────────────────────────
// The simplest daily interaction: exactly one recommendation, plus
// why it comes first and what the engine is waiting for. Never a list.

export function renderNext(set: CultivationDecisionSet): string[] {
  const d = set.top
  const lines = [`➡ Next: ${decisionLine(d)}`]
  if (d.whyFirst) lines.push(`Why first: ${d.whyFirst}`)
  if (set.waitingOn.length) lines.push(`Waiting on: ${set.waitingOn.join(" · ")}`)
  return lines
}

// ── /changes ────────────────────────────────────────────────────────

/** Snapshot written at each /status, /checkin and /diagnose — the diff
 *  base for /changes. Canonical ids + numbers + one timestamp only. */
export function snapshotFrom(
  ctx: GrowContextView,
  diagnosis: Diagnosis,
  now: number
): SessionSnapshot {
  const latest: SessionSnapshot["latest"] = {}
  for (const [metric, key] of METRIC_ORDER) {
    const v = ctx.series[key].latest
    if (v != null) latest[metric] = v
  }
  const top = diagnosis.candidates.find((c) => c.state !== "insufficient")
  return {
    at: now,
    stage: ctx.diary.stage,
    updateCount: ctx.updateCount,
    latest,
    symptoms: episodesOf(ctx)
      .filter((e) => e.status === "active" || e.status === "recurred")
      .map((e) => e.symptom)
      .slice(0, 8),
    ...(top ? { topCandidate: { id: top.id, state: top.state } } : {}),
    ...(ctx.missing.length ? { missing: [...ctx.missing] } : {}),
    ...(ctx.diary.id ? { diaryId: ctx.diary.id } : {}),
  }
}

/** Diff the current context against the persisted snapshot. Only
 *  epsilon-crossing movements and status changes render — noise is
 *  filtered, not reported. */
export function renderChanges(
  ctx: GrowContextView,
  diagnosis: Diagnosis,
  prev: SessionSnapshot | undefined,
  decisions?: CultivationDecisionSet
): string[] {
  if (!prev || (prev.diaryId ?? "") !== ctx.diary.id) {
    // a snapshot must only diff against the diary it was taken on —
    // a mismatched (or legacy un-attributed) snapshot would conflate
    // another grow's readings with this context's
    return [
      "📈 No earlier snapshot to compare against — run /status first, then /changes next time.",
    ]
  }
  const lines: string[] = [
    `📈 Since ${ageText(ctx, prev.at)}:`,
  ]
  const out: string[] = []

  if (prev.stage !== ctx.diary.stage) {
    out.push(`stage ${prev.stage.toLowerCase()} → ${ctx.diary.stage.toLowerCase()}`)
  }

  for (const [metric, key] of METRIC_ORDER) {
    const cur = ctx.series[key].latest
    const old = prev.latest[metric]
    if (cur == null || old == null) continue
    const delta = Math.round((cur - old) * 100) / 100
    const eps = METRIC_EPSILON[metric] ?? 1
    if (Math.abs(delta) < eps) continue
    out.push(`${metricLabel(metric)} ${fmt(metric, old)} → ${fmt(metric, cur)} (${delta > 0 ? "+" : ""}${delta})`)
  }

  const prevSym = new Set<SymptomId>(prev.symptoms)
  const curActive = new Set(
    episodesOf(ctx)
      .filter((e) => e.status === "active" || e.status === "recurred")
      .map((e) => e.symptom)
  )
  for (const s of curActive) {
    if (!prevSym.has(s)) out.push(`new: ${(SYMPTOM_LABELS[s] ?? s.toLowerCase())} reported`)
  }
  for (const e of episodesOf(ctx)) {
    if (e.status === "resolved" && prevSym.has(e.symptom)) {
      out.push(`${(SYMPTOM_LABELS[e.symptom] ?? e.symptom.toLowerCase())} reported resolved`)
    } else if (e.status === "recurred" && prevSym.has(e.symptom)) {
      // was active before AND still active — not new; skip
    }
  }

  const top = diagnosis.candidates.find((c) => c.state !== "insufficient")
  if (top && prev.topCandidate?.id !== top.id) {
    out.push(`main watch is now ${top.name} (${top.state})`)
  } else if (!top && prev.topCandidate) {
    out.push(`previous watch (${CANDIDATES[prev.topCandidate.id]?.name ?? "the earlier concern"}) no longer meets the bar`)
  }

  if (!out.length) {
    lines.push("Nothing meaningful changed — readings are inside their noise bands.")
  } else {
    lines.push(...out.slice(0, 8).map((l) => `- ${l}`))
    // A delta is not automatically a problem — the decision layer says
    // whether the shift is worth verifying and what to look at next.
    const verify = decisions?.decisions.find(
      (d) => d.class === "COMPARE" || d.class === "VERIFY"
    )
    if (verify) lines.push(`Worth verifying: ${decisionLine(verify)}`)
  }
  return lines
}

// ── /plan (Phase I) ─────────────────────────────────────────────────
// The cultivation plan view over the shared Grow Intelligence
// Snapshot + checklist engine. Sections map to checklist states:
//   ⚠ concern · WATCH watch · MEASURE due-reportable · OBSERVE
//   due-inspection/unreportable · UNKNOWN missing data · UPCOMING
//   stage-fixed expectations.
// Deliberately NOT a dump of nextActions() — the single live diagnostic
// step stays behind /check. ≤2 chat messages via toMessages.

const SETUP_MEDIUM_LABELS: Record<string, string> = {
  SOIL: "soil", LIVING_SOIL: "living soil", COCO: "coco",
  HYDRO: "hydro", DWC: "DWC", OTHER: "other medium",
}
const SETUP_LIGHT_LABELS: Record<string, string> = {
  LED: "LED", HPS: "HPS", CMH: "CMH", FLUORESCENT: "fluorescent",
  SUN: "sun", OTHER: "other light",
}
const SETUP_GROW_LABELS: Record<string, string> = {
  INDOOR: "indoor", OUTDOOR: "outdoor", GREENHOUSE: "greenhouse",
}
/** Canonical capability id → display label. Keyword hits render under
 *  "(setup text)" — a claim, never a verified fact. */
const CONTROL_LABELS: Record<string, string> = {
  dehumidifier: "dehumidifier",
  humidifier: "humidifier",
  ac: "AC",
  airflow: "airflow",
  "controllers/sensors": "controllers",
  "ph-meter": "pH meter",
  "ec-meter": "EC meter",
  "env-monitor": "temp/RH monitor",
  "light-meter": "light meter",
  loupe: "loupe",
  co2: "CO₂",
  "auto-irrigation": "auto-irrigation",
}

/** Stage-forward expectation — fixed per stage, never a schedule with
 *  dates. Observable endpoints beat calendar claims. */
const UPCOMING: Record<string, (s: GrowIntelligenceSnapshot) => string | null> = {
  GERMINATION: () => "seedling — once the first true leaves show",
  SEEDLING: () => "vegetative — growth accelerates; the training window opens",
  VEGETATIVE: () => "flower transition — RH targets tighten and stretch begins",
  FLOWER: (s) =>
    s.stageDays >= 35
      ? "harvest — judge maturity on trichomes, not the calendar"
      : "late flower — humidity discipline matters more as buds densify",
  HARVEST: () => "drying — ~57–68°F / 50–65% RH with gentle airflow",
  DRYING: () => "curing — when stems snap rather than bend",
  CURING: () => "completed — the cure keeps improving for weeks; keep logging jar RH",
  COMPLETED: () => null,
}

export function renderPlan(
  snap: GrowIntelligenceSnapshot,
  checklist: ChecklistItem[],
  decisions?: CultivationDecisionSet
): string[] {
  const items = checklist.filter((i) => i.state !== "not_applicable")
  const stageTxt = snap.stage !== "UNKNOWN" ? stageLabel(snap.stage) : "stage unknown"

  const lines: string[] = [
    `🗺 Plan — ${stageTxt}` +
      (snap.stage !== "UNKNOWN"
        ? ` · day ${snap.stageDays} · week ${snap.week}${snap.stageCensored ? " (stage start est.)" : ""}`
        : "") +
      (snap.harvested && snap.stage !== snap.declaredStage ? " (harvested)" : ""),
  ]

  // TOP PRIORITY (Phase J) — the canonical decision layer's answer to
  // "what matters most right now", before the routine checklist below.
  if (decisions) {
    const d = decisions.top
    lines.push(
      d.class === "HOLD"
        ? `Top priority: none — ${d.reason}`
        : `Top priority: ${decisionLine(d)}`
    )
    if (d.whyFirst && d.class !== "HOLD") lines.push(`Why first: ${d.whyFirst}`)
    if (decisions.waitingOn.length) {
      lines.push(`Waiting on: ${decisions.waitingOn.join(" · ")}`)
    }
  }

  // Setup — declared enums + heuristic capability ids only
  const setupBits: string[] = []
  if (snap.setup.mediumType) setupBits.push(SETUP_MEDIUM_LABELS[snap.setup.mediumType] ?? snap.setup.mediumType.toLowerCase())
  if (snap.setup.lightType) setupBits.push(SETUP_LIGHT_LABELS[snap.setup.lightType] ?? snap.setup.lightType.toLowerCase())
  setupBits.push(SETUP_GROW_LABELS[snap.setup.growType] ?? snap.setup.growType.toLowerCase())
  const controls = snap.setup.controls.map((c) => CONTROL_LABELS[c] ?? c).slice(0, 4)
  if (snap.diaryLinked && (snap.setup.mediumType || snap.setup.lightType || snap.setup.present)) {
    lines.push(
      `Setup: ${setupBits.join(" · ")}` +
        (controls.length ? ` · ${controls.join(", ")} (setup text)` : "")
    )
  }

  const concerns = items.filter((i) => i.state === "concern")
  const watch = items.filter((i) => i.state === "watch")
  const due = items.filter((i) => i.state === "due")
  const unknown = items.filter((i) => i.state === "unknown")

  for (const i of concerns.slice(0, 3)) lines.push(`⚠ ${i.label}`)

  if (watch.length) lines.push(`Watch: ${watch.slice(0, 3).map((i) => i.label).join(" · ")}`)

  const measure = due.filter((i) => i.stepId && REPORTABLE_METRICS.has(i.stepId as MetricId))
  const observe = due.filter(
    (i) => !i.stepId || i.stepId.startsWith("inspect:") || !REPORTABLE_METRICS.has(i.stepId as MetricId)
  )
  if (measure.length) {
    lines.push(
      `Measure: ${measure
        .slice(0, 3)
        .map((i) => metricLabel(i.stepId as MetricId))
        .join(" · ")}`
    )
  }
  if (observe.length) {
    lines.push(`Observe: ${observe.slice(0, 3).map((i) => i.label).join(" · ")}`)
  }

  const upcoming = UPCOMING[snap.stage]?.(snap) ?? null
  if (upcoming) lines.push(`Upcoming: ${upcoming}`)

  if (unknown.length) {
    lines.push(`Unknown: ${unknown.slice(0, 3).map((i) => i.label).join(" · ")}`)
  }
  // capability honesty — reportable metrics with no evidence either way
  const unproven = snap.capabilityUnknown.slice(0, 3).map((m) => metricLabel(m))
  if (unproven.length) {
    lines.push(`No evidence of: ${unproven.join(" · ")} (missing data ≠ missing equipment)`)
  }

  if (snap.nextStep) lines.push(`One-step answer → /next · ranked steps → /check`)
  return lines
}
