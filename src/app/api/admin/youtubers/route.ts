import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { forbidden } from "@/lib/security"
import { requireAdmin } from "@/lib/require-staff"
import { getBadgeByName } from "@/lib/badge-registry"
import { rateLimit } from "@/lib/rate-limit"

const BADGE_NAME = "Verified YouTuber"
const MAX_PAGE_SIZE = 100

// GET — list YouTuber applicants and verified creators (ADMINISTRATOR only)
export async function GET(request: Request) {
  try {
    const admin = await requireAdmin()
    if (!admin) return forbidden()

    const rl = await rateLimit(`admin-youtubers:${admin.id}`, 30, 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, Number(searchParams.get("page")) || 1)
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(searchParams.get("limit")) || 50))
    const skip = (page - 1) * limit

    const users = await prisma.user.findMany({
      where: { profile: { youtubeChannelUrl: { not: null } } },
      include: {
        profile: {
          select: {
            id: true,
            username: true,
            avatarUrl: true,
            youtubeChannelUrl: true,
          },
        },
        badges: {
          where: { badge: { name: BADGE_NAME } },
          select: { id: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip,
    })

    return NextResponse.json({
      youtubers: users.map((u) => ({
        id: u.id,
        username: u.profile?.username,
        avatarUrl: u.profile?.avatarUrl,
        youtubeChannelUrl: u.profile?.youtubeChannelUrl,
        isVerified: u.badges.length > 0,
      })),
    })
  } catch (error) {
    console.error("Failed to load YouTubers:", error)
    return NextResponse.json(
      { error: "Failed to load YouTubers" },
      { status: 500 }
    )
  }
}

// POST — approve / toggle Verified YouTuber badge (ADMINISTRATOR only)
export async function POST(request: Request) {
  try {
    const admin = await requireAdmin()
    if (!admin) return forbidden()

    const rl = await rateLimit(`admin-youtubers:${admin.id}`, 60, 60 * 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))
    const { userId } = body

    if (!userId || typeof userId !== "string") {
      return NextResponse.json({ error: "userId is required" }, { status: 400 })
    }

    const def = getBadgeByName(BADGE_NAME)
    const badge = await prisma.badge.upsert({
      where: { name: BADGE_NAME },
      create: {
        name: BADGE_NAME,
        description: def?.description ?? BADGE_NAME,
        icon: def?.icon ?? "Video",
        color: def?.rarity ?? "epic",
        requirement: def?.requirement ?? BADGE_NAME,
      },
      update: {},
    })

    const existing = await prisma.userBadge.findUnique({
      where: { userId_badgeId: { userId, badgeId: badge.id } },
    })

    if (existing) {
      await prisma.userBadge.delete({ where: { id: existing.id } })
      return NextResponse.json({ verified: false })
    }

    await prisma.userBadge.create({
      data: { userId, badgeId: badge.id },
    })

    return NextResponse.json({ verified: true })
  } catch (error) {
    console.error("Failed to verify YouTuber:", error)
    return NextResponse.json(
      { error: "Failed to verify YouTuber" },
      { status: 500 }
    )
  }
}
