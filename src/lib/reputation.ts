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
  REP_CAPS,
  REP_EVENT_TYPES,
  REP_POINTS,
  REFERRAL_MIN_AGE_HOURS,
  REFERRAL_MIN_REP,
  VERIFIED_MIN_AGE_DAYS,
  VERIFIED_MIN_REPUTATION,
  VERIFIED_MULTIPLIER,
  getReputationTier,
} from "@/lib/reputation-config"
import { seedBadges } from "@/lib/badges"
import { BADGE_REGISTRY } from "@/lib/badge-registry"
import { announceBadges, announceTierUp } from "@/lib/terpbot"
import { notify } from "@/lib/notify"
import { rateLimit } from "@/lib/rate-limit"
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
  skippedReason?: "bot" | "no-user" | "suspended" | "self" | "duplicate" | "capped"
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

  // Existing keyed event: active -> no-op; reversed -> reinstate it.
  if (opts.key) {
    const existing = await prisma.reputationEvent.findUnique({
      where: { key: opts.key },
      select: { id: true, userId: true, amount: true, reversedAt: true },
    })
    if (existing) {
      if (!existing.reversedAt) return { awarded: false, skippedReason: "duplicate" }
      return reinstateEvent(existing, subject)
    }
  }

  const cap = REP_CAPS[type as keyof typeof REP_CAPS]
  if (cap !== undefined) {
    const dayStart = new Date()
    dayStart.setUTCHours(0, 0, 0, 0)
    const today = await prisma.reputationEvent.count({
      where: { userId, type, reversedAt: null, createdAt: { gte: dayStart } },
    })
    if (today >= cap) return { awarded: false, skippedReason: "capped" }
  }

  const adjusted = type === REP_EVENT_TYPES.STAFF_ADJUSTMENT ? amount : adjustedAmount(amount, subject.role)
  const oldRep = subject.profile.reputation
  // Clamp negative events to the current balance: the ledger records the
  // actually-applied delta, so balance == SUM(active) always holds and the
  // balance can never dip below zero.
  const applied = adjusted < 0 ? -Math.min(-adjusted, oldRep) : adjusted

  try {
    const newRep = await prisma.$transaction(async (tx) => {
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
    })
    return { awarded: true, amount: applied, oldRep, newRep }
  } catch (error) {
    // Concurrent keyed award lost the race — the winner already incremented.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { awarded: false, skippedReason: "duplicate" }
    }
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
    const { count } = await tx.reputationEvent.updateMany({
      where: { id: original.id, reversedAt: { not: null } },
      data: { reversedAt: null },
    })
    if (count === 0) return null // another request reinstated first
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
  if (newRep === null) return { awarded: false, skippedReason: "duplicate" }
  return { awarded: true, reinstated: true, amount: restored, oldRep, newRep }
}

// ─── Reversals ────────────────────────────────────────────────────────

export interface ReversalResult {
  reversed: boolean
  eventId?: string
  newRep?: number
}

/** Reverse one ledger row with a signed counter-entry. Idempotent. */
export async function reverseReputationEvent(
  eventId: string,
  reason: string,
  actorId?: string
): Promise<ReversalResult> {
  const outcome = await prisma.$transaction(async (tx) => {
    const original = await tx.reputationEvent.findUnique({
      where: { id: eventId },
      select: { id: true, userId: true, amount: true, reversedAt: true, type: true, sourceType: true, sourceId: true },
    })
    if (!original || original.reversedAt) return null
    const subjectUserId = original.userId

    const { count } = await tx.reputationEvent.updateMany({
      where: { id: original.id, reversedAt: null },
      data: { reversedAt: new Date() },
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
  await demoteIfNeeded(outcome.userId).catch(() => null)
  return { reversed: true, eventId, newRep: outcome.newRep }
}

/** Reverse a keyed award (e.g. "like:<reactor>:post:<id>"). Idempotent. */
export async function reverseReputationByKey(key: string, reason: string, actorId?: string): Promise<ReversalResult> {
  const original = await prisma.reputationEvent.findUnique({
    where: { key },
    select: { id: true },
  })
  if (!original) return { reversed: false }
  return reverseReputationEvent(original.id, reason, actorId)
}

/** Reverse every active event tied to a deleted source (post, thread, diary…). */
export async function reverseReputationBySource(
  sourceType: string,
  sourceId: string,
  reason: string,
  actorId?: string
): Promise<number> {
  const events = await prisma.reputationEvent.findMany({
    where: { sourceType, sourceId, reversedAt: null, type: { not: REP_EVENT_TYPES.REVERSAL } },
    select: { id: true },
  })
  let reversed = 0
  for (const e of events) {
    const r = await reverseReputationEvent(e.id, reason, actorId)
    if (r.reversed) reversed++
  }
  return reversed
}

/** Reverse every active event a user *caused* (e.g. likes they granted). */
export async function reverseReputationByActor(actorId: string, reason: string): Promise<number> {
  const events = await prisma.reputationEvent.findMany({
    where: { actorId, reversedAt: null, type: { not: REP_EVENT_TYPES.REVERSAL } },
    select: { id: true },
  })
  let reversed = 0
  for (const e of events) {
    const r = await reverseReputationEvent(e.id, reason, actorId)
    if (r.reversed) reversed++
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

// Exported for staff tooling — applies demotion after negative adjustments.
export { demoteIfNeeded }

// ─── Side effects (deferred; never part of the balance transaction) ───

async function postAwardEffects(
  userId: string,
  user: AwardUser,
  oldRep: number,
  newRep: number
) {
  await checkTierChange(userId, oldRep, newRep)
  await autoVerify(userId, newRep, user)
  await checkBadges(userId)
  await maybePayReferral(userId, user, newRep)
}

// Referral rep pays only once the referred member proves legitimate:
// REFERRAL_MIN_REP earned + REFERRAL_MIN_AGE_HOURS old. Keyed per referee.
async function maybePayReferral(userId: string, user: AwardUser, newRep: number) {
  if (newRep < REFERRAL_MIN_REP) return
  const ageHours = (Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60)
  if (ageHours < REFERRAL_MIN_AGE_HOURS) return

  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { referredById: true },
  })
  if (!profile?.referredById) return
  const referrer = await prisma.profile.findUnique({
    where: { id: profile.referredById },
    select: { userId: true },
  })
  if (!referrer || referrer.userId === userId) return

  const res = await applyReputationAward(
    referrer.userId,
    "REFERRAL",
    REP_POINTS.REFERRAL,
    "A member you invited became an established grower",
    { key: `referral:${userId}`, actorId: userId }
  )
  if (!res.awarded) return

  await notify({
    userId: referrer.userId,
    type: "REPUTATION",
    title: "Referral bonus",
    content: `A member you invited became an established grower — +${res.amount ?? REP_POINTS.REFERRAL} reputation.`,
    link: "/profile",
  }).catch(() => null)

  // Referrer's own side effects (tier/badge checks) for the new points.
  const referrerUser = await prisma.user.findUnique({
    where: { id: referrer.userId },
    select: { role: true, createdAt: true, banned: true, suspendedUntil: true },
  })
  if (referrerUser && res.newRep !== undefined) {
    await postAwardEffects(referrer.userId, referrerUser, res.oldRep ?? res.newRep, res.newRep)
  }
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

  const subject = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, createdAt: true, banned: true, suspendedUntil: true },
  })
  if (!subject) return res

  const effects = async () => {
    try {
      await postAwardEffects(userId, subject, res.oldRep ?? 0, res.newRep ?? 0)
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

export async function getUserStats(userId: string): Promise<UserStats> {
  const [posts, threads, diaries, diaryUpdates, chatMessages, strains, strainPhotos, setups, likesReceived, acceptedAnswers, paidReferrals, user] =
    await Promise.all([
      prisma.post.count({ where: { authorId: userId, deleted: false, thread: { deleted: false } } }),
      prisma.thread.count({ where: { authorId: userId, deleted: false } }),
      prisma.growDiary.count({ where: { authorId: userId, deleted: false } }),
      prisma.diaryUpdate.count({ where: { authorId: userId, diary: { deleted: false } } }),
      prisma.chatMessage.count({ where: { authorId: userId, deleted: false } }),
      prisma.strain.count({ where: { createdById: userId } }),
      prisma.strainPhoto.count({ where: { userId } }),
      prisma.growSetup.count({ where: { authorId: userId, deleted: false } }),
      prisma.reaction.count({
        where: {
          type: "LIKE",
          OR: [{ post: { authorId: userId, deleted: false, thread: { deleted: false } } }, { diary: { authorId: userId, deleted: false } }],
        },
      }),
      prisma.post.count({
        where: {
          authorId: userId,
          deleted: false,
          thread: { deleted: false },
          acceptedAnswerFor: { isNot: null },
        },
      }),
      // Referral badges count only referrals that actually paid out — a pile
      // of fake signups must not advance the Recruiter line.
      prisma.reputationEvent.count({
        where: { userId, type: "REFERRAL", reversedAt: null },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { createdAt: true, profile: { select: { reputation: true } } },
      }),
    ])

  const memberNumber = user
    ? (await prisma.user.count({ where: { createdAt: { lt: user.createdAt } } })) + 1
    : 0

  return {
    posts,
    threads,
    diaries,
    diaryUpdates,
    chatMessages,
    strains,
    strainPhotos,
    setups,
    likesReceived,
    acceptedAnswers,
    referrals: paidReferrals,
    reputation: user?.profile?.reputation ?? 0,
    memberNumber,
  }
}

// Notify and record when a user crosses into a higher reputation tier.
async function checkTierChange(userId: string, oldRep: number, newRep: number) {
  const oldTier = getReputationTier(oldRep)
  const newTier = getReputationTier(newRep)
  if (newTier.threshold <= oldTier.threshold) return

  await notify({
    userId,
    type: "REPUTATION",
    title: `Tier up: ${newTier.name}`,
    content: `You reached ${newRep} reputation and became a ${newTier.name}. ${newTier.benefit}`,
    link: "/profile",
  })

  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { username: true },
  })
  if (profile?.username) {
    await announceTierUp(profile.username, newTier.name, newRep).catch(() => null)
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
    const profile = await prisma.profile.findUnique({ where: { userId }, select: { username: true } })
    if (profile?.username) await announceBadges(profile.username, [badge.name]).catch(() => null)
  }
  return true
}

// Evaluate all badge rules and grant any newly earned badges (+ notification).
export async function checkBadges(userId: string) {
  if (await isBotUser(userId)) return
  if (!badgeSeedComplete) {
    await seedBadges()
    badgeSeedComplete = true
  }
  const stats = await getUserStats(userId)
  const allBadges = await prisma.badge.findMany()
  const earned = await prisma.userBadge.findMany({
    where: { userId },
    select: { badgeId: true },
  })
  const earnedIds = new Set(earned.map((b) => b.badgeId))

  const newlyEarned: string[] = []
  for (const badge of allBadges) {
    if (earnedIds.has(badge.id)) continue
    const rule = BADGE_RULES[badge.name]
    if (!rule || !rule(stats)) continue
    // grantBadge is P2002-safe; only count badges this call actually granted
    // so notifications/announcements never fire for a lost race.
    const granted = await grantBadge(userId, badge.name, { notifyUser: false })
    if (granted) newlyEarned.push(badge.name)
  }

  if (newlyEarned.length > 0) {
    // One grouped notification, not one per badge.
    await notify({
      userId,
      type: "BADGE",
      title: newlyEarned.length === 1 ? "Badge earned" : `${newlyEarned.length} badges earned`,
      content:
        newlyEarned.length === 1
          ? `You earned the "${newlyEarned[0]}" badge.`
          : `You earned: ${newlyEarned.join(", ")}.`,
      link: "/profile",
    }).catch(() => null)

    const profile = await prisma.profile.findUnique({
      where: { userId },
      select: { username: true },
    })
    if (profile?.username) {
      await announceBadges(profile.username, newlyEarned).catch(() => null)
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
