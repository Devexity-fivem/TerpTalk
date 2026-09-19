// Server-side data for the signed-in "Today" homepage. Pure composition —
// every field comes from an existing system: progression libs (level/tier,
// quests, journey, next action), thread/diary follows (unread activity),
// notifications (unread count), and the shared chat teaser (presence +
// room activity). No new models, no new realtime, no polling.
import { prisma } from "@/lib/prisma"
import { activeAuthor } from "@/lib/security"
import { REP_LADDER, getRepStage, getNextTier } from "@/lib/reputation-config"
import { getQuestProgress } from "@/lib/quests"
import { getJourneyState } from "@/lib/journeys"
import { getGrowJourney, GROW_STAGES, type GrowJourneyState } from "@/lib/grow-journey"
import { getChatTeaser, type ChatTeaser } from "@/lib/chat-activity"
import { pickNextAction, type NextAction } from "@/lib/next-action"

export interface MemberHomeData {
  displayName: string
  level: number
  maxLevel: number
  rep: number
  tier: { name: string; icon: string; color: string; bg: string }
  nextAction: NextAction
  quests: {
    slug: string
    title: string
    description: string
    icon: string
    reward: number
    target: number
    progress: number
    done: boolean
  }[]
  grows: {
    id: string
    title: string
    stageLabel: string
    journey: GrowJourneyState | null
    updatedAt: string
    updates: number
    followers: number
  }[]
  sinceLastVisit: {
    unreadThreads: { title: string; slug: string; category: string }[]
    unreadThreadCount: number
    diaryUpdates: { title: string; diaryTitle: string; diaryId: string; author: string }[]
    unreadNotifications: number
  }
  live: ChatTeaser | null
}

const GROW_STAGE_LABELS: Record<string, string> = Object.fromEntries(
  GROW_STAGES.map((s) => [s.key, `${s.icon} ${s.name}`])
)

export async function getMemberHomeData(userId: string): Promise<MemberHomeData | null> {
  const [user, quests, journey, staleDiary, diaries, followedThreads, followedDiaries, unreadNotifications, live] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          name: true,
          profile: { select: { username: true, reputation: true } },
        },
      }),
      getQuestProgress(userId),
      getJourneyState(userId),
      // Same "stale diary" signal /api/progression uses — the member's most
      // recently-touched live diary that hasn't been updated in 3+ days.
      prisma.growDiary.findFirst({
        where: {
          authorId: userId,
          deleted: false,
          harvested: false,
          updatedAt: { lt: new Date(Date.now() - 3 * 86400000) },
        },
        orderBy: { updatedAt: "asc" },
        select: { id: true, title: true },
      }),
      prisma.growDiary.findMany({
        where: { authorId: userId, deleted: false, harvested: false },
        orderBy: { updatedAt: "desc" },
        take: 3,
        select: {
          id: true,
          title: true,
          stage: true,
          updatedAt: true,
          _count: { select: { updates: true, followers: true } },
        },
      }),
      // Followed threads with activity the member hasn't seen — same
      // lastActivityAt > lastSeenAt rule the forum page applies.
      prisma.threadFollow.findMany({
        where: {
          userId,
          thread: { deleted: false, category: { hidden: false } },
        },
        orderBy: { thread: { lastActivityAt: "desc" } },
        take: 10,
        select: {
          lastSeenAt: true,
          thread: {
            select: {
              slug: true,
              title: true,
              lastActivityAt: true,
              category: { select: { name: true } },
            },
          },
        },
      }),
      // Latest updates on diaries the member follows (DiaryFollow has no
      // read cursor — this is honest "recent activity", not unread math).
      prisma.diaryFollow.findMany({
        // Explicitly followed diaries stay visible at PUBLIC|UNLISTED — the
        // member already holds the link. PRIVATE rows drop out.
        where: { userId, diary: { deleted: false, visibility: { in: ["PUBLIC", "UNLISTED"] }, author: activeAuthor() } },
        select: { diaryId: true },
      }),
      prisma.notification.count({ where: { userId, read: false } }),
      getChatTeaser(),
    ])

  if (!user) return null

  const followedDiaryIds = followedDiaries.map((d) => d.diaryId)
  const diaryUpdates = followedDiaryIds.length
    ? await prisma.diaryUpdate.findMany({
        where: {
          diaryId: { in: followedDiaryIds },
          createdAt: { gte: new Date(Date.now() - 7 * 86400000) },
        },
        orderBy: { createdAt: "desc" },
        take: 4,
        select: {
          title: true,
          diary: { select: { id: true, title: true } },
          author: { select: { name: true, profile: { select: { username: true } } } },
        },
      })
    : []

  const unreadThreads = followedThreads.filter(
    (f) => f.thread.lastActivityAt > (f.lastSeenAt ?? new Date(0))
  )

  const rep = user.profile?.reputation ?? 0
  const stage = getRepStage(rep)
  const nextTier = getNextTier(rep)

  // Journey states for the member's active grows — bounded at 3 diaries.
  const journeyStates = await Promise.all(diaries.map((d) => getGrowJourney(d.id)))

  return {
    displayName: user.profile?.username || user.name || "grower",
    level: stage.level,
    maxLevel: REP_LADDER.length,
    rep,
    tier: {
      name: stage.tier.name,
      icon: stage.tier.icon,
      color: stage.tier.color,
      bg: stage.tier.bg,
    },
    nextAction: pickNextAction({ journey, rep, nextTier, staleDiary, quests }),
    quests: quests.slice(0, 3).map((q) => ({
      slug: q.slug,
      title: q.title,
      description: q.description,
      icon: q.icon,
      reward: q.reward,
      target: q.target,
      progress: q.progress,
      done: q.done,
    })),
    grows: diaries.map((d, i) => ({
      id: d.id,
      title: d.title,
      stageLabel:
        journeyStates[i] != null
          ? GROW_STAGE_LABELS[journeyStates[i]!.stage] ?? d.stage
          : d.stage,
      journey: journeyStates[i] ?? null,
      updatedAt: d.updatedAt.toISOString(),
      updates: d._count.updates,
      followers: d._count.followers,
    })),
    sinceLastVisit: {
      unreadThreads: unreadThreads.slice(0, 4).map((f) => ({
        title: f.thread.title,
        slug: f.thread.slug,
        category: f.thread.category.name,
      })),
      unreadThreadCount: unreadThreads.length,
      diaryUpdates: diaryUpdates.map((u) => ({
        title: u.title,
        diaryTitle: u.diary.title,
        diaryId: u.diary.id,
        author: u.author.profile?.username || u.author.name || "a grower",
      })),
      unreadNotifications,
    },
    live,
  }
}
