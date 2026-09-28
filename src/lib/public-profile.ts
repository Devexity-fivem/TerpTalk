// Profile V2 — public-profile aggregation + DTO layer (P0 foundation).
// Single source for the /u/[username] page and /api/users/[username] route.
// Privacy is enforced here at the data boundary: everything derived is
// computed only over rows the viewer can see. See
// docs/audit/profile-v2-implementation-plan.md §11–§13.

import { prisma } from "@/lib/prisma"
import { blockExistsBetween } from "@/lib/security"
import {
  MASTERIES,
  MASTERY_META,
  masteryLevelFromXp,
  rankDisplay,
  standingDisplay,
  xpRankProgress,
  xpStage,
  xpStageProgress,
  PUBLIC_XP_TYPES,
  publicXpLabel,
  type Mastery,
} from "@/lib/progression-config"
import { getGrowStreak } from "@/lib/grow-streak"
import { TERPBOT_USERNAME } from "@/lib/terpbot-constants"
import { getBotStats } from "@/lib/terpbot-events"
import { publicDiaryWhere } from "@/lib/diary-visibility"
import { parseProfileSettings, type ProfileSettings, type SectionVisibility } from "@/lib/profile-settings"

export const PUBLIC_PROFILE_NO_STORE = { "Cache-Control": "no-store, max-age=0, must-revalidate" }

export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url.startsWith("http://") || url.startsWith("https://") ? url : `https://${url}`)
    if (u.protocol !== "https:") return null
    return u.toString()
  } catch {
    return null
  }
}

/**
 * Paths whose XP pipeline is live — Experimentation went live in Phase I
 * (experiment lifecycle awards are wired in src/lib/experiment-progression.ts).
 * If a path's award callsites are ever removed, flip it back to false so the
 * mastery map renders it as "coming online" — never as an earned M-level.
 */
export const LIVE_MASTERIES: Record<Mastery, boolean> = {
  CULTIVATION: true,
  RECORDS: true,
  KNOWLEDGE: true,
  EXPERIMENTATION: true,
  COMMUNITY: true,
}

export interface PublicMasteryEntry {
  mastery: Mastery
  name: string
  icon: string
  xp: number
  level: number
  live: boolean
}

export interface ProfileSectionDTO {
  id: string
  title: string
  body: string // markdown source — render via MarkdownRenderer only
  order: number
  visibility: SectionVisibility
}

export interface FeaturedGrowDTO {
  id: string
  slug: string | null
  title: string
  strain: string | null
  stage: string
  harvested: boolean
  updatedAt: Date
}

export interface PublicProfileStats {
  threadCreator: number
  posts: number
  diaryCreator: number
  followers: number
  following: number
  acceptedAnswers: number
  strainsGrown: number
  harvestCount: number
}

export interface PublicProfileDTO {
  id: string
  username: string
  isBot: boolean
  role: string
  bio: string | null
  location: string | null
  website: string | null
  avatarUrl: string | null
  growExperience: string | null
  favoriteStrain: string | null
  growSpace: string | null
  businessName: string | null
  businessType: string | null
  businessUrl: string | null
  image: string | null
  joinDate: Date
  xp: number
  /** Named standing tier for display, or null when the member opted out of
      public status display. The raw standing number is never public. */
  standingTier: { name: string; icon: string; color: string; bg: string } | null
  rank: ReturnType<typeof rankDisplay>
  rankProgress: ReturnType<typeof xpRankProgress>
  xpStage: ReturnType<typeof xpStage>
  stageProgress: ReturnType<typeof xpStageProgress>
  mastery: PublicMasteryEntry[]
  pinnedHarvest: {
    id: string; slug: string | null; title: string; strain: string | null
    harvestedAt: Date | null; updatedAt: Date
  } | null
  featuredGrow: FeaturedGrowDTO | null
  customSections: ProfileSectionDTO[]
  growStreak: number
  totalUpdates: number
  harvestedDiaries: number
  badges: { name: string; description: string; icon: string; pinned: boolean }[]
  stats: PublicProfileStats
  botStats: {
    commands: number; membersAssisted: number; entityLinks: number
    welcomes: number; announcements: number; daysActive: number
    assists: number; byCommand: Record<string, number>; hasFallbacks: boolean
  } | null
  profileSettings: ProfileSettings
}

export interface PublicProfileResult {
  profile: PublicProfileDTO
  viewerBlocked: boolean
  viewerFollowing: boolean
  recentProgression: { id: string; label: string; amount: number; reversed: boolean; createdAt: Date }[]
  recentThreads: {
    id: string; title: string; slug: string; createdAt: Date
    category: { name: string }; replyCount: number
  }[]
  growDiaries: {
    id: string; slug: string | null; title: string; strain: string | null
    stage: string; featured: boolean
    _count: { updates: number; followers: number }
  }[]
  growSetups: {
    id: string; slug: string | null; title: string; strain: string | null
    images: { url: string }[]; _count: { comments: number }
  }[]
  harvestShelf: {
    id: string; slug: string | null; title: string; strain: string | null
    startDate: Date | null; harvestedAt: Date | null
    yieldAmount: number | null; yieldUnit: string | null
    _count: { updates: number }
  }[]
}

/**
 * Centralized viewer-aware public profile aggregation. One profile lookup,
 * then all independent reads in a single Promise.all — the previous shape ran
 * ~9 sequential roundtrips. Every diary-derived list/count is scoped to what
 * the viewer may see (owner: all non-deleted; others: PUBLIC only), so
 * UNLISTED/PRIVATE rows never inflate public aggregates.
 *
 * Returns null for missing/banned/suspended members (renders 404). Block
 * checks happen in the caller (route and RSC page share the same rule).
 */
export async function getPublicProfileData(
  username: string,
  viewerId?: string
): Promise<PublicProfileResult | null> {
  const profile = await prisma.profile.findFirst({
    where: { username: { equals: username, mode: "insensitive" } },
    select: {
      id: true,
      username: true,
      bio: true,
      location: true,
      website: true,
      avatarUrl: true,
      growExperience: true,
      favoriteStrain: true,
      growSpace: true,
      businessName: true,
      businessType: true,
      businessUrl: true,
      joinDate: true,
      xp: true,
      standing: true,
      pinnedDiaryId: true,
      featuredDiaryId: true,
      profileSettings: true,
      publicMilestoneOptOut: true,
      user: {
        select: {
          id: true,
          image: true,
          createdAt: true,
          banned: true,
          suspendedUntil: true,
          role: true,
          badges: { include: { badge: true }, orderBy: [{ pinned: "desc" as const }, { earnedAt: "asc" as const }] },
          masteryProgress: { select: { mastery: true, xp: true } },
          _count: {
            select: {
              threadCreator: true,
              posts: true,
              diaryCreator: true,
              followers: true,
              following: true,
            },
          },
        },
      },
    },
  })

  const suspended = !!profile?.user.suspendedUntil && profile.user.suspendedUntil > new Date()
  if (!profile || profile.user.banned || suspended) return null

  const ownerId = profile.user.id
  const isOwner = viewerId === ownerId
  // Owner sees all own rows; everyone else only PUBLIC (UNLISTED is
  // link-reachable but never listed or counted on profiles).
  const diaryScope = isOwner ? {} : publicDiaryWhere
  const diaryOwnerScope = { authorId: ownerId, deleted: false }
  const isBot = profile.username === TERPBOT_USERNAME

  const [
    recentThreads,
    streakData,
    growDiaries,
    growSetups,
    harvestShelf,
    diaryCount,
    harvestedCount,
    acceptedAnswers,
    strainsGrownRows,
    pinnedDiaryRow,
    featuredDiaryRow,
    customSections,
    botStatsRaw,
    recentProgressionRows,
  ] = await Promise.all([
    prisma.thread.findMany({
      where: { authorId: ownerId, deleted: false, category: { hidden: false } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true, title: true, slug: true, createdAt: true,
        category: { select: { name: true } }, replyCount: true,
      },
    }),
    getGrowStreak(ownerId, { publicOnly: !isOwner }),
    prisma.growDiary.findMany({
      where: { ...diaryOwnerScope, ...diaryScope },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true, slug: true, title: true, strain: true, stage: true, featured: true,
        _count: { select: { updates: true, followers: true } },
      },
    }),
    prisma.growSetup.findMany({
      where: { authorId: ownerId, deleted: false },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true, slug: true, title: true, strain: true,
        images: { take: 1, orderBy: { order: "asc" }, select: { url: true } },
        _count: { select: { comments: true } },
      },
    }),
    prisma.growDiary.findMany({
      where: { ...diaryOwnerScope, harvested: true, ...diaryScope },
      orderBy: { harvestedAt: "desc" },
      take: 6,
      select: {
        id: true, slug: true, title: true, strain: true,
        startDate: true, harvestedAt: true, yieldAmount: true, yieldUnit: true,
        _count: { select: { updates: true } },
      },
    }),
    prisma.growDiary.count({ where: { ...diaryOwnerScope, ...diaryScope } }),
    prisma.growDiary.count({ where: { ...diaryOwnerScope, harvested: true, ...diaryScope } }),
    prisma.post.count({ where: { authorId: ownerId, deleted: false, acceptedAnswerFor: { isNot: null } } }),
    prisma.growDiary.groupBy({
      by: ["strainId"],
      where: { ...diaryOwnerScope, strainId: { not: null }, ...diaryScope },
    }),
    profile.pinnedDiaryId
      ? prisma.growDiary.findUnique({
          where: { id: profile.pinnedDiaryId },
          select: {
            id: true, slug: true, title: true, strain: true,
            harvestedAt: true, updatedAt: true, deleted: true, visibility: true,
          },
        })
      : Promise.resolve(null),
    profile.featuredDiaryId
      ? prisma.growDiary.findUnique({
          where: { id: profile.featuredDiaryId },
          select: {
            id: true, slug: true, title: true, strain: true, stage: true,
            harvested: true, updatedAt: true, deleted: true, visibility: true, authorId: true,
          },
        })
      : Promise.resolve(null),
    prisma.profileCustomSection.findMany({
      where: {
        profileId: profile.id,
        // HIDDEN is owner-only; MEMBERS is hidden from anonymous viewers.
        ...(isOwner ? {} : { visibility: viewerId ? { in: ["PUBLIC", "MEMBERS"] } : "PUBLIC" }),
      },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      take: PROFILE_SECTIONS_PUBLIC_MAX,
      select: { id: true, title: true, body: true, order: true, visibility: true },
    }),
    isBot ? getBotStats() : Promise.resolve(null),
    isBot || profile.publicMilestoneOptOut
      ? Promise.resolve([])
      : prisma.progressionEvent.findMany({
          where: { userId: ownerId, type: { in: [...PUBLIC_XP_TYPES] } },
          orderBy: { createdAt: "desc" },
          take: 6,
          select: { id: true, type: true, xp: true, standing: true, reversedAt: true, createdAt: true },
        }),
  ])

  // Pinned harvest — Garden Perk; only while the diary is still visible to
  // this viewer (never deleted; PUBLIC unless owner).
  const pinnedHarvest =
    pinnedDiaryRow && !pinnedDiaryRow.deleted && (isOwner || pinnedDiaryRow.visibility === "PUBLIC")
      ? {
          id: pinnedDiaryRow.id, slug: pinnedDiaryRow.slug, title: pinnedDiaryRow.title,
          strain: pinnedDiaryRow.strain, harvestedAt: pinnedDiaryRow.harvestedAt,
          updatedAt: pinnedDiaryRow.updatedAt,
        }
      : null

  // Featured grow — member-selected. Same visibility rule; never surfaces a
  // row the viewer can't open, and never a diary the member doesn't own.
  const featuredGrow: FeaturedGrowDTO | null =
    featuredDiaryRow &&
    !featuredDiaryRow.deleted &&
    featuredDiaryRow.authorId === ownerId &&
    (isOwner || featuredDiaryRow.visibility === "PUBLIC")
      ? {
          id: featuredDiaryRow.id, slug: featuredDiaryRow.slug, title: featuredDiaryRow.title,
          strain: featuredDiaryRow.strain, stage: featuredDiaryRow.stage,
          harvested: featuredDiaryRow.harvested, updatedAt: featuredDiaryRow.updatedAt,
        }
      : null

  const xpByMastery = new Map(profile.user.masteryProgress.map((m) => [m.mastery, m.xp]))
  const mastery: PublicMasteryEntry[] = MASTERIES.map((m) => {
    const xp = xpByMastery.get(m) ?? 0
    return { mastery: m, name: MASTERY_META[m].name, icon: MASTERY_META[m].icon, xp, level: masteryLevelFromXp(xp), live: LIVE_MASTERIES[m] }
  })

  const fullStats = botStatsRaw
  const botStats = fullStats && {
    commands: fullStats.commands,
    membersAssisted: fullStats.membersAssisted,
    entityLinks: fullStats.entityLinks,
    welcomes: fullStats.welcomes,
    announcements: fullStats.announcements,
    daysActive: fullStats.daysActive,
    assists: fullStats.assists,
    byCommand: fullStats.byCommand,
    hasFallbacks: fullStats.fallbacks > 0,
  }

  const hideStatus = profile.publicMilestoneOptOut
  const dto: PublicProfileDTO = {
    id: ownerId,
    username: profile.username,
    isBot,
    role: profile.user.role,
    bio: profile.bio,
    location: profile.location,
    website: safeUrl(profile.website),
    avatarUrl: profile.avatarUrl,
    growExperience: profile.growExperience,
    favoriteStrain: profile.favoriteStrain,
    growSpace: profile.growSpace,
    businessName: profile.businessName,
    businessType: profile.businessType,
    businessUrl: safeUrl(profile.businessUrl),
    image: profile.user.image || profile.avatarUrl,
    joinDate: profile.joinDate,
    xp: profile.xp,
    // Named tier only, and only when the member hasn't opted out of public
    // status display — same rule as the /card DTO. Raw standing never ships.
    standingTier: hideStatus || isBot ? null : standingDisplay(profile.standing),
    rank: rankDisplay(profile.xp),
    rankProgress: xpRankProgress(profile.xp),
    xpStage: xpStage(profile.xp),
    stageProgress: xpStageProgress(profile.xp),
    mastery,
    pinnedHarvest,
    featuredGrow,
    customSections: customSections.map((s) => ({
      id: s.id, title: s.title, body: s.body, order: s.order,
      visibility: s.visibility as SectionVisibility,
    })),
    growStreak: hideStatus ? 0 : streakData.streak,
    totalUpdates: streakData.totalUpdates,
    harvestedDiaries: streakData.harvestedDiaries,
    badges: profile.user.badges.map((b) => ({
      name: b.badge.name, description: b.badge.description, icon: b.badge.icon ?? "", pinned: b.pinned,
    })),
    // _count.following counts rows where this user is the TARGET (their
    // followers) and _count.followers the reverse — remapped to real meaning.
    stats: {
      ...profile.user._count,
      // Non-deleted diaries in the viewer's visibility scope — _count would
      // include soft-deleted rows, so the scoped count wins for everyone.
      diaryCreator: diaryCount,
      followers: profile.user._count.following,
      following: profile.user._count.followers,
      acceptedAnswers,
      strainsGrown: strainsGrownRows.length,
      harvestCount: harvestedCount,
    },
    botStats,
    profileSettings: parseProfileSettings(profile.profileSettings),
  }

  let viewerBlocked = false
  let blockedMe = false
  let viewerFollowing = false
  if (viewerId && !isOwner) {
    const [block, follow] = await Promise.all([
      prisma.block.findUnique({
        where: { blockerId_blockedId: { blockerId: viewerId, blockedId: ownerId } },
        select: { id: true },
      }),
      prisma.follow.findUnique({
        where: { followerId_followingId: { followerId: viewerId, followingId: ownerId } },
        select: { id: true },
      }),
    ])
    viewerBlocked = !!block
    viewerFollowing = !!follow
    blockedMe = await blockExistsBetween(ownerId, viewerId)
  }
  if (blockedMe) return null

  return {
    profile: dto,
    viewerBlocked,
    viewerFollowing,
    recentProgression: recentProgressionRows.map((e) => ({
      id: e.id,
      label: publicXpLabel(e.type),
      amount: e.xp !== 0 ? e.xp : e.standing,
      reversed: !!e.reversedAt,
      createdAt: e.createdAt,
    })),
    recentThreads,
    growDiaries,
    growSetups,
    harvestShelf,
  }
}

const PROFILE_SECTIONS_PUBLIC_MAX = 20
