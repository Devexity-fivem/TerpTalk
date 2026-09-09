import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, forbidden, isBanned, getClientIp, hashIp } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

// Get chat rooms
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return unauthorized()
    }

    if (await isBanned(session.user.id)) return forbidden()

    const ip = getClientIp(request)
    const rl = await rateLimit(`chat-rooms:${hashIp(ip)}`, 60, 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const [rooms, onlineCount] = await Promise.all([
      prisma.chatRoom.findMany({
        where: { isPrivate: false },
        orderBy: { order: "asc" },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          _count: {
            select: { messages: true },
          },
        },
      }),
      prisma.user.count({
        where: {
          lastSeenAt: { gte: new Date(Date.now() - 15 * 60 * 1000) },
        },
      }),
    ])

    return NextResponse.json({ rooms, onlineCount })
  } catch (error) {
    console.error("Failed to fetch chat rooms:", error)
    return NextResponse.json(
      { error: "Failed to load chat rooms" },
      { status: 500 }
    )
  }
}
