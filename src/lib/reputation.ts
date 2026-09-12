// Server-side reputation logic. Anything that touches Prisma lives here;
// the isomorphic values and tier maths live in reputation-config so client
// components can import them without pulling PrismaClient into the browser.
import { after } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  VERIFIED_MULTIPLIER,
  getReputationTier,
} from "@/lib/reputation-config"
import { seedBadges } from "@/lib/badges"
import { announceBadges, announceTierUp } from "@/lib/terpbot"
import { notify } from "@/lib/notify"

// Re-exported for existing server-side callers.
export {
  REP_POINTS,
  REP_TIERS,
  getReputationTier,
  getNextTier,
  getTierProgress,
  type ReputationTier,
} from "@/lib/reputation-config"

export interface UserStats {
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
// Badge rows seeded in the database. Exported read-only for TerpBot's
// /nextbadges command; awarding still goes through checkBadges().
export const BADGE_RULES: Record<string, (s: UserStats) => boolean> = {
  // First steps
  "New Grower": (s) => s.posts + s.threads + s.diaries >= 1,
  "First Post": (s) => s.posts >= 1,
  "First Thread": (s) => s.threads >= 1,
  "First Grow Diary": (s) => s.diaries >= 1,
  "First Photo": (s) => s.strainPhotos >= 1,
  "First Strain": (s) => s.strains >= 1,

  // Post milestones
  "Active Grower": (s) => s.posts >= 10,
  "Conversation Starter": (s) => s.threads >= 5,
  "Forum Regular": (s) => s.posts + s.threads >= 100,
  "Prolific Poster": (s) => s.posts >= 250,
  "Thread Weaver": (s) => s.threads >= 100,
  "Community Pillar": (s) => s.posts + s.threads >= 500,
  "Century Poster": (s) => s.posts >= 100,
  "Veteran Poster": (s) => s.posts >= 500,
  "Master Poster": (s) => s.posts >= 1000,
  "Grand Poster": (s) => s.posts >= 2500,
  "Legendary Poster": (s) => s.posts >= 5000,
  "Mythic Poster": (s) => s.posts >= 10000,

  // Diary milestones
  "Diary Master": (s) => s.diaries >= 5,
  "Garden Veteran": (s) => s.diaries >= 10,
  "Master Gardener": (s) => s.diaries >= 25,
  "Diary Legend": (s) => s.diaries >= 50,
  // "Dedicated Grower" is a 7-consecutive-day update streak, awarded by the
  // diary updates route — not a lifetime update count, so no rule here.

  // Strain milestones
  "Strain Hunter": (s) => s.strains >= 3,
  "Strain Explorer": (s) => s.strains >= 10,
  "Strain Master": (s) => s.strains >= 25,
  "Strain Legend": (s) => s.strains >= 50,
  "Strain God": (s) => s.strains >= 100,

  // Photo milestones
  "Grow Photographer": (s) => s.strainPhotos >= 5,
  "Photo Pro": (s) => s.strainPhotos >= 25,
  "Shutterbug": (s) => s.strainPhotos >= 50,
  "Photo Legend": (s) => s.strainPhotos >= 100,
  "Photo God": (s) => s.strainPhotos >= 250,

  // Social / chat
  "Social Butterfly": (s) => s.chatMessages >= 25,
  "Socialite": (s) => s.chatMessages >= 100,
  "Talk of the Town": (s) => s.chatMessages >= 500,
  "Chat Legend": (s) => s.chatMessages >= 1000,

  // Referrals
  "Recruiter": (s) => s.referrals >= 3,
  "Community Builder": (s) => s.referrals >= 10,
  "Ambassador": (s) => s.referrals >= 25,
  "Founder": (s) => s.referrals >= 50,

  // Likes received
  "Liked": (s) => s.likesReceived >= 10,
  "Helpful Member": (s) => s.likesReceived >= 50,
  "Helpful Grower": (s) => s.likesReceived >= 20,
  "Community Favorite": (s) => s.likesReceived >= 100,
  "Popular Grower": (s) => s.likesReceived >= 250,
  "Influencer": (s) => s.likesReceived >= 500,
  "Celebrity": (s) => s.likesReceived >= 1000,

  // Accepted answers
  "Helper": (s) => s.acceptedAnswers >= 1,
  "Top Helper": (s) => s.acceptedAnswers >= 5,
  "Mentor": (s) => s.acceptedAnswers >= 25,
  "Sage Answer": (s) => s.acceptedAnswers >= 50,
  "Oracle": (s) => s.acceptedAnswers >= 100,

  // Reputation tier badges
  "Sprout": (s) => s.reputation >= 250,
  "Seedling": (s) => s.reputation >= 750,
  "Grower": (s) => s.reputation >= 1500,
  "Cultivator": (s) => s.reputation >= 3500,
  "Master Grower": (s) => s.reputation >= 7000,
  "Legendary Grower": (s) => s.reputation >= 15000,
  "Head Grower": (s) => s.reputation >= 30000,
  "Hash Maker": (s) => s.reputation >= 75000,
  "Mother Plant": (s) => s.reputation >= 150000,
  "Pheno Hunter": (s) => s.reputation >= 300000,
  "Terpene Tycoon": (s) => s.reputation >= 600000,
  "Cannabis Deity": (s) => s.reputation >= 1000000,

  // Overall contribution
  "Top Contributor": (s) => s.reputation >= 10000,
  "Elite Harvest": (s) => s.reputation >= 25000,
  "Legendary Harvest": (s) => s.reputation >= 50000,
  "Mythic Harvest": (s) => s.reputation >= 100000,
}

let badgeSeedComplete = false

export async function getUserStats(userId: string): Promise<UserStats> {
  const [posts, threads, diaries, diaryUpdates, chatMessages, strains, strainPhotos, likesReceived, acceptedAnswers, user] =
    await Promise.all([
      prisma.post.count({ where: { authorId: userId, deleted: false, thread: { deleted: false } } }),
      prisma.thread.count({ where: { authorId: userId, deleted: false } }),
      prisma.growDiary.count({ where: { authorId: userId, deleted: false } }),
      prisma.diaryUpdate.count({ where: { authorId: userId, diary: { deleted: false } } }),
      prisma.chatMessage.count({ where: { authorId: userId, deleted: false } }),
      prisma.strain.count({ where: { createdById: userId } }),
      prisma.strainPhoto.count({ where: { userId } }),
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
    data: { role: "VERIFIED_MEMBER", sessionVersion: { increment: 1 } },
  })

  await notify({
    userId,
    type: "REPUTATION",
    title: "Verified Member",
    content: "You automatically earned the Verified Member tag for reaching 1,500 reputation and being active for 7 days. Enjoy 1.5x reputation gains.",
    link: "/profile",
  })
}

// Award reputation points and re-check badge eligibility.
// This is deferred with `after()` so the user's request is not blocked
// by ~15 profile/badge/notification DB operations.
export async function awardReputation(
  userId: string,
  type: string,
  amount: number,
  reason: string
) {
  after(async () => {
    try {
      const { user, oldRep, newRep } = await prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { role: true, createdAt: true, banned: true },
        })
        const multiplier = user?.role === "VERIFIED_MEMBER" ? VERIFIED_MULTIPLIER : 1
        // Round — reputation columns are Int; a fractional award would fail
        // Prisma validation and silently drop the whole event for verified members.
        const adjusted = Math.round(amount * multiplier)

        const profile = await tx.profile.findUnique({
          where: { userId },
          select: { reputation: true },
        })
        const oldRep = profile?.reputation ?? 0
        const newRep = oldRep + adjusted

        await tx.reputationEvent.create({
          data: { userId, type, amount: adjusted, reason },
        })
        await tx.profile.update({
          where: { userId },
          data: { reputation: { increment: adjusted } },
        })

        return { user, oldRep, newRep }
      })

      await checkTierChange(userId, oldRep, newRep)
      await autoVerify(userId, newRep, user)
      await checkBadges(userId)
    } catch (error) {
      console.error("[awardReputation] background error:", error)
    }
  })
}

// Evaluate all badge rules and grant any newly earned badges (+ notification).
export async function checkBadges(userId: string) {
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

    await prisma.userBadge.create({
      data: { userId, badgeId: badge.id },
    })
    newlyEarned.push(badge.name)
    await notify({
      userId,
      type: "BADGE",
      title: "Badge earned",
      content: `You earned the "${badge.name}" badge — ${badge.description}`,
      link: "/profile",
    })
  }

  // Celebrate new badges in community chat (one message, not one per badge).
  if (newlyEarned.length > 0) {
    const profile = await prisma.profile.findUnique({
      where: { userId },
      select: { username: true },
    })
    if (profile?.username) {
      await announceBadges(profile.username, newlyEarned).catch(() => null)
    }
  }
}
