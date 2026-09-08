import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, getClientIp, logSecurityEvent } from "@/lib/security"

export async function GET() {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return unauthorized()
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: {
        profile: true,
        diaryCreator: {
          select: { id: true },
        },
        posts: {
          select: { id: true },
        },
        followers: {
          select: { id: true },
        },
        following: {
          select: { id: true },
        },
        badges: {
          select: { id: true },
        },
      },
    })

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      )
    }

    // Get recent activity
    const recentThreads = await prisma.thread.findMany({
      where: { authorId: user.id },
      take: 5,
      orderBy: { createdAt: "desc" },
      include: {
        category: true,
        _count: {
          select: { posts: true },
        },
      },
    })

    const recentDiaries = await prisma.growDiary.findMany({
      where: { authorId: user.id },
      take: 5,
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: { updates: true, followers: true },
        },
      },
    })

    const referralCount = user.profile
      ? await prisma.profile.count({ where: { referredById: user.profile.id } })
      : 0

    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        image: user.image,
        role: user.role,
        ageVerified: user.ageVerified,
        createdAt: user.createdAt,
      },
      profile: user.profile,
      stats: {
        diaries: user.diaryCreator.length,
        posts: user.posts.length,
        followers: user.followers.length,
        following: user.following.length,
        badges: user.badges.length,
        reputation: user.profile?.reputation || 0,
        referrals: referralCount,
      },
      recentThreads,
      recentDiaries,
    })
  } catch (error) {
    console.error("Profile fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch profile" },
      { status: 500 }
    )
  }
}

// Profile customization — update own profile fields
export async function PATCH(request: Request) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return unauthorized()
    }

    const body = await request.json().catch(() => ({}))
    const {
      bio,
      location,
      website,
      avatarEmoji,
      avatarUrl,
      bannerColor,
      growExperience,
      favoriteStrain,
      growSpace,
    } = body

    // Validate avatar URL — must be https image link or empty
    if (avatarUrl !== undefined && avatarUrl !== null && avatarUrl !== "") {
      if (
        typeof avatarUrl !== "string" ||
        avatarUrl.length > 500 ||
        !/^https:\/\/.+/i.test(avatarUrl)
      ) {
        return NextResponse.json(
          { error: "Avatar must be a valid https:// image URL" },
          { status: 400 }
        )
      }
    }

    // Validate banner color — hex color or empty
    if (bannerColor !== undefined && bannerColor !== null && bannerColor !== "") {
      if (typeof bannerColor !== "string" || !/^#[0-9a-fA-F]{6}$/.test(bannerColor)) {
        return NextResponse.json(
          { error: "Banner color must be a hex color like #22c55e" },
          { status: 400 }
        )
      }
    }

    const clean = (v: unknown, max: number) =>
      typeof v === "string" ? v.trim().slice(0, max) || null : null

    const updated = await prisma.profile.update({
      where: { userId: session.user.id },
      data: {
        bio: clean(bio, 500),
        location: clean(location, 100),
        website: clean(website, 200),
        avatarEmoji: avatarEmoji ? String(avatarEmoji).slice(0, 8) : null,
        avatarUrl: avatarUrl ? String(avatarUrl).slice(0, 500) : null,
        bannerColor: bannerColor ? String(bannerColor) : null,
        growExperience: clean(growExperience, 50),
        favoriteStrain: clean(favoriteStrain, 100),
        growSpace: clean(growSpace, 100),
      },
    })

    return NextResponse.json({ profile: updated })
  } catch (error) {
    console.error("Profile update error:", error)
    return NextResponse.json(
      { error: "Failed to update profile" },
      { status: 500 }
    )
  }
}

// Account deletion — privacy-by-design right to erasure
export async function DELETE(request: Request) {
  const ip = getClientIp(request)
  const userAgent = request.headers.get("user-agent")

  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return unauthorized()
    }

    const body = await request.json().catch(() => ({}))
    const { confirmUsername } = body

    // Require typed username confirmation for destructive action
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: { profile: true },
    })

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    if (confirmUsername !== user.profile?.username) {
      return NextResponse.json(
        { error: "Username confirmation does not match" },
        { status: 400 }
      )
    }

    await logSecurityEvent("ACCOUNT_DELETED", {
      userId: user.id,
      ip,
      userAgent,
      metadata: { username: user.profile?.username },
    })

    // Cascade delete handles: profile, posts, threads, diaries, setups,
    // chat messages, DMs, notifications, reactions, follows, badges,
    // reputation events, reports filed, moderation actions, blocks
    await prisma.user.delete({ where: { id: user.id } })

    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error("Account deletion error:", error)
    return NextResponse.json(
      { error: "Failed to delete account" },
      { status: 500 }
    )
  }
}
