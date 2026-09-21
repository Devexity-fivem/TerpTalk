// TerpBot session continuity — one expiring BotSession row per user.
// Bounded state only: structured measurements, structured symptom
// observations, and the last /why trail. NEVER stores message text,
// spans, refIds, room ids, other users' ids, or diary content —
// `diaryId` is a public-scope, owner-verified id used only to re-fetch
// through buildGrowContext on the next turn.
// Server-only module (Prisma). The pure state types live in
// terpbot-intel-types.ts.

import { prisma } from "@/lib/prisma"
import { KNOWLEDGE_VERSION } from "@/lib/terpbot-intel-knowledge"
import type {
  NextStepId,
  ReportedPoint,
  SessionObservation,
  SessionState,
} from "@/lib/terpbot-intel-types"

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000
const MAX_POINTS = 24

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
    },
  }
}

export async function saveSession(
  userId: string,
  data: { diaryId: string | null; state: SessionState; pendingAsk: string | null },
  now: number
): Promise<void> {
  const state: SessionState = {
    ...data.state,
    reported: trimPoints(data.state.reported),
    observations: trimObservations(data.state.observations),
  }
  const expiresAt = new Date(now + SESSION_TTL_MS)
  await prisma.botSession.upsert({
    where: { userId },
    create: {
      userId,
      diaryId: data.diaryId,
      knowledgeVersion: KNOWLEDGE_VERSION,
      state: state as object,
      pendingAsk: data.pendingAsk,
      expiresAt,
    },
    update: {
      diaryId: data.diaryId,
      knowledgeVersion: KNOWLEDGE_VERSION,
      state: state as object,
      pendingAsk: data.pendingAsk,
      expiresAt,
    },
  })
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
