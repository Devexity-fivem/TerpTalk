import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, forbidden, getClientIp, logSecurityEvent, isBanned, activeAuthor } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { checkMaintenance } from "@/lib/maintenance"
import { revalidateTag } from "next/cache"

function createSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim()
}

// Lazy-create the canonical discussion thread for a diary. Idempotent:
// repeated clicks reopen the same thread; concurrent requests can't
// produce two canonical threads because the diary update is guarded on
// threadId still being null.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()

    const banned = await isBanned(session.user.id)
    if (banned) return forbidden("Your account is suspended")

    const rl = await rateLimit(`diary-discuss:${session.user.id}`, 10, 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", { userId: session.user.id, ip: getClientIp(request), metadata: { endpoint: "diary-discuss" } })
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const { id } = await params
    const diary = await prisma.growDiary.findFirst({
      where: { id, deleted: false, author: activeAuthor() },
      select: {
        id: true,
        title: true,
        strain: true,
        strainRef: { select: { name: true } },
        threadId: true,
        discussion: { select: { id: true, slug: true, deleted: true } },
      },
    })
    if (!diary) {
      return NextResponse.json({ error: "Diary not found" }, { status: 404 })
    }

    // Already linked and the thread still lives — reopen it.
    if (diary.discussion && !diary.discussion.deleted) {
      return NextResponse.json({ threadId: diary.discussion.id, threadSlug: diary.discussion.slug })
    }
    // Stale link to a deleted thread — clear it before creating a new one.
    if (diary.threadId) {
      await prisma.growDiary.update({ where: { id: diary.id }, data: { threadId: null } })
    }

    const category = await prisma.category.findUnique({
      where: { slug: "general-cannabis-discussion" },
      select: { id: true },
    })
    if (!category) {
      return NextResponse.json({ error: "Discussion category unavailable" }, { status: 500 })
    }

    // Generic title — never embed the diary title, which may be personal.
    const strainName = (diary.strainRef?.name || diary.strain?.trim() || "Unnamed").slice(0, 80)
    // Markdown-hostile characters can't break the generated diary link.
    const safeName = strainName.replace(/[[\]()`\\]/g, "")
    const title = `${strainName} grow — discussion`
    const content = `Community discussion for the grow diary: [${safeName}](/diaries/${diary.id})\n\nQuestions, suggestions, and comparisons welcome.`

    let slug = createSlug(title)
    if (!slug) slug = `grow-discussion`
    slug = `${slug}-${Date.now().toString(36)}`

    const thread = await prisma.thread.create({
      data: {
        title,
        slug,
        content,
        categoryId: category.id,
        authorId: session.user.id,
        // The thread page renders posts, not thread.content — the opening
        // post is what makes the body (and the diary link) visible.
        posts: { create: { content, authorId: session.user.id } },
      },
      select: { id: true, slug: true },
    })

    // Only claim the canonical slot if it's still free — a concurrent
    // request may have linked its own thread first.
    const claimed = await prisma.growDiary.updateMany({
      where: { id: diary.id, OR: [{ threadId: null }, { discussion: { deleted: true } }] },
      data: { threadId: thread.id },
    })
    // The creator follows the canonical thread so replies notify them —
    // same convention as normal thread creation.
    const followThread = (threadId: string) =>
      prisma.threadFollow.upsert({
        where: { userId_threadId: { userId: session.user.id, threadId } },
        create: { userId: session.user.id, threadId, lastSeenAt: new Date() },
        update: { lastSeenAt: new Date() },
      }).catch(() => {})

    if (claimed.count === 0) {
      // Lost the race — retire our duplicate and return the winner.
      await prisma.thread.update({ where: { id: thread.id }, data: { deleted: true } })
      const fresh = await prisma.growDiary.findUnique({
        where: { id: diary.id },
        select: { discussion: { select: { id: true, slug: true } } },
      })
      if (fresh?.discussion) {
        await followThread(fresh.discussion.id)
        return NextResponse.json({ threadId: fresh.discussion.id, threadSlug: fresh.discussion.slug })
      }
      return NextResponse.json({ error: "Could not create discussion" }, { status: 500 })
    }

    await followThread(thread.id)
    revalidateTag("diaries", { expire: 0 })
    revalidateTag("forum", { expire: 0 })
    return NextResponse.json({ threadId: thread.id, threadSlug: thread.slug }, { status: 201 })
  } catch (error) {
    console.error("Diary discuss error:", error)
    return NextResponse.json({ error: "Failed to create discussion" }, { status: 500 })
  }
}
