// Referral bonus — Progression V2 port of the legacy payout path.
//
// The bonus pays only once the referred member proves legitimate:
// REFERRAL_MIN_XP earned on the V2 ledger + REFERRAL_MIN_AGE_HOURS old.
// Keyed per referee (`referral:<refereeId>`), weekly-capped by the
// REFERRAL spec (3/week) inside the engine, peer-gated standing included.
//
// Unlike V1 there is no deferred post-award trigger — XP grows through
// awardProgression, not the retired reputation pipeline. The daily cron
// sweep is the single canonical payout path; keyed idempotency makes it
// safe to run every pass.
import { prisma } from "@/lib/prisma"
import { awardProgression } from "@/lib/progression"
import { notify } from "@/lib/notify"
import { REFERRAL_MIN_XP, REFERRAL_MIN_AGE_HOURS } from "@/lib/progression-config"

export { REFERRAL_MIN_XP, REFERRAL_MIN_AGE_HOURS }

// Canonical eligibility + payout. Both the sweep and any future deferred
// trigger must call this so the business rules never diverge.
async function payReferralBonus(refereeUserId: string, refereeCreatedAt: Date, refereeXp: number) {
  if (refereeXp < REFERRAL_MIN_XP) return
  const ageHours = (Date.now() - refereeCreatedAt.getTime()) / (1000 * 60 * 60)
  if (ageHours < REFERRAL_MIN_AGE_HOURS) return

  const profile = await prisma.profile.findUnique({
    where: { userId: refereeUserId },
    select: { referredById: true, username: true },
  })
  if (!profile?.referredById) return
  const referrer = await prisma.profile.findUnique({
    where: { id: profile.referredById },
    select: { userId: true },
  })
  if (!referrer || referrer.userId === refereeUserId) return

  // Pre-ledger signups (before the deferred-payout system shipped) paid the
  // instant referral bonus as an UNKEYED legacy event inside the
  // registration request — stamped at the same time as the referee's
  // account. The keyed idempotency can't see those rows, so without this
  // check the sweep would re-pay every referral that predates the ledger.
  // The window is tight and the only historical producer of unkeyed
  // REFERRAL events was that signup path, so a match is unambiguous.
  const legacyPayout = await prisma.reputationEvent.findFirst({
    where: {
      userId: referrer.userId,
      type: "REFERRAL",
      key: null,
      reversedAt: null,
      createdAt: {
        gte: new Date(refereeCreatedAt.getTime() - 60_000),
        lte: new Date(refereeCreatedAt.getTime() + 10 * 60_000),
      },
    },
    select: { id: true },
  })
  if (legacyPayout) return

  // Weekly cap + per-referee key are enforced inside awardProgression —
  // the REFERRAL spec carries weeklyCap: 3 and the standing controls
  // (grantor floor, reciprocal, cluster) apply to the +15 standing.
  const res = await awardProgression(
    referrer.userId,
    "REFERRAL",
    "A member you invited became an established grower",
    { key: `referral:${refereeUserId}`, actorId: refereeUserId }
  ).catch(() => null)
  if (!res?.awarded) return

  // The award is already committed — notification delivery stays
  // non-blocking, but a failure must be observable (never re-award).
  const refereeName = profile.username ?? "a member you invited"
  await notify({
    userId: referrer.userId,
    type: "REPUTATION",
    title: "Referral bonus",
    content: `@${refereeName} became an established grower — +${res.xp ?? 25} XP for the invite.`,
    link: "/profile",
  }).catch((error) => {
    console.error(`[referrals] payout notification failed for referrer ${referrer.userId} (referee ${refereeUserId}):`, error)
  })
}

/**
 * Referral reconciliation sweep — the canonical V2 payout path. Scans
 * referred profiles whose referee qualifies on XP and account age, skips
 * referees whose `referral:<userId>` key already has an active event, and
 * hands each remaining candidate to payReferralBonus — the unique key
 * makes a concurrent payout safe (P2002 → duplicate no-op). Reversed-but-
 * not-final keys flow through the canonical path and reinstate exactly as
 * an organic re-trigger would.
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
      xp: { gte: REFERRAL_MIN_XP },
      user: { createdAt: { lte: cutoff } },
    },
    select: {
      userId: true,
      xp: true,
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
  const active = await prisma.progressionEvent.findMany({
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
      await payReferralBonus(c.userId, c.user.createdAt, c.xp)
    } catch (error) {
      failed++
      console.error("[referrals] reconciliation failed for referee", c.userId, error)
    }
  }
  if (failed > 0) {
    throw new Error(`referral reconciliation: ${failed}/${attempted} payouts failed`)
  }
  return { candidates: candidates.length, attempted, failed }
}
