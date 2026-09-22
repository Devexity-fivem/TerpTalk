// TerpBot intelligence — /why trail: build the persisted explanation
// and render it. Evidence `text` values are the already-safe rendered
// lines (rules never embed raw user text — they interpolate metric
// values and canonical labels only). No ids, refIds, diary ids, or
// room ids ever reach the rendered output. Pure — no Prisma.

import { KNOWLEDGE_VERSION, SOURCES } from "@/lib/terpbot-intel-knowledge"
import { SYMPTOM_LABELS } from "@/lib/terpbot-nl-vocab"
import {
  INSPECTION_INFO,
  MEASUREMENT_INFO,
  nextActions,
  signalAgeDays,
} from "@/lib/terpbot-intel"
import { episodesFromObservations } from "@/lib/terpbot-intel-episodes"
import type {
  CandidateResult,
  Diagnosis,
  GrowContextView,
  MetricId,
  WhyTrail,
} from "@/lib/terpbot-intel-types"

const SIGNAL_LABELS: Record<string, string> = {
  humidity: "RH readings",
  temperature: "temperature readings",
  "env:temp-rh": "temp/RH together",
  ph: "pH readings",
  ec: "EC readings",
  "chem:ph-ec": "pH+EC together",
  height: "growth",
  stage: "stage timing",
  data: "data coverage",
  runoff: "runoff readings",
}

/** OBSERVED — a measurement the grower logged or reported, or a
 *  symptom they described. DERIVED — a value calculated from
 *  measurements (VPD, dew point, paired pH+EC). INFERRED — an engine
 *  judgment about context or data coverage, not a reading. */
const SIGNAL_CLASS: Record<string, "observed" | "derived" | "inferred"> = {
  humidity: "observed",
  temperature: "observed",
  ph: "observed",
  ec: "observed",
  runoff: "observed",
  height: "observed",
  stage: "observed",
  "env:temp-rh": "derived",
  "chem:ph-ec": "derived",
  data: "inferred",
}

const SERIES_OF: Partial<Record<MetricId, keyof GrowContextView["series"]>> = {
  temperature: "temperature",
  humidity: "humidity",
  ph: "ph",
  ec: "ec",
  height: "height",
  vpd: "vpdEntered",
  runoffPh: "runoffPh",
  runoffEc: "runoffEc",
}

function signalClass(signal: string): "observed" | "derived" | "inferred" {
  if (signal.startsWith("symptom:")) return "observed"
  return SIGNAL_CLASS[signal] ?? "inferred"
}

function signalLabel(signal: string): string {
  if (signal.startsWith("symptom:")) {
    const id = signal.slice("symptom:".length)
    return `reported ${(SYMPTOM_LABELS[id] ?? id.toLowerCase().replace(/_/g, " "))}`
  }
  return SIGNAL_LABELS[signal] ?? signal
}

/** The persisted /why trail — bounded: top 4 candidates, ≤3 signals
 *  each (weight desc then signal asc), ≤2 opposing texts, ≤3 findings. */
export function buildWhyTrail(
  ctx: GrowContextView,
  diagnosis: Diagnosis,
  now: number,
  next?: WhyTrail["next"]
): WhyTrail {
  let logged = 0
  let reported = 0
  for (const s of Object.values(ctx.series)) {
    for (const p of s.points) {
      if (p.provenance === "user-reported") reported++
      else logged++
    }
  }

  const candidates: WhyTrail["candidates"] = diagnosis.candidates
    .filter((c) => c.state !== "insufficient")
    .slice(0, 4)
    .map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      state: c.state,
      independentSignals: c.independentSignals,
      signals: [...c.supporting, ...c.opposing]
        .map((e) => {
          const sig = e.signal ?? "?"
          const age = signalAgeDays(ctx, sig)
          return {
            signal: sig,
            direction: e.direction as "for" | "risk" | "against",
            weight: { weak: 1, moderate: 2, strong: 3 }[e.strength],
            evidenceClass: signalClass(sig),
            ...(age != null ? { ageDays: Math.round(age) } : {}),
            text: e.text,
          }
        })
        .sort((a, b) => b.weight - a.weight || a.signal.localeCompare(b.signal))
        .slice(0, 3),
      opposing: c.opposing.map((e) => e.text).slice(0, 2),
      ...(c.info.length ? { info: c.info.slice(0, 1).map((e) => e.text) } : {}),
      requiredMissing: c.requiredMissing,
      next: c.nextMeasurement,
      sourceIds: c.sourceIds,
      ...(c.stale ? { stale: true } : {}),
    }))

  return {
    knowledgeVersion: KNOWLEDGE_VERSION,
    at: now,
    // diary title is user-authored free text — renderers never print it,
    // so persist only whether a diary was linked, not its content
    diaryTitle: ctx.diary.id ? "linked" : null,
    basis: {
      logged,
      reported,
      observations: ctx.observations.length,
      staleDays: ctx.daysSinceUpdate,
      ...(ctx.stageStartCensored ? { stageEstimated: true } : {}),
    },
    candidates,
    findings: diagnosis.findings
      .filter((f) => f.state !== "insufficient")
      .slice(0, 3)
      .map((f) => ({
        title: f.title,
        state: f.state,
        text: f.evidence[0]?.text ?? f.title,
      })),
    next: next ?? diagnosis.candidates.find((c) => c.nextMeasurement)?.nextMeasurement,
    longitudinal: buildLongitudinal(ctx, diagnosis),
  }
}

/** Bounded longitudinal slice for /why — changes vs own baseline,
 *  episode states, pending interventions, the chosen action. Canonical
 *  ids + scalars only; no diary ids, no raw text. */
function buildLongitudinal(
  ctx: GrowContextView,
  diagnosis: Diagnosis
): NonNullable<WhyTrail["longitudinal"]> | undefined {
  const changes: NonNullable<WhyTrail["longitudinal"]>["changes"] = []
  const pairs: [MetricId, keyof GrowContextView["series"]][] = [
    ["temperature", "temperature"],
    ["humidity", "humidity"],
    ["ph", "ph"],
    ["ec", "ec"],
    ["runoffPh", "runoffPh"],
    ["runoffEc", "runoffEc"],
  ]
  for (const [metric, key] of pairs) {
    const ch = ctx.series[key].change
    if (!ch || (ch.direction !== "up" && ch.direction !== "down") || ch.vsBaselineDelta == null) continue
    changes.push({
      metric,
      direction: ch.direction,
      delta: ch.vsBaselineDelta,
      durationDays: ch.durationDays,
    })
  }
  changes.sort((a, b) => a.metric.localeCompare(b.metric))

  // Episodes derive at read time — evaluateContext attaches them to its
  // internal eval copy, not to the caller's ctx, so derive here too.
  const episodes = (ctx.episodes ?? episodesFromObservations(ctx.observations, ctx.resolutions ?? []))
    .filter((e) => e.status !== "active")
    .slice(0, 3)
    .map((e) => ({
      symptom: e.symptom,
      status: e.status,
      lastSeenDaysAgo: Math.max(0, Math.floor((ctx.now - e.lastSeen) / 86400000)),
    }))

  const pendingInterventions = (ctx.interventions ?? [])
    .filter((iv) => {
      const key = iv.targetMetric ? SERIES_OF[iv.targetMetric] : undefined
      if (!key) return false
      const at = iv.eventT ?? iv.at
      return !ctx.series[key].points.some((p) => !p.tApproximate && p.t > at)
    })
    .slice(-2)
    .map((iv) => ({
      type: iv.type,
      targetMetric: iv.targetMetric,
      daysAgo: Math.max(0, Math.floor((ctx.now - (iv.eventT ?? iv.at)) / 86400000)),
    }))

  const top = nextActions(ctx, diagnosis)[0]
  const action = top
    ? { class: top.actionClass, stepId: top.stepId, reason: top.reason }
    : undefined

  if (!changes.length && !episodes.length && !pendingInterventions.length && !action) return undefined
  return {
    changes: changes.slice(0, 3),
    episodes,
    pendingInterventions,
    ...(action ? { action } : {}),
  }
}

function uncertaintyLine(c: CandidateResult | WhyTrail["candidates"][number], staleDays: number | null): string | null {
  if (c.state === "conflicting") return "evidence conflicts"
  if (c.requiredMissing.length) {
    return `required measurement missing: ${c.requiredMissing
      .map((m) => MEASUREMENT_INFO[m as keyof typeof MEASUREMENT_INFO]?.label ?? m)
      .join(", ")}`
  }
  if (c.stale && staleDays != null) return `data is ${staleDays} days old`
  if (c.independentSignals <= 1) return "only one independent signal"
  if (staleDays != null && staleDays >= 3) return `data is ${staleDays} days old`
  if (c.state === "possible") return "risk conditions favor it but no symptom confirms it"
  return null
}

/** Render the trail into chat lines — ≤2 messages worth of text.
 *  `question` optionally targets one candidate/signal by name. */
export function renderWhy(trail: WhyTrail, question?: string): string[] {
  const b = trail.basis
  const bits = [
    `${b.logged} logged readings`,
    b.reported ? `${b.reported} you told me` : null,
    b.observations ? `${b.observations} reported symptoms` : null,
    b.stageEstimated ? "stage timing estimated" : null,
  ].filter(Boolean)
  const lines: string[] = [
    `🔍 Why I said that (knowledge v${trail.knowledgeVersion}, ${bits.join(" · ")})`,
  ]

  let candidates = trail.candidates
  if (question) {
    const q = question.toLowerCase()
    const hit = candidates.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        c.signals.some((s) => s.signal.includes(q) || signalLabel(s.signal).includes(q))
    )
    if (hit.length) candidates = hit
  }

  for (const c of candidates.slice(0, 3)) {
    lines.push(
      `${c.name} — ${c.state.toUpperCase()} (${c.independentSignals} independent signal${c.independentSignals === 1 ? "" : "s"})`
    )
    for (const s of c.signals) {
      const cls =
        s.evidenceClass === "derived"
          ? "derived"
          : s.evidenceClass === "inferred"
            ? "inferred"
            : "observed"
      const age =
        s.ageDays != null && s.ageDays >= 2
          ? ` · ${s.ageDays}d ago${s.ageDays >= 10 ? " (stale)" : ""}`
          : ""
      lines.push(`  · ${signalLabel(s.signal)} [${cls}${age}]: ${s.text}`)
    }
    for (const o of c.opposing) {
      lines.push(`  · Against: ${o}`)
    }
    for (const t of c.info ?? []) {
      lines.push(`  · Note: ${t}`)
    }
    if (c.requiredMissing.length) {
      lines.push(
        `  · Missing: ${c.requiredMissing
          .map((m) => MEASUREMENT_INFO[m as keyof typeof MEASUREMENT_INFO]?.label ?? m)
          .join(", ")}`
      )
    }
    const why = uncertaintyLine(c, b.staleDays)
    if (why) lines.push(`Not more certain because: ${why}`)
  }

  for (const f of trail.findings) {
    lines.push(`· ${f.text}`)
  }

  // Longitudinal evidence — what changed vs the grow's own norm,
  // episode states, pending before/after checks
  const lon = trail.longitudinal
  if (lon) {
    for (const ch of lon.changes) {
      const label = MEASUREMENT_INFO[ch.metric]?.label ?? ch.metric
      const dur = ch.durationDays != null && ch.durationDays >= 1 ? ` for ~${Math.round(ch.durationDays)}d` : ""
      lines.push(`Changed: ${label} moved ${ch.direction === "up" ? "up" : "down"} ${Math.abs(ch.delta)} from your earlier readings${dur} — a shift from your norm, not a verdict.`)
    }
    for (const e of lon.episodes) {
      const label = SYMPTOM_LABELS[e.symptom] ?? e.symptom.toLowerCase()
      const statusText =
        e.status === "resolved" ? `reported resolved` :
        e.status === "improving" ? `reported improving` :
        e.status === "stable" ? `reported stable — still present` :
        `returned after a reported resolution (recurrence)`
      lines.push(`Episode: ${label} — ${statusText} (last seen ${e.lastSeenDaysAgo}d ago)`)
    }
    for (const iv of lon.pendingInterventions) {
      const label = iv.targetMetric ? (MEASUREMENT_INFO[iv.targetMetric]?.label ?? iv.targetMetric) : null
      lines.push(
        `Intervention: you reported an adjustment ${iv.daysAgo}d ago${label ? ` — no ${label} reading logged since, so before/after can't be checked yet` : " — watching the next readings"}.`
      )
    }
    if (lon.action) {
      const stepLabel = lon.action.stepId?.startsWith("inspect:")
        ? INSPECTION_INFO[lon.action.stepId]?.label ?? "inspection"
        : lon.action.stepId
          ? MEASUREMENT_INFO[lon.action.stepId as MetricId]?.label ?? lon.action.stepId
          : undefined
      lines.push(`Suggested action class: ${lon.action.class}${stepLabel ? ` — ${stepLabel}` : ""}`)
    }
  }

  if (trail.next) lines.push(`Next: ${trail.next.label} — ${trail.next.why}`)

  // dedup sources across shown candidates, candidates' order then id
  const seen = new Set<string>()
  const srcs: string[] = []
  for (const c of candidates) {
    for (const id of [...c.sourceIds].sort()) {
      if (seen.has(id) || !SOURCES[id]) continue
      seen.add(id)
      srcs.push(id)
      if (srcs.length >= 3) break
    }
    if (srcs.length >= 3) break
  }
  if (srcs.length) {
    const parts = srcs.map((id) => {
      const s = SOURCES[id]
      const tag = s.cannabisSpecific ? "cannabis-specific" : "general horticulture, applied cautiously"
      return `${s.title} (${s.year}) — ${tag}`
    })
    lines.push(`Sources: ${parts.join(" · ")}`)
  }
  return lines
}
