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
  // Small peer-gated bonus for the OP who curates their own thread —
  // requires another member's answer to exist, so it can't be solo-farmed.
  ACCEPT_MARKED: 5,
  REFERRAL: 25,
  DAILY_LOGIN: 1,
  CONTEST_WEEKLY_WIN: 50,
  CONTEST_MONTHLY_WIN: 150,
  // Once per diary — a documented full grow cycle (requires ≥4 updates).
  HARVEST_LOGGED: 25,
  // Once per account — finishing onboarding.
  ONBOARDING_COMPLETE: 15,
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

// The same trust gate applies to accepted-answer payouts: the accept still
// works for anyone, but a brand-new/low-rep acceptor doesn't pay out — a
// fresh sockpuppet can't farm +30s for a main account.
export const ACCEPT_MIN_ACTOR_AGE_HOURS = 24
export const ACCEPT_MIN_ACTOR_REP = 10

// Paying content floors — content still posts below these, it just doesn't
// earn rep. Stops 1-char threads and bare-name strain entries from paying.
export const THREAD_MIN_PAID_LENGTH = 40
export const STRAIN_MIN_PAID_DESCRIPTION = 120

// Only the first N chat messages per rolling day count toward the lifetime
// chatMessageCount that feeds social badges — bounds badge farming while
// staying invisible to normal conversation.
export const CHAT_DAILY_BADGE_CAP = 50

// Referral rep pays out only once the referred member proves legitimate:
// at least this much earned rep and at least this old. A per-week cap keeps
// a sock farm from grinding 25 rep per fake signup for unbounded payouts.
export const REFERRAL_MIN_REP = 25
export const REFERRAL_MIN_AGE_HOURS = 24
export const REFERRAL_MAX_PER_WEEK = 3

// Reputation bonus granted once per badge, scaled by rarity — a fixed,
// finite pool (~all badges ≈ a few thousand rep lifetime) that can't scale
// with spam the way per-post payouts can.
export const BADGE_BONUS: Record<string, number> = {
  common: 15,
  rare: 40,
  epic: 100,
  legendary: 250,
}

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
//   "QUEST_DAILY"                    — daily quest completion bonus
//     (keyed quest:<day>:<slug>:<userId>; perfect-day bonus quest-day:<day>:<uid>)
//   "BADGE_BONUS"                    — one-time rep bonus on badge grant
//     (keyed badgebonus:<badge name>:<userId>; amount = BADGE_BONUS[rarity])
//   "GROW_MILESTONE"                 — derived grow-journey stage reached
//     (keyed growstage:<diaryId>:<stage>:<userId>; amount per stage)
//   "JOURNEY_COMPLETE"               — one-time guided-journey bundle
//     (keyed journey:<slug>:<userId>)
//   "WEEKLY_AWARD"                   — weekly recognition board winner
//     (keyed weekly:<board>:<week>:<userId>)
//   "STREAK_BONUS"                   — garden streak milestone reached
//     (keyed streak:<days>:<userId>; amount per STREAK_MILESTONES)
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
  // Zero-amount marker rows recording that a rung celebration already
  // fired — the P2002 claim makes once-ever dedupe durable. Never public.
  MILESTONE: "MILESTONE",
  QUEST_DAILY: "QUEST_DAILY",
  BADGE_BONUS: "BADGE_BONUS",
  GROW_MILESTONE: "GROW_MILESTONE",
  JOURNEY_COMPLETE: "JOURNEY_COMPLETE",
  WEEKLY_AWARD: "WEEKLY_AWARD",
  STREAK_BONUS: "STREAK_BONUS",
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
  "ACCEPT_MARKED",
  "REFERRAL",
  "CONTEST_WEEKLY_WIN",
  "CONTEST_MONTHLY_WIN",
  "HARVEST_LOGGED",
  "CHALLENGE_WEEKLY",
  "QUEST_DAILY",
  "BADGE_BONUS",
  "GROW_MILESTONE",
  "JOURNEY_COMPLETE",
  "WEEKLY_AWARD",
  "STREAK_BONUS",
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
    case "ACCEPT_MARKED": return "Marked an accepted answer"
    case "REFERRAL": return "Invited a new member"
    case "CONTEST_WEEKLY_WIN": return "Won Budshot of the Week"
    case "CONTEST_MONTHLY_WIN": return "Won Diary of the Month"
    case "HARVEST_LOGGED": return "Logged a harvest"
    case "CHALLENGE_WEEKLY": return "Weekly challenge completed"
    case "QUEST_DAILY": return "Daily quest completed"
    case "BADGE_BONUS": return "Badge bonus"
    case "GROW_MILESTONE": return "Reached a grow milestone"
    case "JOURNEY_COMPLETE": return "Completed the Getting Rooted journey"
    case "WEEKLY_AWARD": return "Weekly recognition"
    case "STREAK_BONUS": return "Garden streak milestone"
    case "ONBOARDING_COMPLETE": return "Finished onboarding"
    case "DAILY_LOGIN": return "Daily check-in"
    case "REVERSAL": return "Reputation adjustment"
    case "REINSTATE": return "Reputation restored"
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
  trustedLinks?: boolean // isTrustedForLinks — first tier granting it
  pollVoting?: boolean // can vote in forum polls
  pollCreation?: boolean // can attach a poll to a new thread
  verifiedMember?: boolean // auto-promotion to VERIFIED_MEMBER (+rep bonus)
  rateLimitBoost?: number // multiplier on forum/chat rate limits
  slowmodeExempt?: boolean // immune to chat room slowmode
  imagesPerPost?: number // overrides MAX_POST_IMAGES
  maxThreadTags?: number // overrides MAX_TAGS
  showcaseSlots?: number // max pinned badges on the member's profile
  questSlots?: number // daily quest count — extra slots mean more rep income
  nameplate?: string // CSS class styling the member's username in chat/posts
}

const PERKS = {
  BASE: { showcaseSlots: 3 } as TierPerks,
  GERM: { showcaseSlots: 3 } as TierPerks,
  SPROUT: { trustedLinks: true, showcaseSlots: 3 } as TierPerks,
  SEEDLING: { trustedLinks: true, nameplate: "tt-nameplate-leaf", showcaseSlots: 3 } as TierPerks,
  ROOTED: { trustedLinks: true, pollVoting: true, pollCreation: true, nameplate: "tt-nameplate-leaf", showcaseSlots: 3 } as TierPerks,
  VEG: { trustedLinks: true, pollVoting: true, pollCreation: true, nameplate: "tt-nameplate-leaf", questSlots: 3, showcaseSlots: 4 } as TierPerks,
  GROWER: { trustedLinks: true, pollVoting: true, pollCreation: true, verifiedMember: true, nameplate: "tt-nameplate-leaf", questSlots: 3, showcaseSlots: 4 } as TierPerks,
  BLOOM: { trustedLinks: true, pollVoting: true, pollCreation: true, verifiedMember: true, nameplate: "tt-nameplate-bloom", questSlots: 3, showcaseSlots: 5 } as TierPerks,
  CULTIVATOR: { trustedLinks: true, pollVoting: true, pollCreation: true, verifiedMember: true, rateLimitBoost: 1.5, nameplate: "tt-nameplate-bloom", questSlots: 3, showcaseSlots: 6 } as TierPerks,
  MASTER: { trustedLinks: true, pollVoting: true, pollCreation: true, verifiedMember: true, rateLimitBoost: 1.5, slowmodeExempt: true, imagesPerPost: 6, nameplate: "tt-nameplate-master", questSlots: 3, showcaseSlots: 8 } as TierPerks,
  HEAD: { trustedLinks: true, pollVoting: true, pollCreation: true, verifiedMember: true, rateLimitBoost: 2, slowmodeExempt: true, imagesPerPost: 8, maxThreadTags: 7, nameplate: "tt-nameplate-master", questSlots: 4, showcaseSlots: 10 } as TierPerks,
  GRAND: { trustedLinks: true, pollVoting: true, pollCreation: true, verifiedMember: true, rateLimitBoost: 2, slowmodeExempt: true, imagesPerPost: 8, maxThreadTags: 7, nameplate: "tt-nameplate-grand", questSlots: 4, showcaseSlots: 12 } as TierPerks,
  MASTER_GARDENER: { trustedLinks: true, pollVoting: true, pollCreation: true, verifiedMember: true, rateLimitBoost: 2, slowmodeExempt: true, imagesPerPost: 10, maxThreadTags: 7, nameplate: "tt-nameplate-gold", questSlots: 4, showcaseSlots: 14 } as TierPerks,
}

// The Path to Master Gardener — a cultivation career ladder. Thresholds
// keep the milestone-badge spine (150/500/1500/3500/7000/15000/30000/50000)
// so badge progress specs stay aligned, with extra rungs between them so
// unlocks land every few weeks of normal play instead of months.
// Cosmetic unlock keys in `benefit` text reference the registries in
// lib/cosmetics.ts — every advertised reward must exist there.
export const REP_TIERS: ReputationTier[] = [
  { threshold: 0, name: "Seed", color: "text-stone-500", bg: "bg-stone-500/10", icon: "🌰", benefit: "Every grow starts somewhere — post, grow, and share to earn rep.", perks: PERKS.BASE },
  { threshold: 50, name: "Germinated", color: "text-lime-600", bg: "bg-lime-500/10", icon: "🌱", benefit: "Your first unlock lands fast — the Seed Shell avatar frame. Keep tending your garden.", perks: PERKS.GERM },
  { threshold: 150, name: "Sprout", color: "text-amber-600", bg: "bg-amber-600/10", icon: "🌿", benefit: "Your links work instantly — no more new-member wait — and you unlock the Sprout Ring avatar frame.", perks: PERKS.SPROUT },
  { threshold: 300, name: "Seedling", color: "text-green-500", bg: "bg-green-500/10", icon: "🌱", benefit: "Your username gets a leaf-green nameplate in chat and the forums — the garden knows your name.", perks: PERKS.SEEDLING },
  { threshold: 500, name: "Rooted", color: "text-green-600", bg: "bg-green-600/10", icon: "🪴", benefit: "Unlocks community polls — vote AND create them — plus the Rooted Band frame and custom profile titles.", perks: PERKS.ROOTED },
  { threshold: 1000, name: "Veg Grower", color: "text-emerald-500", bg: "bg-emerald-500/10", icon: "🌲", benefit: "A third daily quest slot — more quests means more rep every day — plus the Canopy Weave frame.", perks: PERKS.VEG },
  { threshold: 1500, name: "Grower", color: "text-emerald-500", bg: "bg-emerald-500/10", icon: "🌳", benefit: "Earns Verified Member status and a permanent 1.5× reputation bonus, plus the Greenhouse Glow frame and Evergreen theme.", perks: PERKS.GROWER },
  { threshold: 2500, name: "Bloom", color: "text-fuchsia-500", bg: "bg-fuchsia-500/10", icon: "🌸", benefit: "Your nameplate blooms violet, and you unlock the animated Photon Pulse frame and Ultraviolet theme.", perks: PERKS.BLOOM },
  { threshold: 3500, name: "Cultivator", color: "text-cyan-500", bg: "bg-cyan-500/10", icon: "✂️", benefit: "Unlocks The Grow Room — the members-only space for experienced growers — plus the LED Bloom frame, Golden Hour theme, and 1.5× rate limits.", perks: PERKS.CULTIVATOR },
  { threshold: 7000, name: "Master Grower", color: "text-purple-500", bg: "bg-purple-500/10", icon: "🏆", benefit: "Unlocks the Pistil Fire frame, the Midnight Garden theme, a glowing nameplate, slowmode immunity, and 6 images per post.", perks: PERKS.MASTER },
  { threshold: 15000, name: "Head Grower", color: "text-rose-400", bg: "bg-rose-500/10", icon: "🌟", benefit: "Unlocks The Vault — the head table for top growers — a fourth daily quest, double rate limits, 8 images per post, and 7 thread tags.", perks: PERKS.HEAD },
  { threshold: 30000, name: "Grandmaster", color: "text-violet-300", bg: "bg-violet-500/10", icon: "🔮", benefit: "Unlocks the Rosin Ring frame, the Amber Cure theme, and legendary titles — a name the whole garden recognizes.", perks: PERKS.GRAND },
  { threshold: 50000, name: "Master Gardener", color: "text-amber-400", bg: "bg-amber-400/10", icon: "👑", benefit: "The top of the ladder — the aurora-animated Northern Lights frame, Deity Glow theme, a golden nameplate, and 10 images per post.", perks: PERKS.MASTER_GARDENER },
]

// ─── Perk-threshold helpers ──────────────────────────────────────────
// The ladder grows rungs over time, so callers must never index REP_TIERS
// positionally — look up the first tier granting a perk instead.
export function getTierByName(name: string): ReputationTier | undefined {
  return REP_TIERS.find((t) => t.name === name)
}

export function perkThreshold(perk: keyof TierPerks): number {
  return REP_TIERS.find((t) => t.perks[perk])?.threshold ?? Infinity
}

export const TRUSTED_LINKS_REP = perkThreshold("trustedLinks")
export const POLL_VOTING_REP = perkThreshold("pollVoting")
export const POLL_CREATION_REP = perkThreshold("pollCreation")

// ─── Garden streaks ──────────────────────────────────────────────────
// Consecutive UTC days with a daily check-in (DAILY_LOGIN). Milestones
// pay once-ever per member — a streak that breaks simply stops advancing;
// reaching a higher personal-best milestone pays again.
export const STREAK_MILESTONES: { days: number; reward: number }[] = [
  { days: 3, reward: 10 },
  { days: 7, reward: 25 },
  { days: 14, reward: 50 },
  { days: 30, reward: 100 },
  { days: 60, reward: 150 },
  { days: 100, reward: 250 },
  { days: 365, reward: 500 },
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

// Verified-member auto-promotion — the first tier granting the perk.
// Perk-based lookup (not an index) so the ladder can grow new rungs
// without silently moving the gate.
export const VERIFIED_MIN_REPUTATION =
  REP_TIERS.find((t) => t.perks.verifiedMember)?.threshold ?? 1500
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
  // Every checkpoint must sit strictly inside its tier's gap — above the
  // tier's own threshold and below the NEXT tier's threshold — or
  // getRepStage()/getStageProgress() produce invalid ranges.
  Germinated: [100],
  Sprout: [200, 250],
  Seedling: [400],
  Rooted: [650, 800],
  "Veg Grower": [1250],
  Grower: [1800, 2200],
  Bloom: [3000],
  Cultivator: [4500, 5500],
  "Master Grower": [9000, 11000, 13000],
  "Head Grower": [20000, 25000],
  Grandmaster: [35000, 40000, 45000],
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

// Rung crossings for a rep change oldRep -> newRep. Only upward crossings
// count — a demotion back below a rung returns []. Each rung is classified
// so callers can tell a major tier crossing from an in-tier stage tick.
export interface RungCrossing {
  rung: number
  kind: "tier" | "stage"
  level: number // Grow Level landed on (ladder index + 1)
}

const TIER_THRESHOLD_SET = new Set(REP_TIERS.map((t) => t.threshold))

export function crossedRungs(oldRep: number, newRep: number): RungCrossing[] {
  if (newRep <= oldRep) return []
  return REP_LADDER.filter((r) => r > oldRep && r <= newRep).map((r) => ({
    rung: r,
    kind: TIER_THRESHOLD_SET.has(r) ? "tier" : "stage",
    level: REP_LADDER.indexOf(r) + 1,
  }))
}

// Every cosmetic/checkpoint unlock a rep range grants — used to name the
// rewards inside a tier-up celebration. Pure list diff over the registries.
export interface UnlockedReward {
  kind: "frame" | "title" | "theme"
  key: string
  name: string
  unlockedAt: number
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

// ─── Community standing (the trust axis) ─────────────────────────────
// Progression ("reputation"/XP on the ledger) measures participation;
// STANDING measures peer validation — only event types that require
// another member (or staff) to act count. A member can grind XP with
// volume but cannot raise their standing without genuinely helping.
// Reversed events stop counting automatically: the original's amount is
// excluded once reversedAt is set, and the counter-entry's own type is
// REVERSAL/REINSTATE — never in this list.
export const TRUST_EVENT_TYPES = new Set<string>([
  "LIKE_RECEIVED",
  "HELPFUL_ANSWER",
  "REFERRAL",
  "CONTEST_WEEKLY_WIN",
  "CONTEST_MONTHLY_WIN",
  "STAFF_ADJUSTMENT",
])

export interface TrustStanding {
  min: number // inclusive lower bound
  name: string
  color: string
  bg: string
  icon: string
}

export const TRUST_STANDINGS: TrustStanding[] = [
  { min: 0, name: "Unrooted", color: "text-stone-500", bg: "bg-stone-500/10", icon: "🌰" },
  { min: 25, name: "Known", color: "text-green-500", bg: "bg-green-500/10", icon: "🌱" },
  { min: 100, name: "Trusted", color: "text-emerald-500", bg: "bg-emerald-500/10", icon: "" },
  { min: 300, name: "Respected", color: "text-cyan-500", bg: "bg-cyan-500/10", icon: "🪴" },
  { min: 800, name: "Pillar", color: "text-purple-500", bg: "bg-purple-500/10", icon: "🏛️" },
  { min: 2000, name: "Legend", color: "text-amber-500", bg: "bg-amber-500/10", icon: "🌟" },
]

export function getTrustStanding(score: number): TrustStanding {
  let s = TRUST_STANDINGS[0]
  for (const t of TRUST_STANDINGS) {
    if (score >= t.min) s = t
    else break
  }
  return s
}

export function getNextTrustStanding(score: number): TrustStanding | null {
  for (const t of TRUST_STANDINGS) {
    if (score < t.min) return t
  }
  return null
}
