import { NextResponse, after } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, publicUserSelect, LIMITS, getClientIp, logSecurityEvent, forbidden, enforceLinkTrust, isModerator, isAdmin, blockExistsBetween, isActiveAuthorRow } from "@/lib/security"
import { diaryPath } from "@/lib/slugs"
import { updateAnchor } from "@/lib/update-social"
import { requireModerator } from "@/lib/require-staff"
import { rateLimit } from "@/lib/rate-limit"
import { proxyMedia } from "@/lib/media"
import { progressionRateLimit, getProgressionPerks } from "@/lib/progression"
import { POST_MIN_PAID_LENGTH } from "@/lib/reputation-config"
import { awardProgression, checkDuplicateContent } from "@/lib/progression"
import { QUALITY_BANDS } from "@/lib/progression-config"
import { enqueueReversal, drainOne } from "@/lib/reputation-outbox"
import { enqueueXpReversal, drainXpOne } from "@/lib/progression-outbox"
import { storeImages, deleteImagesIfUnreferenced, MAX_POST_IMAGES } from "@/lib/blob"
import { notifyMentions } from "@/lib/mentions"
import { notify, notifyMany, postDeepLink, postLinkWhere } from "@/lib/notify"
import { logModAction } from "@/lib/moderation"
import { checkMaintenance } from "@/lib/maintenance"
import { revalidateTag } from "next/cache"

export async function POST(request: Request) {
  let imageUrls: string[] = []

  try {
    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return unauthorized()
    }

    const body = await request.json().catch(() => ({}))
    const { content, threadId, images, diaryUpdateId } = body

    if (
      typeof content !== "string" || !content.trim() ||
      typeof threadId !== "string" || !threadId ||
      (diaryUpdateId !== undefined && diaryUpdateId !== null && (typeof diaryUpdateId !== "string" || !diaryUpdateId))
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

    // One profile read serves the rate limit and the image-cap check below.
    const perks = await getProgressionPerks(session.user.id)

    // Rate limit: 30 posts per 10 minutes per user (Cultivator+ scale it up)
    const rl = await progressionRateLimit(session.user.id, `post:${session.user.id}`, 30, 10 * 60 * 1000, perks)
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
        author: { select: { createdAt: true } },
      },
    })

    if (!thread) {
      return NextResponse.json(
        { error: "Thread not found" },
        { status: 404 }
      )
    }

    if (thread.locked || thread.deleted || (thread.category?.hidden && !isModerator(session.user.role))) {
      return NextResponse.json(
        { error: "Thread is locked" },
        { status: 403 }
      )
    }

    // A block in either direction means no replying in the other member's
    // thread — same rule as setup comments, reactions, follows, and DMs.
    if (await blockExistsBetween(session.user.id, thread.authorId)) {
      return forbidden()
    }

    // Social Grow Updates — an anchored comment is a normal Post, but only
    // inside the grow's own canonical discussion thread and only while the
    // grow is PUBLIC (the thread is public forum content; an interaction may
    // never be broader than the content it belongs to). One 404 for every
    // failure so update/grow existence can't be probed.
    let anchor: { updateId: string; diaryHref: string; diaryAuthorId: string; updateTitle: string } | null = null
    if (typeof diaryUpdateId === "string") {
      const update = await prisma.diaryUpdate.findUnique({
        where: { id: diaryUpdateId },
        select: {
          id: true,
          title: true,
          diary: {
            select: {
              id: true, slug: true, authorId: true, visibility: true, deleted: true, threadId: true,
              author: { select: { banned: true, suspendedUntil: true } },
            },
          },
        },
      })
      if (
        !update ||
        update.diary.deleted ||
        update.diary.visibility !== "PUBLIC" ||
        !isActiveAuthorRow(update.diary.author) ||
        update.diary.threadId !== threadId
      ) {
        return NextResponse.json({ error: "Update not found" }, { status: 404 })
      }
      // Grow owner == discussion thread author (discuss route invariant);
      // the block check above already covers them — re-check defensively in
      // case the thread author ever diverges.
      if (update.diary.authorId !== thread.authorId && await blockExistsBetween(session.user.id, update.diary.authorId)) {
        return forbidden()
      }
      // Update comments are short and text-only.
      if (Array.isArray(images) && images.length > 0) {
        return NextResponse.json({ error: "Comments can't include images" }, { status: 400 })
      }
      anchor = {
        updateId: update.id,
        diaryHref: diaryPath(update.diary),
        diaryAuthorId: update.diary.authorId,
        updateTitle: update.title,
      }
    }

    const linkBlock = await enforceLinkTrust(content, session.user.id, request, "forum/posts")
    if (linkBlock) return linkBlock

    // Upload attachments first so a storage failure cannot leave a reply
    // with only some of its images.
    try {
      // Seedling+ ranks can attach more images per post.
      imageUrls = anchor ? [] : await storeImages(images, "forum", perks.imagesPerPost ?? MAX_POST_IMAGES, { access: "private" })
    } catch (err) {
      console.error("Forum post image upload error:", err)
      return NextResponse.json(
        { error: "Image upload failed" },
        { status: 400 }
      )
    }

    // Post + replyCount + auto-follow are one transaction — a failure partway
    // can't leave a reply that isn't counted (or a count without a reply).
    const post = await prisma.$transaction(async (tx) => {
      const created = await tx.post.create({
        data: {
          content,
          threadId,
          authorId: session.user.id,
          diaryUpdateId: anchor?.updateId ?? null,
          images: {
            create: imageUrls.map((url, order) => ({ url, order })),
          },
        },
        include: {
          author: { select: publicUserSelect },
          images: { orderBy: { order: "asc" } },
        },
      })
      await tx.thread.update({
        where: { id: threadId },
        data: { replyCount: { increment: 1 }, lastActivityAt: new Date() },
      })
      // Repliers auto-follow the thread (XenForo-style): silent upsert — no
      // notification, and lastSeenAt covers everything up to their own reply.
      await tx.threadFollow.upsert({
        where: { userId_threadId: { userId: session.user.id, threadId } },
        create: { userId: session.user.id, threadId, lastSeenAt: new Date() },
        update: { lastSeenAt: new Date() },
      })
      return created
    })

    // Paying floor: short replies still post — they just don't earn XP or
    // feed post-count quests. Same policy as THREAD_MIN_PAID_LENGTH.
    // V2: REPLY (Community) + SUBSTANTIVE_ANSWER (Knowledge, dual-path,
    // ≥200 chars in others' threads) + NEWCOMER_REPLY (<30d thread author).
    // Simhash tiers gate the award — posts carry no structured data, so a
    // "reduced" verdict pays nothing (design §6.7).
    if (content.trim().length >= POST_MIN_PAID_LENGTH) {
      const dup = await checkDuplicateContent(session.user.id, content, { excludeId: post.id }).catch(
        () => ({ verdict: "clean" as const, similarity: 0 })
      )
      const baseReason = `Replied in "${thread.title.slice(0, 60)}"`
      const src = { sourceType: "POST", sourceId: post.id } as const
      if (dup.verdict !== "clean") {
        await awardProgression(session.user.id, "REPLY", baseReason, {
          key: `post:${post.id}`, ...src, xp: 0, marker: true,
          meta: { dup: dup.verdict, similarity: dup.similarity },
        }).catch(() => {})
      } else {
        await awardProgression(session.user.id, "REPLY", baseReason, {
          key: `post:${post.id}`, ...src,
        }).catch(() => {})
        const othersThread = thread.authorId !== session.user.id
        if (othersThread && content.trim().length >= QUALITY_BANDS.SUBSTANTIVE_MIN_CHARS) {
          await awardProgression(session.user.id, "SUBSTANTIVE_ANSWER", baseReason, {
            key: `post:${post.id}:sub`, ...src,
          }).catch(() => {})
        }
        // Newcomer bonus: replying in a <30d member's thread.
        const newcomerWindow = Date.now() - 30 * 86400000
        if (othersThread && thread.author.createdAt.getTime() > newcomerWindow) {
          await awardProgression(session.user.id, "NEWCOMER_REPLY", baseReason, {
            key: `post:${post.id}:newcomer`, ...src,
          }).catch(() => {})
        }
      }
    }

    // Notify the thread author (if not self-reply; pref/block/ban handled by notify).
    // groupKey+dedupeMs bound reply-bombs: the same replier can't stack more
    // than one REPLY notification per hour on the same thread.
    // Hidden categories never notify — title/link would leak staff-only content.
    // Anchored update comments notify the grower with the existing COMMENT
    // type (notifyOnComment pref; in-app only — pushCategory never maps it),
    // linking straight to the update. `?post=` keeps postLinkWhere cleanup
    // working when the comment is deleted.
    if (anchor) {
      if (anchor.diaryAuthorId !== session.user.id) {
        await notify({
          userId: anchor.diaryAuthorId,
          type: "COMMENT",
          title: "New comment on your grow update",
          content: `@${session.user.name || "Someone"} commented on "${anchor.updateTitle.slice(0, 80)}"`,
          link: updateAnchor(anchor.diaryHref, anchor.updateId, post.id),
          actorId: session.user.id,
          groupKey: `COMMENT:update:${anchor.updateId}`,
          dedupeMs: 60 * 60 * 1000,
        })
      }
    } else if (thread.authorId !== session.user.id && !thread.category?.hidden) {
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

    // Notify @mentions in the reply — excluding the thread/grow owner, who
    // already got the REPLY/COMMENT notification above. Same hidden-category gate.
    if (!thread.category?.hidden) {
      await notifyMentions(
        content,
        session.user.id,
        session.user.name || "Someone",
        anchor ? updateAnchor(anchor.diaryHref, anchor.updateId, post.id) : postDeepLink(thread.slug, post.id),
        anchor ? `a comment on "${anchor.updateTitle.slice(0, 60)}"` : `a reply in "${thread.title.slice(0, 60)}"`,
        [anchor?.diaryAuthorId ?? thread.authorId]
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

    return NextResponse.json(
      { post: { ...post, images: proxyMedia("post", post.images) } },
      { status: 201 }
    )
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

    // Edits were the one unthrottled write on this route — each re-runs
    // the link policy and rewrites searchable content.
    const rl = await rateLimit(`post-edit:${session.user.id}`, 30, 10 * 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Editing too fast. Please slow down." }, { status: 429 })
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
      (post.thread.category?.hidden && !isModerator(session.user.role))
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
      select: {
        id: true, authorId: true, deleted: true, threadId: true,
        author: { select: { id: true, role: true } },
        images: { select: { url: true } },
        thread: { select: { wizardResultId: true } },
      },
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
    let acceptedCleared = 0
    let reversalId: string | null = null
    let xpReversalId: string | null = null
    await prisma.$transaction(async (tx) => {
      await tx.post.update({ where: { id }, data: { deleted: true } })
      // Detach image rows so the blob cleanup's reference check sees the
      // post as truly unlinked. Restore paths re-attach nothing — deleted
      // images stay deleted.
      await tx.postImage.deleteMany({ where: { postId: post.id } })
      const op = await tx.post.findFirst({
        where: { threadId: post.threadId },
        orderBy: { createdAt: "asc" },
        select: { id: true, deleted: true },
      })
      // The OP's body is denormalized onto Thread.content — without this a
      // deleted OP keeps rendering in thread metadata/search.
      if (op?.id === post.id) {
        await tx.thread.update({ where: { id: post.threadId }, data: { content: "" } })
      } else {
        // replyCount counts non-OP posts — only a non-OP delete moves it.
        // Atomic decrement with a zero floor: an absolute rewrite of a
        // stale COUNT could clobber a concurrent reply's increment.
        await tx.thread.updateMany({
          where: { id: post.threadId, replyCount: { gt: 0 } },
          data: { replyCount: { decrement: 1 } },
        })
      }
      // If this post was the accepted answer, clear the pointer — the thread
      // is no longer solved (SetNull on the FK only fires on hard delete).
      acceptedCleared = (
        await tx.thread.updateMany({
          where: { acceptedAnswerId: post.id },
          data: { acceptedAnswerId: null },
        })
      ).count
      // Deep links to this post would now dangle — drop the notifications.
      await tx.notification.deleteMany({ where: postLinkWhere(post.id) })
      // Durable reversal intent — same transaction as the delete, so a
      // crash can't strand reputation on removed content.
      reversalId = await enqueueReversal(tx, {
        kind: "SOURCE", sourceType: "POST", sourceId: post.id,
        reason: "Post removed", requestedBy: session.user.id,
      })
      xpReversalId = await enqueueXpReversal(tx, {
        kind: "SOURCE", sourceType: "POST", sourceId: post.id,
        reason: "Post removed", requestedBy: session.user.id,
      })
    })

    // Staff deletion of another user's content is a moderation action —
    // audit it the same way the mod panel does.
    if (!isOwn && mod) {
      await logModAction(prisma, {
        type: "CONTENT_DELETION",
        reason: "Post removed via forum UI",
        targetUserId: post.authorId,
        moderatorId: mod.id,
        targetType: "POST",
        targetId: id,
      }).catch(() => null)
      await logSecurityEvent("SUSPICIOUS_ACTIVITY", {
        userId: mod.id,
        ip: getClientIp(request),
        metadata: { moderationAction: "CONTENT_DELETION", targetType: "POST", targetId: id, surface: "post-delete" },
      }).catch(() => {})
    }

    // Best-effort immediate drain — the outbox row makes any failure
    // retryable via ping/cron instead of silently losing the reversal.
    if (reversalId) await drainOne(reversalId).catch(() => false)
    if (xpReversalId) await drainXpOne(xpReversalId).catch(() => false)

    // Soft-deleted content must not leave live public blobs behind.
    deleteImagesIfUnreferenced(post.images.map((i) => i.url)).catch(() => {})

    // Deleting the accepted answer un-solves the thread — bust the Plant
    // Doctor outcome aggregates when the thread was wizard-linked.
    if (acceptedCleared > 0 && post.thread.wizardResultId) {
      revalidateTag("analytics", { expire: 0 })
    }

    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error("Post delete error:", error)
    return NextResponse.json({ error: "Failed to delete post" }, { status: 500 })
  }
}