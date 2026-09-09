import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getPusher } from "@/lib/pusher"
import { unauthorized, forbidden, isBanned, isModerator } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

// Pusher channel authorization — private chat channels require a session and room access.
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()

    if (await isBanned(session.user.id)) return forbidden()

    const rl = await rateLimit(`pusher-auth:${session.user.id}`, 60, 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const pusher = getPusher()
    if (!pusher) return forbidden()

    const form = await request.formData().catch(() => null)
    const socketId = form?.get("socket_id")
    const channel = form?.get("channel_name")
    if (typeof socketId !== "string" || typeof channel !== "string") {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }

    // Only allow our private chat channels
    const match = channel.match(/^private-chat-([A-Za-z0-9_-]{1,64})$/)
    if (!match) return forbidden()
    const roomId = match[1]

    const room = await prisma.chatRoom.findUnique({ where: { id: roomId }, select: { isPrivate: true } })
    if (!room) return forbidden()

    if (room.isPrivate) {
      const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
      if (!isModerator(user?.role)) return forbidden("Private room")
    }

    const auth = pusher.authorizeChannel(socketId, channel)
    return NextResponse.json(auth)
  } catch (error) {
    console.error("Pusher auth error:", error)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
}
