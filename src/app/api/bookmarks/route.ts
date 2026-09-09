import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, forbidden, isBanned } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

// POST — toggle bookmark on a thread: { threadId }
// GET — my bookmarked threads
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()

    const userId = session.user.id
    if (await isBanned(userId)) return forbidden()

    const rl = await rateLimit(`bookmark:${userId}`, 60, 10 * 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Slow down" }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))
    const { threadId } = body
    if (typeof threadId !== "string" || !threadId) {
      return NextResponse.json({ error: "threadId required" }, { status: 400 })
    }

    // Only bookmark visible threads
    const thread = await prisma.thread.findUnique({
      where: { id: threadId, deleted: false },
      include: { category: { select: { hidden: true } } },
    })
    if (!thread || thread.category?.hidden) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 })
    }

    const existing = await prisma.bookmark.findUnique({
      where: { userId_threadId: { userId, threadId } },
    })
    if (existing) {
      await prisma.bookmark.delete({ where: { id: existing.id } })
      return NextResponse.json({ bookmarked: false })
    }
    await prisma.bookmark.create({ data: { userId, threadId } })
    return NextResponse.json({ bookmarked: true })
  } catch (error) {
    console.error("Bookmark error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()

    const bookmarks = await prisma.bookmark.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        thread: {
          select: {
            id: true,
            title: true,
            slug: true,
            createdAt: true,
            deleted: true,
            replyCount: true,
            category: { select: { name: true, hidden: true } },
            author: { select: { profile: { select: { username: true } }, name: true } },
          },
        },
      },
    })

    const visible = bookmarks
      .filter((b) => b.thread && !b.thread.deleted && !b.thread.category?.hidden)
      .map((b) => ({
        id: b.id,
        threadId: b.thread!.id,
        title: b.thread!.title,
        slug: b.thread!.slug,
        category: b.thread!.category.name,
        author: b.thread!.author.profile?.username ?? b.thread!.author.name,
        replies: b.thread!.replyCount,
        savedAt: b.createdAt,
      }))

    return NextResponse.json({ bookmarks: visible })
  } catch (error) {
    console.error("Bookmarks fetch error:", error)
    return NextResponse.json({ bookmarks: [] }, { status: 500 })
  }
}
