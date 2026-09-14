import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { unauthorized } from "@/lib/security"
import { prisma } from "@/lib/prisma"
import { getUserStats, getReputationTier } from "@/lib/reputation"
import { BADGE_REGISTRY, BADGE_CATEGORY_LABELS } from "@/lib/badge-registry"
import { rateLimit } from "@/lib/rate-limit"

// GET — the signed-in member's achievement progress. Owner-only: progress
// stats (e.g. hidden-category-adjacent counts) are not public.
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()

    const rl = await rateLimit(`achievements:${session.user.id}`, 30, 60 * 1000)
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

    const [stats, earned, profile] = await Promise.all([
      getUserStats(session.user.id),
      prisma.userBadge.findMany({
        where: { userId: session.user.id },
        select: { badgeId: true, badge: { select: { name: true } }, earnedAt: true, pinned: true },
      }),
      prisma.profile.findUnique({
        where: { userId: session.user.id },
        select: { reputation: true },
      }),
    ])
    const earnedMap = new Map(earned.map((e) => [e.badge.name, e]))

    const achievements = BADGE_REGISTRY.map((def) => {
      const e = earnedMap.get(def.name)
      // Hidden badges stay secret until earned — the collection renders
      // them as "???" with no name, description, or progress to game toward.
      if (def.hidden && !e) {
        return {
          name: null,
          description: "Something is waiting to be discovered.",
          requirement: "???",
          rarity: def.rarity,
          category: def.category,
          icon: null,
          hidden: true,
          earned: false,
          earnedAt: null,
          pinned: false,
          badgeId: null,
          progress: null,
        }
      }
      let progress: { current: number; target: number; direction: "gte" | "lte" } | null = null
      if (def.progress) {
        const raw = def.progress.stats.reduce(
          (sum, k) => sum + Number(stats[k as keyof typeof stats] ?? 0),
          0
        )
        // "lte" specs (member number) don't fill a bar — the raw value IS
        // the datum the UI needs ("member #N of first 250").
        progress =
          def.progress.direction === "lte"
            ? { current: raw, target: def.progress.target, direction: "lte" }
            : { current: Math.min(raw, def.progress.target), target: def.progress.target, direction: "gte" }
      }
      return {
        name: def.name,
        description: def.description,
        requirement: def.requirement,
        rarity: def.rarity,
        category: def.category,
        icon: def.icon,
        hidden: !!def.hidden,
        earned: !!e,
        earnedAt: e?.earnedAt ?? null,
        pinned: e?.pinned ?? false,
        badgeId: e?.badgeId ?? null,
        progress,
      }
    })

    // Showcase quota — pin slots come from the member's current tier.
    const showcaseSlots = getReputationTier(profile?.reputation ?? 0).perks.showcaseSlots ?? 3

    return NextResponse.json(
      {
        achievements,
        categories: BADGE_CATEGORY_LABELS,
        showcase: { pinned: earned.filter((e) => e.pinned).length, slots: showcaseSlots },
      },
      { headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } }
    )
  } catch (error) {
    console.error("Achievements error:", error)
    return NextResponse.json({ error: "Failed to load achievements" }, { status: 500 })
  }
}
