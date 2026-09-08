import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { publicUserSelect, LIMITS, getClientIp, logSecurityEvent, isBanned, forbidden } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const roomId = searchParams.get("roomId")

    if (!roomId) {
      return NextResponse.json(
        { error: "Room ID required" },
        { status: 400 }
      )
    }

    // Get recent messages
    const messages = await prisma.chatMessage.findMany({
      where: { roomId, deleted: false },
      take: 50,
      orderBy: { createdAt: "desc" },
      include: {
        author: { select: publicUserSelect },
      },
    })

    return NextResponse.json({ messages: messages.reverse() })
  } catch (error) {
    console.error("Failed to fetch messages:", error)
    return NextResponse.json(
      { error: "Failed to load messages" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { content, roomId } = body

    if (typeof content !== "string" || !content.trim() || typeof roomId !== "string" || !roomId) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    if (content.length > LIMITS.CHAT_MESSAGE_MAX) {
      return NextResponse.json(
        { error: "Message too long" },
        { status: 400 }
      )
    }

    // Rate limit: 30 messages per minute per user
    const rl = await rateLimit(`chat:${session.user.id}`, 30, 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: session.user.id,
        ip: getClientIp(request),
        metadata: { endpoint: "chat/messages" },
      })
      return NextResponse.json(
        { error: "Sending messages too fast. Please slow down." },
        { status: 429 }
      )
    }

    // Validate room exists
    const room = await prisma.chatRoom.findUnique({
      where: { id: roomId },
    })

    if (!room || room.isPrivate) {
      return NextResponse.json(
        { error: "Room not found" },
        { status: 404 }
      )
    }

    if (await isBanned(session.user.id)) {
      return forbidden("Your account is suspended")
    }

    // Create message
    const message = await prisma.chatMessage.create({
      data: {
        content,
        roomId,
        authorId: session.user.id,
      },
      include: {
        author: { select: publicUserSelect },
      },
    })

    return NextResponse.json({ message }, { status: 201 })
  } catch (error) {
    console.error("Failed to create message:", error)
    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 }
    )
  }
}
