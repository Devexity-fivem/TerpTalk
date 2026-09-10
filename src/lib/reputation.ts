// Server-side reputation logic. Anything that touches Prisma lives here;
// the isomorphic values and tier maths live in reputation-config so client
// components can import them without pulling PrismaClient into the browser.
import { prisma } from "@/lib/prisma"
import {
  VERIFIED_MULTIPLIER,
  REP_TIERS,
  getReputationTier,
  getTierProgress,
} from "@/lib/reputation-config"

// Re-exported for existing server-side callers.
export {
  REP_POINTS,
  REP_TIERS,
  getReputationTier,
  getNextTier,
  getTierProgress,
  type ReputationTier,
} from "@/lib/reputation-config"

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

// Automatically promote trusted, active members to VERIFIED_MEMBER.
const VERIFIED_MIN_REPUTATION = 1500
const VERIFIED_MIN_AGE_DAYS = 7

async function autoVerify(
  userId: string,
  newRep: number,
  user: { role: string | null; createdAt: Date; banned: boolean } | null
) {
  if (!user || user.banned) return
  if (user.role !== "MEMBER") return

  const ageDays = (Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24)
  if (ageDays < VERIFIED_MIN_AGE_DAYS || newRep < VERIFIED_MIN_REPUTATION) return

  await prisma.user.update({
    where: { id: userId },
    data: { role: "VERIFIED_MEMBER" },
  })

  await prisma.notification.create({
    data: {
      userId,
      type: "REPUTATION",
      title: "Verified Member",
      content: "You automatically earned the Verified Member tag for reaching 1,500 reputation and being active for 7 days. Enjoy 1.5x reputation gains.",
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
    select: { role: true, createdAt: true, banned: true },
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
  await autoVerify(userId, newRep, user)
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
