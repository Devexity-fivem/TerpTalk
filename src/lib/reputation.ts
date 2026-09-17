// Server-side reputation logic. Anything that touches Prisma lives here;
// the isomorphic values and tier maths live in reputation-config so client
// components can import them without pulling PrismaClient into the browser.
//
// Reputation 2.0 model:
//   - Profile.reputation is a denormalized balance for hot reads/leaderboards.
//   - ReputationEvent is the append-only ledger. Invariant:
//       reputation == SUM(amount) over ALL rows — reversedAt/reversalOfId
//       are audit status, not sum filters.
//   - Awards are synchronous and idempotent via `key` (P2002 -> no-op).
//   - Reversals are signed counter-entries (type REVERSAL, reversalOfId set);
//     the original row gets reversedAt stamped. Re-awarding a reversed key
//     reinstates the original and voids its counter-entries.
//   - Only side effects (tier/badge/notification work) stay deferred.
import { after } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import {
  BADGE_BONUS,
  CHAT_DAILY_BADGE_CAP,
  LIKE_MIN_ACTOR_AGE_HOURS,
  REP_CAPS,
  REP_EVENT_TYPES,
  REP_POINTS,
  REFERRAL_MAX_PER_WEEK,
  REFERRAL_MIN_AGE_HOURS,
  REFERRAL_MIN_REP,
  TRUST_EVENT_TYPES,
  VERIFIED_MIN_AGE_DAYS,
  VERIFIED_MIN_REPUTATION,
  VERIFIED_MULTIPLIER,
  crossedRungs,
  getRepStage,
  getReputationTier,
} from "@/lib/reputation-config"
import { canEquip, cosmeticsUnlockedBetween, nextLockedCosmetic } from "@/lib/cosmetics"
import { seedBadges } from "@/lib/badges"
import { BADGE_REGISTRY, BADGE_CATEGORIES, type BadgeCategory } from "@/lib/badge-registry"
import { announceBadges, announceTierUp } from "@/lib/terpbot"
import { notify } from "@/lib/notify"
import { rateLimit } from "@/lib/rate-limit"
import { getGrowStreak } from "@/lib/grow-streak"
import { TERPBOT_USERNAME } from "@/lib/terpbot-constants"

// Defense in depth: TerpBot can never earn human reputation or human
// badges — even if a future code path regresses and hands it points
// (e.g. referral attribution). One indexed lookup per call.
async function isBotUser(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { profile: { select: { username: true } } },
  })
  return u?.profile?.username === TERPBOT_USERNAME
}

// Re-exported for existing server-side callers.
export {
  REP_POINTS,
  REP_TIERS,
  REP_CAPS,
  REP_EVENT_TYPES,
  PUBLIC_REP_TYPES,
  REP_LADDER,
  getReputationTier,
  getNextTier,
  getTierProgress,
  getRepStage,
  getRepLevel,
  getStageProgress,
  publicRepLabel,
  type ReputationTier,
  type RepStage,
  getTrustStanding,
  getNextTrustStanding,
  TRUST_EVENT_TYPES,
  type TrustStanding,
} from "@/lib/reputation-config"

export interface AwardOptions {
  key?: string // idempotency token — strongly recommended for all awards
  sourceType?: string // THREAD | POST | DIARY | SETUP | STRAIN | STRAIN_PHOTO | CONTEST
  sourceId?: string // enables bulk reversal when the source is deleted
  actorId?: string // liker / acceptor / staff member who triggered it
  force?: boolean // staff adjustments bypass the banned/suspended recipient skip
}

export interface AwardResult {
  awarded: boolean
  reinstated?: boolean
  amount?: number
  oldRep?: number
  newRep?: number
  skippedReason?: "bot" | "no-user" | "suspended" | "self" | "duplicate" | "capped" | "locked"
}

type AwardUser = {
  role: string | null
  createdAt: Date
  banned: boolean
  suspendedUntil: Date | null
}

function isInactive(user: AwardUser): boolean {
  if (user.banned) return true
  if (user.suspendedUntil && user.suspendedUntil.getTime() > Date.now()) return true
  return false
}

function adjustedAmount(amount: number, role: string | null): number {
  if (role !== "VERIFIED_MEMBER") return amount
  // floor-based bonus: +50% never doubles a 1-point event (1 -> 1, 2 -> 3, 10 -> 15)
  return amount + Math.floor(amount * (VERIFIED_MULTIPLIER - 1))
}

/**
 * The synchronous, transactional heart of Reputation 2.0. Safe to call from
 * scripts/tests (no `after()`), idempotent under retries and concurrency.
 */
export async function applyReputationAward(
  userId: string,
  type: string,
  amount: number,
  reason: string,
  opts: AwardOptions = {}
): Promise<AwardResult> {
  try {
    const subject = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        createdAt: true,
        banned: true,
        suspendedUntil: true,
        profile: { select: { reputation: true, username: true } },
      },
    })
    if (!subject?.profile) return { awarded: false, skippedReason: "no-user" }
    if (subject.profile.username === TERPBOT_USERNAME) return { awarded: false, skippedReason: "bot" }
    if (!opts.force && isInactive(subject)) return { awarded: false, skippedReason: "suspended" }
    // Self-awards are meaningless — callsites already block them; this is the
    // safety net for any path that forgets (staff adjustments exempt).
    if (opts.actorId === userId && type !== REP_EVENT_TYPES.STAFF_ADJUSTMENT) {
      return { awarded: false, skippedReason: "self" }
    }

    // Existing keyed event: active -> no-op; reversed -> reinstate it —
    // unless a staff reversal marked it final, in which case the organic
    // re-trigger is refused and the moderation decision stands.
    if (opts.key) {
      const existing = await prisma.reputationEvent.findUnique({
        where: { key: opts.key },
        select: { id: true, userId: true, amount: true, reversedAt: true, reversalFinal: true },
      })
      if (existing) {
        if (!existing.reversedAt) return { awarded: false, skippedReason: "duplicate" }
        if (existing.reversalFinal) return { awarded: false, skippedReason: "locked" }
        return await reinstateEvent(existing, subject)
      }
    }

    const cap = REP_CAPS[type as keyof typeof REP_CAPS]
    const adjusted = type === REP_EVENT_TYPES.STAFF_ADJUSTMENT ? amount : adjustedAmount(amount, subject.role)
    const oldRep = subject.profile.reputation
    // Clamp negative events to the current balance: the ledger records the
    // actually-applied delta, so balance == SUM(active) always holds and the
    // balance can never dip below zero.
    const applied = adjusted < 0 ? -Math.min(-adjusted, oldRep) : adjusted

    // Serializable for capped types: under read-committed, two parallel
    // awards could both read the same count and both slip under the cap.
    // Serialization failures (P2034) get one transparent retry.
    const runTx = () =>
      prisma.$transaction(
        async (tx) => {
          if (cap !== undefined) {
            const dayStart = new Date()
            dayStart.setUTCHours(0, 0, 0, 0)
            const today = await tx.reputationEvent.count({
              where: { userId, type, reversedAt: null, createdAt: { gte: dayStart } },
            })
            if (today >= cap) return "capped" as const
          }
          await tx.reputationEvent.create({
            data: {
              userId,
              type,
              amount: applied,
              reason,
              key: opts.key,
              sourceType: opts.sourceType,
              sourceId: opts.sourceId,
              actorId: opts.actorId,
            },
          })
          await tx.profile.update({
            where: { userId },
            data: { reputation: { increment: applied } },
          })
          if (applied < 0) {
            await tx.profile.updateMany({
              where: { userId, reputation: { lt: 0 } },
              data: { reputation: 0 },
            })
          }
          return oldRep + applied
        },
        cap !== undefined ? { isolationLevel: "Serializable" } : undefined
      )
    let txResult: number | "capped"
    try {
      txResult = await runTx()
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        txResult = await runTx()
      } else {
        throw error
      }
    }
    if (txResult === "capped") return { awarded: false, skippedReason: "capped" }
    return { awarded: true, amount: applied, oldRep, newRep: txResult }
  } catch (error) {
    // Concurrent keyed award lost the race — the winner already incremented.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { awarded: false, skippedReason: "duplicate" }
    }
    // Callers universally swallow award failures to keep the user action
    // non-blocking — this log is the only observability that the award was
    // lost. It covers every failure point in the function (subject lookup,
    // key pre-check, transaction), and the key is NOT consumed, so the next
    // trigger can still retry.
    console.error("[reputation] award failed:", { userId, type, key: opts.key, sourceType: opts.sourceType, sourceId: opts.sourceId }, error)
    throw error
  }
}

// Undo a previously reversed keyed event: clear the original's reversed
// status and append a REINSTATE row that exactly compensates its prior
// deductions (which may have been clamped below the original amount).
async function reinstateEvent(
  original: { id: string; userId: string; amount: number },
  subject: { profile: { reputation: number } | null }
): Promise<AwardResult> {
  const oldRep = subject.profile?.reputation ?? 0
  let restored = 0
  const newRep = await prisma.$transaction(async (tx) => {
    // CAS guard includes reversalFinal: a staff-final reversal committing
    // between the caller's pre-check and this update must NOT be cleared —
    // the moderation decision stands and the organic re-trigger loses.
    const { count } = await tx.reputationEvent.updateMany({
      where: { id: original.id, reversedAt: { not: null }, reversalFinal: false },
      data: { reversedAt: null },
    })
    if (count === 0) {
      // Lost the CAS: either a concurrent reinstate won or a final reversal
      // landed in between. Distinguish so the caller reports accurately.
      const cur = await tx.reputationEvent.findUnique({
        where: { id: original.id },
        select: { reversalFinal: true, reversedAt: true },
      })
      return cur?.reversedAt && cur.reversalFinal ? "locked" : null
    }
    const descendants = await tx.reputationEvent.findMany({
      where: { reversalOfId: original.id },
      select: { amount: true },
    })
    const restore = -descendants.reduce((s, d) => s + d.amount, 0)
    restored = restore
    // Mark reversal rows undone (status only — every row counts toward the sum).
    await tx.reputationEvent.updateMany({
      where: { reversalOfId: original.id, type: REP_EVENT_TYPES.REVERSAL },
      data: { reversedAt: new Date() },
    })
    if (restore !== 0) {
      const src = await tx.reputationEvent.findUnique({
        where: { id: original.id },
        select: { sourceType: true, sourceId: true },
      })
      await tx.reputationEvent.create({
        data: {
          userId: original.userId,
          type: REP_EVENT_TYPES.REINSTATE,
          amount: restore,
          reason: "Award reinstated",
          key: `rein:${original.id}:${descendants.length}`,
          reversalOfId: original.id,
          sourceType: src?.sourceType,
          sourceId: src?.sourceId,
        },
      })
      await tx.profile.update({
        where: { userId: original.userId },
        data: { reputation: { increment: restore } },
      })
    }
    return oldRep + restore
  })
  if (newRep === "locked") return { awarded: false, skippedReason: "locked" }
  if (newRep === null) return { awarded: false, skippedReason: "duplicate" }
  return { awarded: true, reinstated: true, amount: restored, oldRep, newRep }
}

// ─── Reversals ────────────────────────────────────────────────────────

export interface ReversalResult {
  reversed: boolean
  eventId?: string
  newRep?: number
}

/**
 * Reverse one ledger row with a signed counter-entry. Idempotent.
 * `final: true` marks the reversal as a staff decision — later organic
 * re-triggers of the same key will NOT reinstate the award.
 */
export async function reverseReputationEvent(
  eventId: string,
  reason: string,
  actorId?: string,
  opts: { final?: boolean } = {}
): Promise<ReversalResult> {
  const outcome = await prisma.$transaction(async (tx) => {
    const original = await tx.reputationEvent.findUnique({
      where: { id: eventId },
      select: { id: true, userId: true, amount: true, reversedAt: true, reversalFinal: true, type: true, sourceType: true, sourceId: true },
    })
    if (!original || original.reversedAt) return null
    const subjectUserId = original.userId

    const { count } = await tx.reputationEvent.updateMany({
      where: { id: original.id, reversedAt: null },
      data: { reversedAt: new Date(), ...(opts.final ? { reversalFinal: true } : {}) },
    })
    if (count === 0) return null // concurrent reversal won

    const seq = await tx.reputationEvent.count({ where: { reversalOfId: original.id } })
    // Clamp the counter-entry to the current balance — if a concurrent
    // adjustment already drew the balance down, the reversal records the
    // actually-applied delta so balance == SUM(active) still holds.
    const current = await tx.profile.findUnique({
      where: { userId: original.userId },
      select: { reputation: true },
    })
    const applied = -Math.min(original.amount, current?.reputation ?? 0)
    await tx.reputationEvent.create({
      data: {
        userId: original.userId,
        type: REP_EVENT_TYPES.REVERSAL,
        amount: applied,
        reason,
        key: `rev:${original.id}:${seq}`,
        reversalOfId: original.id,
        sourceType: original.sourceType,
        sourceId: original.sourceId,
        actorId,
      },
    })
    const profile = await tx.profile.update({
      where: { userId: original.userId },
      data: { reputation: { increment: applied } },
      select: { reputation: true },
    })
    return { newRep: Math.max(0, profile.reputation), userId: subjectUserId }
  })

  if (outcome === null) return { reversed: false }
  await postDemotionEffects(outcome.userId).catch((e) =>
    console.error("[reputation] post-demotion effects failed:", outcome.userId, e)
  )
  return { reversed: true, eventId, newRep: outcome.newRep }
}

/** Reverse a keyed award (e.g. "like:<reactor>:post:<id>"). Idempotent. */
export async function reverseReputationByKey(key: string, reason: string, actorId?: string): Promise<ReversalResult> {
  const original = await prisma.reputationEvent.findUnique({
    where: { key },
    select: { id: true },
  })
  if (!original) return { reversed: false }
  try {
    return await reverseReputationEvent(original.id, reason, actorId)
  } catch (err) {
    // Most callers `.catch(() => null)` — without this log a failed
    // un-like/un-accept reversal would silently keep the points.
    console.error("[reputation] keyed reversal failed:", key, err)
    throw err
  }
}

/** Reverse every active event tied to a deleted source (post, thread, diary…). */
export async function reverseReputationBySource(
  sourceType: string,
  sourceId: string,
  reason: string,
  actorId?: string
): Promise<number> {
  // reversalOfId: null selects only root award rows — REVERSAL and REINSTATE
  // rows share the original's sourceType/sourceId, and reversing them would
  // double-deduct (the counter-entries already net out in the balance).
  let events
  try {
    events = await prisma.reputationEvent.findMany({
      where: { sourceType, sourceId, reversedAt: null, reversalOfId: null, type: { not: REP_EVENT_TYPES.REVERSAL } },
      select: { id: true },
    })
  } catch (error) {
    // Callers `.catch(() => 0)` — without this log a failed source sweep
    // silently leaves every award attached to deleted content.
    console.error("[reputation] source reversal lookup failed:", sourceType, sourceId, error)
    throw error
  }
  let reversed = 0
  for (const e of events) {
    try {
      const r = await reverseReputationEvent(e.id, reason, actorId)
      if (r.reversed) reversed++
    } catch (err) {
      // Callers swallow reversal failures — the log is the only trace that
      // rep stayed attached to removed content.
      console.error("[reputation] reversal failed:", sourceType, sourceId, e.id, err)
    }
  }
  return reversed
}

/** Reverse every active event a user *caused* (e.g. likes they granted). */
export async function reverseReputationByActor(actorId: string, reason: string): Promise<number> {
  let events
  try {
    events = await prisma.reputationEvent.findMany({
      where: { actorId, reversedAt: null, reversalOfId: null, type: { not: REP_EVENT_TYPES.REVERSAL } },
      select: { id: true },
    })
  } catch (error) {
    console.error("[reputation] actor reversal lookup failed:", actorId, error)
    throw error
  }
  let reversed = 0
  // Bounded concurrency — a ban can reverse thousands of granted events;
  // unbounded Promise.all would exhaust the Neon pool.
  const BATCH = 25
  for (let i = 0; i < events.length; i += BATCH) {
    const results = await Promise.all(
      events.slice(i, i + BATCH).map((e) =>
        reverseReputationEvent(e.id, reason, actorId).catch((err) => {
          console.error("[reputation] actor reversal failed:", actorId, e.id, err)
          return { reversed: false } as ReversalResult
        })
      )
    )
    reversed += results.filter((r) => r.reversed).length
  }
  return reversed
}

// If a reversal/adjustment drops a verified member below the threshold,
// demote them back to MEMBER (and bump sessionVersion so sessions refresh).
async function demoteIfNeeded(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, profile: { select: { reputation: true } } },
  })
  if (!user || user.role !== "VERIFIED_MEMBER") return
  const rep = user.profile?.reputation ?? 0
  if (rep >= VERIFIED_MIN_REPUTATION) return
  await prisma.user.update({
    where: { id: userId },
    data: { role: "MEMBER", sessionVersion: { increment: 1 } },
  })
  await notify({
    userId,
    type: "REPUTATION",
    title: "Standing changed",
    content: `Your reputation fell below ${VERIFIED_MIN_REPUTATION.toLocaleString()}, so the Verified Member tag was removed.`,
    link: "/profile",
  }).catch(() => null)
}

// After a reputation drop, strip anything the member no longer qualifies
// for: equipped cosmetics above their rep and showcase pins beyond their
// current tier's slot count. Defense-in-depth — equip writes are already
// gated by canEquip(), this closes the read-after-demotion gap.
async function enforceCosmeticUnlocks(userId: string) {
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { reputation: true, avatarFrame: true, profileTitle: true, profileTheme: true },
  })
  if (!profile) return
  const rep = profile.reputation

  const clear: Record<string, null> = {}
  if (profile.avatarFrame && !canEquip(rep, "frames", profile.avatarFrame)) clear.avatarFrame = null
  if (profile.profileTitle && !canEquip(rep, "titles", profile.profileTitle)) clear.profileTitle = null
  if (profile.profileTheme && !canEquip(rep, "themes", profile.profileTheme)) clear.profileTheme = null
  if (Object.keys(clear).length > 0) {
    await prisma.profile.update({ where: { userId }, data: clear })
  }

  const slots = getReputationTier(rep).perks.showcaseSlots ?? 0
  const pinned = await prisma.userBadge.findMany({
    where: { userId, pinned: true },
    orderBy: { earnedAt: "asc" },
    select: { id: true },
  })
  const overflow = pinned.slice(slots)
  if (overflow.length > 0) {
    await prisma.userBadge.updateMany({
      where: { id: { in: overflow.map((b) => b.id) } },
      data: { pinned: false },
    })
  }
}

// Exported for staff tooling — applies demotion + cosmetic pruning after
// negative adjustments and reversals. Best-effort: callers swallow errors,
// so failures are logged here rather than at every callsite.
export async function postDemotionEffects(userId: string) {
  try {
    await demoteIfNeeded(userId)
    await enforceCosmeticUnlocks(userId)
  } catch (error) {
    console.error("[reputation] post-demotion effects failed:", userId, error)
  }
}

// ─── Side effects (deferred; never part of the balance transaction) ───

// Event types that count as a real contribution for the hidden discovery
// badges — check-ins, bookkeeping, and payouts deliberately don't count.
const CONTRIBUTION_TYPES = new Set([
  "THREAD_CREATED",
  "POST_CREATED",
  "DIARY_CREATED",
  "DIARY_UPDATE",
  "STRAIN_CREATED",
  "STRAIN_PHOTO",
  "SETUP_CREATED",
])

// Run one deferred side-effect stage in isolation — a throwing stage is
// logged and must never starve later stages (e.g. a badge failure used to
// skip the referral payout check entirely).
export async function runEffectStage(
  userId: string,
  stage: string,
  fn: () => Promise<unknown>
): Promise<void> {
  try {
    await fn()
  } catch (error) {
    console.error(`[reputation] side-effect "${stage}" failed for user ${userId}:`, error)
  }
}

async function postAwardEffects(
  userId: string,
  user: AwardUser,
  oldRep: number,
  newRep: number,
  type?: string
) {
  // The tier name feeds the badge announcement copy — capture it across the
  // stage boundary so a badge failure still can't take the tier check down.
  let announcedTier: string | null = null
  await runEffectStage(userId, "tier", async () => {
    announcedTier = await checkTierChange(userId, oldRep, newRep)
  })
  await runEffectStage(userId, "stage", () => checkStageChange(userId, oldRep, newRep))
  await runEffectStage(userId, "verify", () => autoVerify(userId, newRep, user))
  await runEffectStage(userId, "badges", () => checkBadges(userId, { announcedTierName: announcedTier }))
  await runEffectStage(userId, "referral", () => maybePayReferral(userId, user, newRep))
  if (type && CONTRIBUTION_TYPES.has(type)) {
    await runEffectStage(userId, "discovery-badges", () => checkDiscoveryBadges(userId))
  }
}

// Exported for paths that write reputation directly (admin adjustments,
// contest resolutions) — they must still run the full milestone pipeline.
export async function runPostAwardEffects(userId: string, oldRep: number, newRep: number, type?: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, createdAt: true, banned: true, suspendedUntil: true },
  })
  if (!user) return
  await postAwardEffects(userId, user, oldRep, newRep, type)
}

// Hidden discovery badges tied to contribution events (not stats):
//   Four Twenty — any contribution on April 20 UTC.
//   Comeback    — first contribution after a 90+ day contribution gap.
async function checkDiscoveryBadges(userId: string) {
  const now = new Date()
  if (now.getUTCMonth() === 3 && now.getUTCDate() === 20) {
    await grantBadge(userId, "Four Twenty", { announce: true })
  }

  const prev = await prisma.reputationEvent.findMany({
    where: { userId, type: { in: [...CONTRIBUTION_TYPES] }, reversalOfId: null },
    orderBy: { createdAt: "desc" },
    take: 2,
    select: { createdAt: true },
  })
  // prev[0] is the contribution just made; prev[1] is the one before it.
  if (prev.length === 2 && now.getTime() - prev[1].createdAt.getTime() > 90 * 86400000) {
    await grantBadge(userId, "Comeback", { announce: true })
  }
}

// Once-ever milestone claims: a keyed 0-amount MILESTONE ledger row. The
// unique `key` makes "has this celebration already fired" durable and
// race-safe — the P2002 loser skips. amount=0 keeps balance == SUM(amount).
async function claimMilestone(userId: string, key: string): Promise<boolean> {
  try {
    await prisma.reputationEvent.create({
      data: {
        userId,
        type: REP_EVENT_TYPES.MILESTONE,
        amount: 0,
        reason: "Milestone marker",
        key,
      },
    })
    return true
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false
    throw error
  }
}

// Referral rep pays only once the referred member proves legitimate:
// REFERRAL_MIN_REP earned + REFERRAL_MIN_AGE_HOURS old. Keyed per referee.
//
// This is the single canonical eligibility/payout path — both the deferred
// post-award trigger and the daily reconciliation sweep call it, so the
// business rules can never diverge between entry points.
async function payReferralBonus(refereeUserId: string, refereeCreatedAt: Date, refereeRep: number) {
  if (refereeRep < REFERRAL_MIN_REP) return
  const ageHours = (Date.now() - refereeCreatedAt.getTime()) / (1000 * 60 * 60)
  if (ageHours < REFERRAL_MIN_AGE_HOURS) return

  const profile = await prisma.profile.findUnique({
    where: { userId: refereeUserId },
    select: { referredById: true },
  })
  if (!profile?.referredById) return
  const referrer = await prisma.profile.findUnique({
    where: { id: profile.referredById },
    select: { userId: true },
  })
  if (!referrer || referrer.userId === refereeUserId) return

  // Weekly payout cap — a sock farm grinding 25 rep per fake signup can't
  // earn unbounded referral rep. Organic referrals (a few a week at most)
  // never notice the limit.
  const weekAgo = new Date(Date.now() - 7 * 86400000)
  const recentPayouts = await prisma.reputationEvent.count({
    where: {
      userId: referrer.userId,
      type: "REFERRAL",
      reversedAt: null,
      createdAt: { gte: weekAgo },
    },
  })
  if (recentPayouts >= REFERRAL_MAX_PER_WEEK) return

  const res = await applyReputationAward(
    referrer.userId,
    "REFERRAL",
    REP_POINTS.REFERRAL,
    "A member you invited became an established grower",
    { key: `referral:${refereeUserId}`, actorId: refereeUserId }
  )
  if (!res.awarded) return

  // The award is already committed — notification delivery stays
  // non-blocking, but a failure must be observable (never re-award).
  await notify({
    userId: referrer.userId,
    type: "REPUTATION",
    title: "Referral bonus",
    content: `A member you invited became an established grower — +${res.amount ?? REP_POINTS.REFERRAL} reputation.`,
    link: "/profile",
  }).catch((error) => {
    console.error(`[reputation] referral payout notification failed for referrer ${referrer.userId} (referee ${refereeUserId}):`, error)
  })

  // Referrer's own side effects (tier/badge checks) for the new points.
  const referrerUser = await prisma.user.findUnique({
    where: { id: referrer.userId },
    select: { role: true, createdAt: true, banned: true, suspendedUntil: true },
  })
  if (referrerUser && res.newRep !== undefined) {
    await postAwardEffects(referrer.userId, referrerUser, res.oldRep ?? res.newRep, res.newRep, "REFERRAL")
  }
}

// Deferred trigger inside the award pipeline — delegates to the canonical
// payout so award-time and sweep-time eligibility can never diverge.
async function maybePayReferral(userId: string, user: AwardUser, newRep: number) {
  await payReferralBonus(userId, user.createdAt, newRep)
}

/**
 * Referral reconciliation sweep — the safety net for qualifying referrals
 * whose payout trigger was lost (deferred side effect dropped, earlier stage
 * failed, referrer was suspended at the moment of qualification, or the
 * referee simply went dormant after crossing the threshold).
 *
 * Bounded: reads at most `limit` candidate profiles (referredById set,
 * rep >= threshold, account old enough), skips referees whose
 * `referral:<userId>` key already has an active event, and hands each
 * remaining candidate to the canonical payReferralBonus — the unique key
 * makes a concurrent normal-path payout safe (P2002 -> duplicate no-op).
 * Reversed-but-not-final keys flow through the canonical path and reinstate
 * exactly as an organic re-trigger would.
 *
 * Throws after processing all candidates if any payout attempt errored, so
 * callers (cron claims) can release the task and retry on the next run.
 */
export async function reconcileReferralPayouts(
  limit = 200
): Promise<{ candidates: number; attempted: number; failed: number }> {
  const cutoff = new Date(Date.now() - REFERRAL_MIN_AGE_HOURS * 60 * 60 * 1000)
  const candidates = await prisma.profile.findMany({
    where: {
      referredById: { not: null },
      reputation: { gte: REFERRAL_MIN_REP },
      user: { createdAt: { lte: cutoff } },
    },
    select: {
      userId: true,
      reputation: true,
      user: { select: { createdAt: true } },
    },
    orderBy: { userId: "asc" },
    take: limit,
  })
  if (candidates.length === 0) return { candidates: 0, attempted: 0, failed: 0 }

  // One indexed read filters out referees whose payout is already live —
  // reversed/final keys deliberately stay eligible so the canonical path
  // applies its own reinstate/locked semantics.
  const keys = candidates.map((c) => `referral:${c.userId}`)
  const active = await prisma.reputationEvent.findMany({
    where: { key: { in: keys }, reversedAt: null },
    select: { key: true },
  })
  const alreadyPaid = new Set(active.map((e) => e.key))

  let attempted = 0
  let failed = 0
  for (const c of candidates) {
    if (alreadyPaid.has(`referral:${c.userId}`)) continue
    attempted++
    try {
      await payReferralBonus(c.userId, c.user.createdAt, c.reputation)
    } catch (error) {
      failed++
      console.error("[reputation] referral reconciliation failed for referee", c.userId, error)
    }
  }
  if (failed > 0) {
    throw new Error(`referral reconciliation: ${failed}/${attempted} payouts failed`)
  }
  return { candidates: candidates.length, attempted, failed }
}

/**
 * Award reputation. The ledger write is synchronous; tier/badge/referral
 * side effects are deferred (or run inline outside a request scope).
 */
export async function awardReputation(
  userId: string,
  type: string,
  amount: number,
  reason: string,
  opts: AwardOptions = {}
): Promise<AwardResult> {
  const res = await applyReputationAward(userId, type, amount, reason, opts)
  if (!res.awarded) return res

  let subject: AwardUser | null
  try {
    subject = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, createdAt: true, banned: true, suspendedUntil: true },
    })
  } catch (error) {
    console.error("[reputation] post-award subject lookup failed:", { userId, type, key: opts.key }, error)
    throw error
  }
  if (!subject) return res

  const effects = async () => {
    try {
      await postAwardEffects(userId, subject, res.oldRep ?? 0, res.newRep ?? 0, type)
    } catch (error) {
      console.error("[awardReputation] side-effect error:", error)
    }
  }
  try {
    after(effects)
  } catch {
    // Outside a request scope (tests, scripts) — run inline instead.
    await effects()
  }
  return res
}

// ─── Badges ───────────────────────────────────────────────────────────

export interface UserStats {
  posts: number
  threads: number
  diaries: number
  diaryUpdates: number
  chatMessages: number
  strains: number
  strainPhotos: number
  setups: number
  likesReceived: number
  acceptedAnswers: number
  referrals: number
  reputation: number
  memberNumber: number // 1-based registration order — powers "Early Supporter"
  harvestedDiaries: number // diaries marked harvested — bounded by real grow time
  growStreak: number // consecutive UTC days with a diary update
  wellLikedPosts: number // posts liked by 3+ distinct members
  distinctAskers: number // threads' distinct authors where user's reply is the accepted answer
  likesGivenDistinct: number // distinct members the user has liked
  acceptsMarked: number // own threads where the user marked an accepted answer
}

// Badge rules — GENERATED from BADGE_REGISTRY progress specs so the grant
// rule and the UI progress bar can never disagree. Badges without a
// `progress` spec (streaks, contest honours, staff awards) are granted by
// their dedicated code paths, not here. Exported read-only for TerpBot's
// /nextbadges command; awarding still goes through checkBadges().
export const BADGE_RULES: Record<string, (s: UserStats) => boolean> = Object.fromEntries(
  BADGE_REGISTRY.flatMap((b): [string, (s: UserStats) => boolean][] => {
    const spec = b.progress
    if (!spec) return []
    const rule =
      spec.direction === "lte"
        ? (s: UserStats) => {
            const v = Number(s[spec.stats[0] as keyof UserStats] ?? 0)
            return v > 0 && v <= spec.target
          }
        : (s: UserStats) =>
            spec.stats.reduce((sum, k) => sum + Number(s[k as keyof UserStats] ?? 0), 0) >= spec.target
    return [[b.name, rule]]
  })
)

let badgeSeedComplete = false

export async function getUserStats(userId: string, needed?: Set<keyof UserStats>): Promise<UserStats> {
  const want = (k: keyof UserStats) => !needed || needed.has(k)
  const likeMinAge = new Date(Date.now() - LIKE_MIN_ACTOR_AGE_HOURS * 3600 * 1000)
  const [posts, threads, diaries, diaryUpdates, , strains, strainPhotos, setups, likesReceived, acceptedAnswers, paidReferrals, harvestedDiaries, wellLikedPosts, distinctAskers, likesGivenDistinct, acceptsMarked, user] =
    await Promise.all([
      want("posts") ? prisma.post.count({ where: { authorId: userId, deleted: false, thread: { deleted: false } } }) : 0,
      want("threads") ? prisma.thread.count({ where: { authorId: userId, deleted: false } }) : 0,
      want("diaries") ? prisma.growDiary.count({ where: { authorId: userId, deleted: false } }) : 0,
      want("diaryUpdates") ? prisma.diaryUpdate.count({ where: { authorId: userId, diary: { deleted: false } } }) : 0,
      0, // chatMessages comes from the profile counter below
      want("strains") ? prisma.strain.count({ where: { createdById: userId } }) : 0,
      want("strainPhotos") ? prisma.strainPhoto.count({ where: { userId } }) : 0,
      want("setups") ? prisma.growSetup.count({ where: { authorId: userId, deleted: false } }) : 0,
      // Only legitimate likers count toward badge stats — the same gate the
      // rep payout uses. Without this, banned/brand-new socks could farm the
      // likesReceived badge line with zero rep cost and no flag surface.
      want("likesReceived")
        ? prisma.reaction.count({
            where: {
              type: "LIKE",
              user: { banned: false, createdAt: { lte: likeMinAge } },
              OR: [{ post: { authorId: userId, deleted: false, thread: { deleted: false } } }, { diary: { authorId: userId, deleted: false } }],
            },
          })
        : 0,
      want("acceptedAnswers")
        ? prisma.post.count({
            where: {
              authorId: userId,
              deleted: false,
              thread: { deleted: false },
              acceptedAnswerFor: { isNot: null },
            },
          })
        : 0,
      // Referral badges count only referrals that actually paid out — a pile
      // of fake signups must not advance the Recruiter line.
      want("referrals")
        ? prisma.reputationEvent.count({
            where: { userId, type: "REFERRAL", reversedAt: null },
          })
        : 0,
      want("harvestedDiaries")
        ? prisma.growDiary.count({ where: { authorId: userId, deleted: false, harvested: true } })
        : 0,
      want("wellLikedPosts")
        ? prisma.$queryRaw<{ n: bigint }[]>`
            SELECT COUNT(*) AS n FROM (
              SELECT p."id" FROM "Post" p
              JOIN "Reaction" r ON r."postId" = p."id" AND r."type" = 'LIKE'
              JOIN "User" ru ON ru."id" = r."userId" AND ru."banned" = false
              WHERE p."authorId" = ${userId} AND p."deleted" = false
              GROUP BY p."id" HAVING COUNT(DISTINCT r."userId") >= 3
            ) t`.then((r) => Number(r[0]?.n ?? 0))
        : 0,
      want("distinctAskers")
        ? prisma.$queryRaw<{ n: bigint }[]>`
            SELECT COUNT(DISTINCT t."authorId") AS n
            FROM "Post" p
            JOIN "Thread" t ON t."id" = p."threadId"
            WHERE p."authorId" = ${userId} AND p."deleted" = false AND t."deleted" = false
              AND t."acceptedAnswerId" = p."id" AND t."authorId" <> ${userId}`.then((r) => Number(r[0]?.n ?? 0))
        : 0,
      want("likesGivenDistinct")
        ? prisma.$queryRaw<{ n: bigint }[]>`
            SELECT COUNT(DISTINCT COALESCE(p."authorId", d."authorId")) AS n
            FROM "Reaction" r
            LEFT JOIN "Post" p ON p."id" = r."postId" AND p."deleted" = false
            LEFT JOIN "GrowDiary" d ON d."id" = r."diaryId" AND d."deleted" = false
            WHERE r."userId" = ${userId} AND r."type" = 'LIKE'
              AND COALESCE(p."authorId", d."authorId") IS NOT NULL
              AND COALESCE(p."authorId", d."authorId") <> ${userId}`.then((r) => Number(r[0]?.n ?? 0))
        : 0,
      want("acceptsMarked")
        ? prisma.thread.count({
            where: { authorId: userId, deleted: false, acceptedAnswerId: { not: null } },
          })
        : 0,
      want("memberNumber") || want("reputation") || want("chatMessages")
        ? prisma.user.findUnique({
            where: { id: userId },
            select: {
              createdAt: true,
              profile: { select: { reputation: true, chatMessageCount: true } },
            },
          })
        : null,
    ])

  const memberNumber = user && want("memberNumber")
    ? (await prisma.user.count({ where: { createdAt: { lt: user.createdAt } } })) + 1
    : 0

  return {
    posts,
    threads,
    diaries,
    diaryUpdates,
    // Lifetime counter — survives room clears and the 3-day chat prune,
    // which used to silently reset social-badge progress.
    chatMessages: user?.profile?.chatMessageCount ?? 0,
    strains,
    strainPhotos,
    setups,
    likesReceived,
    acceptedAnswers,
    referrals: paidReferrals,
    reputation: user?.profile?.reputation ?? 0,
    memberNumber,
    harvestedDiaries,
    growStreak: want("growStreak") ? (await getGrowStreak(userId)).streak : 0,
    wellLikedPosts,
    distinctAskers,
    likesGivenDistinct,
    acceptsMarked,
  }
}

// Notify and record when a user crosses into a higher reputation tier.
// Once-ever per tier per user: a keyed MILESTONE marker makes the
// celebration durable and race-safe — reversals demote the level but
// re-earning the tier never re-fires the announcement or toast.
async function checkTierChange(userId: string, oldRep: number, newRep: number): Promise<string | null> {
  const oldTier = getReputationTier(oldRep)
  const newTier = getReputationTier(newRep)
  if (newTier.threshold <= oldTier.threshold) return null
  if (!(await claimMilestone(userId, `milestone:tier:${userId}:${newTier.threshold}`))) return null

  const stage = getRepStage(newRep)
  const unlocks = cosmeticsUnlockedBetween(oldRep, newRep)

  await notify({
    userId,
    type: "REPUTATION",
    title: `Tier up: ${newTier.name}`,
    content: `You reached ${newRep.toLocaleString()} reputation and became a ${newTier.name}. ${newTier.benefit}`,
    link: "/reputation",
    metadata: {
      kind: "tier",
      level: stage.level,
      stageName: stage.stageName,
      rep: newRep,
      tier: { name: newTier.name, icon: newTier.icon, color: newTier.color, bg: newTier.bg },
      unlocks: unlocks.map((u) => ({ kind: u.kind, key: u.key, name: u.name })),
    },
  })

  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { username: true, publicMilestoneOptOut: true },
  })
  if (profile?.username && !profile.publicMilestoneOptOut) {
    await announceTierUp(
      profile.username,
      newTier.name,
      newRep,
      unlocks.map((u) => u.name)
    ).catch(() => null)
  }
  return newTier.name
}

// In-tier stage crossings — every Grow Level advance is a stage rung on
// REP_LADDER (tier rungs are handled above), so this is the per-level
// feedback layer. Light-weight: a notification with celebration metadata,
// once-ever per rung via MILESTONE markers.
async function checkStageChange(userId: string, oldRep: number, newRep: number) {
  const stages = crossedRungs(oldRep, newRep).filter((c) => c.kind === "stage")
  for (const crossing of stages) {
    if (!(await claimMilestone(userId, `milestone:stage:${userId}:${crossing.rung}`))) continue
    const stage = getRepStage(newRep)
    const nextUnlock = nextLockedCosmetic(newRep)
    await notify({
      userId,
      type: "REPUTATION",
      title: `Grow Level ${stage.level} — ${stage.stageName}`,
      content: nextUnlock
        ? `Your garden reached a new stage. Next unlock: ${nextUnlock.name} at ${nextUnlock.unlockedAt.toLocaleString()} rep.`
        : "Your garden reached a new stage.",
      link: "/reputation",
      metadata: {
        kind: "stage",
        level: stage.level,
        stageName: stage.stageName,
        rep: newRep,
        tier: {
          name: stage.tier.name,
          icon: stage.tier.icon,
          color: stage.tier.color,
          bg: stage.tier.bg,
        },
        nextUnlock: nextUnlock
          ? { kind: nextUnlock.kind, key: nextUnlock.key, name: nextUnlock.name, unlockedAt: nextUnlock.unlockedAt }
          : null,
      },
    }).catch(() => null)
  }
}

// Automatically promote trusted, active members to VERIFIED_MEMBER.
async function autoVerify(
  userId: string,
  newRep: number,
  user: AwardUser | null
) {
  if (!user || isInactive(user)) return
  if (user.role !== "MEMBER") return

  const ageDays = (Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24)
  if (ageDays < VERIFIED_MIN_AGE_DAYS || newRep < VERIFIED_MIN_REPUTATION) return

  await prisma.user.update({
    where: { id: userId },
    data: { role: "VERIFIED_MEMBER", sessionVersion: { increment: 1 } },
  })

  await notify({
    userId,
    type: "REPUTATION",
    title: "Verified Member",
    content: `You automatically earned the Verified Member tag for reaching ${VERIFIED_MIN_REPUTATION.toLocaleString()} reputation and being active for ${VERIFIED_MIN_AGE_DAYS} days. Enjoy a 1.5x reputation bonus.`,
    link: "/profile",
  })
}

/**
 * Unified badge grant used by checkBadges, contest awards, streak awards and
 * admin grants. Concurrency-safe (P2002 = already earned). Returns true when
 * this call actually granted the badge — callers should notify only then.
 */
export async function grantBadge(
  userId: string,
  badgeName: string,
  opts: { announce?: boolean; notifyUser?: boolean; content?: string; link?: string } = {}
): Promise<boolean> {
  if (!badgeSeedComplete) {
    await seedBadges()
    badgeSeedComplete = true
  }
  const badge = await prisma.badge.findUnique({ where: { name: badgeName } })
  if (!badge) return false
  try {
    await prisma.userBadge.create({ data: { userId, badgeId: badge.id } })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false
    throw error
  }

  if (opts.notifyUser !== false) {
    await notify({
      userId,
      type: "BADGE",
      title: "Badge earned",
      content: opts.content ?? `You earned the "${badge.name}" badge — ${badge.description}`,
      link: opts.link ?? "/profile",
    }).catch(() => null)
  }
  if (opts.announce) {
    const profile = await prisma.profile.findUnique({
      where: { userId },
      select: { username: true, publicMilestoneOptOut: true },
    })
    if (profile?.username && !profile.publicMilestoneOptOut) {
      await announceBadges(profile.username, [badge.name]).catch(() => null)
    }
  }

  // One-time rep bonus by rarity — a finite pool that can't scale with
  // spam. Keyed per badge so re-grants/reinstates can never double-pay.
  // Bot-only badges aren't in BADGE_REGISTRY and get no bonus.
  const def = BADGE_REGISTRY.find((b) => b.name === badge.name)
  if (def) {
    await awardReputation(userId, REP_EVENT_TYPES.BADGE_BONUS, BADGE_BONUS[def.rarity] ?? 15, `Badge earned: ${badge.name}`, {
      key: `badgebonus:${badge.name}:${userId}`,
    }).catch(() => null)
  }

  return true
}

// Evaluate all badge rules and grant any newly earned badges (+ notification).
// `announcedTierName` lets the caller suppress a duplicate chat announce when
// the same award just fired announceTierUp for the same-named milestone badge.
export async function checkBadges(userId: string, opts: { announcedTierName?: string | null } = {}) {
  if (await isBotUser(userId)) return
  if (!badgeSeedComplete) {
    await seedBadges()
    badgeSeedComplete = true
  }
  // Fetch badge state first so we only compute the stats that unearned,
  // rule-backed badges actually need — veterans with everything earned skip
  // the ~11 stat queries entirely.
  const allBadges = await prisma.badge.findMany()
  const earned = await prisma.userBadge.findMany({
    where: { userId },
    select: { badgeId: true, badge: { select: { name: true } } },
  })
  const earnedIds = new Set(earned.map((b) => b.badgeId))

  const neededStats = new Set<keyof UserStats>()
  for (const badge of allBadges) {
    if (earnedIds.has(badge.id)) continue
    const def = BADGE_REGISTRY.find((b) => b.name === badge.name)
    if (def?.progress) {
      for (const k of def.progress.stats) neededStats.add(k as keyof UserStats)
    }
  }

  const newlyEarned: string[] = []

  // Role-tracked badges self-heal here too, so staff promoted outside the
  // admin role-change API (seeds, direct edits) still get their badges.
  const userRole = (
    await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  )?.role
  const roleBadgeNames = [
    ...(userRole === "MODERATOR" || userRole === "ADMINISTRATOR" ? ["Moderator"] : []),
    ...(userRole === "ADMINISTRATOR" || userRole === "SUPPORT" ? ["Staff"] : []),
  ]
  for (const name of roleBadgeNames) {
    if (await grantBadge(userId, name, { notifyUser: false })) newlyEarned.push(name)
  }

  if (neededStats.size > 0) {
    const stats = await getUserStats(userId, neededStats)
    for (const badge of allBadges) {
      if (earnedIds.has(badge.id)) continue
      const rule = BADGE_RULES[badge.name]
      if (!rule || !rule(stats)) continue
      // grantBadge is P2002-safe; only count badges this call actually granted
      // so notifications/announcements never fire for a lost race.
      const granted = await grantBadge(userId, badge.name, { notifyUser: false })
      if (granted) newlyEarned.push(badge.name)
    }
  }

  const badgeIdByName = new Map(allBadges.map((b) => [b.name, b.id]))
  const isUnearned = (name: string) => {
    const id = badgeIdByName.get(name)
    return id !== undefined && !earnedIds.has(id)
  }

  // Deep Roots — account at least a year old with a contribution in the
  // last 90 days. Hidden; granted here because it's a composite stat check.
  if (isUnearned("Deep Roots")) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } })
    if (u && Date.now() - u.createdAt.getTime() >= 365 * 86400000) {
      const recent = await prisma.reputationEvent.findFirst({
        where: {
          userId,
          type: { in: [...CONTRIBUTION_TYPES] },
          reversedAt: null,
          createdAt: { gte: new Date(Date.now() - 90 * 86400000) },
        },
        select: { id: true },
      })
      if (recent && (await grantBadge(userId, "Deep Roots", { notifyUser: false }))) {
        newlyEarned.push("Deep Roots")
      }
    }
  }

  // Secret Stash — earned at least one badge in every non-staff category.
  // Meta-badge: hidden so it can't be deliberately gamed toward.
  if (isUnearned("Secret Stash")) {
    const covered = new Set<BadgeCategory>()
    for (const e of earned) {
      const def = BADGE_REGISTRY.find((b) => b.name === e.badge.name)
      if (def) covered.add(def.category)
    }
    for (const name of newlyEarned) {
      const def = BADGE_REGISTRY.find((b) => b.name === name)
      if (def) covered.add(def.category)
    }
    if (BADGE_CATEGORIES.every((c) => c === "staff" || covered.has(c))) {
      if (await grantBadge(userId, "Secret Stash", { notifyUser: false })) newlyEarned.push("Secret Stash")
    }
  }

  // Lazy backfill: badges granted before BADGE_BONUS existed still owe
  // their one-time bonus. Self-healing — runs once per member, then the
  // NOT EXISTS check returns empty forever after.
  const missingBonus = await prisma.$queryRaw<{ name: string }[]>`
    SELECT b."name" FROM "UserBadge" ub
    JOIN "Badge" b ON b."id" = ub."badgeId"
    WHERE ub."userId" = ${userId}
      AND NOT EXISTS (
        SELECT 1 FROM "ReputationEvent" e
        WHERE e."userId" = ${userId}
          AND e."key" = 'badgebonus:' || b."name" || ':' || ${userId}
      )`
  for (const row of missingBonus) {
    const def = BADGE_REGISTRY.find((b) => b.name === row.name)
    if (!def) continue // bot badges and stale rows get no bonus
    await awardReputation(userId, REP_EVENT_TYPES.BADGE_BONUS, BADGE_BONUS[def.rarity] ?? 15, `Badge earned: ${row.name}`, {
      key: `badgebonus:${row.name}:${userId}`,
    }).catch(() => null)
  }

  if (newlyEarned.length > 0) {
    // One grouped notification, not one per badge. Celebration metadata
    // carries the registry details so the client can render real badges.
    const earnedMeta = newlyEarned.map((name) => {
      const def = BADGE_REGISTRY.find((b) => b.name === name)
      return { name, rarity: def?.rarity ?? "common", icon: def?.icon ?? "🏅" }
    })
    await notify({
      userId,
      type: "BADGE",
      title: newlyEarned.length === 1 ? "Badge earned" : `${newlyEarned.length} badges earned`,
      content:
        newlyEarned.length === 1
          ? `You earned the "${newlyEarned[0]}" badge.`
          : `You earned: ${newlyEarned.join(", ")}.`,
      link: "/achievements",
      metadata: { kind: "badge", badges: earnedMeta },
    }).catch(() => null)

    const profile = await prisma.profile.findUnique({
      where: { userId },
      select: { username: true, publicMilestoneOptOut: true },
    })
    // A milestone badge sharing the just-announced tier's name would double-
    // post in chat — the tier-up announce already covers it.
    const toAnnounce = opts.announcedTierName
      ? newlyEarned.filter((n) => n !== opts.announcedTierName)
      : newlyEarned
    if (profile?.username && !profile.publicMilestoneOptOut && toAnnounce.length) {
      await announceBadges(profile.username, toAnnounce).catch(() => null)
    }
  }
}

// ─── Tier perks (real, enforced) ─────────────────────────────────────

// The perks a user's current tier grants. One indexed profile read.
export async function getTierPerks(userId: string) {
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { reputation: true },
  })
  return getReputationTier(profile?.reputation ?? 0).perks
}

// rateLimit() scaled by the caller's tier — Cultivator+ get a boost.
export async function repRateLimit(userId: string, key: string, baseLimit: number, windowMs: number) {
  const perks = await getTierPerks(userId)
  const limit = Math.floor(baseLimit * (perks.rateLimitBoost ?? 1))
  return rateLimit(key, limit, windowMs)
}

// ─── Community standing (trust axis) ─────────────────────────────────
// XP (the ledger balance) measures participation; standing measures peer
// validation. Only event types another member or staff had to cause count
// — volume alone can't raise it. Reversed originals are excluded (their
// counter-entries are REVERSAL/REINSTATE type and never match the list).
export async function getTrustScore(userId: string): Promise<number> {
  const agg = await prisma.reputationEvent.aggregate({
    where: { userId, type: { in: [...TRUST_EVENT_TYPES] }, reversedAt: null },
    _sum: { amount: true },
  })
  return Math.max(0, agg._sum.amount ?? 0)
}

// Badge checks normally ride the rep-award pipeline, which means purely
// social progress (chat messages, onboarding) stalls until the next rep
// event. This throttled entry point lets non-rep paths trigger a check at
// most once per hour per user — one atomic RateLimit upsert when idle.
export async function checkBadgesOccasionally(userId: string): Promise<void> {
  const rl = await rateLimit(`badgecheck:${userId}`, 1, 60 * 60 * 1000).catch(() => null)
  if (!rl?.allowed) return
  await checkBadges(userId)
}

// Chat contribution bookkeeping for the social badge line. The lifetime
// chatMessageCount only increments for the first CHAT_DAILY_BADGE_CAP
// messages per rolling day — chat spam can't speed-run "Chat Legend".
// Also gives badge checks a throttled trigger independent of rep awards.
export async function recordChatMessage(userId: string): Promise<void> {
  const rl = await rateLimit(`chatbadge:${userId}`, CHAT_DAILY_BADGE_CAP, 24 * 60 * 60 * 1000).catch(() => null)
  if (!rl?.allowed) return
  await prisma.profile
    .updateMany({ where: { userId }, data: { chatMessageCount: { increment: 1 } } })
    .catch(() => null)
  await checkBadgesOccasionally(userId)
}

// ─── Reconciliation ──────────────────────────────────────────────────

// Balance/ledger drift check — used by tests and ops. Every row's amount
// counts (reversedAt is status metadata), so this is a plain SUM.
export async function findReputationDrift(): Promise<{ userId: string; reputation: number; ledger: number }[]> {
  return prisma.$queryRaw<{ userId: string; reputation: number; ledger: number }[]>`
    SELECT p."userId", p.reputation, COALESCE(s.total, 0)::int AS ledger
    FROM "Profile" p
    LEFT JOIN (
      SELECT "userId", SUM("amount") AS total
      FROM "ReputationEvent"
      GROUP BY "userId"
    ) s ON s."userId" = p."userId"
    WHERE p.reputation <> COALESCE(s.total, 0)`
}
