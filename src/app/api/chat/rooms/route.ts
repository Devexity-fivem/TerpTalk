import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { prisma } from "@/lib/prisma"
import { sessionCookieName } from "@/lib/auth"
import { unauthorized, forbidden, isSessionValid, getClientIp, hashIp } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

// Get chat rooms
export async function GET(request: NextRequest) {
  try {
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
      cookieName: sessionCookieName,
    })
    const userId = token?.id as string | undefined
    if (!userId) return unauthorized()

    if (!(await isSessionValid(userId, token?.sessionVersion as number | undefined))) return forbidden()

    const ip = getClientIp(request)
    const rl = await rateLimit(`chat-rooms:${hashIp(ip)}`, 60, 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    // Ensure a default public room exists so users always have somewhere to chat
    await prisma.chatRoom.upsert({
      where: { slug: "general" },
      update: {},
      create: {
        name: "General Chat",
        slug: "general",
        description: "Community live chat",
        isPrivate: false,
        order: 1,
      },
    })

    const [rooms, onlineCount] = await Promise.all([
      prisma.chatRoom.findMany({
        where: { isPrivate: false },
        orderBy: { order: "asc" },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          slowModeSeconds: true,
          locked: true,
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
