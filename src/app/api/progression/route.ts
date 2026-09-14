import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import {
  REP_LADDER,
  getRepStage,
  getStageProgress,
  getNextTier,
  getTierProgress,
  getTrustStanding,
  getNextTrustStanding,
} from "@/lib/reputation-config"
import { getTrustScore, getUserStats, type UserStats } from "@/lib/reputation"
import { BADGE_REGISTRY } from "@/lib/badge-registry"
import { nextLockedCosmetic, unlockedCosmetics } from "@/lib/cosmetics"
import { getChallengeProgress, currentWeekKey, weekStart } from "@/lib/challenges"
import { getQuestProgress, currentDayKey } from "@/lib/quests"

// GET — consolidated progression state for the signed-in member. Powers
// the "Your Garden" panel and the /progress dashboard. Owner-only: quest
// progress, near-badge stats, and pinned-badge state are private.
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()
    const userId = session.user.id

    const rl = await rateLimit(`progression:${userId}`, 30, 60 * 1000)
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

    const [profile, challenges, quests, recentBadges, trustScore, earnedBadges] = await Promise.all([
      prisma.profile.findUnique({
        where: { userId },
        select: { reputation: true, avatarFrame: true, profileTitle: true, profileTheme: true },
      }),
      getChallengeProgress(userId),
      getQuestProgress(userId),
      prisma.userBadge.findMany({
        where: { userId },
        orderBy: { earnedAt: "desc" },
        take: 4,
        select: { earnedAt: true, badge: { select: { name: true, icon: true } } },
      }),
      getTrustScore(userId),
      prisma.userBadge.findMany({ where: { userId }, select: { badge: { select: { name: true } } } }),
    ])
    if (!profile) return unauthorized()

    const rep = profile.reputation
    const stage = getRepStage(rep)
    const stageProgress = getStageProgress(rep)
    const nextTier = getNextTier(rep)
    const tierProgress = getTierProgress(rep)
    const nextUnlock = nextLockedCosmetic(rep)
    const start = weekStart()
    const standing = getTrustStanding(trustScore)
    const nextStanding = getNextTrustStanding(trustScore)

    // Upcoming rungs — the next three milestones on the ladder.
    const upcoming = REP_LADDER.filter((r) => r > rep).slice(0, 3).map((r) => ({
      rung: r,
      level: REP_LADDER.indexOf(r) + 1,
      tier: r === nextTier?.threshold ? nextTier.name : stage.tier.name,
    }))

    // "Almost earned" — the top 3 unearned progress badges by completion
    // percentage. Only the stats those badges need are computed.
    const earnedNames = new Set(earnedBadges.map((e) => e.badge.name))
    const neededStats = new Set<keyof UserStats>()
    for (const def of BADGE_REGISTRY) {
      if (def.hidden || earnedNames.has(def.name) || !def.progress) continue
      for (const k of def.progress.stats) neededStats.add(k as keyof UserStats)
    }
    let nearBadges: {
      name: string
      icon: string
      rarity: string
      current: number
      target: number
      percent: number
    }[] = []
    if (neededStats.size > 0) {
      const stats = await getUserStats(userId, neededStats)
      nearBadges = BADGE_REGISTRY.filter((d) => !d.hidden && !earnedNames.has(d.name) && d.progress)
        .map((d) => {
          const spec = d.progress!
          const raw = spec.stats.reduce((s, k) => s + Number(stats[k as keyof UserStats] ?? 0), 0)
          const percent =
            spec.direction === "lte"
              ? raw === 0 || raw > spec.target
                ? 0
                : 100
              : Math.min(100, Math.round((raw / spec.target) * 100))
          return { name: d.name, icon: d.icon, rarity: d.rarity, current: raw, target: spec.target, percent }
        })
        .filter((b) => b.percent > 0 && b.percent < 100)
        .sort((a, b) => b.percent - a.percent)
        .slice(0, 3)
    }

    return NextResponse.json(
      {
        reputation: rep,
        level: stage.level,
        maxLevel: REP_LADDER.length,
        stage: { name: stage.stageName, index: stage.stageIndex, count: stage.stageCount },
        tier: {
          name: stage.tier.name,
          icon: stage.tier.icon,
          color: stage.tier.color,
          bg: stage.tier.bg,
          benefit: stage.tier.benefit,
        },
        stageProgress,
        tierProgress,
        nextTier: nextTier
          ? { name: nextTier.name, icon: nextTier.icon, threshold: nextTier.threshold, benefit: nextTier.benefit }
          : null,
        nextUnlock: nextUnlock
          ? { kind: nextUnlock.kind, name: nextUnlock.name, unlockedAt: nextUnlock.unlockedAt }
          : null,
        upcoming,
        trust: {
          score: trustScore,
          standing: { name: standing.name, icon: standing.icon, color: standing.color, bg: standing.bg },
          next: nextStanding ? { name: nextStanding.name, min: nextStanding.min } : null,
        },
        cosmetics: {
          equipped: {
            avatarFrame: profile.avatarFrame,
            profileTitle: profile.profileTitle,
            profileTheme: profile.profileTheme,
          },
          unlockedCount:
            unlockedCosmetics(rep).frames.length +
            unlockedCosmetics(rep).titles.length +
            unlockedCosmetics(rep).themes.length,
        },
        challenges: { week: currentWeekKey(), endsAt: new Date(start.getTime() + 7 * 86400000), items: challenges },
        quests: { day: currentDayKey(), items: quests },
        nearBadges,
        badgeCount: earnedNames.size,
        recentBadges: recentBadges.map((ub) => ({
          name: ub.badge.name,
          icon: ub.badge.icon,
          earnedAt: ub.earnedAt,
        })),
      },
      { headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } }
    )
  } catch (error) {
    console.error("Progression error:", error)
    return NextResponse.json({ error: "Failed to load progression" }, { status: 500 })
  }
}
