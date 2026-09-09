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
        prisma.thread.findMany({ where: { authorId: userId } }),
        prisma.post.findMany({ where: { authorId: userId } }),
        prisma.growDiary.findMany({ where: { authorId: userId } }),
        prisma.diaryUpdate.findMany({ where: { authorId: userId } }),
        prisma.growSetup.findMany({ where: { authorId: userId } }),
        prisma.chatMessage.findMany({ where: { authorId: userId } }),
        prisma.directMessage.findMany({ where: { senderId: userId } }),
        prisma.directMessage.findMany({ where: { receiverId: userId } }),
        prisma.reaction.findMany({ where: { userId } }),
        prisma.userBadge.findMany({ where: { userId }, include: { badge: true } }),
        prisma.reputationEvent.findMany({ where: { userId } }),
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
