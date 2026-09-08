import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, publicUserSelect, LIMITS, getClientIp, logSecurityEvent, isModerator, isBanned, forbidden } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return unauthorized()
    }

    const body = await request.json()
    const { content, threadId } = body

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

    // Validate thread exists and is not locked
    const thread = await prisma.thread.findUnique({
      where: { id: threadId },
    })

    if (!thread) {
      return NextResponse.json(
        { error: "Thread not found" },
        { status: 404 }
      )
    }

    if (thread.locked || thread.deleted) {
      return NextResponse.json(
        { error: "Thread is locked" },
        { status: 403 }
      )
    }

    if (await isBanned(session.user.id)) {
      return forbidden("Your account is suspended")
    }

    // Create post
    const post = await prisma.post.create({
      data: {
        content,
        threadId,
        authorId: session.user.id,
      },
      include: {
        author: { select: publicUserSelect },
      },
    })

    // Notify the thread author (if not self-reply)
    if (thread.authorId !== session.user.id) {
      await prisma.notification.create({
        data: {
          type: "REPLY",
          userId: thread.authorId,
          title: "New reply to your thread",
          content: `Someone replied to "${thread.title.slice(0, 80)}"`,
          link: `/forum/thread/${thread.slug}`,
        },
      }).catch(() => {})
    }

    return NextResponse.json({ post }, { status: 201 })
  } catch (error) {
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

    const post = await prisma.post.findUnique({
      where: { id },
      select: { id: true, authorId: true, deleted: true },
    })
    if (!post || post.deleted) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 })
    }
    if (post.authorId !== session.user.id) {
      return forbidden()
    }

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
      select: { id: true, authorId: true, deleted: true },
    })
    if (!post || post.deleted) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 })
    }
    if (post.authorId !== session.user.id && !isModerator(session.user.role)) {
      return forbidden()
    }

    await prisma.post.update({ where: { id }, data: { deleted: true } })

    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error("Post delete error:", error)
    return NextResponse.json({ error: "Failed to delete post" }, { status: 500 })
  }
}