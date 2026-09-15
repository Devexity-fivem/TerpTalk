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
import { getJourneyState, evaluateJourneys, type JourneyState } from "@/lib/journeys"

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

    const [profile, challenges, quests, recentBadges, trustScore, earnedBadges, journey, staleDiary] = await Promise.all([
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
      getJourneyState(userId),
      // Cheapest signal for "your grow needs attention": the member's most
      // recent live diary that hasn't been updated in 3+ days.
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
    ])
    if (!profile) return unauthorized()

    // Journey completion pays once through the ledger — safe to evaluate
    // on every load, the keyed award dedupes.
    if (journey?.complete) await evaluateJourneys(userId, journey).catch(() => {})

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

    // Next Best Action — deterministic priority rules over real state.
    // Ordered so the highest-value gap surfaces first; never recommends
    // spam or raw volume.
    const nextAction = pickNextAction({
      journey,
      rep,
      nextTier,
      staleDiary,
      quests,
    })

    return NextResponse.json(
      {
        reputation: rep,
        nextAction,
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
        journey,
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

// Deterministic rule list — highest-value gap wins. The order is the
// product decision: guided journey first for new members, then real grow
// documentation, then tier proximity, then a daily quest, then helping
// another grower.
function pickNextAction(input: {
  journey: JourneyState | null
  rep: number
  nextTier: { name: string; threshold: number } | null
  staleDiary: { id: string; title: string } | null
  quests: { title: string; done: boolean; paid: boolean }[]
}): { icon: string; text: string; href: string; cta: string } {
  const { journey, rep, nextTier, staleDiary, quests } = input

  if (journey && !journey.complete) {
    const step = journey.steps.find((s) => !s.done)
    if (step) {
      return {
        icon: step.icon,
        text: `${step.title} — ${journey.name}, step ${journey.doneCount + 1} of ${journey.steps.length}`,
        href: step.href,
        cta: step.cta,
      }
    }
  }
  if (staleDiary) {
    return {
      icon: "📓",
      text: `"${staleDiary.title.slice(0, 40)}" hasn't been updated in a few days — log what changed`,
      href: `/diaries/${staleDiary.id}`,
      cta: "Add an update",
    }
  }
  if (nextTier) {
    const remaining = nextTier.threshold - rep
    if (remaining <= Math.max(50, Math.round(nextTier.threshold * 0.1))) {
      return {
        icon: "🌿",
        text: `You're only ${remaining} rep from ${nextTier.name} — one good contribution can get you there`,
        href: "/forum",
        cta: "Help a grower",
      }
    }
  }
  const openQuest = quests.find((q) => !q.done && !q.paid)
  if (openQuest) {
    return { icon: "⚡", text: `Today's quest: ${openQuest.title}`, href: "/forum", cta: "Do it" }
  }
  return {
    icon: "💬",
    text: "Answer a grower's question — accepted answers are the fastest way to grow your standing",
    href: "/forum",
    cta: "Browse threads",
  }
}
