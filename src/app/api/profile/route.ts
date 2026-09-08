import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getClientIp, logSecurityEvent } from "@/lib/security"

export async function GET() {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
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

// Account deletion — privacy-by-design right to erasure
export async function DELETE(request: Request) {
  const ip = getClientIp(request)
  const userAgent = request.headers.get("user-agent")

  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
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
