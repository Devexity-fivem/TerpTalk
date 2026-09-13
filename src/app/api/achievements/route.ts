import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { unauthorized } from "@/lib/security"
import { prisma } from "@/lib/prisma"
import { getUserStats } from "@/lib/reputation"
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

    const [stats, earned] = await Promise.all([
      getUserStats(session.user.id),
      prisma.userBadge.findMany({
        where: { userId: session.user.id },
        select: { badgeId: true, badge: { select: { name: true } }, earnedAt: true, pinned: true },
      }),
    ])
    const earnedMap = new Map(earned.map((e) => [e.badge.name, e]))

    const achievements = BADGE_REGISTRY.map((def) => {
      const e = earnedMap.get(def.name)
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
        earned: !!e,
        earnedAt: e?.earnedAt ?? null,
        pinned: e?.pinned ?? false,
        badgeId: e?.badgeId ?? null,
        progress,
      }
    })

    return NextResponse.json(
      { achievements, categories: BADGE_CATEGORY_LABELS },
      { headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } }
    )
  } catch (error) {
    console.error("Achievements error:", error)
    return NextResponse.json({ error: "Failed to load achievements" }, { status: 500 })
  }
}
