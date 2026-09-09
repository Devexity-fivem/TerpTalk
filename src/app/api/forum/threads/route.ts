import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, publicUserSelect, LIMITS, getClientIp, logSecurityEvent, forbidden, containsExternalLink, isTrustedForLinks, isModerator } from "@/lib/security"
import { requireModerator } from "@/lib/require-staff"
import { rateLimit } from "@/lib/rate-limit"
import { awardReputation, REP_POINTS } from "@/lib/reputation"
import { notifyMentions } from "@/lib/mentions"

// Helper function to create a slug from a string
function createSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

export async function POST(request: Request) {
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
    const { title, content, categoryId } = body

    if (
      typeof title !== "string" || !title.trim() ||
      typeof content !== "string" || !content.trim() ||
      typeof categoryId !== "string" || !categoryId
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    if (title.length > LIMITS.THREAD_TITLE_MAX || content.length > LIMITS.POST_CONTENT_MAX) {
      return NextResponse.json(
        { error: "Content exceeds maximum length" },
        { status: 400 }
      )
    }

    // Rate limit: 10 threads per hour per user
    const rl = await rateLimit(`thread:${session.user.id}`, 10, 60 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: session.user.id,
        ip: getClientIp(request),
        metadata: { endpoint: "forum/threads" },
      })
      return NextResponse.json(
        { error: "Too many threads. Please try again later." },
        { status: 429 }
      )
    }

    // Validate category exists and is visible to the user
    const category = await prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true, hidden: true, name: true },
    })

    if (!category) {
      return NextResponse.json(
        { error: "Invalid category" },
        { status: 400 }
      )
    }

    if (category.hidden && !isModerator(currentUser.role)) {
      return forbidden()
    }

    if ((containsExternalLink(title) || containsExternalLink(content)) && !(await isTrustedForLinks(session.user.id))) {
      await logSecurityEvent("NEWBIE_LINK_BLOCKED", {
        userId: session.user.id,
        ip: getClientIp(request),
        metadata: { endpoint: "forum/threads", title: title.slice(0, 120) },
      })
      return NextResponse.json(
        { error: "New users need 24 hours and 10 reputation before posting links. Share plain text in the meantime." },
        { status: 403 }
      )
    }

    // Create slug
    let slug = createSlug(title)
    
    // Check if slug already exists and make it unique
    const existingThread = await prisma.thread.findUnique({
      where: { slug },
    })

    if (existingThread) {
      slug = `${slug}-${Date.now()}`
    }

    // Create thread with initial post
    const thread = await prisma.thread.create({
      data: {
        title,
        slug,
        content,
        categoryId,
        authorId: session.user.id,
        posts: {
          create: {
            content,
            authorId: session.user.id,
          },
        },
      },
      include: {
        author: { select: publicUserSelect },
        category: true,
        posts: {
          include: {
            author: { select: publicUserSelect },
          },
        },
      },
    })

    await awardReputation(
      session.user.id,
      "THREAD_CREATED",
      REP_POINTS.THREAD_CREATED,
      `Created thread "${title.slice(0, 60)}"`
    ).catch(() => {})

    // Notify @mentions in the opening post
    await notifyMentions(
      content,
      session.user.id,
      session.user.name || "Someone",
      `/forum/thread/${thread.slug}`,
      `the thread "${title.slice(0, 60)}"`
    )

    // Notify category followers (one notification per follower)
    const followers = await prisma.categoryFollow.findMany({
      where: { categoryId: category.id },
      include: {
        user: {
          include: {
            profile: { select: { notifyOnCategoryFollow: true } },
          },
        },
      },
    })
    const followerNotifications = followers
      .filter((f) => f.user.id !== session.user.id && f.user.profile?.notifyOnCategoryFollow !== false)
      .map((f) => ({
        userId: f.user.id,
        type: "THREAD_ACTIVITY",
        title: `New thread in ${category.name}`,
        content: `A new discussion "${title.slice(0, 60)}" was posted in a category you follow.`,
        link: `/forum/thread/${thread.slug}`,
      }))
    if (followerNotifications.length > 0) {
      await prisma.notification.createMany({ data: followerNotifications }).catch(() => {})
    }

    return NextResponse.json({ thread }, { status: 201 })
  } catch (error) {
    console.error("Thread creation error:", error)
    return NextResponse.json(
      { error: "Failed to create thread" },
      { status: 500 }
    )
  }
}

// DELETE — delete own thread (or moderator): { id }
export async function DELETE(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return unauthorized()
    }

    const body = await request.json().catch(() => ({}))
    const { id } = body

    if (typeof id !== "string" || !id) {
      return NextResponse.json({ error: "Missing thread id" }, { status: 400 })
    }

    const thread = await prisma.thread.findUnique({
      where: { id },
      select: { id: true, authorId: true, deleted: true },
    })
    if (!thread || thread.deleted) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 })
    }
    if (thread.authorId !== session.user.id && !(await requireModerator())) {
      return forbidden()
    }

    await prisma.thread.update({ where: { id }, data: { deleted: true } })

    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error("Thread delete error:", error)
    return NextResponse.json({ error: "Failed to delete thread" }, { status: 500 })
  }
}