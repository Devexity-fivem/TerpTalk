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
} from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { checkMaintenance } from "@/lib/maintenance"
import { getPusher } from "@/lib/pusher"

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
    const admin = isAdmin(user.role)
    const displayName = user.profile?.username || user.name || "Staff"

    const resolveTarget = async (raw?: string) => {
      if (!raw) return null
      const username = raw.replace(/^@/, "")
      if (!username) return null
      const target = await prisma.user.findFirst({
        where: { profile: { username } },
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
            data: { suspendedUntil: new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000) },
          })
        } else if (actionType === "PERMANENT_BAN") {
          await tx.user.update({
            where: { id: targetUserId },
            data: { banned: true, suspendedUntil: null },
          })
        } else if (actionType === "UNBAN") {
          await tx.user.update({
            where: { id: targetUserId },
            data: { banned: false, suspendedUntil: null, bannedReason: null },
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
        return NextResponse.json({
          ok: true,
          message: [...base, ...staffCmds, ...modCmds, ...adminCmds].join("\n"),
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
        return NextResponse.json({ ok: true, message: `Warned @${target.profile?.username || target.name}` })
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
        return NextResponse.json({ ok: true, message: `Muted @${target.profile?.username || target.name} for ${days} day(s)` })
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
        return NextResponse.json({ ok: true, message: `Banned @${target.profile?.username || target.name}` })
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
        return NextResponse.json({ ok: true, message: `Unbanned @${target.profile?.username || target.name}` })
      }

      default:
        return NextResponse.json({ error: "Unknown command" }, { status: 400 })
    }
  } catch (error) {
    console.error("Chat command error:", error)
    return NextResponse.json({ error: "Command failed" }, { status: 500 })
  }
}
