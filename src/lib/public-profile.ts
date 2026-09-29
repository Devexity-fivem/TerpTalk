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
  STANDINGS,
  buildTitle,
  masteryLevelFromXp,
  nextRankUnlock,
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
import { hasUnlock } from "@/lib/progression"
import { TERPBOT_USERNAME } from "@/lib/terpbot-constants"
import { getBotStats } from "@/lib/terpbot-events"
import { publicDiaryWhere } from "@/lib/diary-visibility"
import { mediaProxyUrl, proxyMedia } from "@/lib/media"
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

export interface GrowCardDTO {
  id: string
  slug: string | null
  title: string
  strain: string | null
  stage: string
  harvested: boolean
  /** Day count since startDate at render time — "Day N" in the hero card. */
  day: number | null
  updates: number
  /** Viewer-relevant only for the owner (marks UNLISTED/PRIVATE own rows). */
  visibility: string
  updatedAt: Date
  startDate: Date | null
  harvestedAt?: Date | null
  yieldAmount?: number | null
  yieldUnit?: string | null
  /** True on the owner's own rows when they've hidden the exact yield —
      viewers just get a null yield instead (the flag itself never ships). */
  yieldPrivate?: boolean
  /** Representative thumbnail from the latest update — section pages only. */
  image?: string | null
  /** Real stage transitions derived from logged updates — section pages
      only; never fabricated from current `stage` alone. */
  stages?: string[]
}

export interface ExperimentCardDTO {
  id: string
  title: string
  /** What the grower changed — the hypothesis, in their own words. */
  change: string
  category: string
  status: string
  outcome: string | null
  /** Grower's own conclusion at completion — the outcome summary. */
  conclusion: string | null
  startedAt: Date
  endedAt: Date | null
  diary: { id: string; slug: string | null; title: string }
}

/** Follower/following list row — compact identity only; no prestige data
    (no counts, no standing, no XP numbers). */
export interface FollowCardDTO {
  id: string
  username: string
  avatarUrl: string | null
  rank: { name: string; icon: string; color: string }
  buildTitle: string | null
}

export interface StrainRowDTO {
  /** Synthetic key = strain name (unique within a portfolio). */
  id: string
  name: string
  slug: string | null
  grows: number
}

/** Deterministic harvest highlights — all derived from viewer-scoped
    harvested diaries; null when the member has no visible harvests. */
export interface HarvestHighlightsDTO {
  firstHarvestAt: Date | null
  latestHarvestAt: Date | null
  longestGrowDays: number
  mostGrownStrain: { name: string; grows: number } | null
  repeatStrains: number
  harvestCount: number
}

export interface AcceptedAnswerDTO {
  id: string
  threadSlug: string | null
  threadTitle: string
  createdAt: Date
}

export interface NotableStatDTO {
  id: string
  label: string
  value: string
  hint?: string
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
  activeGrows: number
  experiments: number
  setups: number
  contestWins: number
  detailedUpdates: number
  documentedWeeks: number
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
  /** Raw XP — null when the member opted out of public status display
      (publicMilestoneOptOut) or the profile is a bot, so the hidden value
      never reaches an unauthorized viewer's payload. */
  xp: number | null
  /** Named standing tier for display, or null when the member opted out of
      public status display. The raw standing number is never public. */
  standingTier: { name: string; icon: string; color: string; bg: string } | null
  rank: ReturnType<typeof rankDisplay> | null
  rankProgress: ReturnType<typeof xpRankProgress> | null
  xpStage: ReturnType<typeof xpStage> | null
  stageProgress: ReturnType<typeof xpStageProgress> | null
  /** Deterministic path-XP identity ("Grow Mentor"…) — ≥50 path XP only,
      and suppressed when the member hides public status. */
  buildTitle: string | null
  /** Legacy grandfather or progression-earned verification chip kind. */
  verified: "legacy" | "progression" | null
  /** Next live rank-gated unlock — never a future/deferred roadmap row. */
  nextUnlock: ReturnType<typeof nextRankUnlock>
  /** True when the member opted out of public status display — controls
      nameplate styling parity with bylines. */
  statusHidden: boolean
  mastery: PublicMasteryEntry[]
  notableStats: NotableStatDTO[]
  pinnedHarvest: {
    id: string; slug: string | null; title: string; strain: string | null
    harvestedAt: Date | null; updatedAt: Date
  } | null
  featuredGrow: GrowCardDTO | null
  /** Latest non-harvested viewer-visible diary — the "currently growing" card. */
  activeGrow: GrowCardDTO | null
  experiments: ExperimentCardDTO[]
  acceptedAnswersList: AcceptedAnswerDTO[]
  strainPortfolio: StrainRowDTO[]
  /** Total distinct strains across visible grows — the portfolio card
      renders "top N of strainTotal" when the member grows many. */
  strainTotal: number
  /** Distinct mediums / lights / grow types / techniques across the
      member's visible grows — label-first equipment chips (§20 P3). */
  equipmentChips: string[]
  /** Deterministic harvest highlights strip for the Harvests tab. */
  harvestHighlights: HarvestHighlightsDTO | null
  /** Distinct harvest years across visible harvests — the Harvests tab
      year filter uses this instead of fabricating options. */
  harvestYears: number[]
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
    mentions: number; unknownCommands: number; fallbacks: number
  } | null
  /** Records widget (Harvested) — real scoped aggregates; null when the
      member hasn't unlocked it or has no qualifying rows. */
  records: {
    longestGrowDays: number
    biggestYield: { title: string; amount: number; unit: string | null } | null
    growingSince: Date | null
  } | null
  /** Owner-only insights (Cured) — private 30-day counts; never shipped to
      other viewers. */
  ownerInsights: {
    newFollowers: number
    updatesLogged: number
    growsStarted: number
  } | null
  profileSettings: ProfileSettings
}

export interface PublicProfileResult {
  profile: PublicProfileDTO
  viewerBlocked: boolean
  viewerFollowing: boolean
  /** True when the request carried a valid member session — follow lists
      are members-visible, so the client gates them on this. */
  viewerLoggedIn: boolean
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
    yieldPrivate: boolean
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
      legacyVerified: true,
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
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000)

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
    activeGrowRow,
    activeGrowCount,
    experimentsRows,
    experimentsCount,
    acceptedPosts,
    contestWins,
    setupsCount,
    detailedUpdates,
    documentedWeekRows,
    growingSinceAgg,
    longestGrowRows,
    openAbuseFlags,
    recordsEnabled,
    insightsEnabled,
    biggestYieldRow,
    newFollowers30d,
    updates30d,
    newGrows30d,
    scopedDiaryEnvRows,
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
        images: { take: 1, orderBy: { order: "asc" }, select: { id: true, url: true } },
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
        yieldPrivate: true,
        _count: { select: { updates: true } },
      },
    }),
    prisma.growDiary.count({ where: { ...diaryOwnerScope, ...diaryScope } }),
    prisma.growDiary.count({ where: { ...diaryOwnerScope, harvested: true, ...diaryScope } }),
    prisma.post.count({ where: { authorId: ownerId, deleted: false, acceptedAnswerFor: { isNot: null } } }),
    prisma.growDiary.groupBy({
      by: ["strainId"],
      where: { ...diaryOwnerScope, strainId: { not: null }, ...diaryScope },
      _count: { _all: true },
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
            harvested: true, updatedAt: true, startDate: true,
            deleted: true, visibility: true, authorId: true,
            _count: { select: { updates: true } },
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
    // P1 — the extra reads join the same parallel batch: active-grow card,
    // experiments (contribution tab + stat), accepted-answer posts, contest
    // wins, scoped aggregates for the notable-stats registry, and setups.
    prisma.growDiary.findFirst({
      where: { ...diaryOwnerScope, harvested: false, ...diaryScope },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true, slug: true, title: true, strain: true, stage: true,
        harvested: true, updatedAt: true, startDate: true, visibility: true,
        _count: { select: { updates: true } },
      },
    }),
    prisma.growDiary.count({ where: { ...diaryOwnerScope, harvested: false, ...diaryScope } }),
    prisma.growExperiment.findMany({
      where: { authorId: ownerId, diary: { deleted: false, ...diaryScope } },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true, title: true, change: true, category: true, status: true,
        outcome: true, conclusion: true, startedAt: true, endedAt: true,
        diary: { select: { id: true, slug: true, title: true } },
      },
    }),
    prisma.growExperiment.count({
      where: { authorId: ownerId, diary: { deleted: false, ...diaryScope } },
    }),
    prisma.post.findMany({
      where: { authorId: ownerId, deleted: false, acceptedAnswerFor: { isNot: null } },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: {
        id: true, createdAt: true,
        thread: { select: { slug: true, title: true, deleted: true, category: { select: { hidden: true } } } },
      },
    }),
    prisma.progressionEvent.count({
      where: { userId: ownerId, type: { in: ["CONTEST_WEEKLY_WIN", "CONTEST_MONTHLY_WIN"] }, reversedAt: null },
    }),
    prisma.growSetup.count({ where: { authorId: ownerId, deleted: false } }),
    prisma.progressionEvent.count({
      where: { userId: ownerId, type: "UPDATE_RICH", reversedAt: null },
    }),
    prisma.diaryUpdate.groupBy({
      by: ["diaryId", "weekNumber"],
      where: { authorId: ownerId, weekNumber: { not: null }, diary: { deleted: false, ...diaryScope } },
    }),
    prisma.growDiary.aggregate({
      where: { ...diaryOwnerScope, ...diaryScope },
      _min: { startDate: true },
    }),
    prisma.growDiary.findMany({
      where: { ...diaryOwnerScope, harvested: true, ...diaryScope, harvestedAt: { not: null } },
      select: { startDate: true, harvestedAt: true },
    }),
    prisma.abuseFlag.count({
      where: { userId: ownerId, status: { in: ["PENDING", "REVIEWING", "ESCALATED"] } },
    }),
    // P2 widgets — eligibility is the OWNER's progression, never the
    // viewer's. Capability check, not just registry presence.
    isBot ? Promise.resolve(false) : hasUnlock(ownerId, "records-widget"),
    isBot || !isOwner ? Promise.resolve(false) : hasUnlock(ownerId, "owner-analytics"),
    prisma.growDiary.findFirst({
      where: {
        ...diaryOwnerScope, harvested: true, ...diaryScope, yieldAmount: { not: null },
        // Per-harvest yield privacy (locked §6): the member's flagged rows
        // never become the public "biggest yield" record.
        ...(isOwner ? {} : { yieldPrivate: false }),
      },
      orderBy: { yieldAmount: "desc" },
      select: { title: true, yieldAmount: true, yieldUnit: true },
    }),
    isOwner
      ? prisma.follow.count({ where: { followingId: ownerId, createdAt: { gte: thirtyDaysAgo } } })
      : Promise.resolve(0),
    isOwner
      ? prisma.diaryUpdate.count({ where: { authorId: ownerId, createdAt: { gte: thirtyDaysAgo } } })
      : Promise.resolve(0),
    isOwner
      ? prisma.growDiary.count({ where: { ...diaryOwnerScope, createdAt: { gte: thirtyDaysAgo } } })
      : Promise.resolve(0),
    // P3 — equipment chips are derived facts: distinct structured fields
    // across the member's viewer-scoped grows (label-first; a future
    // product catalog can link these labels to productIds later).
    prisma.growDiary.findMany({
      where: { ...diaryOwnerScope, ...diaryScope },
      orderBy: { createdAt: "desc" },
      take: 300,
      select: { growType: true, mediumType: true, lightType: true, techniques: true },
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

  const dayOf = (start: Date | null) =>
    start ? Math.max(1, Math.floor((Date.now() - start.getTime()) / 86400000) + 1) : null
  const toGrowCard = (d: {
    id: string; slug: string | null; title: string; strain: string | null
    stage: string; harvested: boolean; updatedAt: Date; startDate: Date
    visibility: string; _count: { updates: number }
  }): GrowCardDTO => ({
    id: d.id, slug: d.slug, title: d.title, strain: d.strain, stage: d.stage,
    harvested: d.harvested, day: dayOf(d.startDate), updates: d._count.updates,
    visibility: d.visibility, updatedAt: d.updatedAt, startDate: d.startDate,
  })

  // Featured grow — member-selected. Same visibility rule; never surfaces a
  // row the viewer can't open, and never a diary the member doesn't own.
  const featuredGrow: GrowCardDTO | null =
    featuredDiaryRow &&
    !featuredDiaryRow.deleted &&
    featuredDiaryRow.authorId === ownerId &&
    (isOwner || featuredDiaryRow.visibility === "PUBLIC")
      ? toGrowCard(featuredDiaryRow)
      : null

  // Active grow — the member's freshest non-harvested visible diary. The
  // hero prefers the member's pick (featured); this is the honest fallback.
  const activeGrow: GrowCardDTO | null = activeGrowRow ? toGrowCard(activeGrowRow) : null

  const xpByMastery = new Map(profile.user.masteryProgress.map((m) => [m.mastery, m.xp]))
  const mastery: PublicMasteryEntry[] = MASTERIES.map((m) => {
    const xp = xpByMastery.get(m) ?? 0
    return { mastery: m, name: MASTERY_META[m].name, icon: MASTERY_META[m].icon, xp, level: masteryLevelFromXp(xp), live: LIVE_MASTERIES[m] }
  })
  const pathXp = Object.fromEntries(profile.user.masteryProgress.map((m) => [m.mastery, m.xp])) as Record<Mastery, number>
  const totalPathXp = Object.values(pathXp).reduce((s, n) => s + n, 0)

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
    mentions: fullStats.mentions,
    unknownCommands: fullStats.unknownCommands,
    fallbacks: fullStats.fallbacks,
  }

  const hideStatus = profile.publicMilestoneOptOut
  const settings = parseProfileSettings(profile.profileSettings)

  // Progression Verified — the earned variant of the verified chip:
  // Respected standing (300), 30d account age, and no open abuse flags.
  const accountAgeDays = (Date.now() - profile.user.createdAt.getTime()) / 86400000
  const verified: PublicProfileDTO["verified"] = profile.legacyVerified
    ? "legacy"
    : !hideStatus && !isBot && profile.standing >= STANDINGS[3].min && accountAgeDays >= 30 && openAbuseFlags === 0
      ? "progression"
      : null

  // Accepted-answer posts only link to threads that are live + public-category.
  const acceptedAnswersList: AcceptedAnswerDTO[] = acceptedPosts
    .filter((p) => p.thread && !p.thread.deleted && !p.thread.category.hidden)
    .map((p) => ({ id: p.id, threadSlug: p.thread.slug, threadTitle: p.thread.title, createdAt: p.createdAt }))

  const longestGrowDays = longestGrowRows.reduce((n, d) => {
    if (!d.startDate || !d.harvestedAt) return n
    return Math.max(n, Math.round((d.harvestedAt.getTime() - d.startDate.getTime()) / 86400000))
  }, 0)

  // Notable-stats registry — every value is derived from viewer-visible rows
  // only (the counts above are all scoped). shownStats ≤4 render in the hero;
  // the full ≤8 list renders on Overview. Unknown/empty picks fall back to
  // the default auto-set so a fresh profile never shows a broken stat.
  const statValues: Record<string, { label: string; value: string; hint?: string }> = {
    grows: { label: "Grows documented", value: String(diaryCount) },
    harvests: { label: "Harvests completed", value: String(harvestedCount) },
    updates: { label: "Updates logged", value: String(streakData.totalUpdates) },
    detailedUpdates: { label: "Detailed updates", value: String(detailedUpdates), hint: "updates that earned a quality band" },
    documentedWeeks: { label: "Documented weeks", value: String(documentedWeekRows.length) },
    longestGrow: { label: "Longest grow", value: longestGrowDays > 0 ? `${longestGrowDays} days` : "—", hint: "start → harvest" },
    growingSince: {
      label: "Growing since",
      value: growingSinceAgg._min.startDate
        ? growingSinceAgg._min.startDate.toLocaleDateString("en-US", { month: "short", year: "numeric" })
        : "—",
    },
    acceptedAnswers: { label: "Accepted answers", value: String(acceptedAnswers) },
    experiments: { label: "Experiments run", value: String(experimentsCount) },
    strains: { label: "Strains grown", value: String(strainsGrownRows.length) },
    activeGrows: { label: "Active grows", value: String(activeGrowCount) },
    streak: { label: "Check-in streak", value: `${streakData.streak} day${streakData.streak === 1 ? "" : "s"}`, hint: "grow logging" },
    setups: { label: "Setup showcases", value: String(setupsCount) },
    contestWins: { label: "Contest wins", value: String(contestWins) },
  }
  const DEFAULT_STATS = ["grows", "harvests", "updates", "acceptedAnswers"]
  const picked = settings.shownStats.filter((id) => id in statValues)
  const chosen = picked.length > 0 ? picked : DEFAULT_STATS
  const notableStats: NotableStatDTO[] = chosen
    .map((id) => ({ id, ...statValues[id] }))
    // Streak zero / missing value stats read as vanity filler — a stat says
    // "0" when it's meaningful (counts), not "—" or "0 days".
    .filter((s) => s.value !== "—" && !(s.id === "streak" && streakData.streak < 2))
    .slice(0, 8)

  // Records widget (Harvested) — real scoped aggregates only; null when the
  // member hasn't unlocked it, so nothing advertises a feature that doesn't
  // exist for them. Biggest yield is scoped to viewer-visible harvests.
  const records: PublicProfileDTO["records"] =
    recordsEnabled && (longestGrowDays > 0 || biggestYieldRow || growingSinceAgg._min.startDate)
      ? {
          longestGrowDays,
          biggestYield: biggestYieldRow?.yieldAmount
            ? { title: biggestYieldRow.title, amount: biggestYieldRow.yieldAmount, unit: biggestYieldRow.yieldUnit }
            : null,
          growingSince: growingSinceAgg._min.startDate,
        }
      : null

  // Owner insights (Cured) — private 30-day counts, owner view only.
  const ownerInsights: PublicProfileDTO["ownerInsights"] =
    insightsEnabled && isOwner
      ? { newFollowers: newFollowers30d, updatesLogged: updates30d, growsStarted: newGrows30d }
      : null

  // Strain portfolio — names resolved in one batch lookup, ordered by how
  // many scoped grows run each strain (portfolio, not popularity metric).
  const strainIds = strainsGrownRows.map((r) => r.strainId).filter((s): s is string => !!s)
  const strainRows = strainIds.length
    ? await prisma.strain.findMany({
        where: { id: { in: strainIds } },
        select: { id: true, name: true, slug: true },
      })
    : []
  const strainById = new Map(strainRows.map((s) => [s.id, s]))
  const strainPortfolioAll = strainsGrownRows
    .map((r) => {
      const s = r.strainId ? strainById.get(r.strainId) : undefined
      return s ? { id: s.name, name: s.name, slug: s.slug, grows: r._count._all } : null
    })
    .filter((s): s is StrainRowDTO => !!s)
    .sort((a, b) => b.grows - a.grows || a.name.localeCompare(b.name))
  const strainPortfolio = strainPortfolioAll.slice(0, 50)
  const strainTotal = strainPortfolioAll.length

  // Equipment chips — label-first structured facts, deduped + bounded.
  const chipSet = new Set<string>()
  for (const d of scopedDiaryEnvRows) {
    if (d.mediumType) chipSet.add(d.mediumType.toLowerCase().replace(/_/g, " "))
    if (d.lightType) chipSet.add(d.lightType.toLowerCase())
    if (d.growType) chipSet.add(d.growType.toLowerCase())
    for (const t of d.techniques) chipSet.add(t.toLowerCase().replace(/_/g, " "))
  }
  const equipmentChips = [...chipSet].sort().slice(0, 14)

  // Harvest years (filter options) + highlights — both derive from the
  // longestGrowRows pairs already fetched, so no extra roundtrips.
  const harvestYearSet = new Set<number>()
  let firstHarvestAt: Date | null = null
  let latestHarvestAt: Date | null = null
  for (const d of longestGrowRows) {
    if (!d.harvestedAt) continue
    harvestYearSet.add(d.harvestedAt.getUTCFullYear())
    if (!firstHarvestAt || d.harvestedAt < firstHarvestAt) firstHarvestAt = d.harvestedAt
    if (!latestHarvestAt || d.harvestedAt > latestHarvestAt) latestHarvestAt = d.harvestedAt
  }
  const harvestYears = [...harvestYearSet].sort((a, b) => b - a)
  const mostGrown = strainPortfolioAll[0] ?? null
  const harvestHighlights: HarvestHighlightsDTO | null = harvestedCount > 0
    ? {
        firstHarvestAt,
        latestHarvestAt,
        longestGrowDays,
        mostGrownStrain: mostGrown ? { name: mostGrown.name, grows: mostGrown.grows } : null,
        repeatStrains: strainPortfolioAll.filter((s) => s.grows > 1).length,
        harvestCount: harvestedCount,
      }
    : null

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
    xp: hideStatus || isBot ? null : profile.xp,
    // Named tier only, and only when the member hasn't opted out of public
    // status display — same rule as the /card DTO. Raw standing never ships.
    // Named tier only from "Known" upward — below it nothing renders (no
    // shame badge), and never when the member opted out. Raw standing
    // number is never shipped.
    standingTier: hideStatus || isBot || profile.standing < STANDINGS[1].min
      ? null
      : standingDisplay(profile.standing),
    rank: hideStatus || isBot ? null : rankDisplay(profile.xp),
    rankProgress: hideStatus || isBot ? null : xpRankProgress(profile.xp),
    xpStage: hideStatus || isBot ? null : xpStage(profile.xp),
    stageProgress: hideStatus || isBot ? null : xpStageProgress(profile.xp),
    buildTitle: hideStatus || isBot || totalPathXp < 50 ? null : buildTitle(pathXp).title,
    verified,
    nextUnlock: hideStatus || isBot ? null : nextRankUnlock(profile.xp),
    statusHidden: hideStatus,
    // Mastery XP/levels are progression data — suppressed entirely when the
    // member opted out of public status display.
    mastery: hideStatus || isBot ? [] : mastery,
    notableStats,
    pinnedHarvest,
    featuredGrow,
    activeGrow,
    experiments: experimentsRows.map((e) => ({
      id: e.id, title: e.title, change: e.change, category: e.category,
      status: e.status, outcome: e.outcome, conclusion: e.conclusion,
      startedAt: e.startedAt, endedAt: e.endedAt,
      diary: e.diary,
    })),
    acceptedAnswersList,
    strainPortfolio,
    strainTotal,
    equipmentChips,
    harvestHighlights,
    harvestYears,
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
      activeGrows: activeGrowCount,
      experiments: experimentsCount,
      setups: setupsCount,
      contestWins,
      detailedUpdates,
      documentedWeeks: documentedWeekRows.length,
    },
    botStats,
    records,
    ownerInsights,
    profileSettings: settings,
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
    viewerLoggedIn: !!viewerId,
    recentProgression: recentProgressionRows.map((e) => ({
      id: e.id,
      label: publicXpLabel(e.type),
      amount: e.xp !== 0 ? e.xp : e.standing,
      reversed: !!e.reversedAt,
      createdAt: e.createdAt,
    })),
    recentThreads,
    growDiaries,
    // Restricted-class media — viewers get the authorization endpoint,
    // never the stored blob URL.
    growSetups: growSetups.map((s) => ({ ...s, images: proxyMedia("setup", s.images) })),
    // Per-harvest yield flags redact amounts for non-owners — the flag
    // itself ships so cards can honestly read "yield hidden".
    harvestShelf: harvestShelf.map((h) =>
      isOwner || !h.yieldPrivate
        ? h
        : { ...h, yieldAmount: null, yieldUnit: null }
    ),
  }
}

const PROFILE_SECTIONS_PUBLIC_MAX = 20
const PROFILE_TAB_PAGE_SIZE = 12

export type ProfileTabSection = "grows" | "harvests" | "followers" | "following" | "strains"

/** Deterministic portfolio filters — only dimensions backed by real
    columns; validated server-side before they reach a where clause. */
export interface ProfileSectionFilters {
  status?: "active" | "completed"
  strain?: string
  stage?: string
  year?: number
}

export type ProfileSectionPage = { nextCursor: string | null } & (
  | { section: "grows"; items: GrowCardDTO[] }
  | { section: "harvests"; items: GrowCardDTO[] }
  | { section: "followers"; items: FollowCardDTO[] }
  | { section: "following"; items: FollowCardDTO[] }
  | { section: "strains"; items: StrainRowDTO[] }
)

const GROW_STAGES = new Set([
  "GERMINATION", "SEEDLING", "VEGETATIVE", "FLOWER", "HARVEST", "DRYING", "CURING", "COMPLETED",
])
const FILTERED_STRAIN_MAX = 80

/**
 * Cursor-paged profile section data — the initial payload stays bounded;
 * tab lists page through here. Same visibility and block rules as the
 * profile itself: viewer-scoped diaries only, block → null, follow lists
 * are members-visible and exclude members blocked by the profile owner or
 * the viewer in either direction.
 */
export async function getProfileSection(
  username: string,
  section: ProfileTabSection,
  viewerId?: string,
  cursor?: string,
  filters?: ProfileSectionFilters
): Promise<ProfileSectionPage | null> {
  const profile = await prisma.profile.findFirst({
    where: { username: { equals: username, mode: "insensitive" } },
    select: { user: { select: { id: true, banned: true, suspendedUntil: true } } },
  })
  const suspended = !!profile?.user.suspendedUntil && profile.user.suspendedUntil > new Date()
  if (!profile || profile.user.banned || suspended) return null

  const ownerId = profile.user.id
  const isOwner = viewerId === ownerId
  if (viewerId && !isOwner && (await blockExistsBetween(ownerId, viewerId))) return null

  // ── Follow lists — members-visible only (locked decision #13). ────
  if (section === "followers" || section === "following") {
    if (!viewerId) return null
    const ownerBlocks = await prisma.block.findMany({
      where: { OR: [{ blockerId: ownerId }, { blockedId: ownerId }] },
      select: { blockerId: true, blockedId: true },
    })
    const viewerBlocks = isOwner
      ? []
      : await prisma.block.findMany({
          where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
          select: { blockerId: true, blockedId: true },
        })
    const excluded = new Set<string>()
    for (const b of ownerBlocks) excluded.add(b.blockerId === ownerId ? b.blockedId : b.blockerId)
    for (const b of viewerBlocks) excluded.add(b.blockerId === viewerId ? b.blockedId : b.blockerId)
    excluded.delete(ownerId)
    const excludedIds = [...excluded]

    // followers = people who follow the owner; following = people the
    // owner follows. Ordered by follow creation for a stable cursor.
    const rows = await prisma.follow.findMany({
      where: {
        ...(section === "followers" ? { followingId: ownerId } : { followerId: ownerId }),
        ...(excludedIds.length
          ? section === "followers"
            ? { followerId: { notIn: excludedIds } }
            : { followingId: { notIn: excludedIds } }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: PROFILE_TAB_PAGE_SIZE + 1,
      select: {
        id: true,
        follower: {
          select: {
            id: true,
            profile: { select: { username: true, avatarUrl: true, xp: true } },
            masteryProgress: { select: { mastery: true, xp: true } },
          },
        },
        following: {
          select: {
            id: true,
            profile: { select: { username: true, avatarUrl: true, xp: true } },
            masteryProgress: { select: { mastery: true, xp: true } },
          },
        },
      },
    })

    const items = rows.slice(0, PROFILE_TAB_PAGE_SIZE).map((f): FollowCardDTO | null => {
      const member = section === "followers" ? f.follower : f.following
      if (!member?.profile) return null
      const pathXp = Object.fromEntries(member.masteryProgress.map((m) => [m.mastery, m.xp])) as Record<Mastery, number>
      const totalPathXp = Object.values(pathXp).reduce((s, n) => s + n, 0)
      const r = rankDisplay(member.profile.xp)
      return {
        id: member.id,
        username: member.profile.username,
        avatarUrl: member.profile.avatarUrl,
        rank: { name: r.name, icon: r.icon, color: r.color },
        buildTitle: totalPathXp >= 50 ? buildTitle(pathXp).title : null,
      }
    }).filter((m): m is FollowCardDTO => !!m)

    return {
      section,
      items,
      nextCursor: rows.length > PROFILE_TAB_PAGE_SIZE ? rows[PROFILE_TAB_PAGE_SIZE - 1].id : null,
    }
  }

  const scope = isOwner ? {} : publicDiaryWhere

  // ── Strain see-all — paged distinct strains across visible grows. ──
  if (section === "strains") {
    const grouped = await prisma.growDiary.groupBy({
      by: ["strainId"],
      where: { authorId: ownerId, deleted: false, strainId: { not: null }, ...scope },
      _count: { _all: true },
    })
    const strainIds = grouped.map((g) => g.strainId).filter((s): s is string => !!s)
    const strainRows = strainIds.length
      ? await prisma.strain.findMany({ where: { id: { in: strainIds } }, select: { id: true, name: true, slug: true } })
      : []
    const byId = new Map(strainRows.map((s) => [s.id, s]))
    const all: StrainRowDTO[] = grouped
      .map((g) => {
        const s = g.strainId ? byId.get(g.strainId) : undefined
        return s ? { id: s.name, name: s.name, slug: s.slug, grows: g._count._all } : null
      })
      .filter((s): s is StrainRowDTO => !!s)
      .sort((a, b) => b.grows - a.grows || a.name.localeCompare(b.name))
    const offset = Math.max(0, parseInt(cursor ?? "0", 10) || 0)
    const items = all.slice(offset, offset + FILTERED_STRAIN_MAX)
    const next = offset + items.length
    return { section: "strains", items, nextCursor: next < all.length ? String(next) : null }
  }

  // ── Grow portfolio (grows) + harvest shelf (harvests) ─────────────
  const harvested = section === "harvests"
  const strain = filters?.strain?.trim()
  const stage = filters?.stage && GROW_STAGES.has(filters.stage) ? filters.stage : undefined
  const year = filters?.year && filters.year >= 2000 && filters.year <= 2100 ? filters.year : undefined
  const where = {
    authorId: ownerId,
    deleted: false,
    ...(harvested ? { harvested: true } : {}),
    ...(filters?.status === "active" ? { harvested: false } : {}),
    ...(filters?.status === "completed" ? { harvested: true } : {}),
    ...(stage && !harvested ? { stage } : {}),
    ...(strain
      ? {
          OR: [
            { strain: { equals: strain, mode: "insensitive" as const } },
            { strainRef: { name: { equals: strain, mode: "insensitive" as const } } },
          ],
        }
      : {}),
    ...(year && harvested
      ? {
          harvestedAt: {
            gte: new Date(Date.UTC(year, 0, 1)),
            lt: new Date(Date.UTC(year + 1, 0, 1)),
          },
        }
      : {}),
    ...scope,
  }
  const rows = await prisma.growDiary.findMany({
    // Grows tab = the whole portfolio, active first then completed; the
    // Harvests tab pages only finished grows, newest harvest first.
    where,
    orderBy: harvested ? [{ harvestedAt: "desc" as const }, { id: "asc" as const }] : [{ harvested: "asc" as const }, { updatedAt: "desc" as const }],
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: PROFILE_TAB_PAGE_SIZE + 1,
    select: {
      id: true, slug: true, title: true, strain: true, stage: true,
      harvested: true, updatedAt: true, startDate: true, visibility: true,
      yieldAmount: true, yieldUnit: true, yieldPrivate: true,
      harvestedAt: true,
      _count: { select: { updates: true } },
      updates: {
        take: 1,
        orderBy: { createdAt: "desc" as const },
        select: { images: { take: 1, orderBy: { order: "asc" as const }, select: { id: true, url: true } } },
      },
    },
  })

  // Real stage transitions per grow — one grouped read over the page's
  // diaries (bounded), ordered by when each stage was first logged. Only
  // stages the member actually recorded appear; nothing is fabricated.
  const pageRows = rows.slice(0, PROFILE_TAB_PAGE_SIZE)
  const stageGroups = pageRows.length
    ? await prisma.diaryUpdate.groupBy({
        by: ["diaryId", "stage"],
        where: { diaryId: { in: pageRows.map((r) => r.id) } },
        _min: { createdAt: true },
      })
    : []
  const stageMap = new Map<string, { stage: string; first: Date }[]>()
  for (const g of stageGroups) {
    if (!g._min.createdAt) continue
    const list = stageMap.get(g.diaryId) ?? []
    list.push({ stage: g.stage, first: g._min.createdAt })
    stageMap.set(g.diaryId, list)
  }
  const stagesOf = (id: string): string[] => {
    const seen = (stageMap.get(id) ?? []).sort((a, b) => a.first.getTime() - b.first.getTime())
    const out: string[] = []
    for (const s of seen) {
      if (!out.includes(s.stage)) out.push(s.stage)
    }
    return out
  }

  const items = pageRows.map((d) => ({
    id: d.id, slug: d.slug, title: d.title, strain: d.strain, stage: d.stage,
    harvested: d.harvested,
    day: d.startDate ? Math.max(1, Math.floor((Date.now() - d.startDate.getTime()) / 86400000) + 1) : null,
    updates: d._count.updates, visibility: d.visibility,
    updatedAt: d.updatedAt, startDate: d.startDate,
    harvestedAt: d.harvestedAt,
    // Per-harvest yield flag (locked §6): the owner always sees their own
    // numbers; other viewers get null + the flag so the card reads "yield
    // hidden" rather than pretending the yield was never recorded.
    yieldAmount: isOwner || !d.yieldPrivate ? d.yieldAmount : null,
    yieldUnit: isOwner || !d.yieldPrivate ? d.yieldUnit : null,
    yieldPrivate: d.yieldPrivate,
    image: d.updates[0]?.images[0] ? mediaProxyUrl("diary", d.updates[0].images[0].id) : null,
    stages: stagesOf(d.id),
  }))

  return {
    section: harvested ? "harvests" : "grows",
    items,
    nextCursor: rows.length > PROFILE_TAB_PAGE_SIZE ? rows[PROFILE_TAB_PAGE_SIZE - 1].id : null,
  }
}

/**
 * P4 — single-stat resolver for the compact ProfileCardDTO (§15: "1
 * selected stat"). The member's `shownStats[0]` pick is resolved with one
 * bounded query against the same viewer-scoped rows the full profile uses;
 * unknown ids fall back to "grows" (the DEFAULT_STATS head). Never leaks
 * non-visible rows — non-owner callers count only PUBLIC diaries.
 */
export async function resolveNotableStatValue(
  ownerId: string,
  statId: string,
  { isOwner = false }: { isOwner?: boolean } = {},
): Promise<{ id: string; label: string; value: string; hint?: string } | null> {
  const ownerScope = { authorId: ownerId, deleted: false }
  const scope = isOwner ? {} : publicDiaryWhere
  switch (statId) {
    case "harvests":
      return { id: statId, label: "Harvests completed", value: String(await prisma.growDiary.count({ where: { ...ownerScope, harvested: true, ...scope } })) }
    case "updates": {
      const n = await getGrowStreak(ownerId, { publicOnly: !isOwner })
      return { id: statId, label: "Updates logged", value: String(n.totalUpdates) }
    }
    case "detailedUpdates":
      return { id: statId, label: "Detailed updates", value: String(await prisma.progressionEvent.count({ where: { userId: ownerId, type: "UPDATE_RICH", reversedAt: null } })), hint: "updates that earned a quality band" }
    case "documentedWeeks": {
      const rows = await prisma.diaryUpdate.groupBy({ by: ["diaryId", "weekNumber"], where: { authorId: ownerId, weekNumber: { not: null }, diary: { deleted: false, ...scope } } })
      return { id: statId, label: "Documented weeks", value: String(rows.length) }
    }
    case "longestGrow": {
      const rows = await prisma.growDiary.findMany({ where: { ...ownerScope, harvested: true, ...scope, harvestedAt: { not: null } }, select: { startDate: true, harvestedAt: true } })
      const days = rows.reduce((n, d) => (!d.startDate || !d.harvestedAt ? n : Math.max(n, Math.round((d.harvestedAt.getTime() - d.startDate.getTime()) / 86400000))), 0)
      return days > 0 ? { id: statId, label: "Longest grow", value: `${days} days`, hint: "start → harvest" } : null
    }
    case "growingSince": {
      const agg = await prisma.growDiary.aggregate({ where: { ...ownerScope, ...scope }, _min: { startDate: true } })
      if (!agg._min.startDate) return null
      return { id: statId, label: "Growing since", value: agg._min.startDate.toLocaleDateString("en-US", { month: "short", year: "numeric" }) }
    }
    case "acceptedAnswers":
      return { id: statId, label: "Accepted answers", value: String(await prisma.post.count({ where: { authorId: ownerId, deleted: false, acceptedAnswerFor: { isNot: null } } })) }
    case "experiments":
      return { id: statId, label: "Experiments run", value: String(await prisma.growExperiment.count({ where: { authorId: ownerId, diary: { deleted: false, ...scope } } })) }
    case "strains": {
      const rows = await prisma.growDiary.groupBy({ by: ["strainId"], where: { ...ownerScope, strainId: { not: null }, ...scope }, _count: { _all: true } })
      return { id: statId, label: "Strains grown", value: String(rows.length) }
    }
    case "activeGrows":
      return { id: statId, label: "Active grows", value: String(await prisma.growDiary.count({ where: { ...ownerScope, harvested: false, ...scope } })) }
    case "streak": {
      const s = await getGrowStreak(ownerId, { publicOnly: !isOwner })
      return s.streak >= 2 ? { id: statId, label: "Check-in streak", value: `${s.streak} days`, hint: "grow logging" } : null
    }
    case "setups":
      return { id: statId, label: "Setup showcases", value: String(await prisma.growSetup.count({ where: ownerScope })) }
    case "contestWins":
      return { id: statId, label: "Contest wins", value: String(await prisma.progressionEvent.count({ where: { userId: ownerId, type: { in: ["CONTEST_WEEKLY_WIN", "CONTEST_MONTHLY_WIN"] }, reversedAt: null } })) }
    case "grows":
    default:
      return { id: "grows", label: "Grows documented", value: String(await prisma.growDiary.count({ where: { ...ownerScope, ...scope } })) }
  }
}
