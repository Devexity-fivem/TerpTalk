// Server-side data for the signed-in "Today" homepage. Pure composition —
// every field comes from an existing system: progression libs (level/tier,
// quests, journey, next action), thread/diary follows (unread activity),
// notifications (unread count), and the shared chat teaser (presence +
// room activity). No new models, no new realtime, no polling.
import { prisma } from "@/lib/prisma"
import { activeAuthor, publicUserSelect } from "@/lib/security"
import { REP_LADDER, getRepStage, getNextTier } from "@/lib/reputation-config"
import { getQuestProgress } from "@/lib/quests"
import { getJourneyState } from "@/lib/journeys"
import { getGrowJourney, GROW_STAGES, type GrowJourneyState } from "@/lib/grow-journey"
import { getChatTeaser, type ChatTeaser } from "@/lib/chat-activity"
import { pickNextAction, type NextAction } from "@/lib/next-action"
import {
  attentionFor,
  getGrowIntel,
  postureLabel,
  type AttentionItem,
} from "@/lib/grow-intel"
import { diaryPath } from "@/lib/slugs"

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
    slug: string | null
    title: string
    stageLabel: string
    journey: GrowJourneyState | null
    updatedAt: string
    updates: number
    followers: number
    /** structured strain link when the diary has one */
    strain: { id: string; slug: string | null; name: string } | null
    /** grow age from the deterministic snapshot (startDate-based) */
    day: number | null
    week: number | null
    /** latest photo from the diary window, if any */
    photo: string | null
    /** latest reading with data — "temperature 74°F" style */
    latestReading: string | null
    /** deterministic posture + canonical next-step line */
    posture: string | null
    nextStep: string | null
    /** number of open deterministic flags (concern/due/episode/intervention) */
    flagCount: number
  }[]
  /** "What deserves my attention" — deterministic signals only, owner scope */
  attention: AttentionItem[]
  /** Community content around the strains the member is actively growing */
  aroundGrows: {
    threads: { slug: string; title: string; category: string; authorName: string; replyCount: number }[]
    harvests: { id: string; slug: string | null; title: string; strainName: string; yieldText: string | null; authorName: string }[]
  }
  sinceLastVisit: {
    unreadThreads: { title: string; slug: string; category: string }[]
    unreadThreadCount: number
    diaryUpdates: { title: string; diaryTitle: string; diaryId: string; diarySlug: string | null; author: string }[]
    unreadNotifications: number
  }
  live: ChatTeaser | null
  /** Community pulse — trending threads to make the cockpit feel alive */
  trending: {
    title: string
    slug: string
    category: string
    replyCount: number
    views: number
    authorName: string
  }[]
}

const GROW_STAGE_LABELS: Record<string, string> = Object.fromEntries(
  GROW_STAGES.map((s) => [s.key, `${s.icon} ${s.name}`])
)

export async function getMemberHomeData(userId: string): Promise<MemberHomeData | null> {
  const [user, quests, journey, staleDiary, diaries, followedThreads, followedDiaries, unreadNotifications, live, trendingCandidates] =
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
        select: { id: true, slug: true, title: true },
      }),
      prisma.growDiary.findMany({
        where: { authorId: userId, deleted: false, harvested: false },
        orderBy: { updatedAt: "desc" },
        take: 3,
        select: {
          id: true,
          slug: true,
          title: true,
          stage: true,
          updatedAt: true,
          strain: true,
          strainId: true,
          strainRef: { select: { id: true, slug: true, name: true } },
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
      // Trending threads for the community pulse — lightweight existing query
      prisma.thread.findMany({
        where: {
          deleted: false,
          category: { hidden: false },
          createdAt: { gte: new Date(Date.now() - 7 * 86400000) },
          author: activeAuthor(),
        },
        take: 50,
        select: {
          slug: true,
          title: true,
          views: true,
          replyCount: true,
          createdAt: true,
          author: { select: publicUserSelect },
          category: { select: { name: true } },
        },
      }),
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
          diary: { select: { id: true, slug: true, title: true } },
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

  // Journey states + deterministic intel for the member's active grows —
  // bounded at 3 diaries (each getGrowIntel is 3 indexed queries).
  const [journeyStates, intelStates, latestPhotos] = await Promise.all([
    Promise.all(diaries.map((d) => getGrowJourney(d.id))),
    Promise.all(diaries.map((d) => getGrowIntel(d.id, userId).catch(() => null))),
    diaries.length
      ? prisma.diaryImage.findMany({
          where: { update: { diaryId: { in: diaries.map((d) => d.id) } } },
          orderBy: { createdAt: "desc" },
          take: 12,
          select: { url: true, update: { select: { diaryId: true } } },
        })
      : Promise.resolve([]),
  ])

  const photoByDiary = new Map<string, string>()
  for (const img of latestPhotos) {
    if (!photoByDiary.has(img.update.diaryId)) photoByDiary.set(img.update.diaryId, img.url)
  }

  // Community content around the strains the member is actively growing —
  // public-scope only, capped, excludes the member's own threads (their
  // own activity already lands in sinceLastVisit/notifications). Threads
  // have no strainId column — the strain page's precise signal is a tag
  // equal to the strain name, reused here.
  const strainIds = [...new Set(diaries.map((d) => d.strainId).filter((s): s is string => !!s))]
  const strainNames = [
    ...new Set(
      diaries
        .map((d) => d.strainRef?.name ?? d.strain ?? null)
        .filter((s): s is string => !!s)
    ),
  ]
  const [aroundThreads, aroundHarvests] = strainNames.length
    ? await Promise.all([
        prisma.thread.findMany({
          where: {
            deleted: false,
            category: { hidden: false },
            author: activeAuthor(),
            authorId: { not: userId },
            tags: { some: { tag: { name: { in: strainNames, mode: "insensitive" } } } },
          },
          orderBy: { lastActivityAt: "desc" },
          take: 4,
          select: {
            slug: true,
            title: true,
            replyCount: true,
            author: { select: publicUserSelect },
            category: { select: { name: true } },
          },
        }),
        prisma.growDiary.findMany({
          where: {
            harvested: true,
            deleted: false,
            visibility: "PUBLIC",
            authorId: { not: userId },
            author: activeAuthor(),
            OR: [
              ...(strainIds.length ? [{ strainId: { in: strainIds } }] : []),
              { strain: { in: strainNames, mode: "insensitive" as const } },
            ],
          },
          orderBy: { updatedAt: "desc" },
          take: 4,
          select: {
            id: true,
            slug: true,
            title: true,
            yieldAmount: true,
            yieldUnit: true,
            strain: true,
            strainRef: { select: { name: true } },
            author: { select: publicUserSelect },
          },
        }),
      ])
    : [[], []]

  // Score trending threads by velocity (same algorithm as the guest landing)
  const trending = trendingCandidates
    .map((t) => {
      const hours = (Date.now() - new Date(t.createdAt).getTime()) / 36e5
      return { ...t, score: (t.views + t.replyCount * 5) / Math.pow(hours + 2, 1.5) }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)

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
    grows: diaries.map((d, i) => {
      const intel = intelStates[i]?.intel ?? null
      return {
        id: d.id,
        slug: d.slug,
        title: d.title,
        stageLabel:
          journeyStates[i] != null
            ? GROW_STAGE_LABELS[journeyStates[i]!.stage] ?? d.stage
            : d.stage,
        journey: journeyStates[i] ?? null,
        updatedAt: d.updatedAt.toISOString(),
        updates: d._count.updates,
        followers: d._count.followers,
        strain: d.strainRef
          ? { id: d.strainRef.id, slug: d.strainRef.slug, name: d.strainRef.name }
          : d.strain
            ? { id: "", slug: null, name: d.strain }
            : null,
        day: intel?.day ?? null,
        week: intel?.week ?? null,
        photo: photoByDiary.get(d.id) ?? null,
        latestReading: intel?.readings[0]
          ? `${intel.readings[0].label} ${intel.readings[0].value}`
          : null,
        posture: intel ? postureLabel(intel.posture) : null,
        nextStep: intel?.nextStep ?? null,
        flagCount: intel
          ? intel.concerns.length +
            intel.due.length +
            intel.episodes.length +
            intel.pendingInterventions.length
          : 0,
      }
    }),
    attention: diaries
      .flatMap((d, i) =>
        intelStates[i]
          ? attentionFor(intelStates[i]!.intel, d.title, diaryPath(d))
          : []
      )
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 6),
    aroundGrows: {
      threads: aroundThreads.map((t) => ({
        slug: t.slug,
        title: t.title,
        category: t.category.name,
        authorName: t.author.profile?.username || t.author.name || "a grower",
        replyCount: t.replyCount,
      })),
      harvests: aroundHarvests.map((h) => ({
        id: h.id,
        slug: h.slug,
        title: h.title,
        strainName: h.strainRef?.name ?? h.strain ?? "strain",
        yieldText:
          h.yieldAmount != null && h.yieldUnit ? `${h.yieldAmount}${h.yieldUnit}` : null,
        authorName: h.author.profile?.username || h.author.name || "a grower",
      })),
    },
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
        diarySlug: u.diary.slug,
        author: u.author.profile?.username || u.author.name || "a grower",
      })),
      unreadNotifications,
    },
    live,
    trending: trending.map((t) => ({
      title: t.title,
      slug: t.slug,
      category: t.category.name,
      replyCount: t.replyCount,
      views: t.views,
      authorName: t.author.profile?.username || t.author.name || "a grower",
    })),
  }
}
