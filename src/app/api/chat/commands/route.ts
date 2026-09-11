import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { sessionCookieName } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import {
  unauthorized,
  isSessionValid,
  forbidden,
  isStaff,
  isModerator,
  getClientIp,
  hashIp,
} from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { checkMaintenance } from "@/lib/maintenance"
import { getPusher } from "@/lib/pusher"
import { publicUserSelect } from "@/lib/security"

const MAX_SLOW = 300

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

    if (!(await isSessionValid(userId, token?.sessionVersion as number | undefined))) {
      return forbidden("Your account is suspended")
    }

    const rl = await rateLimit(`chat-commands:${hashIp(getClientIp(request))}`, 30, 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many commands" }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))
    const { roomId, content } = body

    if (typeof roomId !== "string" || !roomId || typeof content !== "string" || !content.trim() || !content.startsWith("/")) {
      return NextResponse.json({ error: "Invalid command" }, { status: 400 })
    }

    const room = await prisma.chatRoom.findUnique({ where: { id: roomId } })
    if (!room || room.isPrivate) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 })
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, name: true, profile: { select: { username: true } } },
    })
    if (!user) return forbidden()

    const staff = isStaff(user.role)
    const moderator = isModerator(user.role)
    const displayName = user.profile?.username || user.name || "Staff"

    const text = content.trim().slice(1)
    const [command, ...args] = text.split(/\s+/)
    const rest = args.join(" ")

    switch (command.toLowerCase()) {
      case "help": {
        const base = [
          "/help - show this list",
          "/me <action> - roleplay a third-person action",
        ]
        const staffCmds = staff
          ? ["/slowmode <0-300> - set seconds between messages", "/lock - prevent non-staff from posting", "/unlock - re-enable posting"]
          : []
        const modCmds = moderator ? ["/clear - soft-delete all messages", "/announce <message> - post a system-style message"] : []
        return NextResponse.json({
          ok: true,
          message: [...base, ...staffCmds, ...modCmds].join("\n"),
        })
      }

      case "me": {
        if (!rest) {
          return NextResponse.json({ error: "Usage: /me <action>" }, { status: 400 })
        }
        const message = await prisma.chatMessage.create({
          data: {
            roomId,
            authorId: userId,
            content: `*${displayName} ${rest}*`,
          },
          include: { author: { select: publicUserSelect } },
        })
        const author = message.author as unknown as { id: string; name: string | null; image: string | null; role: string | null; profile: { username: string | null } | null }
        const dto = {
          id: message.id,
          content: message.content,
          createdAt: message.createdAt,
          author: {
            id: author.id,
            name: author.name,
            username: author.profile?.username ?? null,
            image: author.image ?? null,
            role: author.role ?? null,
          },
          replyTo: null,
        }
        getPusher()?.trigger(`private-chat-${roomId}`, "new-message", dto).catch(() => {})
        return NextResponse.json({ ok: true, message: dto })
      }

      case "slowmode": {
        if (!staff) return forbidden()
        const seconds = args[0] !== undefined ? parseInt(args[0], 10) : NaN
        if (Number.isNaN(seconds) || seconds < 0 || seconds > MAX_SLOW) {
          return NextResponse.json({ error: "Slow mode must be 0-300 seconds" }, { status: 400 })
        }
        const updated = await prisma.chatRoom.update({
          where: { id: roomId },
          data: { slowModeSeconds: seconds },
        })
        return NextResponse.json({ ok: true, room: { slowModeSeconds: updated.slowModeSeconds } })
      }

      case "lock": {
        if (!staff) return forbidden()
        const updated = await prisma.chatRoom.update({
          where: { id: roomId },
          data: { locked: true },
        })
        return NextResponse.json({ ok: true, room: { locked: updated.locked } })
      }

      case "unlock": {
        if (!staff) return forbidden()
        const updated = await prisma.chatRoom.update({
          where: { id: roomId },
          data: { locked: false },
        })
        return NextResponse.json({ ok: true, room: { locked: updated.locked } })
      }

      case "clear": {
        if (!moderator) return forbidden()
        const result = await prisma.chatMessage.updateMany({
          where: { roomId, deleted: false },
          data: { deleted: true },
        })
        return NextResponse.json({ ok: true, cleared: result.count })
      }

      case "announce": {
        if (!staff) return forbidden()
        if (!rest) {
          return NextResponse.json({ error: "Usage: /announce <message>" }, { status: 400 })
        }
        const message = await prisma.chatMessage.create({
          data: {
            roomId,
            authorId: userId,
            content: `📢 ${rest}`,
          },
          include: { author: { select: publicUserSelect } },
        })
        const author = message.author as unknown as { id: string; name: string | null; image: string | null; role: string | null; profile: { username: string | null } | null }
        const dto = {
          id: message.id,
          content: message.content,
          createdAt: message.createdAt,
          author: {
            id: author.id,
            name: author.name,
            username: author.profile?.username ?? null,
            image: author.image ?? null,
            role: author.role ?? null,
          },
          replyTo: null,
        }
        getPusher()?.trigger(`private-chat-${roomId}`, "new-message", dto).catch(() => {})
        return NextResponse.json({ ok: true, message: dto })
      }

      default:
        return NextResponse.json({ error: "Unknown command" }, { status: 400 })
    }
  } catch (error) {
    console.error("Chat command error:", error)
    return NextResponse.json({ error: "Command failed" }, { status: 500 })
  }
}
