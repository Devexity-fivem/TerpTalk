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
import { INSPECTION_INFO, MEASUREMENT_INFO } from "@/lib/terpbot-intel"
import { episodesFromObservations } from "@/lib/terpbot-intel-episodes"
import { CANDIDATES } from "@/lib/terpbot-intel-knowledge"
import { LOCATION_LABELS, SYMPTOM_LABELS } from "@/lib/terpbot-nl-vocab"
import type {
  ActionRequest,
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

const fmt = (metric: MetricId, v: number) =>
  metric === "temperature" ? `${v}°F`
  : metric === "humidity" ? `${v}%`
  : metric === "vpd" ? `≈${v} kPa`
  : metric === "ph" || metric === "runoffPh" ? `pH ${v}`
  : metric === "ec" || metric === "runoffEc" ? `EC ${v}`
  : metric === "height" ? `${v} cm`
  : `${v}`

const metricLabel = (m: MetricId) => MEASUREMENT_INFO[m]?.label ?? m

/** user-authored free text (diary title) is markup/URL-launderable —
 *  bot messages bypass link-trust checks, so strip it before render.
 *  Same rules as terpbot-data's sanitizeField, kept local so this
 *  module stays Prisma-free. */
const scrub = (s: string, max = 60) =>
  s.replace(/[\r\n]+/g, " ").replace(/[[\]()*`<>\\@]/g, "").replace(/\s+/g, " ").trim().slice(0, max)

/** inspect:* ids render via their authored label, never raw */
const stepLabel = (id: string) =>
  id.startsWith("inspect:")
    ? INSPECTION_INFO[id]?.label ?? "inspection"
    : MEASUREMENT_INFO[id as MetricId]?.label ?? id

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
  actions: ActionRequest[]
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

  // pending interventions — honest before/after
  for (const iv of (ctx.interventions ?? []).slice(-1)) {
    const key = iv.targetMetric
      ? (METRIC_ORDER.find(([m]) => m === iv.targetMetric)?.[1] ??
        (iv.targetMetric === "vpd" ? "vpdComputed" : undefined))
      : undefined
    const at = iv.eventT ?? iv.at
    const after = key ? ctx.series[key].points.filter((p) => !p.tApproximate && p.t > at) : []
    const label = iv.targetMetric ? metricLabel(iv.targetMetric) : null
    if (!key || !after.length) {
      lines.push(`Adjustment: reported ${ageText(ctx, at)}${label ? ` — ${label} not logged since` : ""}`)
    } else if (iv.beforeReading) {
      lines.push(`Adjustment: ${label} ${iv.beforeReading.v} → ${after[after.length - 1].v} since your change — consistent timing, not proof of cause`)
    }
  }

  // top assessment (never a diagnosis) + next action
  const top = diagnosis.candidates[0]
  if (top && top.state !== "insufficient") {
    lines.push(`${top.kind === "risk" ? "Risk" : "Watch"}: ${top.name} — ${top.state.toUpperCase()}`)
  }
  const act = actions[0]
  if (act) {
    lines.push(`Next: ${renderActionLine(act)}`)
  } else if (ctx.daysSinceUpdate != null && ctx.daysSinceUpdate >= 4) {
    lines.push(`Next: log an update — last one was ${ctx.daysSinceUpdate}d ago`)
  }
  return lines
}

// ── /check ──────────────────────────────────────────────────────────

/** Ranked next actions — the measure-vs-adjust order is explicit in the
 *  class labels. */
export function renderCheck(actions: ActionRequest[]): string[] {
  if (!actions.length) {
    return [
      "✅ Nothing to check right now — measurements are current and nothing is unresolved.",
    ]
  }
  const lines = ["🔎 What would help most, in order:"]
  actions.forEach((a, i) => {
    lines.push(`${i + 1}. ${renderActionLine(a)}`)
  })
  return lines
}

function renderActionLine(a: ActionRequest): string {
  switch (a.actionClass) {
    case "MEASURE":
      return `Measure ${a.stepId ? metricLabel(a.stepId as MetricId) : "readings"} — ${a.reason}`
    case "OBSERVE":
      return `Check ${a.stepId ? stepLabel(a.stepId) : ""} — ${a.reason}`
    case "COMPARE":
      return `Measure ${a.stepId ? metricLabel(a.stepId as MetricId) : ""} — evidence conflicts between ${a.discriminates.length} live possibilities; this separates them`
    case "VERIFY":
      return `Re-measure ${a.stepId ? metricLabel(a.stepId as MetricId) : ""} — the reading backing this is old enough to have changed`
    case "ADJUST":
      return `${a.actionText} (${a.confidence.toUpperCase()} evidence, no opposing signals)`
    case "WAIT":
      return a.reason
    case "LOG":
      return a.reason
  }
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
  }
}

/** Diff the current context against the persisted snapshot. Only
 *  epsilon-crossing movements and status changes render — noise is
 *  filtered, not reported. */
export function renderChanges(
  ctx: GrowContextView,
  diagnosis: Diagnosis,
  prev: SessionSnapshot | undefined
): string[] {
  if (!prev) {
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
  }
  return lines
}
