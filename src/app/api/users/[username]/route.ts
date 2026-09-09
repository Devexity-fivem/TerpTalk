import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { blockExistsBetween } from "@/lib/security"
import { getTrustLevel } from "@/lib/security"

function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null
  if (/^https?:\/\//i.test(url)) return url
  if (/^\/\//i.test(url)) return `https:${url}`
  return `https://${url}`
}

// GET — public profile by username (safe fields only)
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ username: string }> }
) {
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
          role: true,
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
    where: { authorId: profile.user.id, deleted: false },
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

  return NextResponse.json({
    profile: {
      id: profile.user.id,
      role: profile.user.role,
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
  })
}
