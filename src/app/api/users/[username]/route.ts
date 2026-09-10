import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { blockExistsBetween, getTrustLevel, getClientIp, hashIp } from "@/lib/security"
import { getReputationTier, getTierProgress } from "@/lib/reputation"
import { getGrowStreak } from "@/lib/grow-streak"
import { rateLimit } from "@/lib/rate-limit"

function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url.startsWith("http://") || url.startsWith("https://") ? url : `https://${url}`)
    if (u.protocol !== "https:") return null
    return u.toString()
  } catch {
    return null
  }
}

// GET — public profile by username (safe fields only)
export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  const ip = getClientIp(request)
  const rl = await rateLimit(`public-profile:${hashIp(ip)}`, 60, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  try {
    const { username } = await params
    if (typeof username !== "string" || username.length > 30) {
      return NextResponse.json({ error: "Invalid username" }, { status: 400 })
    }

    const profile = await prisma.profile.findUnique({
      where: { username },
      select: {
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
        reputation: true,
        user: {
          select: {
            id: true,
            image: true,
            createdAt: true,
            banned: true,
            badges: { include: { badge: true } },
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

    if (!profile || profile.user.banned) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    // Privacy: don't reveal block state except whether *I* blocked them / they blocked me
    const session = await getServerSession(authOptions)
    let viewerBlocked = false
    let blockedMe = false
    let viewerFollowing = false
    if (session?.user?.id && session.user.id !== profile.user.id) {
      viewerBlocked = !!(await prisma.block.findUnique({
        where: {
          blockerId_blockedId: {
            blockerId: session.user.id,
            blockedId: profile.user.id,
          },
        },
        select: { id: true },
      }))
      blockedMe = await blockExistsBetween(profile.user.id, session.user.id)
      viewerFollowing = !!(await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: session.user.id,
            followingId: profile.user.id,
          },
        },
        select: { id: true },
      }))
    }

    if (blockedMe) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const recentThreads = await prisma.thread.findMany({
      where: {
        authorId: profile.user.id,
        deleted: false,
        category: { hidden: false },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        title: true,
        slug: true,
        createdAt: true,
        category: { select: { name: true } },
        replyCount: true,
      },
    })

    const { streak, totalUpdates, harvestedDiaries } = await getGrowStreak(profile.user.id)

    const growDiaries = await prisma.growDiary.findMany({
      where: { authorId: profile.user.id, deleted: false },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        title: true,
        strain: true,
        stage: true,
        featured: true,
        _count: { select: { updates: true, followers: true } },
      },
    })

    return NextResponse.json({
      profile: {
        id: profile.user.id,
        username: profile.username,
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
        image: profile.user.image,
        joinDate: profile.joinDate,
        reputation: profile.reputation,
        trustLevel: getTrustLevel(profile.user.createdAt, profile.reputation),
        reputationTier: getReputationTier(profile.reputation),
        tierProgress: getTierProgress(profile.reputation),
        growStreak: streak,
        totalUpdates,
        harvestedDiaries,
        badges: profile.user.badges.map((b) => ({
          name: b.badge.name,
          description: b.badge.description,
          icon: b.badge.icon,
        })),
        stats: profile.user._count,
      },
      viewerBlocked,
      viewerFollowing,
      recentThreads,
      growDiaries,
    })
  } catch (error) {
    console.error("Public profile error:", error)
    return NextResponse.json({ error: "Failed to load profile" }, { status: 500 })
  }
}
