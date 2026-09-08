import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { publicUserSelect, LIMITS, getClientIp, logSecurityEvent, isModerator, isBanned, forbidden } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

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
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    const body = await request.json()
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

    // Validate category exists
    const category = await prisma.category.findUnique({
      where: { id: categoryId },
    })

    if (!category) {
      return NextResponse.json(
        { error: "Invalid category" },
        { status: 400 }
      )
    }

    if (await isBanned(session.user.id)) {
      return forbidden("Your account is suspended")
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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
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
    if (thread.authorId !== session.user.id && !isModerator(session.user.role)) {
      return forbidden()
    }

    await prisma.thread.update({ where: { id }, data: { deleted: true } })

    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error("Thread delete error:", error)
    return NextResponse.json({ error: "Failed to delete thread" }, { status: 500 })
  }
}