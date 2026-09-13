import { NextResponse } from "next/server"
import { revalidateTag } from "next/cache"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, publicUserSelect, LIMITS, getClientIp, logSecurityEvent, forbidden, containsExternalLink, isTrustedForLinks, isModerator, isAdmin } from "@/lib/security"
import { requireModerator } from "@/lib/require-staff"
import { awardReputation, reverseReputationBySource, repRateLimit, getTierPerks, REP_POINTS, REP_TIERS } from "@/lib/reputation"
import { notifyMentions } from "@/lib/mentions"
import { notifyMany, invalidateNotificationsForLink, postDeepLink } from "@/lib/notify"
import { storeImages, deleteImagesIfUnreferenced } from "@/lib/blob"
import { getBooleanSetting, SITE_SETTINGS } from "@/lib/settings"
import { checkMaintenance } from "@/lib/maintenance"

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
  let imageUrls: string[] = []

  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return unauthorized()
    }

    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

    if (!(await getBooleanSetting(SITE_SETTINGS.NEW_THREADS_ENABLED, true)) && !isModerator(session.user.role)) {
      return forbidden("New thread creation is temporarily disabled")
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

    // Head Grower+ can attach up to 7 tags instead of 5.
    const tagCap = (await getTierPerks(session.user.id)).maxThreadTags ?? MAX_TAGS
    if (tagInputs.length > tagCap) {
      return NextResponse.json({ error: `Maximum ${tagCap} tags per thread` }, { status: 400 })
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

    // Rate limit: 10 threads per hour per user (Cultivator+ scale it up)
    const rl = await repRateLimit(session.user.id, `thread:${session.user.id}`, 10, 60 * 60 * 1000)
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
    try {
      imageUrls = await storeImages(images, "forum")
    } catch (err) {
      console.error("Forum thread image upload error:", err)
      return NextResponse.json(
        { error: "Image upload failed" },
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
      `Created thread "${title.slice(0, 60)}"`,
      { key: `thread:${thread.id}`, sourceType: "THREAD", sourceId: thread.id }
    ).catch(() => {})

    // Notify @mentions in the opening post — deep link lands on the OP.
    // Hidden categories never notify — title/link would leak staff-only content.
    const opPostId = thread.posts[0]?.id
    const opLink = opPostId ? postDeepLink(thread.slug, opPostId) : `/forum/thread/${thread.slug}`
    if (!category.hidden) {
      await notifyMentions(
        content,
        session.user.id,
        session.user.name || "Someone",
        opLink,
        `the thread "${title.slice(0, 60)}"`
      )
    }

    // The author auto-follows their own thread — powers unread indicators
    // and (via the reply fan-out) activity notifications.
    await prisma.threadFollow.upsert({
      where: { userId_threadId: { userId: session.user.id, threadId: thread.id } },
      create: { userId: session.user.id, threadId: thread.id, lastSeenAt: new Date() },
      update: { lastSeenAt: new Date() },
    }).catch(() => {})

    // Notify category followers (one notification per follower)
    // notifyMany filters prefs, banned recipients, and blocks in bulk.
    // Hidden categories never fan out — the link would leak content.
    if (!category.hidden) {
      const followers = await prisma.categoryFollow.findMany({
        where: { categoryId: category.id },
        select: { userId: true },
      })
      await notifyMany(
        followers
          .filter((f) => f.userId !== session.user.id)
          .map((f) => ({
            userId: f.userId,
            type: "THREAD_ACTIVITY" as const,
            title: `New thread in ${category.name}`,
            content: `@${session.user.name || "Someone"} started "${title.slice(0, 60)}" in a category you follow.`,
            link: opLink,
            actorId: session.user.id,
            groupKey: `THREAD_ACTIVITY:category:${category.id}`,
            dedupeMs: 60 * 60 * 1000,
          }))
      )
    }

    revalidateTag("forum", { expire: 0 })

    return NextResponse.json({ thread }, { status: 201 })
  } catch (error) {
    // Clean up any already-uploaded Blob objects if the thread could not be created.
    deleteImagesIfUnreferenced(imageUrls).catch(() => {})
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
      select: { id: true, slug: true, authorId: true, deleted: true, author: { select: { id: true, role: true } } },
    })
    if (!thread || thread.deleted) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 })
    }
    const mod = await requireModerator()
    const isOwn = thread.authorId === session.user.id
    if (!isOwn && !mod) {
      return forbidden()
    }
    if (!isOwn && mod && !isAdmin(mod.role) && !["MEMBER", "VERIFIED_MEMBER"].includes(thread.author.role)) {
      return forbidden()
    }

    await prisma.thread.update({ where: { id }, data: { deleted: true } })
    await invalidateNotificationsForLink(`/forum/thread/${thread.slug}`)

    // Reputation reconciliation: reverse the thread award plus every event
    // on posts inside it (post creation, likes, accepted answers).
    await reverseReputationBySource("THREAD", thread.id, "Thread removed", session.user.id).catch(() => 0)
    const postIds = await prisma.post.findMany({
      where: { threadId: thread.id },
      select: { id: true },
    })
    for (const p of postIds) {
      await reverseReputationBySource("POST", p.id, "Thread removed", session.user.id).catch(() => 0)
    }

    revalidateTag("forum", { expire: 0 })

    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error("Thread delete error:", error)
    return NextResponse.json({ error: "Failed to delete thread" }, { status: 500 })
  }
}