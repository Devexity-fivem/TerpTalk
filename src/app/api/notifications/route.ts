import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized } from "@/lib/security"

// GET — my notifications (most recent 50)
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return unauthorized()
  }

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
}

// PATCH — mark notifications read: { ids?: string[] } or { all: true }
export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return unauthorized()
  }

  const body = await request.json().catch(() => ({}))

  if (body.all === true) {
    await prisma.notification.updateMany({
      where: { userId: session.user.id, read: false },
      data: { read: true },
    })
  } else if (Array.isArray(body.ids)) {
    const ids = body.ids.filter((i: unknown) => typeof i === "string").slice(0, 100)
    await prisma.notification.updateMany({
      where: { userId: session.user.id, id: { in: ids } },
      data: { read: true },
    })
  } else {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
