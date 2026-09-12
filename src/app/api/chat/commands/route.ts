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
  enforceLinkTrust,
} from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { checkMaintenance } from "@/lib/maintenance"
import { getBooleanSetting, SITE_SETTINGS } from "@/lib/settings"
import { getPusher } from "@/lib/pusher"
import { postBotMessage, randomGrowTip, TERPBOT_USERNAME } from "@/lib/terpbot"
import { emitNotificationPush } from "@/lib/notify"
import { currentWeekKey } from "@/lib/week"

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

    // Non-staff commands summon the bot into the room — they must respect the
    // same chat protections as normal messages (disabled chat, locked rooms,
    // slow mode). Staff commands stay usable since they're moderation tools.
    if (!staff) {
      if (!(await getBooleanSetting(SITE_SETTINGS.CHAT_ENABLED, true))) {
        return forbidden("Chat is temporarily disabled")
      }
      if (room.locked) return forbidden("Chat is locked")
      if (room.slowModeSeconds > 0) {
        const slowRl = await rateLimit(`chat-cmd-slow:${userId}:${roomId}`, 1, room.slowModeSeconds * 1000)
        if (!slowRl.allowed) {
          return NextResponse.json({ error: `Slow mode: wait ${room.slowModeSeconds}s` }, { status: 429 })
        }
      }
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

    const postBot = (text: string) => postBotMessage(roomId, text)

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
      // The bot is never a valid moderation target.
      if (target?.profile?.username === TERPBOT_USERNAME) return null
      return target
    }

    const applyModeration = async (
      actionType: "WARNING" | "TEMPORARY_BAN" | "PERMANENT_BAN" | "UNBAN",
      targetUserId: string,
      reason: string,
      durationDays?: number
    ) => {
      let createdNotification: Awaited<ReturnType<typeof prisma.notification.create>> | null = null
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

        // Intentionally anonymous — never name the acting moderator.
        createdNotification = await tx.notification.create({
          data: {
            type: "MODERATOR_ANNOUNCEMENT",
            userId: targetUserId,
            title: `Moderation action: ${actionType.replace(/_/g, " ").toLowerCase()}`,
            content: `A moderator took action on your account or content. Reason: ${reason.trim().slice(0, 200)}`,
          },
        }).catch(() => null)
      })

      if (createdNotification) {
        emitNotificationPush(targetUserId, createdNotification)
      }
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
          "/tip - grow tip",
          "/stats - community stats",
          "/top - top growers by rep",
          "/strain <name> - look up a strain",
          "/guide <search> - find a grow guide",
          "/ask <question> - search strains + guides",
          "/contest - this week's contest status",
          "/rules - community rules",
          "/flip - flip a coin",
          "/roll [sides] - roll a die",
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
        const linkBlock = await enforceLinkTrust(rest, userId, request, "chat/commands:/me")
        if (linkBlock) return linkBlock
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

      case "tip": {
        const bot = await postBot(`💡 Grow tip: ${randomGrowTip()}`)
        return NextResponse.json({ ok: true, message: bot })
      }

      case "stats": {
        const [members, threads, posts, diaries, strains] = await Promise.all([
          prisma.user.count({ where: { banned: false } }),
          prisma.thread.count({ where: { deleted: false } }),
          prisma.post.count({ where: { deleted: false, thread: { deleted: false } } }),
          prisma.growDiary.count({ where: { deleted: false } }),
          prisma.strain.count(),
        ])
        const bot = await postBot(
          `📊 TerpTalk stats — ${members} members · ${threads} threads · ${posts} posts · ${diaries} grow diaries · ${strains} strains`
        )
        return NextResponse.json({ ok: true, message: bot })
      }

      case "top":
      case "leaderboard": {
        const top = await prisma.profile.findMany({
          where: { user: { banned: false }, username: { not: TERPBOT_USERNAME } },
          orderBy: { reputation: "desc" },
          take: 5,
          select: { username: true, reputation: true },
        })
        const lines = top.map((p, i) => `${i + 1}. @${p.username} — ${p.reputation} rep`)
        const bot = await postBot(`🏆 Top growers:\n${lines.join("\n")}\nFull board: /leaderboard`)
        return NextResponse.json({ ok: true, message: bot })
      }

      case "strain": {
        if (!rest) {
          return NextResponse.json({ error: "Usage: /strain <name>" }, { status: 400 })
        }
        const strain = await prisma.strain.findFirst({
          where: { name: { contains: rest, mode: "insensitive" } },
          orderBy: { name: "asc" },
        })
        const bot = strain
          ? await postBot(
              [
                `🌿 ${strain.name}${strain.type ? ` (${strain.type})` : ""}`,
                strain.genetics ? `Genetics: ${strain.genetics}` : null,
                strain.breeder ? `Breeder: ${strain.breeder}` : null,
                `Details: /strains/${strain.id}`,
              ]
                .filter(Boolean)
                .join("\n")
            )
          : await postBot(`No strain matching "${rest}" in the library — browse /strains or add it yourself!`)
        return NextResponse.json({ ok: true, message: bot })
      }

      case "guide": {
        if (!rest) {
          return NextResponse.json({ error: "Usage: /guide <search>" }, { status: 400 })
        }
        const guides = await prisma.guide.findMany({
          where: {
            published: true,
            OR: [
              { title: { contains: rest, mode: "insensitive" } },
              { excerpt: { contains: rest, mode: "insensitive" } },
              { topic: { contains: rest, mode: "insensitive" } },
            ],
          },
          take: 3,
          select: { title: true, slug: true },
        })
        const bot = guides.length
          ? await postBot(
              `📚 Guides matching "${rest}":\n${guides.map((g) => `- ${g.title} → /guides/${g.slug}`).join("\n")}`
            )
          : await postBot(`No guides matching "${rest}" — browse /guides`)
        return NextResponse.json({ ok: true, message: bot })
      }

      case "ask": {
        if (!rest) {
          return NextResponse.json({ error: "Usage: /ask <question>" }, { status: 400 })
        }
        const [guides, strains] = await Promise.all([
          prisma.guide.findMany({
            where: {
              published: true,
              OR: [
                { title: { contains: rest, mode: "insensitive" } },
                { excerpt: { contains: rest, mode: "insensitive" } },
                { content: { contains: rest, mode: "insensitive" } },
              ],
            },
            take: 2,
            select: { title: true, slug: true },
          }),
          prisma.strain.findMany({
            where: {
              OR: [
                { name: { contains: rest, mode: "insensitive" } },
                { description: { contains: rest, mode: "insensitive" } },
                { growingInfo: { contains: rest, mode: "insensitive" } },
              ],
            },
            take: 2,
            select: { id: true, name: true },
          }),
        ])
        const lines = [
          ...guides.map((g) => `📚 ${g.title} → /guides/${g.slug}`),
          ...strains.map((s) => `🌿 ${s.name} → /strains/${s.id}`),
        ]
        const bot = lines.length
          ? await postBot(`Here's what I found for "${rest}":\n${lines.join("\n")}\nFor anything else, try /help`)
          : await postBot(
              `Couldn't find anything about "${rest}" — try different keywords, browse /guides and /strains, or ask the community in Discussions!`
            )
        return NextResponse.json({ ok: true, message: bot })
      }

      case "contest": {
        const week = currentWeekKey()
        const [entries, leader] = await Promise.all([
          prisma.contestEntry.count({ where: { week } }),
          prisma.contestEntry.findFirst({
            where: { week },
            orderBy: { votes: { _count: "desc" } },
            include: {
              user: { select: { name: true, profile: { select: { username: true } } } },
              _count: { select: { votes: true } },
            },
          }),
        ])
        const leaderText =
          leader && leader._count.votes > 0
            ? `Current leader: @${leader.user.profile?.username || leader.user.name} with ${leader._count.votes} vote${leader._count.votes === 1 ? "" : "s"}.`
            : "No leader yet — every entry needs votes!"
        const bot = await postBot(
          `🏆 Photo contest (week ${week}): ${entries} entr${entries === 1 ? "y" : "ies"}. ${leaderText} Enter or vote on the Contest page.`
        )
        return NextResponse.json({ ok: true, message: bot })
      }

      case "rules": {
        const bot = await postBot(
          [
            "📜 Community rules:",
            "1. 21+ only — no exceptions.",
            "2. Be respectful — no harassment, hate speech, or personal attacks.",
            "3. No buying, selling, or sourcing cannabis or anything else.",
            "4. No spam or unsolicited advertising.",
            "5. Don't dox anyone — pseudonyms stay pseudonymous.",
            "6. Staff decisions are final; report issues with /help moderation tools or the Report button.",
          ].join("\n")
        )
        return NextResponse.json({ ok: true, message: bot })
      }

      case "flip": {
        const result = Math.random() < 0.5 ? "Heads" : "Tails"
        const bot = await postBot(`🪙 @${displayName} flipped a coin — ${result}!`)
        return NextResponse.json({ ok: true, message: bot })
      }

      case "roll": {
        const sides = args[0] !== undefined ? parseInt(args[0], 10) : 6
        if (Number.isNaN(sides) || sides < 2 || sides > 1000) {
          return NextResponse.json({ error: "Usage: /roll [2-1000]" }, { status: 400 })
        }
        const rolled = 1 + Math.floor(Math.random() * sides)
        const bot = await postBot(`🎲 @${displayName} rolled a d${sides} — ${rolled}!`)
        return NextResponse.json({ ok: true, message: bot })
      }

      case "slowmode": {
        if (!moderator) return forbidden()
        const seconds = args[0] !== undefined ? parseInt(args[0], 10) : NaN
        if (Number.isNaN(seconds) || seconds < 0 || seconds > MAX_SLOW) {
          return NextResponse.json({ error: "Slow mode must be 0-300 seconds" }, { status: 400 })
        }
        const updated = await prisma.chatRoom.update({
          where: { id: roomId },
          data: { slowModeSeconds: seconds },
        })
        const bot = await postBot(`Slow mode set to ${seconds} second(s)`)
        return NextResponse.json({ ok: true, room: { slowModeSeconds: updated.slowModeSeconds }, message: bot })
      }

      case "lock": {
        if (!moderator) return forbidden()
        const updated = await prisma.chatRoom.update({
          where: { id: roomId },
          data: { locked: true },
        })
        const bot = await postBot(`🔒 Chat locked by the moderation team`)
        return NextResponse.json({ ok: true, room: { locked: updated.locked }, message: bot })
      }

      case "unlock": {
        if (!moderator) return forbidden()
        const updated = await prisma.chatRoom.update({
          where: { id: roomId },
          data: { locked: false },
        })
        const bot = await postBot(`🔓 Chat unlocked by the moderation team`)
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
        const bot = await postBot(`🧹 ${result.count} message(s) cleared by the moderation team`)
        return NextResponse.json({ ok: true, cleared: result.count, message: bot })
      }

      case "announce": {
        if (!moderator) return forbidden()
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
        // Neutral public echo — moderation is intentionally anonymous; naming
        // the acting staff member (or the reason) in room history contradicts
        // the anonymity the private notification promises.
        const bot = await postBot(`⚠️ @${target.profile?.username || target.name} was warned by the moderation team`)
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
        const bot = await postBot(`⚠️ @${target.profile?.username || target.name} was suspended for ${days} day(s) by the moderation team`)
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
        const bot = await postBot(`@${target.profile?.username || target.name} was banned by the moderation team`)
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
        // No public post — announcing an unban reveals the user was banned.
        return NextResponse.json({ ok: true })
      }

      default:
        return NextResponse.json({ error: "Unknown command" }, { status: 400 })
    }
  } catch (error) {
    console.error("Chat command error:", error)
    return NextResponse.json({ error: "Command failed" }, { status: 500 })
  }
}
