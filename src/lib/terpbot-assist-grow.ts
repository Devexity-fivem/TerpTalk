// TerpBot BOT_ASSIST — longitudinal grow scan (Phase H7).
//
// Daily-cron entry point: pick growers with fresh evidence, build each
// one's OWNER-scope grow context, evaluate the deterministic trigger
// registry, deliver at most one private BOT_ASSIST notification via
// the shared botAssist() pipeline (claim-first dedupe + 3/day cap +
// 7-day cross-kind cushion + notifyOnBotAssist pref — unchanged).
//
// PRIVACY CONTRACT — owner scope, explicit at the call site:
//   candidates are diaries read from the DB; ownerId is always the
//   diary row's own authorId, never a request value. buildGrowContext
//   enforces `id = diaryId AND authorId = ownerId AND deleted = false
//   AND harvested = false` in a single query — a foreign, deleted, or
//   harvested diary resolves to null and is skipped. The output leaves
//   only via notify({ userId: ownerId, type: "BOT_ASSIST" }) — never a
//   chat post, never another user's inbox, and nothing here observes
//   DirectMessage/Report/SecurityEvent/staff tables.
//
// Bounded by design: ≤100 candidate users per run (deterministic
// order), ≤20 sends per run, at most 1 fire per user per run (the
// cushion would absorb a second anyway — evaluating is cheap, sending
// is what the budget protects).

import { prisma } from "@/lib/prisma"
import { activeAuthor } from "@/lib/security"
import { botAssist } from "@/lib/terpbot-assist"
import { evaluateAssists } from "@/lib/terpbot-assist-triggers"
import { buildGrowContext } from "@/lib/terpbot-intel-context"
import { episodesFromObservations } from "@/lib/terpbot-intel-episodes"
import {
  mergeInterventions,
  mergeObservations,
  mergeReported,
  mergeResolutions,
} from "@/lib/terpbot-intel-merge"
import { snapshotFrom } from "@/lib/terpbot-intel-status"
import { evaluateContext, MEASUREMENT_INFO } from "@/lib/terpbot-intel"
import { buildWhyTrail } from "@/lib/terpbot-intel-why"
import { loadSession, saveSession } from "@/lib/terpbot-session"
import type { GrowContextView } from "@/lib/terpbot-intel-types"

const DAY = 86400000
const SCAN_USER_CAP = 100
const SEND_CAP = 20
/** diaries untouched longer than this are the diary-stale assist's job;
 *  the longitudinal scan only watches grows with recent evidence */
const RECENT_DIARY_MS = 14 * DAY

/** Owner-scope composition — the private twin of terpbot-data's
 *  intelContextFor. The scope literal stays at this call site and is
 *  never derived from runtime input. */
async function assistContextFor(userId: string, diaryId: string, now: number) {
  const session = await loadSession(userId, now)
  // buildGrowContext enforces authorId === ownerId internally — a stale
  // or foreign diaryId can only resolve the caller's own diary or null.
  const base: GrowContextView | null = await buildGrowContext(diaryId, {
    ownerId: userId,
    scope: "owner",
    now: new Date(now),
  })
  if (!base) return null
  // Session evidence only merges onto the diary it was recorded
  // against — a session linked to another (or deleted) diary must not
  // contaminate this grow's context with a different grow's reports.
  const linked = !session?.diaryId || session.diaryId === diaryId
  const state = linked ? session?.state : undefined
  const merged = mergeInterventions(
    mergeResolutions(
      mergeObservations(
        mergeReported(base, state?.reported ?? [], now),
        state?.observations ?? []
      ),
      state?.resolutions ?? []
    ),
    state?.interventions ?? []
  )
  return { session, merged }
}

/**
 * Daily scan — evaluate longitudinal triggers over each eligible
 * grower's own data and deliver the single most useful private assist.
 */
export async function scanGrowAssists(opts: {
  /** Test seam: restrict the scan to these author ids. Omit in production. */
  authorIds?: string[]
} = {}): Promise<{ scanned: number; sent: number }> {
  const now = Date.now()

  // Candidates: owners of diaries with recent activity. Owner scope
  // means PRIVATE/UNLISTED diaries are eligible too — the notification
  // only ever reaches the diary's own author.
  const diaries = await prisma.growDiary.findMany({
    where: {
      deleted: false,
      harvested: false,
      updatedAt: { gte: new Date(now - RECENT_DIARY_MS) },
      author: activeAuthor(),
      ...(opts.authorIds ? { authorId: { in: opts.authorIds } } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: SCAN_USER_CAP,
    select: { id: true, authorId: true },
  })

  // Live sessions add growers whose evidence is chat-reported rather
  // than diary-logged — a diary untouched for weeks can still carry a
  // pending intervention the grower told TerpBot about yesterday.
  const sessions = await prisma.botSession.findMany({
    where: {
      expiresAt: { gt: new Date(now) },
      ...(opts.authorIds ? { userId: { in: opts.authorIds } } : {}),
      user: activeAuthor(),
    },
    orderBy: { updatedAt: "desc" },
    take: SCAN_USER_CAP,
    select: { userId: true, diaryId: true },
  })

  // One entry per user: session-linked diary wins (it's what the
  // longitudinal state actually attaches to), else the newest active
  // diary. Session users with no diary at all are dropped — every
  // trigger key is diary-scoped and a context needs a diary.
  const targets = new Map<string, string | null>()
  for (const s of sessions) {
    if (!targets.has(s.userId)) targets.set(s.userId, s.diaryId)
  }
  for (const d of diaries) {
    // a null session link isn't a link — let the newest diary take it
    if (!targets.get(d.authorId)) targets.set(d.authorId, d.id)
  }
  const userIds = [...targets.keys()].slice(0, SCAN_USER_CAP)

  let sent = 0
  let scanned = 0
  for (const userId of userIds) {
    if (sent >= SEND_CAP) break
    // Per-user isolation: one bad row (corrupt session, transient DB
    // error, a data-dependent crash) must not starve everyone after it
    // in the deterministic scan order — log, skip, move on.
    try {
      // A session user with no linked diary — or whose linked diary was
      // deleted/harvested since — still needs a context: fall back to
      // their newest live diary (rare path, lazy per-user lookup).
      let diaryId = targets.get(userId)
      let composed = diaryId ? await assistContextFor(userId, diaryId, now) : null
      if (!composed) {
        const d = await prisma.growDiary.findFirst({
          where: { authorId: userId, deleted: false, harvested: false },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          select: { id: true },
        })
        diaryId = d?.id ?? null
        if (!diaryId) continue
        composed = await assistContextFor(userId, diaryId, now)
        if (!composed) continue
      }
      scanned++

      // Session interventions only live inside the 24h BotSession TTL,
      // but a follow-up window spans days 2–7 — a quiet grower's
      // session would expire before their follow-up becomes due.
      // Refresh the row's expiry while a pending-window intervention
      // exists so T4 can actually reach them later in the week. Read
      // from the merged context — interventions recorded against a
      // different diary don't keep a session alive for this one.
      const hasPendingWindowIv = (composed.merged.interventions ?? []).some((iv) => {
        if (iv.pastUnresolved || !iv.targetMetric) return false
        const d = (now - (iv.eventT ?? iv.at)) / DAY
        return d >= 2 && d <= 7
      })
      if (hasPendingWindowIv) {
        await prisma.botSession.updateMany({
          where: { userId, expiresAt: { gt: new Date(now) } },
          data: { expiresAt: new Date(now + 24 * 60 * 60 * 1000) },
        })
      }

      const diagnosis = evaluateContext(composed.merged)
      const episodes = episodesFromObservations(
        composed.merged.observations,
        composed.merged.resolutions ?? []
      )
      const fires = evaluateAssists({
        ctx: composed.merged,
        diagnosis,
        episodes,
        snapshot: composed.session?.state.snapshot,
      })
      if (!fires.length) continue

      // Skip fires whose evidence-epoch key is already claimed — a dead
      // key at the top of the ranking must yield to fresh evidence
      // below it, not starve every other trigger for the life of the
      // episode. claimBotEvent still dedupes atomically on the race.
      const claimedKeys = new Set(
        (
          await prisma.botEvent.findMany({
            where: { key: { in: fires.map((f) => f.key) } },
            select: { key: true },
          })
        ).map((r) => r.key)
      )
      const fire = fires.find((f) => !claimedKeys.has(f.key))
      if (!fire) continue

      const result = await botAssist({
        key: fire.key,
        kind: fire.triggerId,
        userId,
        title: fire.title,
        content: fire.content,
        link: `/chat`,
        metadata: {
          kind: "grow-assist",
          triggerId: fire.triggerId,
          actionClass: fire.actionClass,
          severity: fire.severity,
        },
      })
      if (result !== "sent") continue
      sent++

      // The assist's reasoning stays answerable: persist the /why trail
      // + the asked-for step on the session so typing /why or a bare
      // reading in chat continues the thread. For PUBLIC diaries only —
      // trail AND snapshot both render in public rooms (/why, /changes)
      // and would echo private readings/stage into a room; session.
      // diaryId is documented public-scope-only, so a private diary's
      // id never lands on it (the existing link is preserved instead).
      // pendingAsk is a canonical metric id — safe for any visibility.
      const pub = composed.merged.diary.visibility === "PUBLIC"
      try {
        await saveSession(
          userId,
          {
            diaryId: pub ? (diaryId ?? null) : (composed.session?.diaryId ?? null),
            pendingAsk: fire.stepId ?? composed.session?.pendingAsk ?? null,
            ...(pub
              ? {
                  trail: buildWhyTrail(
                    composed.merged,
                    diagnosis,
                    now,
                    fire.stepId
                      ? {
                          id: fire.stepId,
                          label: MEASUREMENT_INFO[fire.stepId]?.label ?? fire.stepId,
                          // render-safe authored why — never the audit
                          // reason (it carries candidate ids)
                          why: MEASUREMENT_INFO[fire.stepId]?.why ?? fire.title,
                        }
                      : undefined
                  ),
                  snapshot: snapshotFrom(composed.merged, diagnosis, now),
                }
              : {}),
          },
          now
        )
      } catch {
        // session write is best-effort — the notification already landed
      }
    } catch (e) {
      console.error("[terpbot] grow-assist scan failed for user:", userId, e)
    }
  }
  return { scanned, sent }
}
