import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, forbidden, getClientIp, logSecurityEvent, LIMITS, isBanned } from "@/lib/security"
import { storeImage } from "@/lib/blob"
import { rateLimit } from "@/lib/rate-limit"
import bcrypt from "bcryptjs"

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
          include: { badge: true },
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
      select: {
        id: true,
        title: true,
        slug: true,
        createdAt: true,
        replyCount: true,
        category: { select: { name: true } },
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
      badges: user.badges.map((b) => ({
        name: b.badge.name,
        description: b.badge.description,
        icon: b.badge.icon,
        earnedAt: b.earnedAt,
      })),
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
  const ip = getClientIp(request)
  const userAgent = request.headers.get("user-agent")

  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return unauthorized()
    }

    const userId = session.user.id

    if (await isBanned(userId)) {
      return forbidden()
    }

    const rl = await rateLimit(`profile-update:${userId}`, 20, 60 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId,
        ip,
        userAgent,
        metadata: { endpoint: "profile" },
      })
      return NextResponse.json(
        { error: "Too many updates" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
      )
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }

    let { avatarUrl } = body
    const {
      bio,
      location,
      website,
      growExperience,
      favoriteStrain,
      growSpace,
      businessName,
      businessType,
      businessUrl,
      notifyOnReply,
      notifyOnMention,
      notifyOnCategoryFollow,
      notifyOnMessage,
      notifyOnComment,
      emailDigestFrequency,
    } = body as Record<string, unknown>

    const clean = (v: unknown, max: number) => {
      if (v === undefined) return undefined
      if (typeof v !== "string") return v === null ? null : undefined
      const trimmed = v.trim()
      if (!trimmed) return null
      return trimmed.slice(0, max)
    }

    // Validate avatar — https URL, or data URI from client-side image upload (max ~200KB encoded)
    if (avatarUrl !== undefined && avatarUrl !== null) {
      if (avatarUrl === "") {
        avatarUrl = null
      } else {
        if (typeof avatarUrl !== "string" || avatarUrl.length > 300_000) {
          return NextResponse.json(
            { error: "Avatar must be an image upload or a valid https:// image URL" },
            { status: 400 }
          )
        }
        const isDataUri = /^data:image\/(png|jpe?g|webp);base64,/.test(avatarUrl)
        const isHttps = /^https:\/\/.+/i.test(avatarUrl)
        if (!isDataUri && !isHttps) {
          return NextResponse.json(
            { error: "Avatar must be an image upload or a valid https:// image URL" },
            { status: 400 }
          )
        }
        if (isDataUri) {
          avatarUrl = await storeImage(avatarUrl, "avatars")
        }
      }
    }

    // Website must be an https:// URL — blocks javascript:/data: stored-XSS links
    const cleanWebsite = clean(website, 200)
    if (cleanWebsite !== undefined && cleanWebsite !== null && !/^https:\/\/.+/i.test(cleanWebsite)) {
      return NextResponse.json(
        { error: "Website must be an https:// URL" },
        { status: 400 }
      )
    }

    const cleanBusinessUrl = clean(businessUrl, 200)
    if (cleanBusinessUrl !== undefined && cleanBusinessUrl !== null && !/^https:\/\/.+/i.test(cleanBusinessUrl)) {
      return NextResponse.json(
        { error: "Business URL must be an https:// URL" },
        { status: 400 }
      )
    }

    const BUSINESS_TYPES = new Set(["BREEDER", "VENDOR", "GROW_SHOP", "BRAND"])
    const cleanBusinessType =
      typeof businessType === "string" && BUSINESS_TYPES.has(businessType.toUpperCase())
        ? businessType.toUpperCase()
        : businessType === undefined
        ? undefined
        : null
    const cleanBusinessName = clean(businessName, 80)

    const DIGEST_OPTIONS = new Set(["DAILY", "WEEKLY", "NEVER"])
    const cleanDigest =
      typeof emailDigestFrequency === "string" && DIGEST_OPTIONS.has(emailDigestFrequency.toUpperCase())
        ? emailDigestFrequency.toUpperCase()
        : emailDigestFrequency === undefined
        ? undefined
        : null

    const updateData: Record<string, unknown> = {}
    const setIfDefined = (key: string, value: unknown) => {
      if (value !== undefined) updateData[key] = value
    }

    setIfDefined("bio", clean(bio, 500))
    setIfDefined("location", clean(location, 100))
    setIfDefined("website", cleanWebsite)
    setIfDefined("growExperience", clean(growExperience, 50))
    setIfDefined("favoriteStrain", clean(favoriteStrain, 100))
    setIfDefined("growSpace", clean(growSpace, 100))
    setIfDefined("businessName", cleanBusinessName)
    setIfDefined("businessType", cleanBusinessType)
    setIfDefined("businessUrl", cleanBusinessUrl)

    if (typeof notifyOnReply === "boolean") updateData.notifyOnReply = notifyOnReply
    if (typeof notifyOnMention === "boolean") updateData.notifyOnMention = notifyOnMention
    if (typeof notifyOnCategoryFollow === "boolean") updateData.notifyOnCategoryFollow = notifyOnCategoryFollow
    if (typeof notifyOnMessage === "boolean") updateData.notifyOnMessage = notifyOnMessage
    if (typeof notifyOnComment === "boolean") updateData.notifyOnComment = notifyOnComment

    setIfDefined("emailDigestFrequency", cleanDigest)

    if (avatarUrl !== undefined) {
      updateData.avatarUrl = avatarUrl ? String(avatarUrl).slice(0, 500) : null
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
    }

    const updated = await prisma.profile.update({
      where: { userId },
      data: updateData,
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
        notifyOnReply: true,
        notifyOnMention: true,
        notifyOnCategoryFollow: true,
        notifyOnMessage: true,
        notifyOnComment: true,
        emailDigestFrequency: true,
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
    const { confirmUsername, password } = body

    if (
      typeof confirmUsername !== "string" ||
      typeof password !== "string" ||
      password.length < LIMITS.PASSWORD_MIN ||
      password.length > LIMITS.PASSWORD_MAX
    ) {
      return NextResponse.json({ error: "Current password and username confirmation are required" }, { status: 400 })
    }

    // Rate limit: 3 deletion attempts per hour per user
    const rl = await rateLimit(`account-delete:${session.user.id}`, 3, 60 * 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 })
    }

    // Require typed username confirmation for destructive action
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: { profile: { select: { username: true } } },
    })

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    if (!(await bcrypt.compare(password, user.password || ""))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 403 })
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
