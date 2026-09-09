import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

// POST — toggle bookmark on a thread: { threadId }
// GET — my bookmarked threads
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()

    const rl = await rateLimit(`bookmark:${session.user.id}`, 60, 10 * 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Slow down" }, { status: 429 })
    }

    const { threadId } = await request.json().catch(() => ({}))
    if (typeof threadId !== "string" || !threadId) {
      return NextResponse.json({ error: "threadId required" }, { status: 400 })
    }

    const existing = await prisma.bookmark.findUnique({
      where: { userId_threadId: { userId: session.user.id, threadId } },
    })
    if (existing) {
      await prisma.bookmark.delete({ where: { id: existing.id } })
      return NextResponse.json({ bookmarked: false })
    }
    await prisma.bookmark.create({ data: { userId: session.user.id, threadId } })
    return NextResponse.json({ bookmarked: true })
  } catch (error) {
    console.error("Bookmark error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return unauthorized()

  const bookmarks = await prisma.bookmark.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      thread: {
        select: {
          id: true, title: true, slug: true, createdAt: true, deleted: true, replyCount: true,
          category: { select: { name: true } },
          author: { select: { profile: { select: { username: true } }, name: true } },
        },
      },
    },
  })

  return NextResponse.json({
    bookmarks: bookmarks.filter((b) => !b.thread.deleted).map((b) => ({
      id: b.id,
      threadId: b.thread.id,
      title: b.thread.title,
      slug: b.thread.slug,
      category: b.thread.category.name,
      author: b.thread.author.profile?.username ?? b.thread.author.name,
      replies: b.thread.replyCount,
      savedAt: b.createdAt,
    })),
  })
}
