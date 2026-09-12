import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, publicUserSelect, LIMITS, getClientIp, logSecurityEvent, isBanned, forbidden, enforceLinkTrust, isModerator, isAdmin } from "@/lib/security"
import { requireModerator } from "@/lib/require-staff"
import { rateLimit } from "@/lib/rate-limit"
import { awardReputation, REP_POINTS } from "@/lib/reputation"
import { storeImages, deleteImagesIfUnreferenced } from "@/lib/blob"
import { notifyMentions } from "@/lib/mentions"
import { notify } from "@/lib/notify"
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

    // Rate limit: 30 posts per 10 minutes per user
    const rl = await rateLimit(`post:${session.user.id}`, 30, 10 * 60 * 1000)
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
      imageUrls = await storeImages(images, "forum")
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
      data: { replyCount: { increment: 1 } },
    })

    await awardReputation(
      session.user.id,
      "POST_CREATED",
      REP_POINTS.POST_CREATED,
      `Replied in "${thread.title.slice(0, 60)}"`
    ).catch(() => {})

    // Notify the thread author (if not self-reply; pref/block/ban handled by notify)
    if (thread.authorId !== session.user.id) {
      await notify({
        userId: thread.authorId,
        type: "REPLY",
        title: "New reply to your thread",
        content: `@${session.user.name || "Someone"} replied to "${thread.title.slice(0, 80)}"`,
        link: `/forum/thread/${thread.slug}`,
        actorId: session.user.id,
      })
    }

    // Notify @mentions in the reply — excluding the thread author, who
    // already got the REPLY notification above.
    await notifyMentions(
      content,
      session.user.id,
      session.user.name || "Someone",
      `/forum/thread/${thread.slug}`,
      `a reply in "${thread.title.slice(0, 60)}"`,
      [thread.authorId]
    )

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
      await tx.thread.update({
        where: { id: post.threadId },
        data: { replyCount: Math.max(0, remaining - 1) },
      })
    })

    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error("Post delete error:", error)
    return NextResponse.json({ error: "Failed to delete post" }, { status: 500 })
  }
}