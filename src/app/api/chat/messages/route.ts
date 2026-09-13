import { NextRequest, NextResponse, after } from "next/server"
import { getToken } from "next-auth/jwt"
import { sessionCookieName } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, publicUserSelect, LIMITS, getClientIp, logSecurityEvent, isSessionValid, forbidden, isModerator, isStaff, enforceLinkTrust } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { repRateLimit, getTierPerks } from "@/lib/reputation"
import { notifyMentions } from "@/lib/mentions"
import { getPusher } from "@/lib/pusher"
import { postBotMessage, TERPBOT_USERNAME } from "@/lib/terpbot"
import { parseTerpbotIntent, TERPBOT_REFUSAL_TEXT, terpbotFallbackText } from "@/lib/terpbot-intents"
import { runBotCommand } from "@/lib/terpbot-data"
import { recordBotEvent, countEntityLinks } from "@/lib/terpbot-events"
import { getBooleanSetting, SITE_SETTINGS } from "@/lib/settings"
import { checkMaintenance } from "@/lib/maintenance"

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/

type ChatMessageWithAuthor = {
  id: string
  content: string
  createdAt: Date
  deleted: boolean
  author: {
    id?: string | null
    name?: string | null
    image?: string | null
    role?: string | null
    profile?: { username?: string | null } | null
  }
  replyTo: ChatMessageWithAuthor | null
}

function messageDto(m: ChatMessageWithAuthor) {
  const content = m.deleted ? "[deleted]" : m.content
  const replyTo = m.replyTo
    ? {
        id: m.replyTo.id,
        content: m.replyTo.deleted ? "[deleted]" : m.replyTo.content,
        author: {
          id: m.replyTo.author.id,
          name: m.replyTo.author.name,
          username: m.replyTo.author.profile?.username ?? null,
          image: m.replyTo.author.image ?? null,
          role: m.replyTo.author.role ?? null,
        },
      }
    : null
  return {
    id: m.id,
    content,
    createdAt: m.createdAt,
    author: {
      id: m.author.id,
      name: m.author.name,
      username: m.author.profile?.username ?? null,
      image: m.author.image ?? null,
      role: m.author.role ?? null,
    },
    replyTo,
  }
}

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
      cookieName: sessionCookieName,
    })
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
        replyTo: {
          include: { author: { select: publicUserSelect } },
        },
      },
    })

    return NextResponse.json({
      messages: (afterDate ? messages : messages.reverse()).map((m) =>
        messageDto(m as unknown as ChatMessageWithAuthor)
      ),
    })
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
    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
      cookieName: sessionCookieName,
    })
    const userId = token?.id as string | undefined
    if (!token || !userId) return unauthorized()

    if (!(await isSessionValid(userId, token?.sessionVersion as number | undefined))) return forbidden("Your account is suspended")

    if (!(await getBooleanSetting(SITE_SETTINGS.CHAT_ENABLED, true))) {
      return forbidden("Chat is temporarily disabled")
    }

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

    // Rate limit: 30 messages per minute per user (Cultivator+ scale it up)
    const rl = await repRateLimit(userId, `chat:${userId}`, 30, 60 * 1000)
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

    // Validate room exists and get latest room settings
    const room = await prisma.chatRoom.findUnique({
      where: { id: roomId },
    })

    if (!room || room.isPrivate) {
      return NextResponse.json(
        { error: "Room not found" },
        { status: 404 }
      )
    }

    const { replyToId } = body
    if (replyToId && (typeof replyToId !== "string" || !/^[a-z0-9]{25}$/.test(replyToId))) {
      return NextResponse.json({ error: "Invalid reply" }, { status: 400 })
    }
    if (replyToId) {
      const parent = await prisma.chatMessage.findFirst({
        where: { id: replyToId, roomId, deleted: false },
      })
      if (!parent) {
        return NextResponse.json({ error: "Reply not found" }, { status: 404 })
      }
    }

    const [user, lastMessage] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
      prisma.chatMessage.findFirst({
        where: { roomId, authorId: userId, deleted: false },
        orderBy: { createdAt: "desc" },
      }),
    ])
    if (!user) return forbidden()
    const staff = isStaff(user.role)

    if (room.locked && !staff) {
      return forbidden("Chat is locked")
    }

    // Master Grower+ (and staff) are exempt from room slowmode.
    const slowmodeExempt = staff || (await getTierPerks(userId)).slowmodeExempt === true
    if (
      room.slowModeSeconds > 0 &&
      !slowmodeExempt &&
      lastMessage &&
      Date.now() - lastMessage.createdAt.getTime() < room.slowModeSeconds * 1000
    ) {
      return NextResponse.json(
        { error: `Slow mode: wait ${room.slowModeSeconds}s between messages` },
        { status: 429 }
      )
    }

    const linkBlock = await enforceLinkTrust(content, userId, request, "chat/messages")
    if (linkBlock) return linkBlock

    // Create message
    const message = await prisma.chatMessage.create({
      data: {
        content,
        roomId,
        authorId: userId,
        ...(replyToId ? { replyToId } : {}),
      },
      include: {
        author: { select: publicUserSelect },
        replyTo: {
          include: { author: { select: publicUserSelect } },
        },
      },
    })

    const dto = messageDto(message as unknown as ChatMessageWithAuthor)

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

    // TerpBot answers direct pings through the deterministic intent parser.
    // At most one bot reply per room per minute so it can't be spammed into
    // flooding; only "mention"-surface public commands are reachable this
    // way — staff/moderation vocabulary short-circuits to a refusal before
    // any matcher runs. The reply threads under the pinging message.
    if (/@terpbot\b/i.test(content)) {
      const lastBot = await prisma.chatMessage.findFirst({
        where: { roomId, author: { profile: { username: TERPBOT_USERNAME } }, deleted: false },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      })
      if (!lastBot || Date.now() - lastBot.createdAt.getTime() > 60 * 1000) {
        const intent = parseTerpbotIntent(content)
        const respond = async () => {
          if (intent.kind === "refusal") {
            const dto = await postBotMessage(roomId, TERPBOT_REFUSAL_TEXT, message.id)
            if (dto) await recordBotEvent({ type: "MENTION_REFUSAL", key: `mention:${message.id}`, userId })
          } else if (intent.kind === "fallback") {
            const dto = await postBotMessage(roomId, terpbotFallbackText(content), message.id)
            if (dto) await recordBotEvent({ type: "MENTION_FALLBACK", key: `mention:${message.id}`, userId })
          } else if (intent.kind === "help") {
            const dto = await postBotMessage(
              roomId,
              `🤖 You pinged me! Ask things like "my rep", "summarize this", "did anyone answer this?", "find threads about …" — or /help for every command.`,
              message.id
            )
            if (dto) await recordBotEvent({ type: "MENTION_HELP", key: `mention:${message.id}`, userId })
          } else {
            const result = await runBotCommand(intent.name, {
              userId,
              role: user.role,
              displayName: actorName,
              args: intent.args,
              rest: intent.args.join(" "),
              roomId,
              rawContent: content,
              replyToContent: message.replyTo?.deleted ? undefined : message.replyTo?.content,
            })
            const texts = result.ok ? result.messages : [`🤖 ${result.error}`]
            let first = true
            let posted = false
            for (const text of texts.slice(0, 2)) {
              const dto = await postBotMessage(roomId, text, first ? message.id : undefined)
              posted = posted || !!dto
              first = false
            }
            if (result.ok && posted) {
              await recordBotEvent({
                type: "COMMAND_MENTION",
                key: `mention:${message.id}`,
                userId,
                command: intent.name,
                entities: countEntityLinks(texts),
              })
            }
          }
        }
        after(() => respond().catch((e) => console.error("[terpbot] mention reply failed:", e)))
      }
    }

    return NextResponse.json({ message: dto }, { status: 201 })
  } catch (error) {
    console.error("Failed to create message:", error)
    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 }
    )
  }
}
