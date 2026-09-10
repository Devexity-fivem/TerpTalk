import { NextResponse } from "next/server"
import { revalidateTag } from "next/cache"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, publicUserSelect, LIMITS, getClientIp, logSecurityEvent, forbidden, containsExternalLink, isTrustedForLinks, isModerator } from "@/lib/security"
import { requireModerator } from "@/lib/require-staff"
import { rateLimit } from "@/lib/rate-limit"
import { awardReputation, REP_POINTS, REP_TIERS } from "@/lib/reputation"
import { notifyMentions } from "@/lib/mentions"
import { storeImages } from "@/lib/blob"

// Helper function to create a slug from a string
function createSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

function createTagSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

const MAX_TAGS = 5

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
    const { title, content, categoryId, images } = body
    const tagInputs = Array.isArray(body.tags) ? body.tags.filter((t: unknown): t is string => typeof t === "string").map((t: string) => t.trim()).filter(Boolean) : []

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

    if (tagInputs.length > MAX_TAGS) {
      return NextResponse.json({ error: `Maximum ${MAX_TAGS} tags per thread` }, { status: 400 })
    }

    let pollData: { question: string; options: { text: string; order: number }[] } | undefined
    if (body.poll && typeof body.poll === "object" && !Array.isArray(body.poll)) {
      const pollInput = body.poll as { question?: unknown; options?: unknown }
      if (typeof pollInput.question !== "string" || !pollInput.question.trim() || pollInput.question.length > 200) {
        return NextResponse.json({ error: "Poll question must be between 1 and 200 characters" }, { status: 400 })
      }
      const rawOptions = Array.isArray(pollInput.options) ? pollInput.options : []
      if (rawOptions.length < 2 || rawOptions.length > 10) {
        return NextResponse.json({ error: "Polls need between 2 and 10 options" }, { status: 400 })
      }
      const pollOptions: { text: string; order: number }[] = []
      for (let i = 0; i < rawOptions.length; i++) {
        const opt = rawOptions[i]
        if (typeof opt !== "string" || !opt.trim() || opt.length > 100) {
          return NextResponse.json({ error: `Poll option ${i + 1} is invalid` }, { status: 400 })
        }
        pollOptions.push({ text: opt.trim(), order: i })
      }
      pollData = { question: pollInput.question.trim(), options: pollOptions }
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
        { error: `New users need 24 hours and ${REP_TIERS[1].threshold} reputation (Sprout tier) before posting links. Share plain text in the meantime.` },
        { status: 403 }
      )
    }

    // Upload attachments before creating the thread so a storage failure
    // cannot leave a thread with half its images.
    let imageUrls: string[] = []
    try {
      imageUrls = await storeImages(images, "forum")
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Image upload failed" },
        { status: 400 }
      )
    }

    // Resolve tags: reuse existing slugs or create new ones.
    const threadTags = [] as { tag: { connect: { id: string } } }[]
    for (const name of tagInputs) {
      if (!name || name.length > 30 || name.length < 2) {
        return NextResponse.json({ error: `Invalid tag name: ${name.slice(0, 20)}` }, { status: 400 })
      }
      const slug = createTagSlug(name)
      if (!slug || slug.length < 2) {
        return NextResponse.json({ error: `Invalid tag: ${name.slice(0, 20)}` }, { status: 400 })
      }
      const tag = await prisma.tag.upsert({
        where: { slug },
        update: {},
        create: { name: name.toLowerCase(), slug, color: null },
      })
      threadTags.push({ tag: { connect: { id: tag.id } } })
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
        images: {
          create: imageUrls.map((url, order) => ({ url, order })),
        },
        tags: { create: threadTags },
        poll: pollData
          ? {
              create: {
                question: pollData.question,
                multiple: false,
                options: { create: pollData.options },
              },
            }
          : undefined,
      },
      include: {
        author: { select: publicUserSelect },
        category: true,
        tags: { include: { tag: true } },
        poll: { include: { options: { orderBy: { order: "asc" } } } },
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

    revalidateTag("forum", { expire: 0 })

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

    revalidateTag("forum", { expire: 0 })

    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error("Thread delete error:", error)
    return NextResponse.json({ error: "Failed to delete thread" }, { status: 500 })
  }
}