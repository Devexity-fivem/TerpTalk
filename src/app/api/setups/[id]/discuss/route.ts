import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, getClientIp, logSecurityEvent, activeAuthor } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { checkMaintenance } from "@/lib/maintenance"
import { revalidateTag } from "next/cache"
import { setupPath } from "@/lib/slugs"

function createSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim()
}

// Lazy-create the canonical discussion thread for a setup. Idempotent:
// repeated clicks reopen the same thread; concurrent requests can't
// produce two canonical threads because the setup update is guarded on
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

    const rl = await rateLimit(`setup-discuss:${session.user.id}`, 10, 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", { userId: session.user.id, ip: getClientIp(request), metadata: { endpoint: "setup-discuss" } })
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const { id } = await params
    // Setups have no private/unlisted visibility — every live setup is
    // public, so unlike diaries a public thread can't leak existence.
    const setup = await prisma.growSetup.findFirst({
      where: { id, deleted: false, author: activeAuthor() },
      select: {
        id: true,
        slug: true,
        strain: true,
        threadId: true,
        authorId: true,
        discussion: { select: { id: true, slug: true, deleted: true } },
      },
    })
    if (!setup) {
      return NextResponse.json({ error: "Setup not found" }, { status: 404 })
    }

    // Already linked and the thread still lives — reopen it.
    if (setup.discussion && !setup.discussion.deleted) {
      return NextResponse.json({ threadId: setup.discussion.id, threadSlug: setup.discussion.slug })
    }
    // Stale link to a deleted thread — clear it before creating a new one.
    if (setup.threadId) {
      await prisma.growSetup.update({ where: { id: setup.id }, data: { threadId: null } })
    }

    const category = await prisma.category.findUnique({
      where: { slug: "general-cannabis-discussion" },
      select: { id: true },
    })
    if (!category) {
      return NextResponse.json({ error: "Discussion category unavailable" }, { status: 500 })
    }

    // Generic title — never embed the setup title, which may be personal.
    // The free-text strain name (when present) is the shared vocabulary.
    const strainName = setup.strain?.trim().slice(0, 80) || null
    const title = strainName ? `${strainName} grow setup — discussion` : "Grow setup — discussion"
    // Markdown-hostile characters can't break the generated setup link.
    const safeName = (strainName ?? "grow setup").replace(/[[\]()`\\]/g, "")
    const content = `Community discussion for the grow setup: [${safeName}](${setupPath(setup)})\n\nQuestions, feedback, and comparisons welcome.`

    let slug = createSlug(title)
    if (!slug) slug = `setup-discussion`
    // Readable prefix + enough entropy that two same-name discussions
    // opening in the same millisecond can't collide.
    slug = `${slug}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

    const thread = await prisma.thread.create({
      data: {
        title,
        slug,
        content,
        categoryId: category.id,
        // Canonical discussion belongs to the setup's owner — whoever
        // triggered lazy-creation must not silently own (and edit) it.
        authorId: setup.authorId,
        // The thread page renders posts, not thread.content — the opening
        // post is what makes the body (and the setup link) visible.
        posts: { create: { content, authorId: setup.authorId } },
      },
      select: { id: true, slug: true },
    })

    // Only claim the canonical slot if it's still free — a concurrent
    // request may have linked its own thread first.
    const claimed = await prisma.growSetup.updateMany({
      where: { id: setup.id, OR: [{ threadId: null }, { discussion: { deleted: true } }] },
      data: { threadId: thread.id },
    })
    // Both the setup owner (author convention) and the member who opened
    // the discussion follow it so replies notify them.
    const followThread = (threadId: string) =>
      Promise.all(
        [...new Set([setup.authorId, session.user.id])].map((userId) =>
          prisma.threadFollow.upsert({
            where: { userId_threadId: { userId, threadId } },
            create: { userId, threadId, lastSeenAt: new Date() },
            update: { lastSeenAt: new Date() },
          }).catch(() => {})
        )
      )

    if (claimed.count === 0) {
      // Lost the race — retire our duplicate and return the winner.
      await prisma.thread.update({ where: { id: thread.id }, data: { deleted: true } })
      const fresh = await prisma.growSetup.findUnique({
        where: { id: setup.id },
        select: { discussion: { select: { id: true, slug: true } } },
      })
      if (fresh?.discussion) {
        await followThread(fresh.discussion.id)
        return NextResponse.json({ threadId: fresh.discussion.id, threadSlug: fresh.discussion.slug })
      }
      return NextResponse.json({ error: "Could not create discussion" }, { status: 500 })
    }

    await followThread(thread.id)
    revalidateTag("setups", { expire: 0 })
    revalidateTag("forum", { expire: 0 })
    return NextResponse.json({ threadId: thread.id, threadSlug: thread.slug }, { status: 201 })
  } catch (error) {
    console.error("Setup discuss error:", error)
    return NextResponse.json({ error: "Failed to create discussion" }, { status: 500 })
  }
}
