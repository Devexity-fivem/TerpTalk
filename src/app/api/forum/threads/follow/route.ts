import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, getClientIp, logSecurityEvent, isBanned, forbidden, isModerator, blockExistsBetween } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { checkMaintenance } from "@/lib/maintenance"

// POST — toggle a thread follow. { threadId: string }
// Followed threads emit throttled THREAD_ACTIVITY notifications on new
// replies and drive unread indicators. Never exposes the follower list.
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()

    if (await isBanned(session.user.id)) return forbidden("Your account is suspended")

    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

    const body = await request.json().catch(() => ({}))
    const { threadId } = body
    if (typeof threadId !== "string" || !threadId || threadId.length > 64) {
      return NextResponse.json({ error: "threadId is required" }, { status: 400 })
    }

    const rl = await rateLimit(`thread-follow:${session.user.id}`, 60, 10 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: session.user.id,
        ip: getClientIp(request),
        metadata: { endpoint: "forum/threads/follow" },
      })
      return NextResponse.json({ error: "Slow down." }, { status: 429 })
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    })

    const thread = await prisma.thread.findUnique({
      where: { id: threadId },
      select: { id: true, deleted: true, authorId: true, category: { select: { hidden: true } } },
    })

    // 404 for missing/deleted/hidden — no existence leak.
    if (!thread || thread.deleted || (thread.category?.hidden && !isModerator(currentUser?.role))) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 })
    }

    if (await blockExistsBetween(session.user.id, thread.authorId)) {
      return forbidden()
    }

    const key = { userId: session.user.id, threadId }
    const existing = await prisma.threadFollow.findUnique({
      where: { userId_threadId: key },
    })
    if (existing) {
      await prisma.threadFollow.deleteMany({ where: { id: existing.id } })
      return NextResponse.json({ following: false })
    }

    try {
      // lastSeenAt = now — following a thread you just viewed shouldn't
      // immediately flag it unread.
      await prisma.threadFollow.create({
        data: { ...key, lastSeenAt: new Date() },
      })
    } catch (e) {
      // Concurrent double-toggle — the row already exists, treat as followed.
      if ((e as { code?: string }).code !== "P2002") throw e
    }
    return NextResponse.json({ following: true })
  } catch (error) {
    console.error("Thread follow error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
