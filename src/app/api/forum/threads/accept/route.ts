import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { isBanned, isModerator, forbidden, unauthorized, getClientIp, logSecurityEvent } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { awardReputation } from "@/lib/reputation"

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, role: true, banned: true },
    })
    if (!user) return unauthorized()

    const body = await request.json().catch(() => ({}))
    const { threadId, postId } = body

    if (typeof threadId !== "string" || (postId !== null && typeof postId !== "string")) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }

    if (await isBanned(user.id) || user.banned) {
      return forbidden("Your account is suspended")
    }

    // Rate limit: 30 accept actions per hour per user
    const rl = await rateLimit(`accept-answer:${user.id}`, 30, 60 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: user.id,
        ip: getClientIp(request),
        metadata: { endpoint: "forum/threads/accept" },
      })
      return NextResponse.json({ error: "Too many actions. Please try again later." }, { status: 429 })
    }

    const thread = await prisma.thread.findUnique({
      where: { id: threadId },
      select: { id: true, authorId: true, acceptedAnswerId: true, title: true },
    })
    if (!thread) return NextResponse.json({ error: "Thread not found" }, { status: 404 })

    // Only thread author or moderator can set accepted answer
    const canSet = thread.authorId === user.id || isModerator(user.role)
    if (!canSet) return forbidden()

    if (postId === null) {
      await prisma.thread.update({
        where: { id: threadId },
        data: { acceptedAnswerId: null },
      })
      return NextResponse.json({ success: true })
    }

    const post = await prisma.post.findFirst({
      where: { id: postId, threadId, deleted: false },
      select: { id: true, authorId: true, content: true },
    })
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 })

    // Don't accept the thread author’s own post as the answer
    if (post.authorId === thread.authorId) {
      return NextResponse.json({ error: "Thread author cannot mark their own post as the answer" }, { status: 400 })
    }

    await prisma.thread.update({
      where: { id: threadId },
      data: { acceptedAnswerId: postId },
    })

    // Award reputation for helpful answer (only once when newly set)
    if (thread.acceptedAnswerId !== postId) {
      await awardReputation(
        post.authorId,
        "HELPFUL_ANSWER",
        25,
        `Accepted answer in "${thread.title.slice(0, 50)}"`,
      ).catch(() => {})

      await prisma.notification.create({
        data: {
          userId: post.authorId,
          type: "ACCEPTED_ANSWER",
          title: "Your answer was accepted",
          content: `Your reply in "${thread.title.slice(0, 60)}" was marked as the accepted answer.`,
          link: `/forum/thread/${threadId}`,
        },
      }).catch(() => {})
    }

    return NextResponse.json({ success: true, post: { id: postId } })
  } catch (error: unknown) {
    console.error("Accept answer error:", error)
    if (error instanceof Response) return error
    return NextResponse.json({ error: "Failed to update accepted answer" }, { status: 500 })
  }
}
