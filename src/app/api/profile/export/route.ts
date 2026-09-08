import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized } from "@/lib/security"

// GDPR-style data export: returns all data associated with the user
export async function GET() {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return unauthorized()
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
