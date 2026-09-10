import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { forbidden } from "@/lib/security"
import { requireAdmin } from "@/lib/require-staff"
import { BADGE_ICONS, BADGE_DESCRIPTIONS } from "@/lib/badges"

const BADGE_NAME = "Verified YouTuber"

// GET — list YouTuber applicants and verified creators (ADMINISTRATOR only)
export async function GET() {
  try {
    if (!(await requireAdmin())) return forbidden()

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
      take: 100,
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
    if (!(await requireAdmin())) return forbidden()

    const body = await request.json().catch(() => ({}))
    const { userId } = body

    if (!userId || typeof userId !== "string") {
      return NextResponse.json({ error: "userId is required" }, { status: 400 })
    }

    const badge = await prisma.badge.upsert({
      where: { name: BADGE_NAME },
      create: {
        name: BADGE_NAME,
        description: BADGE_DESCRIPTIONS[BADGE_NAME] || BADGE_NAME,
        icon: BADGE_ICONS[BADGE_NAME],
        requirement: BADGE_DESCRIPTIONS[BADGE_NAME] || BADGE_NAME,
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
