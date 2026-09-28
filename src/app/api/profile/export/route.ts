import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, getClientIp, logSecurityEvent } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

// GDPR-style data export: returns all data associated with the user
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return unauthorized()
    }

    // Heavy query — 5 exports per hour per user
    const rl = await rateLimit(`export:${session.user.id}`, 5, 60 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: session.user.id, ip: getClientIp(request), metadata: { endpoint: "profile/export" },
      })
      return NextResponse.json({ error: "Too many export requests" }, { status: 429 })
    }

    const userId = session.user.id

    // Note: `blocksReceived` is deliberately excluded — who blocked you is
    // the other user's private moderation choice, not your data. Likewise
    // SecurityEvent/AbuseFlag/ModerationAction (trust & safety internals),
    // AffiliateClick (system telemetry), BotSession (ephemeral derived
    // state), PendingReversal/PendingXpReversal (internal ledger ops), and
    // reports filed *about* the user are intentionally not exported.
    const [user, profile, customSections, threads, posts, diaries, diaryUpdates, diaryImages, experiments, setups, setupImages, setupComments, chatMessages, sentMessages, receivedMessages, reactions, postImages, strainPhotos, polls, pollVotes, badges, achievements, reputationEvents, progressionEvents, masteryProgress, notifications, followsGiven, followsReceived, blocksMade, bookmarks, savedSearches, contestEntries, contestVotes, diaryContestEntries, diaryContestVotes, strains, guideEdits, staffApplications, reportsFiled, feedback, categoryFollows, threadFollows, diaryFollows, botEvents] =
      await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            name: true,
            image: true,
            role: true,
            ageVerified: true,
            createdAt: true,
            lastSeenAt: true,
          },
        }),
        prisma.profile.findUnique({ where: { userId } }),
        prisma.profileCustomSection.findMany({
          where: { profile: { userId } },
          orderBy: [{ order: "asc" }, { createdAt: "asc" }],
          take: 1_000,
        }),
        // Per-collection caps keep a power user's export from being a
        // multi-hundred-MB response; rate-limited to 5/hr above.
        prisma.thread.findMany({ where: { authorId: userId }, take: 10_000, orderBy: { createdAt: "desc" } }),
        prisma.post.findMany({ where: { authorId: userId }, take: 10_000, orderBy: { createdAt: "desc" } }),
        prisma.growDiary.findMany({ where: { authorId: userId }, take: 10_000, orderBy: { createdAt: "desc" } }),
        prisma.diaryUpdate.findMany({ where: { authorId: userId }, include: { nutrients: true }, take: 10_000, orderBy: { createdAt: "desc" } }),
        prisma.diaryImage.findMany({ where: { update: { authorId: userId } }, take: 10_000, orderBy: { createdAt: "desc" } }),
        prisma.growExperiment.findMany({ where: { authorId: userId }, take: 10_000, orderBy: { createdAt: "desc" } }),
        prisma.growSetup.findMany({ where: { authorId: userId }, take: 10_000, orderBy: { createdAt: "desc" } }),
        prisma.setupImage.findMany({ where: { setup: { authorId: userId } }, take: 10_000, orderBy: { createdAt: "desc" } }),
        prisma.setupComment.findMany({ where: { authorId: userId }, take: 10_000, orderBy: { createdAt: "desc" } }),
        prisma.chatMessage.findMany({ where: { authorId: userId }, take: 10_000, orderBy: { createdAt: "desc" } }),
        prisma.directMessage.findMany({ where: { senderId: userId }, take: 10_000, orderBy: { createdAt: "desc" } }),
        prisma.directMessage.findMany({ where: { receiverId: userId }, take: 10_000, orderBy: { createdAt: "desc" } }),
        prisma.reaction.findMany({ where: { userId }, take: 10_000, orderBy: { createdAt: "desc" } }),
        prisma.postImage.findMany({ where: { OR: [{ post: { authorId: userId } }, { thread: { authorId: userId } }] }, take: 10_000, orderBy: { createdAt: "desc" } }),
        prisma.strainPhoto.findMany({ where: { userId }, take: 10_000, orderBy: { createdAt: "desc" } }),
        prisma.poll.findMany({ where: { thread: { authorId: userId } }, include: { options: true }, take: 1_000 }),
        prisma.pollVote.findMany({ where: { userId }, include: { option: { select: { text: true } }, poll: { select: { question: true } } }, take: 10_000, orderBy: { createdAt: "desc" } }),
        prisma.userBadge.findMany({ where: { userId }, include: { badge: true }, take: 1_000 }),
        prisma.userAchievement.findMany({ where: { userId }, include: { achievement: true }, take: 1_000 }),
        prisma.reputationEvent.findMany({ where: { userId }, take: 10_000, orderBy: { createdAt: "desc" } }),
        prisma.progressionEvent.findMany({ where: { userId }, take: 10_000, orderBy: { createdAt: "desc" } }),
        prisma.masteryProgress.findMany({ where: { userId }, take: 100 }),
        prisma.notification.findMany({ where: { userId }, take: 10_000, orderBy: { createdAt: "desc" } }),
        prisma.follow.findMany({ where: { followerId: userId }, take: 10_000 }),
        prisma.follow.findMany({ where: { followingId: userId }, take: 10_000 }),
        prisma.block.findMany({ where: { blockerId: userId }, take: 10_000 }),
        prisma.bookmark.findMany({ where: { userId }, take: 10_000, orderBy: { createdAt: "desc" } }),
        prisma.savedSearch.findMany({ where: { userId }, take: 1_000 }),
        prisma.contestEntry.findMany({ where: { userId }, take: 1_000 }),
        prisma.contestVote.findMany({ where: { userId }, take: 1_000 }),
        prisma.diaryContestEntry.findMany({ where: { userId }, take: 1_000 }),
        prisma.diaryContestVote.findMany({ where: { userId }, take: 1_000 }),
        prisma.strain.findMany({ where: { createdById: userId }, take: 10_000 }),
        prisma.guideEdit.findMany({ where: { editorId: userId }, take: 10_000 }),
        prisma.staffApplication.findMany({ where: { userId }, take: 100 }),
        prisma.report.findMany({ where: { reporterId: userId }, take: 10_000, orderBy: { createdAt: "desc" } }),
        prisma.feedback.findMany({ where: { authorId: userId }, take: 1_000, orderBy: { createdAt: "desc" } }),
        prisma.categoryFollow.findMany({ where: { userId }, take: 1_000 }),
        prisma.threadFollow.findMany({ where: { userId }, take: 10_000 }),
        prisma.diaryFollow.findMany({ where: { userId }, take: 10_000 }),
        prisma.botEvent.findMany({ where: { userId }, take: 10_000, orderBy: { createdAt: "desc" } }),
      ])

    // Profile.referredById references Profile.id, not User.id
    const referralsMade = profile
      ? await prisma.profile.findMany({
          where: { referredById: profile.id },
          select: { username: true, joinDate: true },
          take: 10_000,
        })
      : []

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const exportData = {
      exportedAt: new Date().toISOString(),
      user,
      // `profile` includes profileSettings + featuredDiaryId automatically;
      // customSections is the Profile V2 member-authored content.
      profile,
      customSections,
      content: {
        threads,
        posts,
        postImages,
        diaries,
        diaryUpdates,
        diaryImages,
        experiments,
        setups,
        setupImages,
        setupComments,
        strains,
        strainPhotos,
        polls,
        pollVotes,
        guideEdits,
        chatMessages,
        directMessages: { sent: sentMessages, received: receivedMessages },
        reactions,
      },
      social: {
        followsGiven,
        followsReceived,
        blocksMade,
        categoryFollows,
        threadFollows,
        diaryFollows,
      },
      activity: {
        bookmarks,
        savedSearches,
        notifications,
        contestEntries,
        contestVotes,
        diaryContestEntries,
        diaryContestVotes,
        reportsFiled,
        // Feedback the member filed — staff-internal triage fields
        // (priority, adminNotes, resolvedById) stay out of the export.
        feedback: feedback.map(
          ({ type, status, source, title, message, pagePath, deviceType, resolvedAt, createdAt, updatedAt }) => ({
            type, status, source, title, message, pagePath, deviceType, resolvedAt, createdAt, updatedAt,
          })
        ),
        staffApplications,
        referralsMade,
        // TerpBot command telemetry scoped to this user — internal
        // idempotency keys stripped.
        botEvents: botEvents.map(({ type, command, entities, createdAt }) => ({ type, command, entities, createdAt })),
      },
      badges,
      // V2 progression-achievement grants (Badge/V1 = cosmetic community
      // badges above; these are the unlock-capable framework records).
      achievements,
      masteryProgress,
      // Strip other users' identifiers (actorId = who liked/accepted your
      // content — their action, not yours) and internal idempotency keys.
      reputationEvents: reputationEvents.map(
        ({ type, amount, reason, sourceType, sourceId, reversedAt, reversalFinal, createdAt }) => ({
          type, amount, reason, sourceType, sourceId, reversedAt, reversalFinal, createdAt,
        })
      ),
      progressionEvents: progressionEvents.map(
        ({ type, xp, standing, mastery, reason, sourceType, sourceId, reversedAt, reversalFinal, createdAt }) => ({
          type, xp, standing, mastery, reason, sourceType, sourceId, reversedAt, reversalFinal, createdAt,
        })
      ),
    }

    return new NextResponse(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="terptalk-export-${userId}.json"`,
      },
    })
  } catch (error) {
    console.error("Data export error:", error)
    return NextResponse.json(
      { error: "Failed to export data" },
      { status: 500 }
    )
  }
}
