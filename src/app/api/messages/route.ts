import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { sessionCookieName } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, publicUserSelect, getClientIp, logSecurityEvent, isSessionValid, forbidden, blockExistsBetween, hashIp, enforceLinkTrust } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { checkMaintenance } from "@/lib/maintenance"
import { notify } from "@/lib/notify"

function senderDto(user: { id?: string; name?: string | null; image?: string | null; profile?: { username?: string | null } | null }) {
  return {
    name: user.name ?? user.profile?.username ?? "Unknown",
    username: user.profile?.username ?? null,
    image: user.image ?? null,
  }
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/

// GET — list conversations, or ?with=<userId> for a thread (marks it read)
export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET, cookieName: sessionCookieName })
    const userId = token?.id as string | undefined
    if (!userId) return unauthorized()
    if (!(await isSessionValid(userId, token?.sessionVersion as number | undefined))) return forbidden()

    const ip = getClientIp(request)
    const rl = await rateLimit(`messages-read:${userId}:${hashIp(ip)}`, 120, 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const { searchParams } = new URL(request.url)
    const withId = searchParams.get("with")
    const after = searchParams.get("after") // ISO timestamp for incremental polling

    if (withId) {
      // Incremental mode: only fetch messages newer than `after` — the
      // poll then transfers near-empty payloads instead of the whole thread
      if (after && ISO_RE.test(after)) {
        const afterDate = new Date(after)
        if (isNaN(afterDate.getTime())) {
          return NextResponse.json({ error: "Invalid after timestamp" }, { status: 400 })
        }
        const fresh = await prisma.directMessage.findMany({
          where: {
            deleted: false,
            createdAt: { gt: afterDate },
            OR: [
              { senderId: userId, receiverId: withId },
              { senderId: withId, receiverId: userId },
            ],
          },
          orderBy: { createdAt: "asc" },
          take: 50,
          include: { sender: { select: publicUserSelect } },
        })
        // Still mark incoming as read
        if (fresh.some((m) => m.senderId === withId && !m.read)) {
          await prisma.directMessage.updateMany({
            where: { senderId: withId, receiverId: userId, read: false, deleted: false },
            data: { read: true },
          })
        }
        return NextResponse.json({
          messages: fresh.map((m) => ({
            id: m.id,
            content: m.content,
            createdAt: m.createdAt,
            sender: senderDto(m.sender),
          })),
          incremental: true,
        })
      }

      const messages = await prisma.directMessage.findMany({
        where: {
          deleted: false,
          OR: [
            { senderId: userId, receiverId: withId },
            { senderId: withId, receiverId: userId },
          ],
        },
        orderBy: { createdAt: "asc" },
        take: 100,
        include: { sender: { select: publicUserSelect } },
      })

      // Only write when there are actually unread messages from the other user.
      if (messages.some((m) => m.senderId === withId && !m.read)) {
        await prisma.directMessage.updateMany({
          where: { senderId: withId, receiverId: userId, read: false, deleted: false },
          data: { read: true },
        })
      }

      return NextResponse.json({
        messages: messages.map((m) => ({
          id: m.id,
          content: m.content,
          createdAt: m.createdAt,
          sender: senderDto(m.sender),
        })),
      })
    }

    // Conversation list: latest message per partner + unread count
    const msgs = await prisma.directMessage.findMany({
      where: {
        deleted: false,
        OR: [{ senderId: userId }, { receiverId: userId }],
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        sender: { select: publicUserSelect },
        receiver: { select: publicUserSelect },
      },
    })

    const convos = new Map<string, { partnerName: string | null; partnerUsername: string | null; partnerImage: string | null; lastMessage: string; lastAt: Date; unread: number }>()
    for (const m of msgs) {
      const partner = m.senderId === userId ? m.receiver : m.sender
      const partnerId = partner.id
      if (!convos.has(partnerId)) {
        convos.set(partnerId, {
          partnerName: partner.name ?? partner.profile?.username ?? "Unknown",
          partnerUsername: partner.profile?.username ?? null,
          partnerImage: partner.image ?? null,
          lastMessage: m.content.slice(0, 80),
          lastAt: m.createdAt,
          unread: 0,
        })
      }
      if (m.receiverId === userId && !m.read) {
        convos.get(partnerId)!.unread++
      }
    }

    return NextResponse.json({ conversations: [...convos.values()] })
  } catch (error) {
    console.error("Messages fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 })
  }
}

// POST — send a DM: { to, content }
export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET, cookieName: sessionCookieName })
    const userId = token?.id as string | undefined
    if (!token || !userId) return unauthorized()

    if (!(await isSessionValid(userId, token?.sessionVersion as number | undefined))) return forbidden()

    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

    const { to, content } = await request.json().catch(() => ({}))
    if (typeof to !== "string" || typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 })
    }
    if (to === userId) {
      return NextResponse.json({ error: "Cannot message yourself" }, { status: 400 })
    }
    if (content.length > 2000) {
      return NextResponse.json({ error: "Message too long" }, { status: 400 })
    }

    const rl = await rateLimit(`dm:${userId}`, 60, 10 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId, ip: getClientIp(request), metadata: { endpoint: "messages" },
      })
      return NextResponse.json({ error: "Slow down." }, { status: 429 })
    }
    if (!(await isSessionValid(userId, token?.sessionVersion as number | undefined))) return forbidden("Your account is suspended")
    if (await blockExistsBetween(userId, to)) {
      return forbidden("You cannot message this user")
    }

    const linkBlock = await enforceLinkTrust(content, userId, request, "messages")
    if (linkBlock) return linkBlock

    const target = await prisma.user.findUnique({
      where: { id: to },
      select: { id: true, banned: true, profile: { select: { notifyOnMessage: true } } },
    })
    if (!target || target.banned) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const message = await prisma.directMessage.create({
      data: { senderId: userId, receiverId: to, content: content.trim() },
      include: { sender: { select: publicUserSelect } },
    })

    await notify({
      userId: to,
      type: "DIRECT_MESSAGE",
      title: "New message",
      content: `@${((token as { name?: string | null }).name) ?? "Someone"} sent you a message`,
      link: `/messages?with=${userId}`,
      actorId: userId,
      groupKey: `DM:${userId}:${to}`,
      dedupeMs: 10 * 60 * 1000,
    })

    return NextResponse.json({
      message: {
        id: message.id,
        content: message.content,
        createdAt: message.createdAt,
        sender: senderDto(message.sender),
      },
    }, { status: 201 })
  } catch (error) {
    console.error("DM error:", error)
    return NextResponse.json({ error: "Failed to send" }, { status: 500 })
  }
}
