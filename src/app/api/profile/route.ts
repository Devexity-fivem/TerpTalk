import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, forbidden, getClientIp, logSecurityEvent, LIMITS, isBanned, enforceLinkTrust } from "@/lib/security"
import { storeImage, deleteImagesIfUnreferenced, isBlobConfigured } from "@/lib/blob"
import { rankDisplay, xpRankProgress, xpStage, xpStageProgress } from "@/lib/progression-config"
import { getProgressionPerks, progressionPerksFrom, hasUnlock, statSlotLimit, profileSectionLimit } from "@/lib/progression"
import { enqueueReversal, drainOne } from "@/lib/reputation-outbox"
import { enqueueXpReversal, drainXpOne } from "@/lib/progression-outbox"
import { Prisma } from "@prisma/client"
import { validateProfileSettingsPatch, parseProfileSettings } from "@/lib/profile-settings"
import { rateLimit } from "@/lib/rate-limit"
import { checkMaintenance } from "@/lib/maintenance"
import { revalidateTag } from "next/cache"
import bcrypt from "bcryptjs"

const NO_STORE = { "Cache-Control": "no-store, max-age=0, must-revalidate" }

const parseOldBanner = (raw: unknown): string | null =>
  parseProfileSettings(raw).bannerImage

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

    // Get recent activity — exclude soft-deleted items; the _count selects
    // above already filter them, so the lists must match.
    const recentThreads = await prisma.thread.findMany({
      where: { authorId: user.id, deleted: false },
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
      where: { authorId: user.id, deleted: false },
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

    // Harvested grows the member can pin to their profile (Garden Perk).
    const harvestedDiaries = await prisma.growDiary.findMany({
      where: { authorId: user.id, deleted: false, harvested: true },
      orderBy: { harvestedAt: "desc" },
      take: 50,
      select: {
        id: true,
        slug: true,
        title: true,
        strain: true,
        harvestedAt: true,
        visibility: true,
      },
    })

    // P2 — every own non-deleted diary is eligible for the featured-grow
    // picker (any visibility; a PRIVATE pick simply doesn't render publicly).
    const featureableDiaries = await prisma.growDiary.findMany({
      where: { authorId: user.id, deleted: false },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: {
        id: true,
        slug: true,
        title: true,
        strain: true,
        harvested: true,
        stage: true,
        visibility: true,
      },
    })

    // P2 — progression-derived customization caps for the editor.
    const [sectionLimit, statSlots, recordsWidget, insightsWidget] = await Promise.all([
      profileSectionLimit(user.id),
      statSlotLimit(user.id),
      hasUnlock(user.id, "records-widget"),
      hasUnlock(user.id, "owner-analytics"),
    ])

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
      harvestedDiaries,
      featureableDiaries,
      customization: {
        sectionLimit,
        statSlots,
        widgets: { records: recordsWidget, ownerInsights: insightsWidget },
      },
      stats: {
        diaries: user._count.diaryCreator,
        posts: user._count.posts,
        // Follow relation names are inverted in the schema — see the note in
        // api/users/[username]. "following" counts followers, "followers"
        // counts who the user follows.
        followers: user._count.following,
        following: user._count.followers,
        badges: user.badges.length,
        xp: user.profile?.xp || 0,
        standing: user.profile?.standing || 0,
        pollCreation: progressionPerksFrom(
          user.profile?.xp ?? 0,
          user.profile?.standing ?? 0,
          user.profile?.unlockFrozen ?? true
        ).pollCreation,
        rank: rankDisplay(user.profile?.xp || 0),
        rankProgress: xpRankProgress(user.profile?.xp || 0),
        xpStage: xpStage(user.profile?.xp || 0),
        stageProgress: xpStageProgress(user.profile?.xp || 0),
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
  let newBannerBlobUrl: string | undefined
  let oldBannerToDelete: string | undefined

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
      select: { avatarUrl: true, xp: true },
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
      pinnedDiaryId,
      featuredDiaryId,
      profileSettings,
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
          try {
            avatarUrl = await storeImage(avatarUrl, "avatars")
          } catch (e) {
            return NextResponse.json(
              { error: e instanceof Error ? e.message : "Invalid image" },
              { status: isBlobConfigured() ? 400 : 503 }
            )
          }
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

    if (avatarUrl !== undefined) {
      updateData.avatarUrl = avatarUrl ? String(avatarUrl).slice(0, 500) : null
    }

    // ─── Pinned harvest (Garden Perk) ────────────────────────────────
    // null clears; otherwise the member needs the pinned-harvest unlock
    // (Harvested rank or a 60-day streak marker) and the diary must be
    // their own harvested, non-deleted grow.
    if (pinnedDiaryId !== undefined) {
      if (pinnedDiaryId === null) {
        updateData.pinnedDiaryId = null
      } else {
        if (typeof pinnedDiaryId !== "string" || pinnedDiaryId.length > 40) {
          return NextResponse.json({ error: "Invalid pinnedDiaryId" }, { status: 400 })
        }
        if (!(await hasUnlock(userId, "pinned-harvest"))) {
          return NextResponse.json({ error: "Pinning a harvest unlocks at Harvested rank or a 60-day streak" }, { status: 403 })
        }
        const diary = await prisma.growDiary.findUnique({
          where: { id: pinnedDiaryId },
          select: { authorId: true, harvested: true, deleted: true },
        })
        if (!diary || diary.authorId !== userId) {
          return NextResponse.json({ error: "You can only pin one of your own grows" }, { status: 400 })
        }
        if (diary.deleted || !diary.harvested) {
          return NextResponse.json({ error: "Only a harvested grow can be pinned" }, { status: 400 })
        }
        updateData.pinnedDiaryId = pinnedDiaryId
      }
    }

    // ─── Featured grow (Profile V2) ───────────────────────────────────
    // Member-controlled hero grow. Unlike pinnedDiaryId this is NOT
    // unlock-gated (featured grow is free identity, not a perk) and accepts
    // any own non-deleted diary at any visibility — a PRIVATE featured grow
    // simply doesn't render for other viewers; it never becomes public.
    if (featuredDiaryId !== undefined) {
      if (featuredDiaryId === null) {
        updateData.featuredDiaryId = null
      } else {
        if (typeof featuredDiaryId !== "string" || featuredDiaryId.length > 40) {
          return NextResponse.json({ error: "Invalid featuredDiaryId" }, { status: 400 })
        }
        const diary = await prisma.growDiary.findUnique({
          where: { id: featuredDiaryId },
          select: { authorId: true, deleted: true },
        })
        if (!diary || diary.deleted) {
          return NextResponse.json({ error: "That grow doesn't exist" }, { status: 400 })
        }
        if (diary.authorId !== userId) {
          return NextResponse.json({ error: "You can only feature one of your own grows" }, { status: 400 })
        }
        updateData.featuredDiaryId = featuredDiaryId
      }
    }

    // ─── Profile settings (Profile V2) ────────────────────────────────
    // Validated/normalized preset-only blob — no arbitrary CSS/HTML.
    if (profileSettings !== undefined) {
      const currentSettingsRow = await prisma.profile.findUnique({
        where: { userId },
        select: { id: true, profileSettings: true },
      })
      const result = validateProfileSettingsPatch(profileSettings, currentSettingsRow?.profileSettings)
      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: 400 })
      }
      const merged = result.settings!
      // Stat slots are progression-capped (Seed 4 → Vegged 6 → Harvested 8).
      const slots = await statSlotLimit(userId)
      if (merged.shownStats.length > slots) {
        return NextResponse.json(
          { error: `Your rank lets you show up to ${slots} notable stats` },
          { status: 403 }
        )
      }
      // pinnedSection must reference a section the member actually owns —
      // a foreign/stale id is ignored (keeps the existing pin), never stored.
      if (merged.pinnedSection) {
        const owned = currentSettingsRow
          ? await prisma.profileCustomSection.findFirst({
              where: { id: merged.pinnedSection, profileId: currentSettingsRow.id },
              select: { id: true },
            })
          : null
        if (!owned) {
          merged.pinnedSection = parseProfileSettings(currentSettingsRow?.profileSettings).pinnedSection
        }
      }
      // Banner uploads arrive as a data URI and go through the shared image
      // pipeline (MIME + signature + re-encode) before persistence — the
      // stored value is only ever a pipeline product. Storing happens only
      // after every validator above has passed so a failed PATCH can't
      // orphan a blob; the catch below still sweeps it if the DB write dies.
      if (typeof merged.bannerImage === "string" && /^data:image\//i.test(merged.bannerImage)) {
        try {
          newBannerBlobUrl = await storeImage(merged.bannerImage, "banners")
          merged.bannerImage = newBannerBlobUrl
        } catch (e) {
          return NextResponse.json(
            { error: e instanceof Error ? e.message : "Invalid banner image" },
            { status: isBlobConfigured() ? 400 : 503 }
          )
        }
      }
      // Banner replaced/removed → queue the old blob for cleanup after save.
      const oldBanner = parseOldBanner(currentSettingsRow?.profileSettings)
      if (oldBanner && oldBanner !== merged.bannerImage) {
        oldBannerToDelete = oldBanner
      }
      updateData.profileSettings = merged as object
    }

    // ─── Badge showcase ───────────────────────────────────────────────
    // pinnedBadges: badge IDs the member wants pinned. Must all be earned
    // by this member; count is capped by the rank's showcaseSlots perk.
    let pinOps: { unpin: Prisma.PrismaPromise<unknown>; pin: Prisma.PrismaPromise<unknown> } | null = null
    if (pinnedBadges !== undefined) {
      if (!Array.isArray(pinnedBadges) || pinnedBadges.length > 20 ||
          !pinnedBadges.every((b) => typeof b === "string" && b.length <= 40)) {
        return NextResponse.json({ error: "Invalid pinned badges" }, { status: 400 })
      }
      const slots = (await getProgressionPerks(userId)).showcaseSlots
      if (pinnedBadges.length > slots) {
        return NextResponse.json(
          { error: `Your rank lets you showcase up to ${slots} badges` },
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
                pinnedDiaryId: true,
                featuredDiaryId: true,
                profileSettings: true,
                notifyOnReply: true,
                notifyOnMention: true,
                notifyOnCategoryFollow: true,
                notifyOnMessage: true,
                notifyOnComment: true,
                notifyOnFollow: true,
                notifyOnReaction: true,
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
                pinnedDiaryId: true,
                featuredDiaryId: true,
                profileSettings: true,
                notifyOnReply: true,
                notifyOnMention: true,
                notifyOnCategoryFollow: true,
                notifyOnMessage: true,
                notifyOnComment: true,
                notifyOnFollow: true,
                notifyOnReaction: true,
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

    // Best-effort cleanup of the previous avatar/banner blobs when replaced or removed.
    const oldAvatar = current?.avatarUrl
    if (oldAvatar && oldAvatar !== updateData.avatarUrl) {
      deleteImagesIfUnreferenced([oldAvatar]).catch(() => {})
    }
    deleteImagesIfUnreferenced([oldBannerToDelete]).catch(() => {})

    return NextResponse.json({ profile: updated }, { headers: NO_STORE })
  } catch (error) {
    // Clean up any new Blobs if the profile update could not be saved.
    deleteImagesIfUnreferenced([newAvatarBlobUrl, newBannerBlobUrl]).catch(() => {})
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

    // Case-insensitive — login is insensitive too, so requiring an
    // exact-case match here is just a footgun.
    if (
      confirmUsername.trim().toLowerCase() !== (user.profile?.username ?? "").toLowerCase() ||
      !user.profile?.username
    ) {
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
            // Images on other members' replies inside this user's threads —
            // the cascade removes those posts too, so their blobs go as well.
            { post: { thread: { authorId: user.id } } },
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

    // Scrub the username out of other members' notifications before the
    // actor link is dropped — otherwise "@name replied…" text and /u/name
    // links outlive the account (and a re-registered name would inherit them).
    await prisma.notification.updateMany({
      where: { actorId: user.id },
      data: { content: "A former member interacted with your content.", link: null },
    }).catch(() => {})

    // Welcome announcements are keyed by username — re-key to the user id so
    // the retained once-ever marker doesn't store the deleted name.
    if (user.profile?.username) {
      await prisma.botEvent.updateMany({
        where: { key: `announce:welcome:${user.profile.username.toLowerCase()}` },
        data: { key: `announce:welcome:uid:${user.id}` },
      }).catch(() => {})
    }

    // The thread cascade also removes every reply other members posted in
    // this user's threads — claw back the rep they earned from those posts
    // (creation, likes, accepted answers), matching the owner/staff
    // thread-removal policy.
    const [ownedThreads, threadPosts] = await Promise.all([
      prisma.thread.findMany({ where: { authorId: user.id }, select: { id: true } }),
      prisma.post.findMany({ where: { thread: { authorId: user.id } }, select: { id: true } }),
    ])

    // Durable reversal intents are written in the SAME transaction as the
    // account cascade — voiding the reputation this account granted others
    // (likes, accepted answers) plus sweeps of its deleted threads/posts can
    // never be stranded between the delete and a post-commit reversal. Both
    // ledgers: legacy rep rows plus live V2 progression awards.
    const reversalIds: string[] = []
    const xpReversalIds: string[] = []
    await prisma.$transaction(async (tx) => {
      reversalIds.push(await enqueueReversal(tx, {
        kind: "ACTOR", actorId: user.id,
        reason: "Granting account deleted", requestedBy: user.id,
      }))
      xpReversalIds.push(await enqueueXpReversal(tx, {
        kind: "ACTOR", actorId: user.id,
        reason: "Granting account deleted", requestedBy: user.id,
      }))
      for (const t of ownedThreads) {
        reversalIds.push(await enqueueReversal(tx, {
          kind: "SOURCE", sourceType: "THREAD", sourceId: t.id,
          reason: "Thread removed", requestedBy: user.id,
        }))
        xpReversalIds.push(await enqueueXpReversal(tx, {
          kind: "SOURCE", sourceType: "THREAD", sourceId: t.id,
          reason: "Thread removed", requestedBy: user.id,
        }))
      }
      for (const p of threadPosts) {
        reversalIds.push(await enqueueReversal(tx, {
          kind: "SOURCE", sourceType: "POST", sourceId: p.id,
          reason: "Thread removed", requestedBy: user.id,
        }))
        xpReversalIds.push(await enqueueXpReversal(tx, {
          kind: "SOURCE", sourceType: "POST", sourceId: p.id,
          reason: "Thread removed", requestedBy: user.id,
        }))
      }
      // Cascade delete handles: profile, posts, threads, diaries, setups,
      // chat messages, DMs, notifications, reactions, follows, badges,
      // reputation events, reports filed, moderation actions, blocks
      await tx.user.delete({ where: { id: user.id } })
    })
    for (const rid of reversalIds) await drainOne(rid).catch(() => false)
    for (const rid of xpReversalIds) await drainXpOne(rid).catch(() => false)

    // Best-effort cleanup of owned Blob objects after the DB records are gone.
    try {
      await deleteImagesIfUnreferenced(ownedImageUrls)
    } catch {
      // Cleanup failure must not roll back the account deletion.
    }

    // The cascade removed all of the member's diaries/threads — community
    // aggregates must drop them immediately, not at TTL.
    revalidateTag("analytics", { expire: 0 })

    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error("Account deletion error:", error)
    return NextResponse.json(
      { error: "Failed to delete account" },
      { status: 500 }
    )
  }
}
