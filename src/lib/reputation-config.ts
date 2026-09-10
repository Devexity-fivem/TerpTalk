/**
 * Reputation values and pure tier maths.
 *
 * Kept free of any Prisma import so client components can read point values
 * and render tier badges. Importing these from lib/reputation.ts instead would
 * pull PrismaClient into the browser bundle and crash at runtime.
 */

export const VERIFIED_MULTIPLIER = 1.5

// Point values for community actions
export const REP_POINTS = {
  THREAD_CREATED: 5,
  POST_CREATED: 2,
  DIARY_CREATED: 8,
  DIARY_UPDATE: 2,
  STRAIN_CREATED: 8,
  STRAIN_PHOTO: 5,
  LIKE_RECEIVED: 1,
  REFERRAL: 15,
} as const

export interface ReputationTier {
  threshold: number
  name: string
  color: string
  bg: string
  icon: string
  benefit: string
}

export const REP_TIERS: ReputationTier[] = [
  { threshold: 0, name: "Seed", color: "text-stone-500", bg: "bg-stone-500/10", icon: "🌱", benefit: "Welcome to the community — start growing your rep." },
  { threshold: 250, name: "Sprout", color: "text-amber-600", bg: "bg-amber-600/10", icon: "🌿", benefit: "Your links no longer need manual approval." },
  { threshold: 750, name: "Seedling", color: "text-green-500", bg: "bg-green-500/10", icon: "🌱", benefit: "Unlock the ability to vote in community polls." },
  { threshold: 1500, name: "Grower", color: "text-emerald-500", bg: "bg-emerald-500/10", icon: "🌲", benefit: "Appear on the public leaderboard and unlock weekly rewards." },
  { threshold: 3500, name: "Cultivator", color: "text-cyan-500", bg: "bg-cyan-500/10", icon: "🌿", benefit: "Can edit community guides and strain entries." },
  { threshold: 7000, name: "Master Grower", color: "text-purple-500", bg: "bg-purple-500/10", icon: "🏆", benefit: "Double voting weight in contests and a legendary profile flair." },
  { threshold: 15000, name: "Legendary Grower", color: "text-amber-400", bg: "bg-amber-400/10", icon: "👑", benefit: "Immortalized as a community elder — exclusive badge and title." },
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
