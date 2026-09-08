import { prisma } from "@/lib/prisma"

// Point values for community actions
export const REP_POINTS = {
  THREAD_CREATED: 10,
  POST_CREATED: 5,
  DIARY_CREATED: 15,
  DIARY_UPDATE: 5,
  STRAIN_CREATED: 15,
  STRAIN_PHOTO: 10,
  LIKE_RECEIVED: 2,
  REFERRAL: 25,
} as const

interface UserStats {
  posts: number
  threads: number
  diaries: number
  diaryUpdates: number
  chatMessages: number
  strains: number
  strainPhotos: number
  likesReceived: number
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
  "Top Contributor": (s) => s.reputation >= 1000,
}

async function getUserStats(userId: string): Promise<UserStats> {
  const [posts, threads, diaries, diaryUpdates, chatMessages, strains, strainPhotos, likesReceived, user] =
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
    referrals: user?.profile?._count.referrals ?? 0,
    reputation: user?.profile?.reputation ?? 0,
  }
}

// Award reputation points and re-check badge eligibility.
export async function awardReputation(
  userId: string,
  type: string,
  amount: number,
  reason: string
) {
  await prisma.reputationEvent.create({
    data: { userId, type, amount, reason },
  })
  await prisma.profile.update({
    where: { userId },
    data: { reputation: { increment: amount } },
  })
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
