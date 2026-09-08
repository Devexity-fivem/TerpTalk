import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, publicUserSelect, getClientIp, logSecurityEvent, isBanned, forbidden, blockExistsBetween } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

// GET — list conversations, or ?with=<userId> for a thread (marks it read)
export async function GET(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return unauthorized()

  const { searchParams } = new URL(request.url)
  const withId = searchParams.get("with")

  if (withId) {
    // Mark their messages to me as read
    await prisma.directMessage.updateMany({
      where: { senderId: withId, receiverId: session.user.id, read: false, deleted: false },
      data: { read: true },
    })
    const messages = await prisma.directMessage.findMany({
      where: {
        deleted: false,
        OR: [
          { senderId: session.user.id, receiverId: withId },
          { senderId: withId, receiverId: session.user.id },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: 100,
      include: { sender: { select: publicUserSelect } },
    })
    return NextResponse.json({ messages })
  }

  // Conversation list: latest message per partner + unread count
  const msgs = await prisma.directMessage.findMany({
    where: {
      deleted: false,
      OR: [{ senderId: session.user.id }, { receiverId: session.user.id }],
    },
    orderBy: { createdAt: "desc" },
    take: 300,
    include: {
      sender: { select: publicUserSelect },
      receiver: { select: publicUserSelect },
    },
  })

  const convos = new Map<string, { partner: { id: string; name: string | null; role: string; profile: { username: string | null } | null }; lastMessage: string; lastAt: Date; unread: number }>()
  for (const m of msgs) {
    const partner = m.senderId === session.user.id ? m.receiver : m.sender
    if (!convos.has(partner.id)) {
      convos.set(partner.id, {
        partner,
        lastMessage: m.content.slice(0, 80),
        lastAt: m.createdAt,
        unread: 0,
      })
    }
    if (m.receiverId === session.user.id && !m.read) {
      convos.get(partner.id)!.unread++
    }
  }

  return NextResponse.json({ conversations: [...convos.values()] })
}

// POST — send a DM: { to, content }
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()

    const { to, content } = await request.json().catch(() => ({}))
    if (typeof to !== "string" || typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 })
    }
    if (to === session.user.id) {
      return NextResponse.json({ error: "Cannot message yourself" }, { status: 400 })
    }
    if (content.length > 2000) {
      return NextResponse.json({ error: "Message too long" }, { status: 400 })
    }

    const rl = await rateLimit(`dm:${session.user.id}`, 60, 10 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: session.user.id, ip: getClientIp(request), metadata: { endpoint: "messages" },
      })
      return NextResponse.json({ error: "Slow down." }, { status: 429 })
    }
    if (await isBanned(session.user.id)) return forbidden("Your account is suspended")
    if (await blockExistsBetween(session.user.id, to)) {
      return forbidden("You cannot message this user")
    }

    const target = await prisma.user.findUnique({ where: { id: to }, select: { id: true, banned: true } })
    if (!target || target.banned) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const message = await prisma.directMessage.create({
      data: { senderId: session.user.id, receiverId: to, content: content.trim() },
      include: { sender: { select: publicUserSelect } },
    })

    await prisma.notification.create({
      data: {
        userId: to,
        type: "DIRECT_MESSAGE",
        title: "New message",
        content: `${session.user.name || "Someone"} sent you a message`,
        link: `/messages?with=${session.user.id}`,
      },
    }).catch(() => {})

    return NextResponse.json({ message }, { status: 201 })
  } catch (error) {
    console.error("DM error:", error)
    return NextResponse.json({ error: "Failed to send" }, { status: 500 })
  }
}
