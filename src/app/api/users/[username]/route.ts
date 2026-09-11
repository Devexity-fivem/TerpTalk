import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { sessionCookieName } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { blockExistsBetween, getTrustLevel, getClientIp, hashIp, isSessionValid } from "@/lib/security"
import { getReputationTier, getTierProgress } from "@/lib/reputation"
import { getGrowStreak } from "@/lib/grow-streak"
import { rateLimit } from "@/lib/rate-limit"

const NO_STORE = { "Cache-Control": "no-store, max-age=0, must-revalidate" }

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

async function getPublicProfileData(username: string) {
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

    if (!profile || profile.user.banned) return null

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

    return {
      profile,
      recentThreads,
      growDiaries,
      growStreak: { streak, totalUpdates, harvestedDiaries },
    }
  }

// GET — public profile by username (safe fields only)
export async function GET(
  request: NextRequest,
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

    const data = await getPublicProfileData(username)
    if (!data) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const { profile, recentThreads, growDiaries, growStreak } = data

    // Use JWT token for the viewer instead of a full DB session lookup.
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET, cookieName: sessionCookieName })
    let viewerId = token?.id as string | undefined
    if (viewerId && !(await isSessionValid(viewerId, token?.sessionVersion as number | undefined))) {
      viewerId = undefined
    }

    let viewerBlocked = false
    let blockedMe = false
    let viewerFollowing = false
    if (viewerId && viewerId !== profile.user.id) {
      const [block, follow] = await Promise.all([
        prisma.block.findUnique({
          where: {
            blockerId_blockedId: {
              blockerId: viewerId,
              blockedId: profile.user.id,
            },
          },
          select: { id: true },
        }),
        prisma.follow.findUnique({
          where: {
            followerId_followingId: {
              followerId: viewerId,
              followingId: profile.user.id,
            },
          },
          select: { id: true },
        }),
      ])
      viewerBlocked = !!block
      viewerFollowing = !!follow
      blockedMe = await blockExistsBetween(profile.user.id, viewerId)
    }

    if (blockedMe) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

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
        image: profile.user.image || profile.avatarUrl,
        joinDate: profile.joinDate,
        reputation: profile.reputation,
        trustLevel: getTrustLevel(profile.user.createdAt, profile.reputation),
        reputationTier: getReputationTier(profile.reputation),
        tierProgress: getTierProgress(profile.reputation),
        growStreak: growStreak.streak,
        totalUpdates: growStreak.totalUpdates,
        harvestedDiaries: growStreak.harvestedDiaries,
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
    }, { headers: NO_STORE })
  } catch (error) {
    console.error("Public profile error:", error)
    return NextResponse.json({ error: "Failed to load profile" }, { status: 500 })
  }
}
