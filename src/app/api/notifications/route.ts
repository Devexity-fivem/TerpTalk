import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, forbidden, isBanned } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

// GET — my notifications (most recent 50)
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()
    if (await isBanned(session.user.id)) return forbidden()

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: session.user.id },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          type: true,
          title: true,
          content: true,
          link: true,
          read: true,
          createdAt: true,
        },
      }),
      prisma.notification.count({
        where: { userId: session.user.id, read: false },
      }),
    ])

    return NextResponse.json({ notifications, unreadCount })
  } catch (error) {
    console.error("Notifications fetch error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}

// PATCH — mark notifications read: { ids?: string[] } or { all: true }
export async function PATCH(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()
    if (await isBanned(session.user.id)) return forbidden()

    const rl = await rateLimit(`notifications:${session.user.id}`, 60, 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))

    if (body.all === true) {
      await prisma.notification.updateMany({
        where: { userId: session.user.id, read: false },
        data: { read: true },
      })
    } else if (Array.isArray(body.ids)) {
      const ids = body.ids
        .filter((i: unknown) => typeof i === "string" && i.length > 0)
        .slice(0, 100)
      await prisma.notification.updateMany({
        where: { userId: session.user.id, id: { in: ids } },
        data: { read: true },
      })
    } else {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Notifications update error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
