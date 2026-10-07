import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { isModerator, activeAuthor } from "@/lib/security"
import { anchoredPostVisibleWhere } from "@/lib/update-social"

export const dynamic = "force-dynamic"

// Cheap per-thread fingerprint for the thread page's LiveRefresh tickle —
// visible post count + newest post timestamps + thread edit time. Mirrors
// the page's visibility rules exactly: hidden-category threads 404 for
// non-moderators, deleted/inactive-author threads 404 for everyone.
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const session = await getServerSession(authOptions)
    const canSeeHidden = isModerator(session?.user?.role)

    const thread = await prisma.thread.findUnique({
      where: { slug },
      select: {
        id: true,
        deleted: true,
        updatedAt: true,
        category: { select: { hidden: true } },
        author: { select: { banned: true, suspendedUntil: true } },
      },
    })
    const authorInactive =
      !!thread &&
      (thread.author.banned ||
        (thread.author.suspendedUntil && thread.author.suspendedUntil > new Date()))
    if (!thread || thread.deleted || authorInactive || (thread.category?.hidden && !canSeeHidden)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const [posts, lastPost] = await Promise.all([
      prisma.post.count({ where: { threadId: thread.id, deleted: false, author: activeAuthor(), ...anchoredPostVisibleWhere() } }),
      prisma.post.findFirst({
        where: { threadId: thread.id, deleted: false, author: activeAuthor(), ...anchoredPostVisibleWhere() },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, updatedAt: true },
      }),
    ])

    const fingerprint = [
      posts,
      lastPost?.createdAt.toISOString() ?? "0",
      lastPost?.updatedAt.toISOString() ?? "0",
      thread.updatedAt.toISOString(),
    ].join(":")
    return NextResponse.json({ fingerprint }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    console.error("Thread activity error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
