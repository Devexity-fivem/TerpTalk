// TerpBot intelligence — /why trail: build the persisted explanation
// and render it. Evidence `text` values are the already-safe rendered
// lines (rules never embed raw user text — they interpolate metric
// values and canonical labels only). No ids, refIds, diary ids, or
// room ids ever reach the rendered output. Pure — no Prisma.

import { KNOWLEDGE_VERSION, SOURCES } from "@/lib/terpbot-intel-knowledge"
import { SYMPTOM_LABELS } from "@/lib/terpbot-nl-vocab"
import {
  MEASUREMENT_INFO,
} from "@/lib/terpbot-intel"
import type {
  CandidateResult,
  Diagnosis,
  GrowContextView,
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
        .map((e) => ({
          signal: e.signal ?? "?",
          direction: e.direction as "for" | "risk" | "against",
          weight: { weak: 1, moderate: 2, strong: 3 }[e.strength],
          text: e.text,
        }))
        .sort((a, b) => b.weight - a.weight || a.signal.localeCompare(b.signal))
        .slice(0, 3),
      opposing: c.opposing.map((e) => e.text).slice(0, 2),
      requiredMissing: c.requiredMissing,
      next: c.nextMeasurement,
      sourceIds: c.sourceIds,
      ...(c.stale ? { stale: true } : {}),
    }))

  return {
    knowledgeVersion: KNOWLEDGE_VERSION,
    at: now,
    diaryTitle: ctx.diary.title || null,
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
      lines.push(`  · ${signalLabel(s.signal)}: ${s.text}`)
    }
    for (const o of c.opposing) {
      lines.push(`  · Against: ${o}`)
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
