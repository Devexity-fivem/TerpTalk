import { NextRequest, NextResponse } from "next/server"
import { after } from "next/server"
import { getToken } from "next-auth/jwt"
import { sessionCookieName } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, forbidden, isSessionValid } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

// GET — my notifications (most recent 50)
export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET, cookieName: sessionCookieName })
    const userId = token?.id as string | undefined
    if (!userId) return unauthorized()
    if (!(await isSessionValid(userId, token?.sessionVersion as number | undefined))) return forbidden()

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
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
        where: { userId, read: false },
      }),
    ])

    return NextResponse.json({ notifications, unreadCount })
  } catch (error) {
    console.error("Notifications fetch error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}

const NOTIFICATION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000

// PATCH — mark notifications read: { ids?: string[] } or { all: true }
export async function PATCH(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET, cookieName: sessionCookieName })
    const userId = token?.id as string | undefined
    if (!userId) return unauthorized()
    if (!(await isSessionValid(userId, token?.sessionVersion as number | undefined))) return forbidden()

    const rl = await rateLimit(`notifications-patch:${userId}`, 60, 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))

    if (body.all === true) {
      await prisma.notification.updateMany({
        where: { userId, read: false },
        data: { read: true },
      })
    } else if (Array.isArray(body.ids)) {
      const ids = body.ids
        .filter((i: unknown) => typeof i === "string" && i.length > 0)
        .slice(0, 100)
      await prisma.notification.updateMany({
        where: { userId, id: { in: ids } },
        data: { read: true },
      })
    } else {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }

    // Purge stale read notifications for this user after the response.
    after(async () => {
      try {
        await prisma.notification.deleteMany({
          where: {
            userId,
            read: true,
            createdAt: { lt: new Date(Date.now() - NOTIFICATION_RETENTION_MS) },
          },
        })
      } catch {
        // non-fatal
      }
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Notifications update error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
