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
}

export interface ExperimentCardDTO {
  id: string
  title: string
  category: string
  status: string
  outcome: string | null
  startedAt: Date
  endedAt: Date | null
  diary: { id: string; slug: string | null; title: string }
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
  xp: number
  /** Named standing tier for display, or null when the member opted out of
      public status display. The raw standing number is never public. */
  standingTier: { name: string; icon: string; color: string; bg: string } | null
  rank: ReturnType<typeof rankDisplay>
  rankProgress: ReturnType<typeof xpRankProgress>
  xpStage: ReturnType<typeof xpStage>
  stageProgress: ReturnType<typeof xpStageProgress>
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
  strainPortfolio: { name: string; slug: string | null; grows: number }[]
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
        id: true, title: true, category: true, status: true, outcome: true,
        startedAt: true, endedAt: true,
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
  const strainPortfolio = strainsGrownRows
    .map((r) => {
      const s = r.strainId ? strainById.get(r.strainId) : undefined
      return s ? { name: s.name, slug: s.slug, grows: r._count._all } : null
    })
    .filter((s): s is { name: string; slug: string | null; grows: number } => !!s)
    .sort((a, b) => b.grows - a.grows)
    .slice(0, 10)

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
    // Named tier only from "Known" upward — below it nothing renders (no
    // shame badge), and never when the member opted out. Raw standing
    // number is never shipped.
    standingTier: hideStatus || isBot || profile.standing < STANDINGS[1].min
      ? null
      : standingDisplay(profile.standing),
    rank: rankDisplay(profile.xp),
    rankProgress: xpRankProgress(profile.xp),
    xpStage: xpStage(profile.xp),
    stageProgress: xpStageProgress(profile.xp),
    buildTitle: hideStatus || isBot || totalPathXp < 50 ? null : buildTitle(pathXp).title,
    verified,
    nextUnlock: hideStatus || isBot ? null : nextRankUnlock(profile.xp),
    statusHidden: hideStatus,
    mastery,
    notableStats,
    pinnedHarvest,
    featuredGrow,
    activeGrow,
    experiments: experimentsRows.map((e) => ({
      id: e.id, title: e.title, category: e.category, status: e.status,
      outcome: e.outcome, startedAt: e.startedAt, endedAt: e.endedAt,
      diary: e.diary,
    })),
    acceptedAnswersList,
    strainPortfolio,
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
const PROFILE_TAB_PAGE_SIZE = 12

export type ProfileTabSection = "grows" | "harvests"

export interface ProfileSectionPage {
  items: GrowCardDTO[]
  nextCursor: string | null
}

/**
 * Cursor-paged grow portfolio for the Grows/Harvests tabs — the initial
 * payload stays bounded; tab lists page through here. Same visibility and
 * block rules as the profile itself.
 */
export async function getProfileSection(
  username: string,
  section: ProfileTabSection,
  viewerId?: string,
  cursor?: string
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
  const scope = isOwner ? {} : publicDiaryWhere

  const harvested = section === "harvests"
  const rows = await prisma.growDiary.findMany({
    // Grows tab = the whole portfolio, active first then completed; the
    // Harvests tab pages only finished grows, newest harvest first.
    where: { authorId: ownerId, deleted: false, ...(harvested ? { harvested: true } : {}), ...scope },
    orderBy: harvested ? { harvestedAt: "desc" } : [{ harvested: "asc" }, { updatedAt: "desc" }],
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: PROFILE_TAB_PAGE_SIZE + 1,
    select: {
      id: true, slug: true, title: true, strain: true, stage: true,
      harvested: true, updatedAt: true, startDate: true, visibility: true,
      yieldAmount: true, yieldUnit: true,
      harvestedAt: true,
      _count: { select: { updates: true } },
    },
  })

  // Yield rides with diary visibility — no separate per-harvest flag exists
  // today; a row the viewer can see is a row whose yield they can see.
  const items = rows.slice(0, PROFILE_TAB_PAGE_SIZE).map((d) => ({
    id: d.id, slug: d.slug, title: d.title, strain: d.strain, stage: d.stage,
    harvested: d.harvested,
    day: d.startDate ? Math.max(1, Math.floor((Date.now() - d.startDate.getTime()) / 86400000) + 1) : null,
    updates: d._count.updates, visibility: d.visibility,
    updatedAt: d.updatedAt, startDate: d.startDate,
    harvestedAt: d.harvestedAt,
    yieldAmount: d.yieldAmount, yieldUnit: d.yieldUnit,
  }))

  return {
    items,
    nextCursor: rows.length > PROFILE_TAB_PAGE_SIZE ? rows[PROFILE_TAB_PAGE_SIZE - 1].id : null,
  }
}
