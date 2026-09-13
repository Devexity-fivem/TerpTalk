import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, forbidden, getClientIp, logSecurityEvent, LIMITS, isBanned, enforceLinkTrust } from "@/lib/security"
import { storeImage, deleteImagesIfUnreferenced } from "@/lib/blob"
import { getReputationTier, getTierProgress, getRepStage, getStageProgress, reverseReputationByActor } from "@/lib/reputation"
import { canEquip } from "@/lib/cosmetics"
import { Prisma } from "@prisma/client"
import { rateLimit } from "@/lib/rate-limit"
import { checkMaintenance } from "@/lib/maintenance"
import bcrypt from "bcryptjs"

const NO_STORE = { "Cache-Control": "no-store, max-age=0, must-revalidate" }

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
        badges: {
          include: { badge: true },
        },
        _count: {
          select: {
            diaryCreator: { where: { deleted: false } },
            posts: { where: { deleted: false, thread: { deleted: false } } },
            followers: true,
            following: true,
          },
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
        image: user.profile?.avatarUrl || user.image,
        role: user.role,
        ageVerified: user.ageVerified,
        createdAt: user.createdAt,
      },
      profile: user.profile,
      stats: {
        diaries: user._count.diaryCreator,
        posts: user._count.posts,
        // Follow relation names are inverted in the schema — see the note in
        // api/users/[username]. "following" counts followers, "followers"
        // counts who the user follows.
        followers: user._count.following,
        following: user._count.followers,
        badges: user.badges.length,
        reputation: user.profile?.reputation || 0,
        reputationTier: getReputationTier(user.profile?.reputation || 0),
        tierProgress: getTierProgress(user.profile?.reputation || 0),
        repStage: getRepStage(user.profile?.reputation || 0),
        stageProgress: getStageProgress(user.profile?.reputation || 0),
        referrals: referralCount,
      },
      recentThreads,
      recentDiaries,
      badges: user.badges.map((b) => ({
        id: b.badgeId,
        name: b.badge.name,
        description: b.badge.description,
        icon: b.badge.icon,
        pinned: b.pinned,
        earnedAt: b.earnedAt,
      })),
    }, { headers: NO_STORE })
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
  let newAvatarBlobUrl: string | undefined

  try {
    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return unauthorized()
    }

    const userId = session.user.id

    const current = await prisma.profile.findUnique({
      where: { userId },
      select: { avatarUrl: true, reputation: true },
    })

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
      notifyOnFollow,
      notifyOnReaction,
      emailDigestFrequency,
      avatarFrame,
      profileTitle,
      profileTheme,
      pinnedBadges,
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
      if (avatarUrl === "" || avatarUrl === current?.avatarUrl) {
        avatarUrl = avatarUrl === "" ? null : current?.avatarUrl
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
          newAvatarBlobUrl = avatarUrl
        } else if (isHttps) {
          return NextResponse.json(
            { error: "Avatar must be uploaded, not linked from an external URL" },
            { status: 400 }
          )
        }
      }
    }

    // Website must be an https:// URL — blocks javascript:/data: stored-XSS links
    let cleanWebsite = clean(website, 200)
    if (cleanWebsite !== undefined && cleanWebsite !== null) {
      if (/^https:\/\/?$/i.test(cleanWebsite)) {
        cleanWebsite = null
      } else if (!/^https:\/\/.+/i.test(cleanWebsite)) {
        return NextResponse.json(
          { error: "Website must be an https:// URL" },
          { status: 400 }
        )
      }
    }

    let cleanBusinessUrl = clean(businessUrl, 200)
    if (cleanBusinessUrl !== undefined && cleanBusinessUrl !== null) {
      if (/^https:\/\/?$/i.test(cleanBusinessUrl)) {
        cleanBusinessUrl = null
      } else if (!/^https:\/\/.+/i.test(cleanBusinessUrl)) {
        return NextResponse.json(
          { error: "Business URL must be an https:// URL" },
          { status: 400 }
        )
      }
    }

    // Public profile links are gated by the same new-user link policy used for
    // posts — otherwise fresh accounts become an instant SEO/spam vector.
    const linkText = [cleanWebsite, cleanBusinessUrl, typeof bio === "string" ? bio : null]
      .filter((v): v is string => !!v)
      .join(" ")
    if (linkText) {
      const linkBlock = await enforceLinkTrust(linkText, userId, request, "profile")
      if (linkBlock) return linkBlock
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

    setIfDefined("bio", clean(bio, LIMITS.BIO_MAX))
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
    if (typeof notifyOnFollow === "boolean") updateData.notifyOnFollow = notifyOnFollow
    if (typeof notifyOnReaction === "boolean") updateData.notifyOnReaction = notifyOnReaction

    setIfDefined("emailDigestFrequency", cleanDigest)

    if (avatarUrl !== undefined) {
      updateData.avatarUrl = avatarUrl ? String(avatarUrl).slice(0, 500) : null
    }

    // ─── Cosmetics ────────────────────────────────────────────────────
    // Registry keys only — canEquip() enforces the reputation unlock so a
    // member can never equip a cosmetic above their tier. null clears.
    const reputation = current?.reputation ?? 0
    const cosmeticFields: [string, unknown, "frames" | "titles" | "themes"][] = [
      ["avatarFrame", avatarFrame, "frames"],
      ["profileTitle", profileTitle, "titles"],
      ["profileTheme", profileTheme, "themes"],
    ]
    for (const [field, value, kind] of cosmeticFields) {
      if (value === undefined) continue
      if (value !== null && (typeof value !== "string" || value.length > 60)) {
        return NextResponse.json({ error: `Invalid ${field}` }, { status: 400 })
      }
      if (!canEquip(reputation, kind, value as string | null)) {
        return NextResponse.json({ error: "That reward isn't unlocked yet" }, { status: 403 })
      }
      updateData[field] = value
    }

    // ─── Badge showcase ───────────────────────────────────────────────
    // pinnedBadges: badge IDs the member wants pinned. Must all be earned
    // by this member; count is capped by the tier's showcaseSlots perk.
    let pinOps: { unpin: Prisma.PrismaPromise<unknown>; pin: Prisma.PrismaPromise<unknown> } | null = null
    if (pinnedBadges !== undefined) {
      if (!Array.isArray(pinnedBadges) || pinnedBadges.length > 20 ||
          !pinnedBadges.every((b) => typeof b === "string" && b.length <= 40)) {
        return NextResponse.json({ error: "Invalid pinned badges" }, { status: 400 })
      }
      const slots = getReputationTier(reputation).perks.showcaseSlots ?? 3
      if (pinnedBadges.length > slots) {
        return NextResponse.json(
          { error: `Your tier lets you showcase up to ${slots} badges` },
          { status: 400 }
        )
      }
      const owned = await prisma.userBadge.findMany({
        where: { userId, badgeId: { in: pinnedBadges } },
        select: { badgeId: true },
      })
      if (owned.length !== pinnedBadges.length) {
        return NextResponse.json({ error: "You can only showcase badges you've earned" }, { status: 400 })
      }
      pinOps = {
        unpin: prisma.userBadge.updateMany({ where: { userId, pinned: true }, data: { pinned: false } }),
        pin: pinnedBadges.length
          ? prisma.userBadge.updateMany({ where: { userId, badgeId: { in: pinnedBadges } }, data: { pinned: true } })
          : prisma.userBadge.updateMany({ where: { userId, badgeId: { in: [] } }, data: { pinned: true } }),
      }
    }

    if (Object.keys(updateData).length === 0 && !pinOps) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
    }

    const [updated] = await prisma.$transaction([
      ...(Object.keys(updateData).length > 0
        ? [
            prisma.profile.update({
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
                avatarFrame: true,
                profileTitle: true,
                profileTheme: true,
                notifyOnReply: true,
                notifyOnMention: true,
                notifyOnCategoryFollow: true,
                notifyOnMessage: true,
                notifyOnComment: true,
                notifyOnFollow: true,
                notifyOnReaction: true,
                emailDigestFrequency: true,
              },
            }),
          ]
        : [
            prisma.profile.findUniqueOrThrow({
              where: { userId },
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
                avatarFrame: true,
                profileTitle: true,
                profileTheme: true,
                notifyOnReply: true,
                notifyOnMention: true,
                notifyOnCategoryFollow: true,
                notifyOnMessage: true,
                notifyOnComment: true,
                notifyOnFollow: true,
                notifyOnReaction: true,
                emailDigestFrequency: true,
              },
            }),
          ]),
      ...(pinOps ? [pinOps.unpin, pinOps.pin] : []),
      ...(avatarUrl !== undefined
        ? [
            prisma.user.update({
              where: { id: userId },
              data: { image: updateData.avatarUrl as string | null },
              select: { id: true },
            }),
          ]
        : []),
    ])

    // Best-effort cleanup of the previous avatar blob when it is replaced or removed.
    const oldAvatar = current?.avatarUrl
    if (oldAvatar && oldAvatar !== updateData.avatarUrl) {
      deleteImagesIfUnreferenced([oldAvatar]).catch(() => {})
    }

    return NextResponse.json({ profile: updated }, { headers: NO_STORE })
  } catch (error) {
    // Clean up the new avatar Blob if the profile update could not be saved.
    deleteImagesIfUnreferenced([newAvatarBlobUrl]).catch(() => {})
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
    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

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
      include: { profile: { select: { username: true, avatarUrl: true } } },
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

    // Collect all Vercel Blob URLs owned by this user before cascading deletion.
    const [
      postImages,
      diaryImages,
      setupImages,
      strainPhotos,
      contestImages,
    ] = await Promise.all([
      prisma.postImage.findMany({
        where: {
          OR: [
            { thread: { authorId: user.id } },
            { post: { authorId: user.id } },
          ],
        },
        select: { url: true },
      }),
      prisma.diaryImage.findMany({
        where: { update: { authorId: user.id } },
        select: { url: true },
      }),
      prisma.setupImage.findMany({
        where: { setup: { authorId: user.id } },
        select: { url: true },
      }),
      prisma.strainPhoto.findMany({
        where: { userId: user.id },
        select: { imageUrl: true },
      }),
      prisma.contestEntry.findMany({
        where: { userId: user.id },
        select: { imageUrl: true },
      }),
    ])

    const ownedImageUrls = [
      ...postImages.map((i) => i.url),
      ...diaryImages.map((i) => i.url),
      ...setupImages.map((i) => i.url),
      ...strainPhotos.map((i) => i.imageUrl),
      ...contestImages.map((i) => i.imageUrl),
      user.profile?.avatarUrl,
    ]

    // Void reputation this account granted others (likes, accepted answers)
    // before the cascade deletes their own ledger rows.
    await reverseReputationByActor(user.id, "Granting account deleted").catch(() => 0)

    // Cascade delete handles: profile, posts, threads, diaries, setups,
    // chat messages, DMs, notifications, reactions, follows, badges,
    // reputation events, reports filed, moderation actions, blocks
    await prisma.user.delete({ where: { id: user.id } })

    // Best-effort cleanup of owned Blob objects after the DB records are gone.
    try {
      await deleteImagesIfUnreferenced(ownedImageUrls)
    } catch {
      // Cleanup failure must not roll back the account deletion.
    }

    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error("Account deletion error:", error)
    return NextResponse.json(
      { error: "Failed to delete account" },
      { status: 500 }
    )
  }
}
