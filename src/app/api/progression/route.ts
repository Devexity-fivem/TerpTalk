import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized } from "@/lib/security"
import {
  REP_LADDER,
  getRepStage,
  getStageProgress,
  getNextTier,
  getTierProgress,
} from "@/lib/reputation-config"
import { nextLockedCosmetic, unlockedCosmetics } from "@/lib/cosmetics"
import { getChallengeProgress, currentWeekKey, weekStart } from "@/lib/challenges"

// GET — consolidated progression state for the signed-in member. Powers
// the "Your Garden" dashboard panel on /reputation. Owner-only: challenge
// progress and pinned-badge state are private.
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()
    const userId = session.user.id

    const [profile, challenges, recentBadges] = await Promise.all([
      prisma.profile.findUnique({
        where: { userId },
        select: { reputation: true, avatarFrame: true, profileTitle: true, profileTheme: true },
      }),
      getChallengeProgress(userId),
      prisma.userBadge.findMany({
        where: { userId },
        orderBy: { earnedAt: "desc" },
        take: 4,
        select: { earnedAt: true, badge: { select: { name: true, icon: true } } },
      }),
    ])
    if (!profile) return unauthorized()

    const rep = profile.reputation
    const stage = getRepStage(rep)
    const stageProgress = getStageProgress(rep)
    const nextTier = getNextTier(rep)
    const tierProgress = getTierProgress(rep)
    const nextUnlock = nextLockedCosmetic(rep)
    const start = weekStart()

    // Upcoming rungs — the next three milestones on the ladder.
    const upcoming = REP_LADDER.filter((r) => r > rep).slice(0, 3).map((r) => ({
      rung: r,
      level: REP_LADDER.indexOf(r) + 1,
      tier: r === nextTier?.threshold ? nextTier.name : stage.tier.name,
    }))

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
