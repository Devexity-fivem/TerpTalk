import { NextResponse, after } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, publicUserSelect, LIMITS, getClientIp, logSecurityEvent, isBanned, forbidden, enforceLinkTrust, isModerator, isAdmin } from "@/lib/security"
import { requireModerator } from "@/lib/require-staff"
import { awardReputation, reverseReputationBySource, repRateLimit, getTierPerks, REP_POINTS } from "@/lib/reputation"
import { storeImages, deleteImagesIfUnreferenced, MAX_POST_IMAGES } from "@/lib/blob"
import { notifyMentions } from "@/lib/mentions"
import { notify, notifyMany, postDeepLink, postLinkWhere } from "@/lib/notify"
import { checkMaintenance } from "@/lib/maintenance"

export async function POST(request: Request) {
  let imageUrls: string[] = []

  try {
    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return unauthorized()
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true, banned: true },
    })
    if (!currentUser || currentUser.banned) {
      return forbidden("Your account is suspended")
    }

    const body = await request.json().catch(() => ({}))
    const { content, threadId, images } = body

    if (
      typeof content !== "string" || !content.trim() ||
      typeof threadId !== "string" || !threadId
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    if (content.length < 10 || content.length > LIMITS.POST_CONTENT_MAX) {
      return NextResponse.json(
        { error: "Content must be between 10 and 10,000 characters" },
        { status: 400 }
      )
    }

    // Rate limit: 30 posts per 10 minutes per user (Cultivator+ scale it up)
    const rl = await repRateLimit(session.user.id, `post:${session.user.id}`, 30, 10 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: session.user.id,
        ip: getClientIp(request),
        metadata: { endpoint: "forum/posts" },
      })
      return NextResponse.json(
        { error: "Posting too fast. Please slow down." },
        { status: 429 }
      )
    }

    // Validate thread exists and is not locked/deleted/hidden
    const thread = await prisma.thread.findUnique({
      where: { id: threadId },
      include: {
        category: { select: { hidden: true } },
      },
    })

    if (!thread) {
      return NextResponse.json(
        { error: "Thread not found" },
        { status: 404 }
      )
    }

    if (thread.locked || thread.deleted || (thread.category?.hidden && !isModerator(currentUser.role))) {
      return NextResponse.json(
        { error: "Thread is locked" },
        { status: 403 }
      )
    }

    const linkBlock = await enforceLinkTrust(content, session.user.id, request, "forum/posts")
    if (linkBlock) return linkBlock

    // Upload attachments first so a storage failure cannot leave a reply
    // with only some of its images.
    try {
      // Master Grower+ can attach more images per post.
      const perks = await getTierPerks(session.user.id)
      imageUrls = await storeImages(images, "forum", perks.imagesPerPost ?? MAX_POST_IMAGES)
    } catch (err) {
      console.error("Forum post image upload error:", err)
      return NextResponse.json(
        { error: "Image upload failed" },
        { status: 400 }
      )
    }

    // Create post
    const post = await prisma.post.create({
      data: {
        content,
        threadId,
        authorId: session.user.id,
        images: {
          create: imageUrls.map((url, order) => ({ url, order })),
        },
      },
      include: {
        author: { select: publicUserSelect },
        images: { orderBy: { order: "asc" } },
      },
    })

    await prisma.thread.update({
      where: { id: threadId },
      data: { replyCount: { increment: 1 }, lastActivityAt: new Date() },
    })

    // Repliers auto-follow the thread (XenForo-style): silent upsert — no
    // notification, and lastSeenAt covers everything up to their own reply.
    // Prisma upsert isn't atomic (select-then-write), so retry once on a
    // concurrent-reply race before giving up.
    const autoFollow = () =>
      prisma.threadFollow.upsert({
        where: { userId_threadId: { userId: session.user.id, threadId } },
        create: { userId: session.user.id, threadId, lastSeenAt: new Date() },
        update: { lastSeenAt: new Date() },
      })
    await autoFollow().catch(() => autoFollow().catch(() => {}))

    await awardReputation(
      session.user.id,
      "POST_CREATED",
      REP_POINTS.POST_CREATED,
      `Replied in "${thread.title.slice(0, 60)}"`,
      { key: `post:${post.id}`, sourceType: "POST", sourceId: post.id }
    ).catch(() => {})

    // Notify the thread author (if not self-reply; pref/block/ban handled by notify).
    // groupKey+dedupeMs bound reply-bombs: the same replier can't stack more
    // than one REPLY notification per hour on the same thread.
    // Hidden categories never notify — title/link would leak staff-only content.
    if (thread.authorId !== session.user.id && !thread.category?.hidden) {
      await notify({
        userId: thread.authorId,
        type: "REPLY",
        title: "New reply to your thread",
        content: `@${session.user.name || "Someone"} replied to "${thread.title.slice(0, 80)}"`,
        link: postDeepLink(thread.slug, post.id),
        actorId: session.user.id,
        groupKey: `REPLY:thread:${threadId}`,
        dedupeMs: 60 * 60 * 1000,
      })
    }

    // Notify @mentions in the reply — excluding the thread author, who
    // already got the REPLY notification above. Same hidden-category gate.
    if (!thread.category?.hidden) {
      await notifyMentions(
        content,
        session.user.id,
        session.user.name || "Someone",
        postDeepLink(thread.slug, post.id),
        `a reply in "${thread.title.slice(0, 60)}"`,
        [thread.authorId]
      )
    }

    // Fan out to thread followers — throttled per follower via
    // ThreadFollow.lastNotifiedAt (≤1 notification per 6h per thread), and
    // never for hidden categories or deleted threads. Deferred with after()
    // so fan-out never delays the reply response.
    if (!thread.category?.hidden) {
      const replierId = session.user.id
      const replierName = session.user.name || "Someone"
      const threadTitle = thread.title
      const threadSlug = thread.slug
      const authorId = thread.authorId
      const postId = post.id
      after(async () => {
        try {
          // Re-validate inside the deferred callback — the thread could be
          // deleted or its category hidden between the response and now.
          const fresh = await prisma.thread.findUnique({
            where: { id: threadId },
            select: { deleted: true, category: { select: { hidden: true } } },
          })
          if (!fresh || fresh.deleted || fresh.category?.hidden) return

          const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000)
          const followers = await prisma.threadFollow.findMany({
            where: {
              threadId,
              userId: { notIn: [replierId, authorId] },
              OR: [{ lastNotifiedAt: null }, { lastNotifiedAt: { lt: cutoff } }],
            },
            select: { userId: true },
            orderBy: { createdAt: "asc" },
            take: 2000,
          })
          if (followers.length === 0) return
          const { sent, deliveredUserIds } = await notifyMany(
            followers.map((f) => ({
              userId: f.userId,
              type: "THREAD_ACTIVITY" as const,
              title: "New reply in a thread you follow",
              content: `@${replierName} replied in "${threadTitle.slice(0, 60)}"`,
              link: postDeepLink(threadSlug, postId),
              actorId: replierId,
              groupKey: `THREAD_ACTIVITY:thread:${threadId}`,
              dedupeMs: 6 * 60 * 60 * 1000,
              metadata: { threadId, postId },
            }))
          )
          // Stamp the throttle only for followers who actually received the
          // notification — filtered-out recipients (pref off, blocked, banned)
          // must not burn their 6h window.
          if (sent > 0 && deliveredUserIds.length > 0) {
            await prisma.threadFollow.updateMany({
              where: { threadId, userId: { in: deliveredUserIds } },
              data: { lastNotifiedAt: new Date() },
            })
          }
        } catch (e) {
          console.error("Thread-follow fan-out error:", e)
        }
      })
    }

    return NextResponse.json({ post }, { status: 201 })
  } catch (error) {
    // Clean up any already-uploaded Blob objects if the post could not be created.
    deleteImagesIfUnreferenced(imageUrls).catch(() => {})
    console.error("Post creation error:", error)
    return NextResponse.json(
      { error: "Failed to create post" },
      { status: 500 }
    )
  }
}

// PATCH — edit own post: { id, content }
export async function PATCH(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return unauthorized()
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true, banned: true },
    })
    if (!currentUser || currentUser.banned) {
      return forbidden("Your account is suspended")
    }

    const body = await request.json().catch(() => ({}))
    const { id, content } = body

    if (typeof id !== "string" || !id || typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    if (content.length < 10 || content.length > LIMITS.POST_CONTENT_MAX) {
      return NextResponse.json(
        { error: "Content must be between 10 and 10,000 characters" },
        { status: 400 }
      )
    }

    const post = await prisma.post.findUnique({
      where: { id },
      select: {
        id: true,
        authorId: true,
        deleted: true,
        threadId: true,
        thread: { select: { locked: true, deleted: true, category: { select: { hidden: true } } } },
      },
    })
    if (!post || post.deleted) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 })
    }
    if (post.authorId !== session.user.id) {
      return forbidden()
    }
    if (
      post.thread.locked ||
      post.thread.deleted ||
      (post.thread.category?.hidden && !isModerator(currentUser.role))
    ) {
      return NextResponse.json({ error: "Thread is locked" }, { status: 403 })
    }

    // Same link policy as creation — edits must not be a bypass.
    const linkBlock = await enforceLinkTrust(content, session.user.id, request, "forum/posts:edit")
    if (linkBlock) return linkBlock

    const updated = await prisma.post.update({
      where: { id },
      data: { content, edited: true },
      include: { author: { select: publicUserSelect } },
    })

    // Keep Thread.content (the search/listing copy of the OP body) in sync
    // when the opening post is edited — otherwise edits are invisible to
    // search and thread previews.
    const op = await prisma.post.findFirst({
      where: { threadId: post.threadId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    })
    if (op?.id === id) {
      await prisma.thread.update({
        where: { id: post.threadId },
        data: { content },
      })
    }

    return NextResponse.json({ post: updated })
  } catch (error) {
    console.error("Post update error:", error)
    return NextResponse.json({ error: "Failed to update post" }, { status: 500 })
  }
}

// DELETE — delete own post (or moderator): { id }
export async function DELETE(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return unauthorized()
    }

    const body = await request.json().catch(() => ({}))
    const { id } = body

    if (typeof id !== "string" || !id) {
      return NextResponse.json({ error: "Missing post id" }, { status: 400 })
    }

    const post = await prisma.post.findUnique({
      where: { id },
      select: { id: true, authorId: true, deleted: true, threadId: true, author: { select: { id: true, role: true } } },
    })
    if (!post || post.deleted) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 })
    }
    const mod = await requireModerator()
    const isOwn = post.authorId === session.user.id
    if (!isOwn && !mod) {
      return forbidden()
    }
    if (!isOwn && mod && !isAdmin(mod.role) && !["MEMBER", "VERIFIED_MEMBER"].includes(post.author.role)) {
      return forbidden()
    }
    if (isOwn && (await isBanned(session.user.id))) {
      return forbidden("Your account is suspended")
    }

    await prisma.$transaction(async (tx) => {
      await tx.post.update({ where: { id }, data: { deleted: true } })
      const remaining = await tx.post.count({ where: { threadId: post.threadId, deleted: false } })
      // replyCount = non-deleted posts minus the opening post — but only when
      // the OP still exists; deleting the OP must not double-subtract.
      const op = await tx.post.findFirst({
        where: { threadId: post.threadId },
        orderBy: { createdAt: "asc" },
        select: { deleted: true },
      })
      await tx.thread.update({
        where: { id: post.threadId },
        data: { replyCount: Math.max(0, remaining - (op && !op.deleted ? 1 : 0)) },
      })
      // If this post was the accepted answer, clear the pointer — the thread
      // is no longer solved (SetNull on the FK only fires on hard delete).
      await tx.thread.updateMany({
        where: { acceptedAnswerId: post.id },
        data: { acceptedAnswerId: null },
      })
      // Deep links to this post would now dangle — drop the notifications.
      await tx.notification.deleteMany({ where: postLinkWhere(post.id) })
    })

    // Reputation reconciliation: reverse every active event tied to this post
    // (creation award, likes on it, accepted-answer award). Counter-entries
    // preserve the audit trail and are idempotent under retries.
    await reverseReputationBySource("POST", post.id, "Post removed", session.user.id).catch(() => 0)

    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error("Post delete error:", error)
    return NextResponse.json({ error: "Failed to delete post" }, { status: 500 })
  }
}