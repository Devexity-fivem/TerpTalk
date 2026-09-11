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
  isAdmin,
  getClientIp,
  hashIp,
  publicUserSelect,
  LIMITS,
  USERNAME_REGEX,
} from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { checkMaintenance } from "@/lib/maintenance"
import { getPusher } from "@/lib/pusher"

type ChatMessageWithAuthor = {
  id: string
  content: string
  createdAt: Date
  author: {
    id: string
    name: string | null
    image: string | null
    role: string | null
    profile: { username: string | null } | null
  }
}

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

    const body = await request.json().catch(() => ({}))
    const { roomId, content } = body

    if (typeof roomId !== "string" || !roomId || typeof content !== "string" || !content.trim() || !content.startsWith("/")) {
      return NextResponse.json({ error: "Invalid command" }, { status: 400 })
    }
    if (content.length > LIMITS.CHAT_MESSAGE_MAX) {
      return NextResponse.json({ error: "Command too long" }, { status: 400 })
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

    const userRl = await rateLimit(`chat-commands-user:${userId}`, 30, 60 * 1000)
    const ipRl = await rateLimit(`chat-commands:${hashIp(getClientIp(request))}`, 30, 60 * 1000)
    if (!userRl.allowed || !ipRl.allowed) {
      return NextResponse.json({ error: "Too many commands" }, { status: 429 })
    }

    const staff = isStaff(user.role)
    const moderator = isModerator(user.role)
    const admin = isAdmin(user.role)
    const displayName = user.profile?.username || user.name || "Staff"

    const getOrCreateBot = async () => {
      const existing = await prisma.user.findFirst({
        where: { profile: { username: "terpbot" } },
        select: { id: true },
      })
      if (existing) return existing
      const created = await prisma.user.create({
        data: {
          name: "TerpBot",
          ageVerified: true,
          status: "ONLINE",
          profile: { create: { username: "terpbot" } },
        },
        select: { id: true },
      })
      return created
    }

    const toChatDto = (message: ChatMessageWithAuthor) => {
      const author = message.author as unknown as {
        id: string
        name: string | null
        image: string | null
        role: string | null
        profile: { username: string | null } | null
      }
      return {
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
    }

    const postBot = async (text: string) => {
      const bot = await getOrCreateBot()
      const message = await prisma.chatMessage.create({
        data: { roomId, authorId: bot.id, content: text },
        include: { author: { select: publicUserSelect } },
      })
      const dto = toChatDto(message)
      getPusher()?.trigger(`private-chat-${roomId}`, "new-message", dto).catch(() => {})
      return dto
    }

    const resolveTarget = async (raw?: string) => {
      if (!raw) return null
      const username = raw.replace(/^@/, "")
      if (!username || username.length < LIMITS.USERNAME_MIN || username.length > LIMITS.USERNAME_MAX || !USERNAME_REGEX.test(username)) {
        return null
      }
      const target = await prisma.user.findFirst({
        where: { profile: { username: { equals: username, mode: "insensitive" } } },
        select: { id: true, role: true, name: true, banned: true, suspendedUntil: true, profile: { select: { username: true } } },
      })
      return target
    }

    const applyModeration = async (
      actionType: "WARNING" | "TEMPORARY_BAN" | "PERMANENT_BAN" | "UNBAN",
      targetUserId: string,
      reason: string,
      durationDays?: number
    ) => {
      await prisma.$transaction(async (tx) => {
        const target = await tx.user.findUnique({
          where: { id: targetUserId },
          select: { role: true },
        })
        if (!target) throw new Error("USER_NOT_FOUND")
        if (target.role === "ADMINISTRATOR") throw new Error("FORBIDDEN")
        if (target.role === "MODERATOR" && !admin) throw new Error("FORBIDDEN")

        if (actionType === "TEMPORARY_BAN" && typeof durationDays === "number" && durationDays > 0) {
          await tx.user.update({
            where: { id: targetUserId },
            data: { suspendedUntil: new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000), sessionVersion: { increment: 1 } },
          })
        } else if (actionType === "PERMANENT_BAN") {
          await tx.user.update({
            where: { id: targetUserId },
            data: { banned: true, suspendedUntil: null, sessionVersion: { increment: 1 } },
          })
        } else if (actionType === "UNBAN") {
          await tx.user.update({
            where: { id: targetUserId },
            data: { banned: false, suspendedUntil: null, bannedReason: null, sessionVersion: { increment: 1 } },
          })
        }

        await tx.moderationAction.create({
          data: {
            type: actionType,
            reason: reason.trim().slice(0, 500),
            targetUserId,
            moderatorId: userId,
            duration: typeof durationDays === "number" ? durationDays : null,
          },
        })

        await tx.notification.create({
          data: {
            type: "MODERATOR_ANNOUNCEMENT",
            userId: targetUserId,
            title: `Moderation action: ${actionType.replace(/_/g, " ").toLowerCase()}`,
            content: `A moderator took action on your account or content. Reason: ${reason.trim().slice(0, 200)}`,
          },
        }).catch(() => {})
      })
    }

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
        const modCmds = moderator
          ? [
              "/clear - soft-delete all messages",
              "/announce <message> - post a system-style message",
              "/warn <@user> <reason> - warn a user",
            ]
          : []
        const adminCmds = admin
          ? [
              "/mute <@user> <days> <reason> - temporarily suspend a user",
              "/ban <@user> <reason> - permanently ban a user",
              "/unban <@user> - lift a permanent ban",
            ]
          : []
        const helpText = [
          "Available commands:",
          ...base,
          ...staffCmds,
          ...modCmds,
          ...adminCmds,
        ].join("\n")
        const dto = await postBot(helpText)
        return NextResponse.json({ ok: true, message: dto })
      }

      case "me": {
        if (!rest) {
          return NextResponse.json({ error: "Usage: /me <action>" }, { status: 400 })
        }
        if (room.locked && !staff) {
          return forbidden("Chat is locked")
        }
        if (room.slowModeSeconds > 0 && !staff) {
          const last = await prisma.chatMessage.findFirst({
            where: { roomId, authorId: userId, deleted: false },
            orderBy: { createdAt: "desc" },
          })
          if (last && Date.now() - last.createdAt.getTime() < room.slowModeSeconds * 1000) {
            return NextResponse.json({ error: `Slow mode: wait ${room.slowModeSeconds}s` }, { status: 429 })
          }
        }
        const message = await prisma.chatMessage.create({
          data: {
            roomId,
            authorId: userId,
            content: `*${displayName} ${rest}*`,
          },
          include: { author: { select: publicUserSelect } },
        })
        const dto = toChatDto(message)
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
        const bot = await postBot(`Slow mode set to ${seconds} second(s) by @${displayName}`)
        return NextResponse.json({ ok: true, room: { slowModeSeconds: updated.slowModeSeconds }, message: bot })
      }

      case "lock": {
        if (!staff) return forbidden()
        const updated = await prisma.chatRoom.update({
          where: { id: roomId },
          data: { locked: true },
        })
        const bot = await postBot(`Chat locked by @${displayName}`)
        return NextResponse.json({ ok: true, room: { locked: updated.locked }, message: bot })
      }

      case "unlock": {
        if (!staff) return forbidden()
        const updated = await prisma.chatRoom.update({
          where: { id: roomId },
          data: { locked: false },
        })
        const bot = await postBot(`Chat unlocked by @${displayName}`)
        return NextResponse.json({ ok: true, room: { locked: updated.locked }, message: bot })
      }

      case "clear": {
        if (!moderator) return forbidden()
        const where = admin
          ? { roomId, deleted: false }
          : { roomId, deleted: false, author: { role: { in: ["MEMBER", "VERIFIED_MEMBER"] } } }
        const result = await prisma.chatMessage.updateMany({
          where,
          data: { deleted: true },
        })
        const bot = await postBot(`Cleared ${result.count} message(s) by @${displayName}`)
        return NextResponse.json({ ok: true, cleared: result.count, message: bot })
      }

      case "announce": {
        if (!staff) return forbidden()
        if (!rest) {
          return NextResponse.json({ error: "Usage: /announce <message>" }, { status: 400 })
        }
        const dto = await postBot(`📢 ${rest}`)
        return NextResponse.json({ ok: true, message: dto })
      }

      case "warn": {
        if (!moderator) return forbidden()
        const targetUsername = args[0]
        const reason = args.slice(1).join(" ")
        if (!targetUsername || !reason) {
          return NextResponse.json({ error: "Usage: /warn <@user> <reason>" }, { status: 400 })
        }
        const target = await resolveTarget(targetUsername)
        if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 })
        await applyModeration("WARNING", target.id, reason)
        const bot = await postBot(`Warned @${target.profile?.username || target.name} by @${displayName}: ${reason}`)
        return NextResponse.json({ ok: true, message: bot })
      }

      case "mute": {
        if (!admin) return forbidden()
        const targetUsername = args[0]
        const days = parseInt(args[1] || "1", 10)
        const reason = args.slice(2).join(" ") || "Chat moderation"
        if (!targetUsername || Number.isNaN(days) || days <= 0 || days > 365) {
          return NextResponse.json({ error: "Usage: /mute <@user> <days> [reason]" }, { status: 400 })
        }
        const target = await resolveTarget(targetUsername)
        if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 })
        await applyModeration("TEMPORARY_BAN", target.id, reason, days)
        const bot = await postBot(`Muted @${target.profile?.username || target.name} for ${days} day(s) by @${displayName}: ${reason}`)
        return NextResponse.json({ ok: true, message: bot })
      }

      case "ban": {
        if (!admin) return forbidden()
        const targetUsername = args[0]
        const reason = args.slice(1).join(" ") || "Chat moderation"
        if (!targetUsername) {
          return NextResponse.json({ error: "Usage: /ban <@user> <reason>" }, { status: 400 })
        }
        const target = await resolveTarget(targetUsername)
        if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 })
        await applyModeration("PERMANENT_BAN", target.id, reason)
        const bot = await postBot(`Banned @${target.profile?.username || target.name} by @${displayName}: ${reason}`)
        return NextResponse.json({ ok: true, message: bot })
      }

      case "unban": {
        if (!admin) return forbidden()
        const targetUsername = args[0]
        if (!targetUsername) {
          return NextResponse.json({ error: "Usage: /unban <@user>" }, { status: 400 })
        }
        const target = await resolveTarget(targetUsername)
        if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 })
        await applyModeration("UNBAN", target.id, "Chat unban")
        const bot = await postBot(`Unbanned @${target.profile?.username || target.name} by @${displayName}`)
        return NextResponse.json({ ok: true, message: bot })
      }

      default:
        return NextResponse.json({ error: "Unknown command" }, { status: 400 })
    }
  } catch (error) {
    console.error("Chat command error:", error)
    return NextResponse.json({ error: "Command failed" }, { status: 500 })
  }
}
