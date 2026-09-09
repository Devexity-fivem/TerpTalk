import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, getClientIp, logSecurityEvent } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

// GDPR-style data export: returns all data associated with the user
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return unauthorized()
    }

    // Heavy query — 5 exports per hour per user
    const rl = await rateLimit(`export:${session.user.id}`, 5, 60 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: session.user.id, ip: getClientIp(request), metadata: { endpoint: "profile/export" },
      })
      return NextResponse.json({ error: "Too many export requests" }, { status: 429 })
    }

    const userId = session.user.id

    const [user, profile, threads, posts, diaries, diaryUpdates, setups, chatMessages, sentMessages, receivedMessages, reactions, badges, reputationEvents] =
      await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            name: true,
            image: true,
            role: true,
            ageVerified: true,
            createdAt: true,
            lastSeenAt: true,
          },
        }),
        prisma.profile.findUnique({ where: { userId } }),
        // Per-collection caps keep a power user's export from being a
        // multi-hundred-MB response; rate-limited to 5/hr above.
        prisma.thread.findMany({ where: { authorId: userId }, take: 10_000, orderBy: { createdAt: "desc" } }),
        prisma.post.findMany({ where: { authorId: userId }, take: 10_000, orderBy: { createdAt: "desc" } }),
        prisma.growDiary.findMany({ where: { authorId: userId }, take: 10_000, orderBy: { createdAt: "desc" } }),
        prisma.diaryUpdate.findMany({ where: { authorId: userId }, take: 10_000, orderBy: { createdAt: "desc" } }),
        prisma.growSetup.findMany({ where: { authorId: userId }, take: 10_000, orderBy: { createdAt: "desc" } }),
        prisma.chatMessage.findMany({ where: { authorId: userId }, take: 10_000, orderBy: { createdAt: "desc" } }),
        prisma.directMessage.findMany({ where: { senderId: userId }, take: 10_000, orderBy: { createdAt: "desc" } }),
        prisma.directMessage.findMany({ where: { receiverId: userId }, take: 10_000, orderBy: { createdAt: "desc" } }),
        prisma.reaction.findMany({ where: { userId }, take: 10_000, orderBy: { createdAt: "desc" } }),
        prisma.userBadge.findMany({ where: { userId }, include: { badge: true }, take: 1_000 }),
        prisma.reputationEvent.findMany({ where: { userId }, take: 10_000, orderBy: { createdAt: "desc" } }),
      ])

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const exportData = {
      exportedAt: new Date().toISOString(),
      user,
      profile,
      content: {
        threads,
        posts,
        diaries,
        diaryUpdates,
        setups,
        chatMessages,
        directMessages: { sent: sentMessages, received: receivedMessages },
        reactions,
      },
      badges,
      reputationEvents,
    }

    return new NextResponse(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="terptalk-export-${userId}.json"`,
      },
    })
  } catch (error) {
    console.error("Data export error:", error)
    return NextResponse.json(
      { error: "Failed to export data" },
      { status: 500 }
    )
  }
}
