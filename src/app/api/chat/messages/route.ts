import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { prisma } from "@/lib/prisma"
import { unauthorized, publicUserSelect, LIMITS, getClientIp, logSecurityEvent, isSessionValid, forbidden, isModerator } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { notifyMentions } from "@/lib/mentions"
import { getPusher } from "@/lib/pusher"

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/

type ChatMessageWithAuthor = {
  id: string
  content: string
  createdAt: Date
  author: {
    name?: string | null
    image?: string | null
    profile?: { username?: string | null } | null
  }
}

function messageDto(m: ChatMessageWithAuthor) {
  return {
    id: m.id,
    content: m.content,
    createdAt: m.createdAt,
    author: {
      name: m.author.name,
      username: m.author.profile?.username ?? null,
      image: m.author.image ?? null,
    },
  }
}

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })
    const userId = token?.id as string | undefined
    if (!userId) return unauthorized()

    if (!(await isSessionValid(userId, token?.sessionVersion as number | undefined))) return forbidden("Your account is suspended")

    const rl = await rateLimit(`chat-read:${userId}`, 120, 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const { searchParams } = new URL(request.url)
    const roomId = searchParams.get("roomId")

    if (!roomId || typeof roomId !== "string") {
      return NextResponse.json(
        { error: "Room ID required" },
        { status: 400 }
      )
    }

    const room = await prisma.chatRoom.findUnique({ where: { id: roomId } })
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 })
    }

    // Public rooms are open; private rooms require moderator access until a membership model exists
    if (room.isPrivate) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
      if (!isModerator(user?.role)) {
        return forbidden("Private room")
      }
    }

    // Get recent messages — or incrementally: ?after=<ISO date> returns only new ones
    const after = searchParams.get("after")
    let afterDate: Date | null = null
    if (after) {
      if (!ISO_RE.test(after)) {
        return NextResponse.json({ error: "Invalid after param" }, { status: 400 })
      }
      afterDate = new Date(after)
      if (isNaN(afterDate.getTime())) {
        return NextResponse.json({ error: "Invalid after param" }, { status: 400 })
      }
    }

    const messages = await prisma.chatMessage.findMany({
      where: {
        roomId,
        deleted: false,
        ...(afterDate && { createdAt: { gt: afterDate } }),
      },
      take: afterDate ? 100 : 50,
      orderBy: { createdAt: afterDate ? "asc" : "desc" },
      include: {
        author: { select: publicUserSelect },
      },
    })

    return NextResponse.json({ messages: (afterDate ? messages : messages.reverse()).map(messageDto) })
  } catch (error) {
    console.error("Failed to fetch messages:", error)
    return NextResponse.json(
      { error: "Failed to load messages" },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })
    const userId = token?.id as string | undefined
    if (!token || !userId) return unauthorized()

    if (!(await isSessionValid(userId, token?.sessionVersion as number | undefined))) return forbidden("Your account is suspended")

    const body = await request.json().catch(() => ({}))
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
    const rl = await rateLimit(`chat:${userId}`, 30, 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId,
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

    // Create message
    const message = await prisma.chatMessage.create({
      data: {
        content,
        roomId,
        authorId: userId,
      },
      include: {
        author: { select: publicUserSelect },
      },
    })

    const dto = messageDto(message)

    // Notify @mentions in chat (fire-and-forget)
    const actorName =
      ((token as { name?: string | null }).name) ??
      ((token as { username?: string | null }).username) ??
      "Someone"
    notifyMentions(
      content,
      userId,
      actorName,
      "/",
      "community chat"
    ).catch(() => {})

    // Realtime fan-out when Pusher is configured (clients fall back to polling)
    getPusher()?.trigger(`private-chat-${roomId}`, "new-message", dto).catch(() => {})

    return NextResponse.json({ message: dto }, { status: 201 })
  } catch (error) {
    console.error("Failed to create message:", error)
    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 }
    )
  }
}
