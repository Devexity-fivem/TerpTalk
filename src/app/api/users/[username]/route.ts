import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { blockExistsBetween } from "@/lib/security"

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
      joinDate: true,
      reputation: true,
      user: {
        select: {
          id: true,
          image: true,
          role: true,
          createdAt: true,
          banned: true,
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
      _count: { select: { posts: true } },
    },
  })

  return NextResponse.json({
    profile: {
      id: profile.user.id,
      role: profile.user.role,
      username: profile.username,
      bio: profile.bio,
      location: profile.location,
      website: profile.website,
      avatarUrl: profile.avatarUrl,
      growExperience: profile.growExperience,
      favoriteStrain: profile.favoriteStrain,
      growSpace: profile.growSpace,
      image: profile.user.image,
      joinDate: profile.joinDate,
      reputation: profile.reputation,
      stats: profile.user._count,
    },
    viewerBlocked,
    recentThreads,
  })
}
