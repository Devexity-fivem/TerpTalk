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
  POST_CREATED: 10, // first 10 replies/day pay
  DIARY_CREATED: 2,
  DIARY_UPDATE: 5, // plus the per-diary-per-day key dedupe — bounds the
  // only self-driven source that used to scale with diary count.
  STRAIN_CREATED: 5,
  STRAIN_PHOTO: 5,
  SETUP_CREATED: 2,
  LIKE_RECEIVED: 50,
  HELPFUL_ANSWER: 2,
  // REFERRAL is deduped per referred user. DAILY_LOGIN is deduped per day.
  // Contest wins are deduped per period. CHALLENGE_WEEKLY is deduped per
  // challenge per ISO week (keyed award — no count cap needed).
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
//   "CHALLENGE_WEEKLY"               — weekly challenge completion bonus
//     (amount varies per challenge; keyed challenge:<week>:<slug>:<userId>)
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
  CHALLENGE_WEEKLY: "CHALLENGE_WEEKLY",
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
  "CHALLENGE_WEEKLY",
  "REVERSAL",
  "REINSTATE",
  "LEGACY_MIGRATION",
])

// Public-safe label per type — raw `reason` strings embed titles and
// usernames, so public surfaces always render these labels instead.
export function publicRepLabel(type: string): string {
  switch (type) {
    case "THREAD_CREATED": return "Started a grow talk"
    case "POST_CREATED": return "Helped in a thread"
    case "DIARY_CREATED": return "Started a grow diary"
    case "DIARY_UPDATE": return "Tended your garden"
    case "STRAIN_CREATED": return "Added strain knowledge"
    case "STRAIN_PHOTO": return "Shared a bud shot"
    case "SETUP_CREATED": return "Shared a grow setup"
    case "LIKE_RECEIVED": return "A grower liked your post"
    case "HELPFUL_ANSWER": return "Your answer was accepted"
    case "REFERRAL": return "Invited a new member"
    case "CONTEST_WEEKLY_WIN": return "Won Budshot of the Week"
    case "CONTEST_MONTHLY_WIN": return "Won Diary of the Month"
    case "CHALLENGE_WEEKLY": return "Weekly challenge completed"
    case "DAILY_LOGIN": return "Daily check-in"
    case "REVERSAL": return "Reputation adjustment"
    case "REINSTATE": return "Reputation restored"
    case "STAFF_ADJUSTMENT": return "Staff adjustment"
    case "LEGACY_MIGRATION": return "Reputation carried over"
    default: return "Reputation change"
  }
}

// Emoji accent per event type for the public history feed.
export function publicRepIcon(type: string): string {
  switch (type) {
    case "THREAD_CREATED": return "🧵"
    case "POST_CREATED": return "💬"
    case "DIARY_CREATED": return "📓"
    case "DIARY_UPDATE": return "🌱"
    case "STRAIN_CREATED": return "🧬"
    case "STRAIN_PHOTO": return "📸"
    case "SETUP_CREATED": return "🛠️"
    case "LIKE_RECEIVED": return "❤️"
    case "HELPFUL_ANSWER": return "✅"
    case "REFERRAL": return "🤝"
    case "CONTEST_WEEKLY_WIN": return "🏆"
    case "CONTEST_MONTHLY_WIN": return "🏆"
    case "CHALLENGE_WEEKLY": return "🎯"
    case "DAILY_LOGIN": return "☀️"
    case "REVERSAL": return "↩️"
    case "REINSTATE": return "↩️"
    case "STAFF_ADJUSTMENT": return "🛡️"
    case "LEGACY_MIGRATION": return "📦"
    default: return "✨"
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
  showcaseSlots?: number // max pinned badges on the member's profile
}

const PERKS = {
  BASE: { showcaseSlots: 3 } as TierPerks,
  SPROUT: { trustedLinks: true, showcaseSlots: 3 } as TierPerks,
  ROOTED: { trustedLinks: true, pollVoting: true, showcaseSlots: 3 } as TierPerks,
  GROWER: { trustedLinks: true, pollVoting: true, verifiedMember: true, showcaseSlots: 4 } as TierPerks,
  CULTIVATOR: { trustedLinks: true, pollVoting: true, verifiedMember: true, rateLimitBoost: 1.5, showcaseSlots: 5 } as TierPerks,
  MASTER: { trustedLinks: true, pollVoting: true, verifiedMember: true, rateLimitBoost: 1.5, slowmodeExempt: true, imagesPerPost: 6, showcaseSlots: 6 } as TierPerks,
  HEAD: { trustedLinks: true, pollVoting: true, verifiedMember: true, rateLimitBoost: 2, slowmodeExempt: true, imagesPerPost: 8, maxThreadTags: 7, showcaseSlots: 8 } as TierPerks,
  HASH: { trustedLinks: true, pollVoting: true, verifiedMember: true, rateLimitBoost: 2, slowmodeExempt: true, imagesPerPost: 8, maxThreadTags: 7, showcaseSlots: 10 } as TierPerks,
  DEITY: { trustedLinks: true, pollVoting: true, verifiedMember: true, rateLimitBoost: 2, slowmodeExempt: true, imagesPerPost: 8, maxThreadTags: 7, showcaseSlots: 12 } as TierPerks,
}

// Cosmetic unlock keys in `benefit` text reference the registries in
// lib/cosmetics.ts — every advertised reward must exist there.
export const REP_TIERS: ReputationTier[] = [
  { threshold: 0, name: "Seed", color: "text-stone-500", bg: "bg-stone-500/10", icon: "🌰", benefit: "Every grow starts somewhere — post, grow, and share to earn rep.", perks: PERKS.BASE },
  { threshold: 250, name: "Sprout", color: "text-amber-600", bg: "bg-amber-600/10", icon: "🌱", benefit: "Unlocks the Sprout Ring avatar frame — and your links no longer need the new-member wait.", perks: PERKS.SPROUT },
  { threshold: 750, name: "Rooted", color: "text-green-500", bg: "bg-green-500/10", icon: "🌿", benefit: "Unlocks the Rooted Band frame, custom profile titles, and community poll voting.", perks: PERKS.ROOTED },
  { threshold: 1500, name: "Grower", color: "text-emerald-500", bg: "bg-emerald-500/10", icon: "🪴", benefit: "Unlocks the Greenhouse Glow frame, the Evergreen profile theme, Verified Member status, and a 1.5× rep bonus.", perks: PERKS.GROWER },
  { threshold: 3500, name: "Cultivator", color: "text-cyan-500", bg: "bg-cyan-500/10", icon: "✂️", benefit: "Unlocks the LED Bloom frame, the Golden Hour theme, and more room to post.", perks: PERKS.CULTIVATOR },
  { threshold: 7000, name: "Master Grower", color: "text-purple-500", bg: "bg-purple-500/10", icon: "🏆", benefit: "Unlocks the Pistil Fire frame, the Midnight Garden theme, slowmode immunity, and 6 images per post.", perks: PERKS.MASTER },
  { threshold: 15000, name: "Head Grower", color: "text-rose-400", bg: "bg-rose-500/10", icon: "🌟", benefit: "Unlocks the Amber Jar frame, the Deep Water theme, double limits, and 7 thread tags.", perks: PERKS.HEAD },
  { threshold: 40000, name: "Hash Maker", color: "text-violet-300", bg: "bg-violet-500/10", icon: "🔮", benefit: "Unlocks the Rosin Ring frame, the Amber Cure theme, and legendary titles — pressed to perfection.", perks: PERKS.HASH },
  { threshold: 100000, name: "Cannabis Deity", color: "text-sky-300", bg: "bg-sky-500/10", icon: "🌌", benefit: "Unlocks the Northern Lights frame and the Deity Glow theme — the top of the ladder.", perks: PERKS.DEITY },
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
// 30 days — the age gate is the only real defense against a farmed account
// instantly amplifying to the 1.5× multiplier.
export const VERIFIED_MIN_AGE_DAYS = 30

// ─── Grow Stages ─────────────────────────────────────────────────────
// Tiers are sparse and perk-bearing; stages are the frequent feedback
// layer INSIDE each tier gap. Stages are pure presentation — derived
// from the reputation balance with zero schema cost, and reversals
// automatically demote them. The combined ladder (tier thresholds +
// stage checkpoints) gives a decorative Grow Level (1..N).

// Checkpoints within each tier's gap (tier threshold excluded — it's
// stage 1 of that tier). Round numbers, weighted toward the long deserts.
const TIER_STAGE_CHECKPOINTS: Record<string, number[]> = {
  Sprout: [500],
  Rooted: [1000, 1250],
  Grower: [2000, 2500, 3000],
  Cultivator: [4000, 5000, 6000],
  "Master Grower": [8000, 10000, 12000, 14000],
  "Head Grower": [20000, 25000, 30000, 35000],
  "Hash Maker": [50000, 60000, 70000, 80000, 90000],
}

// Grow-cycle names clipped to the number of stages in a tier gap.
const STAGE_NAMES: Record<number, string[]> = {
  1: ["Growing"],
  2: ["Veg", "Flower"],
  3: ["Veg", "Flower", "Harvest"],
  4: ["Germ", "Veg", "Flower", "Harvest"],
  5: ["Germ", "Veg", "Flower", "Flush", "Harvest"],
  6: ["Germ", "Veg", "Flower", "Flush", "Harvest", "Cure"],
}

// Flat ladder of every rung: tier thresholds interleaved with stage
// checkpoints, ascending. Level = index into this list + 1.
export const REP_LADDER: number[] = (() => {
  const rungs = new Set<number>(REP_TIERS.map((t) => t.threshold))
  for (const t of REP_TIERS) {
    for (const c of TIER_STAGE_CHECKPOINTS[t.name] ?? []) rungs.add(c)
  }
  return [...rungs].sort((a, b) => a - b)
})()

export interface RepStage {
  level: number // 1-based position on the combined ladder
  tier: ReputationTier
  stageName: string // grow-cycle name within the tier
  stageIndex: number // 0-based within the tier
  stageCount: number // total stages in the tier
  stageStart: number // rep where this stage begins
  stageEnd: number // rep where the next rung begins (=== stageStart at top)
}

export function getRepStage(reputation: number): RepStage {
  const tier = getReputationTier(reputation)
  const checkpoints = TIER_STAGE_CHECKPOINTS[tier.name] ?? []
  const rungs = [tier.threshold, ...checkpoints]
  let stageIndex = 0
  for (let i = 0; i < rungs.length; i++) {
    if (reputation >= rungs[i]) stageIndex = i
    else break
  }
  const stageStart = rungs[stageIndex]
  const stageEnd = rungs[stageIndex + 1] ?? getNextTier(reputation)?.threshold ?? stageStart
  const names = STAGE_NAMES[rungs.length] ?? STAGE_NAMES[1]
  const level = REP_LADDER.findIndex((r) => r === stageStart) + 1
  return {
    level,
    tier,
    stageName: names[stageIndex] ?? `Stage ${stageIndex + 1}`,
    stageIndex,
    stageCount: rungs.length,
    stageStart,
    stageEnd,
  }
}

export function getRepLevel(reputation: number): number {
  return getRepStage(reputation).level
}

// Progress within the current stage — the bar that actually moves weekly.
export function getStageProgress(reputation: number): { current: number; next: number; percent: number; remaining: number } {
  const stage = getRepStage(reputation)
  if (stage.stageEnd <= stage.stageStart) {
    return { current: reputation, next: reputation, percent: 100, remaining: 0 }
  }
  const range = stage.stageEnd - stage.stageStart
  const gained = reputation - stage.stageStart
  return {
    current: gained,
    next: range,
    percent: Math.min(100, Math.max(0, Math.round((gained / range) * 100))),
    remaining: range - gained,
  }
}
