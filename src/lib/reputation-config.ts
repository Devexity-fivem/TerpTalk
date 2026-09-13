/**
 * Reputation 2.0 — values, caps, tier maths, and visibility policy.
 *
 * Kept free of any Prisma import so client components can read point values
 * and render tier badges. Importing these from lib/reputation.ts instead would
 * pull PrismaClient into the browser bundle and crash at runtime.
 */

// Verified members earn a 50% bonus, applied as a floor so 1-point events
// don't double: adjusted = amount + floor(amount * (VERIFIED_MULTIPLIER - 1)).
export const VERIFIED_MULTIPLIER = 1.5

// ─── Point values ────────────────────────────────────────────────────
// Every source below is keyed/deduped at the callsite via ReputationEvent.key.
export const REP_POINTS = {
  THREAD_CREATED: 10,
  POST_CREATED: 2,
  DIARY_CREATED: 10,
  DIARY_UPDATE: 3,
  STRAIN_CREATED: 10,
  STRAIN_PHOTO: 3,
  SETUP_CREATED: 8,
  LIKE_RECEIVED: 2,
  HELPFUL_ANSWER: 30,
  REFERRAL: 25,
  DAILY_LOGIN: 1,
  CONTEST_WEEKLY_WIN: 50,
  CONTEST_MONTHLY_WIN: 150,
} as const

export type RepSource = keyof typeof REP_POINTS

// ─── Daily award caps (per recipient, per UTC day) ───────────────────
// Beyond the cap the action still succeeds — it just stops paying rep.
export const REP_CAPS: Partial<Record<RepSource, number>> = {
  THREAD_CREATED: 3, // first 3 threads/day pay
  POST_CREATED: 15, // first 15 replies/day pay
  DIARY_CREATED: 2,
  STRAIN_CREATED: 5,
  STRAIN_PHOTO: 5,
  SETUP_CREATED: 2,
  LIKE_RECEIVED: 50,
  HELPFUL_ANSWER: 2,
  // DIARY_UPDATE is deduped by key (diaryId + UTC day) instead of a count cap.
  // REFERRAL is deduped per referred user. DAILY_LOGIN is deduped per day.
  // Contest wins are deduped per period.
}

// A liker's account must be this old before their LIKE generates rep —
// reactions still display; they just don't pay sockpuppets.
export const LIKE_MIN_ACTOR_AGE_HOURS = 24

// Referral rep pays out only once the referred member proves legitimate:
// at least this much earned rep and at least this old.
export const REFERRAL_MIN_REP = 25
export const REFERRAL_MIN_AGE_HOURS = 24

// Staff manual adjustments are bounded per action.
export const STAFF_ADJUST_MAX = 500

// "Early Supporter" badge — auto-earned by the first N registered members.
export const EARLY_SUPPORTER_LIMIT = 250

// ─── Event-type vocabulary ───────────────────────────────────────────
// ReputationEvent.type is a free-form string (codebase convention — see
// User.role, Notification.type). Known values:
//   REP_POINTS keys above            — positive awards
//   "REVERSAL"                       — counter-entry reversing another event
//   "REINSTATE"                      — counter-entry undoing a reversal
//   "STAFF_ADJUSTMENT"               — manual staff grant/deduction
//   "LEGACY_MIGRATION"               — pre-ledger balance carried forward
//
// Accounting model: EVERY row's amount counts toward the balance —
// reversedAt/reversalOfId are audit status, not sum filters. Reversals and
// reinstates record the actually-applied delta (clamped to the balance at
// the time), so balance == SUM(amount) always holds.
export const REP_EVENT_TYPES = {
  REVERSAL: "REVERSAL",
  REINSTATE: "REINSTATE",
  STAFF_ADJUSTMENT: "STAFF_ADJUSTMENT",
  LEGACY_MIGRATION: "LEGACY_MIGRATION",
} as const

// Which event types are shown on a member's public reputation history.
// Everything not listed is staff/owner-only (adjustments, daily check-in
// cadence, internal bookkeeping).
export const PUBLIC_REP_TYPES = new Set<string>([
  "THREAD_CREATED",
  "POST_CREATED",
  "DIARY_CREATED",
  "DIARY_UPDATE",
  "STRAIN_CREATED",
  "STRAIN_PHOTO",
  "SETUP_CREATED",
  "LIKE_RECEIVED",
  "HELPFUL_ANSWER",
  "REFERRAL",
  "CONTEST_WEEKLY_WIN",
  "CONTEST_MONTHLY_WIN",
  "REVERSAL",
  "REINSTATE",
  "LEGACY_MIGRATION",
])

// Public-safe label per type — raw `reason` strings embed titles and
// usernames, so public surfaces always render these labels instead.
export function publicRepLabel(type: string): string {
  switch (type) {
    case "THREAD_CREATED": return "Started a thread"
    case "POST_CREATED": return "Replied in the forums"
    case "DIARY_CREATED": return "Started a grow diary"
    case "DIARY_UPDATE": return "Posted a diary update"
    case "STRAIN_CREATED": return "Added a strain"
    case "STRAIN_PHOTO": return "Shared a photo"
    case "SETUP_CREATED": return "Shared a grow setup"
    case "LIKE_RECEIVED": return "Content was liked"
    case "HELPFUL_ANSWER": return "Answer accepted"
    case "REFERRAL": return "Invited a new member"
    case "CONTEST_WEEKLY_WIN": return "Won Budshot of the Week"
    case "CONTEST_MONTHLY_WIN": return "Won Diary of the Month"
    case "DAILY_LOGIN": return "Daily check-in"
    case "REVERSAL": return "Reversal of removed content"
    case "REINSTATE": return "Award reinstated"
    case "STAFF_ADJUSTMENT": return "Staff adjustment"
    case "LEGACY_MIGRATION": return "Reputation carried over"
    default: return "Reputation change"
  }
}

// ─── Tiers ───────────────────────────────────────────────────────────
export interface ReputationTier {
  threshold: number
  name: string
  color: string
  bg: string
  icon: string
  benefit: string
  // Real, enforced perks — indexed by tier position. Anything listed here
  // must be implemented in code, not just advertised.
  perks: TierPerks
}

export interface TierPerks {
  trustedLinks?: boolean // isTrustedForLinks — REP_TIERS[1].threshold
  pollVoting?: boolean // can vote in forum polls
  verifiedMember?: boolean // auto-promotion to VERIFIED_MEMBER (+rep bonus)
  rateLimitBoost?: number // multiplier on forum/chat rate limits
  slowmodeExempt?: boolean // immune to chat room slowmode
  imagesPerPost?: number // overrides MAX_POST_IMAGES
  maxThreadTags?: number // overrides MAX_TAGS
}

const PERKS = {
  BASE: {} as TierPerks,
  SPROUT: { trustedLinks: true } as TierPerks,
  SEEDLING: { trustedLinks: true, pollVoting: true } as TierPerks,
  GROWER: { trustedLinks: true, pollVoting: true, verifiedMember: true } as TierPerks,
  CULTIVATOR: { trustedLinks: true, pollVoting: true, verifiedMember: true, rateLimitBoost: 1.5 } as TierPerks,
  MASTER: { trustedLinks: true, pollVoting: true, verifiedMember: true, rateLimitBoost: 1.5, slowmodeExempt: true, imagesPerPost: 6 } as TierPerks,
  HEAD: { trustedLinks: true, pollVoting: true, verifiedMember: true, rateLimitBoost: 2, slowmodeExempt: true, imagesPerPost: 8, maxThreadTags: 7 } as TierPerks,
  HASH: { trustedLinks: true, pollVoting: true, verifiedMember: true, rateLimitBoost: 2, slowmodeExempt: true, imagesPerPost: 8, maxThreadTags: 7 } as TierPerks,
  DEITY: { trustedLinks: true, pollVoting: true, verifiedMember: true, rateLimitBoost: 2, slowmodeExempt: true, imagesPerPost: 8, maxThreadTags: 7 } as TierPerks,
}

export const REP_TIERS: ReputationTier[] = [
  { threshold: 0, name: "Seed", color: "text-stone-500", bg: "bg-stone-500/10", icon: "🌰", benefit: "Welcome to the community — start growing your rep.", perks: PERKS.BASE },
  { threshold: 250, name: "Sprout", color: "text-amber-600", bg: "bg-amber-600/10", icon: "🌱", benefit: "Your links no longer need the new-member wait.", perks: PERKS.SPROUT },
  { threshold: 750, name: "Seedling", color: "text-green-500", bg: "bg-green-500/10", icon: "�", benefit: "Vote in community polls.", perks: PERKS.SEEDLING },
  { threshold: 1500, name: "Grower", color: "text-emerald-500", bg: "bg-emerald-500/10", icon: "🪴", benefit: "Earn the Verified Member tag and a 1.5× reputation bonus.", perks: PERKS.GROWER },
  { threshold: 3500, name: "Cultivator", color: "text-cyan-500", bg: "bg-cyan-500/10", icon: "�", benefit: "Higher posting and chat rate limits.", perks: PERKS.CULTIVATOR },
  { threshold: 7000, name: "Master Grower", color: "text-purple-500", bg: "bg-purple-500/10", icon: "🏆", benefit: "Exempt from chat slowmode and can attach 6 images per post.", perks: PERKS.MASTER },
  { threshold: 15000, name: "Head Grower", color: "text-rose-400", bg: "bg-rose-500/10", icon: "🌟", benefit: "Double rate limits, 8 images per post, and up to 7 thread tags.", perks: PERKS.HEAD },
  { threshold: 40000, name: "Hash Maker", color: "text-violet-300", bg: "bg-violet-500/10", icon: "🔮", benefit: "Pressed to perfection — all perks plus a legendary profile flair.", perks: PERKS.HASH },
  { threshold: 100000, name: "Cannabis Deity", color: "text-sky-300", bg: "bg-sky-500/10", icon: "🌌", benefit: "The top of the ladder — a true cannabis deity.", perks: PERKS.DEITY },
]

export function getReputationTier(reputation: number): ReputationTier {
  let tier = REP_TIERS[0]
  for (const t of REP_TIERS) {
    if (reputation >= t.threshold) tier = t
    else break
  }
  return tier
}

export function getNextTier(reputation: number): ReputationTier | null {
  for (const t of REP_TIERS) {
    if (reputation < t.threshold) return t
  }
  return null
}

export function getTierProgress(reputation: number): { current: number; next: number; percent: number } {
  const currentTier = getReputationTier(reputation)
  const nextTier = getNextTier(reputation)
  if (!nextTier) return { current: currentTier.threshold, next: currentTier.threshold, percent: 100 }
  const range = nextTier.threshold - currentTier.threshold
  const gained = reputation - currentTier.threshold
  return {
    current: currentTier.threshold,
    next: nextTier.threshold,
    percent: Math.min(100, Math.max(0, Math.round((gained / range) * 100))),
  }
}

// Verified-member auto-promotion threshold (the Grower tier).
export const VERIFIED_MIN_REPUTATION = REP_TIERS[3].threshold
export const VERIFIED_MIN_AGE_DAYS = 7
