// TerpBot BOT_ASSIST — longitudinal trigger registry (Phase H7).
// Pure evaluation: the functions perform no I/O (the interventionKey
// import shares the session layer's identity format so dedupe keys
// can't drift apart). Every trigger evaluates the already-
// merged owner-scope context + diagnosis and either produces one
// AssistFire or nothing.
//
// Contract (see spec):
// - Evidence-triggered only: no fire without a concrete, named signal.
// - Dedupe is carried in `key` — the BotEvent claim makes a key
//   once-ever, so the key embeds the evidence EPOCH (stale-week bucket,
//   episode count, intervention day, shift start week). A repeated scan
//   of unchanged state produces the same key and is silently absorbed;
//   a genuine state transition produces a new key = legitimate re-arm.
// - No ADJUST action class: proactive assists only ever ask the grower
//   to MEASURE / OBSERVE / VERIFY / COMPARE / LOG / WAIT.
// - No urgency vocabulary: severities are INFO / ATTENTION / CHECK.
// - Copy is canonical-only: metric labels, symptom labels, day counts.
//   Never raw diary/chat text, never internal ids, never a percentage
//   the data doesn't contain, never a causation claim.

import { CANDIDATES } from "@/lib/terpbot-intel-knowledge"
import { SCHEMA_SERIES, MEASUREMENT_INFO } from "@/lib/terpbot-intel"
import { interventionKey } from "@/lib/terpbot-session"
import { SYMPTOM_LABELS, LOCATION_LABELS } from "@/lib/terpbot-nl-vocab"
import { STALE_DAYS } from "@/lib/terpbot-intel-types"
import type {
  ActionClass,
  Diagnosis,
  GrowContextView,
  MetricId,
  SessionSnapshot,
  SymptomEpisode,
} from "@/lib/terpbot-intel-types"

const DAY = 86400000

export type AssistSeverity = "INFO" | "ATTENTION" | "CHECK"
type AssistAction = Exclude<ActionClass, "ADJUST">

export interface AssistFire {
  /** registry id — also the BotEvent.command / assist kind */
  triggerId: string
  severity: AssistSeverity
  actionClass: AssistAction
  /** once-per-evidence-epoch BotEvent key (includes diaryId) */
  key: string
  /** notification title — compact, canonical */
  title: string
  /** notification body — ≤500 chars, plain text, one idea */
  content: string
  /** reportable metric the assist asks for, when it asks */
  stepId?: MetricId
  /** canonical-scalar audit line — why the trigger fired */
  reason: string
}

interface AssistInput {
  ctx: GrowContextView
  diagnosis: Diagnosis
  /** derived at read time — caller runs episodesFromObservations */
  episodes: SymptomEpisode[]
  /** last persisted session snapshot — the gap-fill diff base */
  snapshot?: SessionSnapshot
}

const metricLabel = (m: MetricId) => MEASUREMENT_INFO[m]?.label ?? m

/** Chat-command references only make sense for public diaries — the
 *  commands run scope:"public" and can't see a private grow's data,
 *  so an assist for a PRIVATE/UNLISTED diary must not point at a
 *  /why trail that doesn't exist or a /check that can't see it. */
const pubRef = (ctx: GrowContextView, s: string) =>
  ctx.diary.visibility === "PUBLIC" ? s : ""

/** The newest REAL point for a metric — tApproximate points are
 *  parked approximations and must not back a concrete "N days old"
 *  claim. Returns null when no real point exists. */
function newestRealPoint(ctx: GrowContextView, m: MetricId): { t: number; ageDays: number } | null {
  const key = SCHEMA_SERIES[m]
  if (!key) return null
  let last = 0
  for (const p of ctx.series[key].points) {
    if (!p.tApproximate && p.t > last) last = p.t
  }
  return last ? { t: last, ageDays: (ctx.now - last) / DAY } : null
}

const symptomLabel = (e: SymptomEpisode) =>
  SYMPTOM_LABELS[e.symptom] ?? e.symptom.toLowerCase().replace(/_/g, " ")

const placeLabel = (e: SymptomEpisode) =>
  e.location ? ` (${(LOCATION_LABELS[e.location] ?? e.location).toLowerCase()})` : ""

/** The most useful next measurement a live candidate is missing — the
 *  "one useful next step" the assist copy points at. */
function discriminator(diagnosis: Diagnosis): { metric: MetricId; label: string } | null {
  for (const c of diagnosis.candidates) {
    if (c.state === "insufficient") continue
    const m = c.nextMeasurement?.id ?? c.requiredMissing[0]
    if (m && SCHEMA_SERIES[m as MetricId]) {
      return { metric: m as MetricId, label: metricLabel(m as MetricId) }
    }
  }
  return null
}

// ── T1 · stale critical measurement ────────────────────────────────
// A logged/reported metric that still backs a live candidate has aged
// past STALE_DAYS. Re-arm epoch: each additional stale WEEK — the key
// changes only when the situation materially worsened (freshness
// crossing another 7-day boundary), never on a plain calendar tick.

function staleMeasurement({ ctx, diagnosis }: AssistInput): AssistFire[] {
  const live = diagnosis.candidates.filter((c) => c.state !== "insufficient")
  if (!live.length) return []
  const fires: AssistFire[] = []
  for (const m of Object.keys(SCHEMA_SERIES) as MetricId[]) {
    // Age comes from the newest REAL point — an unbounded-past report
    // parked at t−30d (tApproximate) must not produce a fabricated
    // "your reading is 30 days old" claim.
    const newest = newestRealPoint(ctx, m)
    if (!newest || newest.ageDays < STALE_DAYS) continue
    const backs = live.some((c) => {
      const def = CANDIDATES[c.id]
      return !!def && (def.requiredInputs.includes(m) || def.discriminatingInputs.includes(m))
    })
    if (!backs) continue
    const days = Math.floor(newest.ageDays)
    fires.push({
      triggerId: "stale-measurement",
      severity: days >= 21 ? "ATTENTION" : "INFO",
      actionClass: "VERIFY",
      // Epoch: stale-week bucket anchored to the last real reading's
      // day — a fresh reading ends the episode, and a metric that goes
      // stale AGAIN gets a new anchor instead of replaying dead keys.
      key: `assist:stale-metric:${ctx.diary.id}:${m}:r${Math.floor(newest.t / DAY)}:w${Math.floor(newest.ageDays / 7)}`,
      title: `Your ${metricLabel(m)} reading is ${days} days old`,
      content:
        `The open question on your grow still leans on a ${days}-day-old ${metricLabel(m)} reading. ` +
        `A current one would sharpen the picture — type it in chat or log it on your diary.${pubRef(ctx, " /check shows why.")}`,
      stepId: m,
      reason: `freshness[${m}]=${days}d backs ${live[0].id} (${live[0].state})`,
    })
  }
  return fires
}

// ── T2 · persistent unresolved issue ───────────────────────────────
// Same symptom reported across several days, never resolved. Re-arm
// epoch: the episode's firstSeen day — one assist per episode instance.
// A recurred episode is T5's job, not this one's.

function persistentSymptom({ ctx, diagnosis, episodes }: AssistInput): AssistFire[] {
  const disc = discriminator(diagnosis)
  const fires: AssistFire[] = []
  for (const ep of episodes) {
    if (ep.status !== "active" || ep.approximate) continue
    // span is measured across REAL reports only — a synthetic
    // unbounded-history point (pastUnresolved) must not inflate
    // "reported over N days" into something the grower never said
    const real = ctx.observations
      .filter((o) => o.symptom === ep.symptom && o.location === ep.location && !o.tApproximate)
      .map((o) => o.t)
    if (real.length < 2) continue
    const spanDays = Math.floor((Math.max(...real) - Math.min(...real)) / DAY)
    if (spanDays < 3) continue // needs reports spread over days
    // once ever per (diary, symptom, location): the episode's firstSeen
    // slides forward as observations age out of the window, which would
    // re-key and re-nag for the identical issue. If it resolves and
    // returns, that's recurrence — T5's lane, a new key there.
    fires.push({
      triggerId: "persistent-symptom",
      severity: spanDays >= 7 ? "CHECK" : "ATTENTION",
      actionClass: disc ? "VERIFY" : "OBSERVE",
      key: `assist:persist:${ctx.diary.id}:${ep.symptom}|${ep.location ?? ""}`,
      title: `${symptomLabel(ep)} — still unresolved`,
      content:
        `You've reported ${symptomLabel(ep).toLowerCase()}${placeLabel(ep)} across ${spanDays + 1} days without a clear resolution. ` +
        (disc
          ? `A current ${disc.label} reading would help narrow it down — type it in chat or log it.${pubRef(ctx, " /why explains.")}`
          : `A fresh look and a note on what's changed would help` +
            (ctx.diary.visibility === "PUBLIC"
              ? ` — type /check in chat for the next step.`
              : ` — log it on your diary.`)),
      stepId: disc?.metric,
      reason: `episode ${ep.symptom}|${ep.location ?? ""} active, span=${spanDays}d across ${real.length} reports`,
    })
  }
  return fires
}

// ── T3 · meaningful baseline shift ─────────────────────────────────
// Personal baseline moved beyond epsilon and the new level has held ≥2
// days. Never "your RH is wrong" — baseline = the grower's own history,
// a change detector, not a horticultural verdict. Re-arm epoch: the
// week the shift began + its direction — a flip or a genuinely new
// shift re-keys; persistence alone doesn't.

const BASELINE_METRICS: MetricId[] = ["temperature", "humidity", "ph", "ec", "runoffPh", "runoffEc"]

function baselineShift({ ctx }: AssistInput): AssistFire[] {
  const fires: AssistFire[] = []
  for (const m of BASELINE_METRICS) {
    const key = SCHEMA_SERIES[m]
    if (!key) continue
    const ch = ctx.series[key].change
    const b = ctx.baselines[m]
    if (!ch || !b || b.tier === "insufficient") continue
    if (ch.direction !== "up" && ch.direction !== "down") continue
    if ((ch.durationDays ?? 0) < 2) continue
    // durationDays is anchored to `now` — gate on the newest real
    // reading so "running higher for Nd" never describes data that
    // stopped arriving; silence past STALE_DAYS is T1's lane instead
    const newest = newestRealPoint(ctx, m)
    if (!newest || newest.ageDays > STALE_DAYS) continue
    // 30-day run-start bucket — a week bucket can jitter across a
    // boundary when durationDays is re-estimated from new points and
    // re-fire the same ongoing shift after the cushion lapses.
    const runStartMonth = Math.floor((ctx.now - (ch.durationDays ?? 0) * DAY) / (30 * DAY))
    fires.push({
      triggerId: "baseline-shift",
      severity: "INFO",
      actionClass: "VERIFY",
      key: `assist:bshift:${ctx.diary.id}:${m}:${ch.direction}:m${runStartMonth}`,
      title: `Your ${metricLabel(m)} has shifted`,
      content:
        `Recent ${metricLabel(m)} readings are running noticeably ${ch.direction === "up" ? "higher" : "lower"} ` +
        `than your own recent baseline — for about ${ch.durationDays}d now. Worth checking whether that change was ` +
        `intentional.${pubRef(ctx, " /status in chat shows the detail.")}`,
      stepId: m,
      reason: `${m} ${ch.direction} vs ${b.tier} baseline, held ${ch.durationDays}d`,
    })
  }
  return fires
}

// ── T4 · post-intervention follow-up ───────────────────────────────
// A session-recorded intervention 2–7 days old with no after-reading
// yet. Once ever per intervention (the intervention identity IS the
// key). Window lapses at 7d — we stay silent rather than nag. Never
// claims the intervention worked or didn't.

function interventionFollowup({ ctx }: AssistInput): AssistFire[] {
  const fires: AssistFire[] = []
  for (const iv of ctx.interventions ?? []) {
    if (iv.pastUnresolved) continue
    const m = iv.targetMetric
    const key = m ? SCHEMA_SERIES[m] : undefined
    if (!m || !key) continue
    const at = iv.eventT ?? iv.at
    const days = Math.floor((ctx.now - at) / DAY)
    if (days < 2 || days > 7) continue
    const answered = ctx.series[key].points.some((p) => !p.tApproximate && p.t > at)
    if (answered) continue
    fires.push({
      triggerId: "intervention-followup",
      severity: "INFO",
      actionClass: "MEASURE",
      key: `assist:ivfup:${ctx.diary.id}:${interventionKey(iv)}`,
      title: `Follow-up on your adjustment`,
      content:
        `You adjusted things ~${days}d ago. A current ${metricLabel(m)} reading would show whether the ` +
        `environment moved the way you intended — type it in chat or log it on your diary.`,
      stepId: m,
      reason: `intervention ${interventionKey(iv)} pending follow-up at ${days}d`,
    })
  }
  return fires
}

// ── T5 · recurring issue ───────────────────────────────────────────
// A resolved episode has recurred. Re-arm epoch: episodeCount — each
// genuine recurrence is new evidence. Copy stays correlational: "a
// similar pattern appeared again" — never "X caused it".

function recurrence({ ctx, episodes }: AssistInput): AssistFire[] {
  const fires: AssistFire[] = []
  for (const ep of episodes) {
    if (ep.status !== "recurred" || ep.approximate || ep.episodeCount < 2) continue
    const prev = ep.lastResolvedAt
      ? `around ${Math.max(1, Math.floor((ctx.now - ep.lastResolvedAt) / DAY))}d ago`
      : "earlier"
    fires.push({
      triggerId: "recurrence",
      severity: "ATTENTION",
      actionClass: "OBSERVE",
      key: `assist:recur:${ctx.diary.id}:${ep.symptom}|${ep.location ?? ""}:ep${ep.episodeCount}`,
      title: `${symptomLabel(ep)} has returned`,
      content:
        `You saw a similar episode ${prev}. Comparing today's conditions with then may help spot what's ` +
        `driving it${pubRef(ctx, " — /changes in chat shows what's different since")}.`,
      reason: `episode ${ep.symptom}|${ep.location ?? ""} recurred (count=${ep.episodeCount})`,
    })
  }
  return fires
}

// ── T6 · fresh evidence closing an old gap ─────────────────────────
// The last snapshot recorded a metric as missing; a real point has
// since landed. Once per gap-fill event — the key carries the snapshot
// day, so a new gap-filling reading under a new snapshot re-keys
// legitimately.

function gapFilled({ ctx, snapshot }: AssistInput): AssistFire[] {
  if (!snapshot?.missing?.length) return []
  // the snapshot belongs to the diary it was taken on — a gap recorded
  // on diary A must not fire because diary B happens to have data
  if (snapshot.diaryId && snapshot.diaryId !== ctx.diary.id) return []
  const snapDay = Math.floor(snapshot.at / DAY)
  const fires: AssistFire[] = []
  for (const m of snapshot.missing) {
    const key = SCHEMA_SERIES[m]
    if (!key) continue
    const age = ctx.freshness[m]
    if (age == null || age > 2) continue // landed, and landed recently
    fires.push({
      triggerId: "gap-filled",
      severity: "INFO",
      actionClass: "VERIFY",
      key: `assist:gapfill:${ctx.diary.id}:${m}:d${snapDay}`,
      title: `Your ${metricLabel(m)} reading is in`,
      content:
        `${metricLabel(m)} was a gap last time we looked — the new reading can change the picture.` +
        pubRef(ctx, ` /check in chat re-evaluates with it included.`),
      stepId: m,
      reason: `snapshot d${snapDay} missing ${m}; now fresh (${age}d)`,
    })
  }
  return fires
}

// ── registry + ranking ──────────────────────────────────────────────

type Trigger = (input: AssistInput) => AssistFire[]

/** Evaluation order is also the final tie-break order within a
 *  severity band — persistent/recurring issues outrank data hygiene. */
export const ASSIST_TRIGGERS: Trigger[] = [
  persistentSymptom,
  recurrence,
  staleMeasurement,
  interventionFollowup,
  baselineShift,
  gapFilled,
]

const SEVERITY_RANK: Record<AssistSeverity, number> = { CHECK: 0, ATTENTION: 1, INFO: 2 }

/** All eligible fires, ranked: severity, then registry order. The
 *  caller sends at most the top one — the 7-day cross-kind cushion in
 *  botAssist would absorb a second anyway. */
export function evaluateAssists(input: AssistInput): AssistFire[] {
  const fires = ASSIST_TRIGGERS.flatMap((t) => t(input))
  return fires.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
}
