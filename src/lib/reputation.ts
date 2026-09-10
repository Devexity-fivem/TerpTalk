import { prisma } from "@/lib/prisma"

const VERIFIED_MULTIPLIER = 1.5

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

interface UserStats {
  posts: number
  threads: number
  diaries: number
  diaryUpdates: number
  chatMessages: number
  strains: number
  strainPhotos: number
  likesReceived: number
  acceptedAnswers: number
  referrals: number
  reputation: number
}

// Badge rules — evaluated against live user stats. Badge names must match the
// Badge rows seeded in the database.
const BADGE_RULES: Record<string, (s: UserStats) => boolean> = {
  "New Grower": (s) => s.posts + s.threads + s.diaries >= 1,
  "First Post": (s) => s.posts >= 1,
  "Conversation Starter": (s) => s.threads >= 5,
  "Active Grower": (s) => s.posts >= 10,
  "Diary Master": (s) => s.diaries >= 5,
  "Strain Hunter": (s) => s.strains >= 3,
  "Grow Photographer": (s) => s.strainPhotos >= 5,
  "Social Butterfly": (s) => s.chatMessages >= 25,
  "Recruiter": (s) => s.referrals >= 3,
  "Liked": (s) => s.likesReceived >= 10,
  "Helpful Grower": (s) => s.likesReceived >= 20,
  "Community Favorite": (s) => s.likesReceived >= 100,
  "Helper": (s) => s.acceptedAnswers >= 1,
  "Top Helper": (s) => s.acceptedAnswers >= 5,
  "Top Contributor": (s) => s.reputation >= 10000,
  "Dedicated Grower": (s) => s.diaryUpdates >= 7,
  // Reputation tier badges
  "Sprout": (s) => s.reputation >= 250,
  "Seedling": (s) => s.reputation >= 750,
  "Grower": (s) => s.reputation >= 1500,
  "Cultivator": (s) => s.reputation >= 3500,
  "Master Grower": (s) => s.reputation >= 7000,
  "Legendary Grower": (s) => s.reputation >= 15000,
}

async function getUserStats(userId: string): Promise<UserStats> {
  const [posts, threads, diaries, diaryUpdates, chatMessages, strains, strainPhotos, likesReceived, acceptedAnswers, user] =
    await Promise.all([
      prisma.post.count({ where: { authorId: userId, deleted: false } }),
      prisma.thread.count({ where: { authorId: userId, deleted: false } }),
      prisma.growDiary.count({ where: { authorId: userId, deleted: false } }),
      prisma.diaryUpdate.count({ where: { authorId: userId } }),
      prisma.chatMessage.count({ where: { authorId: userId } }),
      prisma.strain.count({ where: { createdById: userId } }),
      prisma.strainPhoto.count({ where: { userId } }),
      prisma.reaction.count({
        where: {
          type: "LIKE",
          OR: [{ post: { authorId: userId } }, { diary: { authorId: userId } }],
        },
      }),
      prisma.post.count({
        where: {
          authorId: userId,
          deleted: false,
          acceptedAnswerFor: { isNot: null },
        },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { profile: { select: { reputation: true, id: true, _count: { select: { referrals: true } } } } },
      }),
    ])

  return {
    posts,
    threads,
    diaries,
    diaryUpdates,
    chatMessages,
    strains,
    strainPhotos,
    likesReceived,
    acceptedAnswers,
    referrals: user?.profile?._count.referrals ?? 0,
    reputation: user?.profile?.reputation ?? 0,
  }
}

// Notify and record when a user crosses into a higher reputation tier.
async function checkTierChange(userId: string, oldRep: number, newRep: number) {
  const oldTier = getReputationTier(oldRep)
  const newTier = getReputationTier(newRep)
  if (newTier.threshold <= oldTier.threshold) return

  await prisma.notification.create({
    data: {
      userId,
      type: "REPUTATION",
      title: `Tier up: ${newTier.name}`,
      content: `You reached ${newRep} reputation and became a ${newTier.name}. ${newTier.benefit}`,
      link: "/profile",
    },
  }).catch(() => {})
}

// Award reputation points and re-check badge eligibility.
export async function awardReputation(
  userId: string,
  type: string,
  amount: number,
  reason: string
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  })
  const multiplier = user?.role === "VERIFIED_MEMBER" ? VERIFIED_MULTIPLIER : 1
  const adjusted = amount * multiplier

  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { reputation: true },
  })
  const oldRep = profile?.reputation ?? 0
  const newRep = oldRep + adjusted

  await prisma.reputationEvent.create({
    data: { userId, type, amount: adjusted, reason },
  })
  await prisma.profile.update({
    where: { userId },
    data: { reputation: { increment: adjusted } },
  })
  await checkTierChange(userId, oldRep, newRep)
  await checkBadges(userId)
}

// Evaluate all badge rules and grant any newly earned badges (+ notification).
export async function checkBadges(userId: string) {
  const stats = await getUserStats(userId)
  const allBadges = await prisma.badge.findMany()
  const earned = await prisma.userBadge.findMany({
    where: { userId },
    select: { badgeId: true },
  })
  const earnedIds = new Set(earned.map((b) => b.badgeId))

  for (const badge of allBadges) {
    if (earnedIds.has(badge.id)) continue
    const rule = BADGE_RULES[badge.name]
    if (!rule || !rule(stats)) continue

    await prisma.userBadge.create({
      data: { userId, badgeId: badge.id },
    })
    await prisma.notification.create({
      data: {
        userId,
        type: "BADGE",
        title: "Badge earned",
        content: `You earned the "${badge.name}" badge — ${badge.description}`,
        link: "/profile",
      },
    }).catch(() => {})
  }
}
