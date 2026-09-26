/**
 * Grow intelligence projection — the owner-facing view over the
 * deterministic TerpBot engine. Chat commands (/status, /next, /check,
 * /plan, /changes, /measurements) and BOT_ASSIST already consume
 * buildGrowContext + buildSnapshot + buildCultivationDecisions; this
 * module distills the same outputs into compact serializable shapes for
 * the member cockpit, the diary intel panel, and the intel API route.
 *
 * Honesty contract (same as the engine): every field is a projection of
 * the snapshot, checklist, or decision set — missing data stays
 * "unknown", nothing is invented to fill the panel, and labels come from
 * the canonical vocab (MEASUREMENT_INFO / SYMPTOM_LABELS / checklist
 * labels), never raw user text.
 */
import { buildGrowContext } from "@/lib/terpbot-intel-context"
import type { GrowContextView } from "@/lib/terpbot-intel-types"
import {
  buildSnapshot,
  type GrowIntelligenceSnapshot,
} from "@/lib/terpbot-intel-snapshot"
import {
  buildCultivationDecisions,
  decisionLine,
  type CultivationDecisionSet,
  type DecisionPosture,
} from "@/lib/terpbot-intel-decisions"
import { activeChecklist } from "@/lib/terpbot-intel-checklist"
import { fmt, metricLabel } from "@/lib/terpbot-intel-status"
import { SYMPTOM_LABELS } from "@/lib/terpbot-nl-vocab"
import { prisma } from "@/lib/prisma"
import {
  experimentFollowUp,
  EXPERIMENT_FOLLOW_UP_LABELS,
  type ExperimentFollowUp,
  type ExperimentStatus,
} from "@/lib/experiments"

// ── Shapes ──────────────────────────────────────────────────────────

export interface IntelReading {
  label: string
  value: string
  /** reading sits outside the resolved stage/medium band */
  outOfBand: boolean
  stale: boolean
}

export interface IntelFlag {
  /** checklist concern/due label or canonical episode label */
  text: string
  /** "concern" outranks "due" for cockpit ordering */
  kind: "concern" | "due" | "episode" | "intervention"
}

export interface GrowIntel {
  diaryId: string
  /** effective stage from the snapshot (observed transitions win) */
  stage: string
  day: number
  week: number
  stageDays: number
  daysSinceUpdate: number | null
  posture: DecisionPosture
  /** decisionLine(top) — canonical phrasing, HOLD included */
  nextStep: string
  whyFirst: string | null
  waitingOn: string[]
  concerns: IntelFlag[]
  due: IntelFlag[]
  episodes: IntelFlag[]
  pendingInterventions: IntelFlag[]
  /** latest readings with data, canonical order, ≤6 rows */
  readings: IntelReading[]
  /** main watch — top non-insufficient diagnosis candidate, if any */
  watch: { name: string; state: string } | null
  /** documented experiments on this grow — grower-recorded changes */
  experiments: {
    id: string
    title: string
    status: ExperimentStatus
    followUp: ExperimentFollowUp | null
    observationCount: number
  }[]
}

export interface AttentionItem {
  diaryId: string
  diaryTitle: string
  href: string
  kind: "concern" | "due" | "episode" | "intervention" | "stale" | "transition" | "experiment"
  text: string
  /** 0 = most important — deterministic ordering, not manufactured urgency */
  rank: number
}

export interface GrowIntelBundle {
  ctx: GrowContextView
  snap: GrowIntelligenceSnapshot
  decisions: CultivationDecisionSet
  intel: GrowIntel
}

// ── Projection ──────────────────────────────────────────────────────

interface ExperimentRow {
  id: string
  title: string
  status: string
  startedAt: Date
  /** latest linked observation only (bounded) */
  updates: { createdAt: Date }[]
  /** true linked-update count (from _count) */
  observationCount: number
}

function projectIntel(
  ctx: GrowContextView,
  snap: GrowIntelligenceSnapshot,
  decisions: CultivationDecisionSet,
  experiments: ExperimentRow[] = []
): GrowIntel {
  const checklist = activeChecklist(snap)
  const concerns = checklist
    .filter((i) => i.state === "concern")
    .slice(0, 3)
    .map((i) => ({ text: i.label, kind: "concern" as const }))
  const due = checklist
    .filter((i) => i.state === "due")
    .slice(0, 3)
    .map((i) => ({ text: i.label, kind: "due" as const }))
  const episodes = snap.episodes
    .filter((e) => e.status === "active" || e.status === "recurred")
    .slice(0, 3)
    .map((e) => ({
      text:
        e.status === "recurred"
          ? `${SYMPTOM_LABELS[e.symptom] ?? e.symptom.toLowerCase()} — recurred`
          : (SYMPTOM_LABELS[e.symptom] ?? e.symptom.toLowerCase()),
      kind: "episode" as const,
    }))
  const pendingInterventions = snap.interventions
    .filter((i) => i.state === "pending" || i.state === "untracked")
    .slice(0, 2)
    .map((i) => ({
      text: i.type.startsWith("experiment:")
        ? i.targetMetric
          ? `experiment "${i.label ?? "documented change"}" — started ${i.ageDays}d ago, ${metricLabel(i.targetMetric)} not logged since`
          : `experiment "${i.label ?? "documented change"}" — started ${i.ageDays}d ago, awaiting observation`
        : i.targetMetric
          ? `${metricLabel(i.targetMetric)} — reported ${i.ageDays}d ago, not logged since`
          : `adjustment reported ${i.ageDays}d ago — no follow-up reading`,
      kind: "intervention" as const,
    }))

  const readings = snap.readings.slice(0, 6).map((r) => ({
    label: metricLabel(r.metric),
    value: fmt(r.metric, r.value),
    outOfBand: r.inBand === false,
    stale: r.stale,
  }))

  const top = snap.diagnosis.candidates.find((c) => c.state !== "insufficient")

  return {
    diaryId: ctx.diary.id,
    stage: snap.stage,
    day: snap.day,
    week: snap.week,
    stageDays: snap.stageDays,
    daysSinceUpdate: snap.daysSinceUpdate,
    posture: decisions.posture,
    nextStep: decisionLine(decisions.top),
    whyFirst: decisions.top.whyFirst ?? null,
    waitingOn: decisions.waitingOn,
    concerns,
    due,
    episodes,
    pendingInterventions,
    readings,
    watch: top ? { name: top.name, state: top.state } : null,
    experiments: experiments.map((e) => ({
      id: e.id,
      title: e.title,
      status: e.status as ExperimentStatus,
      followUp: experimentFollowUp({
        status: e.status,
        observationCount: e.observationCount,
        lastObservationAt: e.updates[0]?.createdAt ?? null,
      }),
      observationCount: e.observationCount,
    })),
  }
}

/** Build the owner-scope context + snapshot + decision set for one diary.
 *  Returns null when the diary isn't the owner's (or is deleted) — the
 *  same guarantee the public-scope commands get, enforced at the query. */
export async function getGrowIntel(
  diaryId: string,
  ownerId: string,
  opts: { now?: Date } = {}
): Promise<GrowIntelBundle | null> {
  const ctx = await buildGrowContext(diaryId, {
    ownerId,
    scope: "owner",
    now: opts.now,
  })
  if (!ctx) return null
  const snap = buildSnapshot(ctx)
  const decisions = buildCultivationDecisions(snap)
  // Documented experiments — owner-scope (getGrowIntel already enforced
  // ownership through buildGrowContext). One bounded query; the linked
  // update window only needs counts + latest timestamp for follow-up.
  const experiments = await prisma.growExperiment.findMany({
    where: { diaryId },
    orderBy: [{ status: "asc" }, { startedAt: "desc" }],
    take: 20,
    select: {
      id: true,
      title: true,
      status: true,
      startedAt: true,
      updates: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      _count: { select: { updates: true } },
    },
  })
  const experimentRows: ExperimentRow[] = experiments.map((e) => ({
    id: e.id,
    title: e.title,
    status: e.status,
    startedAt: e.startedAt,
    updates: e.updates,
    observationCount: e._count.updates,
  }))
  return { ctx, snap, decisions, intel: projectIntel(ctx, snap, decisions, experimentRows) }
}

// ── Attention derivation ────────────────────────────────────────────
// "What deserves my attention" — projections of signals that already
// exist in the snapshot/decision set. rank is the deterministic order;
// nothing is emitted merely because data is missing.

export function attentionFor(intel: GrowIntel, diaryTitle: string, href: string): AttentionItem[] {
  const items: AttentionItem[] = []
  const base = { diaryId: intel.diaryId, diaryTitle, href }

  for (const f of intel.concerns) {
    items.push({ ...base, kind: "concern", rank: 0, text: f.text })
  }
  for (const e of intel.episodes) {
    items.push({ ...base, kind: "episode", rank: 1, text: e.text })
  }
  for (const f of intel.due) {
    items.push({ ...base, kind: "due", rank: 2, text: f.text })
  }
  // Experiments awaiting evidence — explicit deterministic rule
  // (awaiting first observation / quiet follow-up window), not a
  // reminder manufactured because the record exists.
  for (const e of intel.experiments) {
    if (!e.followUp) continue
    items.push({
      ...base,
      kind: "experiment",
      rank: 3,
      text: `experiment "${e.title}" — ${EXPERIMENT_FOLLOW_UP_LABELS[e.followUp]}`,
    })
  }
  for (const f of intel.pendingInterventions) {
    items.push({ ...base, kind: "intervention", rank: 4, text: f.text })
  }
  // Staleness uses the product's existing 3-day signal (same threshold
  // as next-action's staleDiary rule) — not a manufactured alarm.
  if (intel.daysSinceUpdate != null && intel.daysSinceUpdate >= 3 && intel.stage !== "COMPLETED") {
    items.push({
      ...base,
      kind: "stale",
      rank: 5,
      text: `no update in ${intel.daysSinceUpdate} days`,
    })
  }
  items.sort((a, b) => a.rank - b.rank)
  return items.slice(0, 4)
}

/** One-line "state of this grow" for a cockpit row — posture label. */
export function postureLabel(posture: DecisionPosture): string {
  switch (posture) {
    case "act": return "action suggested"
    case "wait": return "evaluating a change"
    case "monitor": return "watching things settle"
    case "collect": return "needs more data"
    case "stable": return "on track"
  }
}
