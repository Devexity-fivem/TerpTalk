// TerpBot session continuity — one expiring BotSession row per user.
// Bounded state only: structured measurements, structured symptom
// observations, and the last /why trail. NEVER stores message text,
// spans, refIds, room ids, other users' ids, or diary content —
// `diaryId` is a public-scope, owner-verified id used only to re-fetch
// through buildGrowContext on the next turn.
// Server-only module (Prisma). The pure state types live in
// terpbot-intel-types.ts.
//
// Concurrency: slash commands run inline and mentions run through
// after(), so two requests can interleave between load and save.
// saveSession therefore writes DELTAS through an optimistic
// compare-and-swap (`version` column + updateMany predicate): the
// writer re-reads, merges its additions onto the freshest row, and
// retries on a lost race. Last-writer-wins is gone — a concurrent
// /checkin can never erase a /diagnose's observations.

import { prisma } from "@/lib/prisma"
import { KNOWLEDGE_VERSION } from "@/lib/terpbot-intel-knowledge"
import type {
  InterventionRecord,
  NextStepId,
  ReportedPoint,
  ResolutionClaim,
  SessionObservation,
  SessionSnapshot,
  SessionState,
} from "@/lib/terpbot-intel-types"

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000
const MAX_POINTS = 24
const MAX_INTERVENTIONS = 12
const MAX_RESOLUTIONS = 12
const CAS_ATTEMPTS = 3

export interface LoadedSession {
  diaryId: string | null
  pendingAsk: string | null
  state: SessionState
}

export async function loadSession(userId: string, now: number): Promise<LoadedSession | null> {
  const row = await prisma.botSession.findUnique({ where: { userId } })
  if (!row || row.expiresAt.getTime() <= now) return null
  const state = row.state as unknown as SessionState
  return {
    diaryId: row.diaryId,
    pendingAsk: row.pendingAsk as NextStepId | null,
    state: {
      reported: state.reported ?? [],
      observations: state.observations ?? [],
      stage: state.stage,
      trail: state.trail,
      interventions: state.interventions ?? [],
      resolutions: state.resolutions ?? [],
      snapshot: state.snapshot,
    },
  }
}

/** What one turn contributes. Append-only fields merge onto the live
 *  row; replace fields overwrite it. `undefined` leaves a replace
 *  field unchanged — `null` actively clears it. */
export interface SessionDelta {
  /** replace — the diary this turn reasoned over (null unlinks) */
  diaryId: string | null
  /** replace — the open question (null clears it) */
  pendingAsk: string | null
  /** replace only when provided — a stage claim from this turn */
  stage?: string
  /** replace only when provided — the /why trail for this turn */
  trail?: SessionState["trail"]
  /** append — measurements reported this turn */
  addReported?: ReportedPoint[]
  /** append — symptom observations reported this turn */
  addObservations?: SessionObservation[]
  /** append — interventions reported this turn */
  addInterventions?: InterventionRecord[]
  /** append — resolution/progression claims this turn */
  addResolutions?: (Omit<ResolutionClaim, "source">)[]
  /** replace only when provided — status snapshot for /changes */
  snapshot?: SessionSnapshot
}

const isP2002 = (e: unknown) =>
  typeof e === "object" && e != null && (e as { code?: string }).code === "P2002"

export async function saveSession(
  userId: string,
  delta: SessionDelta,
  now: number
): Promise<void> {
  const expiresAt = new Date(now + SESSION_TTL_MS)

  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const row = await prisma.botSession.findUnique({ where: { userId } })
    const live = row && row.expiresAt.getTime() > now ? row : null
    const curState = live ? (live.state as unknown as SessionState) : null
    const cur: SessionState = {
      reported: curState?.reported ?? [],
      observations: curState?.observations ?? [],
      stage: curState?.stage,
      trail: curState?.trail,
      interventions: curState?.interventions ?? [],
      resolutions: curState?.resolutions ?? [],
      snapshot: curState?.snapshot,
    }

    const next: SessionState = {
      reported: trimPoints(mergeReportedPoints(cur.reported, delta.addReported ?? [])),
      observations: trimObservations(
        mergeSessionObservations(cur.observations, delta.addObservations ?? [])
      ),
      stage: delta.stage !== undefined ? delta.stage : cur.stage,
      trail: delta.trail !== undefined ? delta.trail : cur.trail,
      interventions: trimByT(
        mergeByKey(cur.interventions ?? [], delta.addInterventions ?? [], interventionKey),
        MAX_INTERVENTIONS
      ),
      resolutions: trimByT(
        mergeByKey(cur.resolutions ?? [], delta.addResolutions ?? [], resolutionKey),
        MAX_RESOLUTIONS
      ),
      snapshot: delta.snapshot !== undefined ? delta.snapshot : cur.snapshot,
    }

    if (!live) {
      try {
        await prisma.botSession.create({
          data: {
            userId,
            diaryId: delta.diaryId,
            knowledgeVersion: KNOWLEDGE_VERSION,
            state: next as object,
            pendingAsk: delta.pendingAsk,
            expiresAt,
            version: 1,
          },
        })
        return
      } catch (e) {
        // Lost a create race — the winner's row now exists; merge onto it.
        if (isP2002(e)) continue
        throw e
      }
    }

    const r = await prisma.botSession.updateMany({
      where: { userId, version: live.version },
      data: {
        diaryId: delta.diaryId,
        knowledgeVersion: KNOWLEDGE_VERSION,
        state: next as object,
        pendingAsk: delta.pendingAsk,
        expiresAt,
        version: { increment: 1 },
      },
    })
    if (r.count === 1) return
    // count 0 — someone else wrote between our read and write; re-read
    // and merge the same delta onto their fresher state.
  }
  throw new Error(`botsession CAS exhausted ${CAS_ATTEMPTS} attempts for ${userId}`)
}

export async function clearSession(userId: string): Promise<void> {
  await prisma.botSession.deleteMany({ where: { userId } })
}

/** expired-row sweeper — called from the TerpBot cron alongside the
 *  other periodic sweeps */
export async function sweepExpiredSessions(now: number): Promise<number> {
  const r = await prisma.botSession.deleteMany({
    where: { expiresAt: { lt: new Date(now) } },
  })
  return r.count
}

// ── merge helpers ─────────────────────────────────────────────────
// Appends are deduped on their full content so a retried CAS merge can
// never double-record a point; ordering is by report time (arrival
// order) — event-time ordering is recomputed at mergeReported time.

function mergeReportedPoints(cur: ReportedPoint[], add: ReportedPoint[]): ReportedPoint[] {
  if (!add.length) return cur
  const seen = new Set(cur.map(pointKey))
  return [...cur, ...add.filter((p) => !seen.has(pointKey(p)))]
}

function mergeSessionObservations(
  cur: SessionObservation[],
  add: SessionObservation[]
): SessionObservation[] {
  if (!add.length) return cur
  const seen = new Set(cur.map(obsKey))
  return [...cur, ...add.filter((o) => !seen.has(obsKey(o)))]
}

const pointKey = (p: ReportedPoint) =>
  `${p.metric}|${p.value}|${p.unit ?? ""}|${p.t}|${p.eventT ?? ""}`

const obsKey = (o: SessionObservation) =>
  `${o.symptom}|${o.location ?? ""}|${o.stage ?? ""}|${o.period ?? ""}|${o.t}|${o.eventT ?? ""}`

const DAY = 86400000

/** one adjustment of a kind per target per day — CAS-retry safe */
const interventionKey = (i: InterventionRecord) =>
  `${i.type}|${i.targetMetric ?? ""}|${i.direction ?? ""}|${Math.floor((i.eventT ?? i.at) / DAY)}`

const resolutionKey = (r: Omit<ResolutionClaim, "source">) =>
  `${r.symptom ?? ""}|${r.location ?? ""}|${r.kind}|${Math.floor(r.t / DAY)}`

function mergeByKey<T>(cur: T[], add: T[], keyFn: (x: T) => string): T[] {
  if (!add.length) return cur
  const seen = new Set(cur.map(keyFn))
  return [...cur, ...add.filter((x) => !seen.has(keyFn(x)))]
}

function trimByT<T extends object>(items: T[], max: number): T[] {
  const time = (x: T) => {
    const o = x as { eventT?: number; at?: number; t?: number }
    return o.eventT ?? o.at ?? o.t ?? 0
  }
  return [...items].sort((a, b) => time(a) - time(b)).slice(-max)
}

// newest N points, ordered by t then metric — deterministic both in
// storage order and in what survives the trim
function trimPoints(points: ReportedPoint[]): ReportedPoint[] {
  return [...points]
    .sort((a, b) => a.t - b.t || a.metric.localeCompare(b.metric))
    .slice(-MAX_POINTS)
}

function trimObservations(obs: SessionObservation[]): SessionObservation[] {
  return [...obs]
    .sort((a, b) => a.t - b.t || a.symptom.localeCompare(b.symptom))
    .slice(-MAX_POINTS)
}
