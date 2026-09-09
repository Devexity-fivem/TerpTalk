import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, isAdmin, forbidden, getClientIp, logSecurityEvent } from "@/lib/security"
import { requireModerator } from "@/lib/require-staff"

const CONTENT_TYPES = new Set(["THREAD", "POST", "CHAT_MESSAGE", "DIARY", "SETUP"])
const ACTION_TYPES = new Set([
  "WARNING", "CONTENT_DELETION", "TEMPORARY_BAN", "PERMANENT_BAN", "UNBAN",
  "PIN_THREAD", "LOCK_THREAD",
])

// POST — take a moderation action (moderators/admins only)
// { actionType, targetType?, targetId?, targetUserId, reason, durationDays? }
export async function POST(request: Request) {
  try {
    // Fresh DB check — a demoted or banned mod loses access immediately
    const staff = await requireModerator()
    if (!staff) {
      const session = await getServerSession(authOptions).catch(() => null)
      if (session?.user?.id) {
        await logSecurityEvent("AUTHORIZATION_FAILURE", {
          userId: session.user.id,
          ip: getClientIp(request),
          metadata: { endpoint: "moderation/actions" },
        })
      }
      return session?.user?.id ? forbidden() : unauthorized()
    }

    const body = await request.json().catch(() => ({}))
    const { actionType, targetType, targetId, targetUserId, reason, durationDays } = body

    if (
      typeof actionType !== "string" ||
      !ACTION_TYPES.has(actionType) ||
      typeof targetUserId !== "string" ||
      !targetUserId ||
      typeof reason !== "string" ||
      !reason.trim() ||
      reason.length > 500
    ) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }

    if (durationDays !== undefined && durationDays !== null && (!Number.isInteger(durationDays) || durationDays <= 0)) {
      return NextResponse.json({ error: "durationDays must be a positive integer" }, { status: 400 })
    }

    if (targetUserId === staff.id) {
      return NextResponse.json({ error: "Cannot take action on yourself" }, { status: 400 })
    }

    await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, role: true, banned: true },
      })
      if (!target) {
        throw new Error("User not found")
      }

      if (target.role === "ADMINISTRATOR") {
        throw new Error("Cannot take action on an administrator")
      }
      if (target.role === "MODERATOR" && !isAdmin(staff.role)) {
        throw new Error("Only administrators can moderate moderators")
      }

      if (["TEMPORARY_BAN", "PERMANENT_BAN", "UNBAN"].includes(actionType) && !isAdmin(staff.role)) {
        throw new Error("Bans require administrator role")
      }

      if (actionType === "CONTENT_DELETION") {
        if (!targetType || !CONTENT_TYPES.has(targetType) || typeof targetId !== "string" || !targetId) {
          throw new Error("targetType and targetId required for content deletion")
        }
        let ok = false
        switch (targetType) {
          case "THREAD":
            ok = !!(await tx.thread.updateMany({ where: { id: targetId, authorId: targetUserId }, data: { deleted: true } })).count
            break
          case "POST":
            ok = !!(await tx.post.updateMany({ where: { id: targetId, authorId: targetUserId }, data: { deleted: true } })).count
            break
          case "CHAT_MESSAGE":
            ok = !!(await tx.chatMessage.updateMany({ where: { id: targetId, authorId: targetUserId }, data: { deleted: true } })).count
            break
          case "DIARY":
            ok = !!(await tx.growDiary.updateMany({ where: { id: targetId, authorId: targetUserId }, data: { deleted: true } })).count
            break
          case "SETUP":
            ok = !!(await tx.growSetup.updateMany({ where: { id: targetId, authorId: targetUserId }, data: { deleted: true } })).count
            break
        }
        if (!ok) {
          throw new Error("Content not found or author mismatch")
        }
      }

      if (actionType === "TEMPORARY_BAN" || actionType === "PERMANENT_BAN") {
        await tx.user.update({
          where: { id: targetUserId },
          data: { banned: true, bannedReason: reason.trim() },
        })
      }

      if (actionType === "PIN_THREAD" || actionType === "LOCK_THREAD") {
        if (typeof targetId !== "string" || !targetId) {
          throw new Error("targetId (thread id) required")
        }
        const thread = await tx.thread.findUnique({ where: { id: targetId }, select: { pinned: true, locked: true, authorId: true } })
        if (!thread) {
          throw new Error("Thread not found")
        }
        await tx.thread.update({
          where: { id: targetId },
          data: actionType === "PIN_THREAD" ? { pinned: !thread.pinned } : { locked: !thread.locked },
        })
      }

      if (actionType === "UNBAN") {
        await tx.user.update({
          where: { id: targetUserId },
          data: { banned: false, bannedReason: null },
        })
      }

      await tx.moderationAction.create({
        data: {
          type: actionType,
          reason: reason.trim(),
          targetUserId,
          moderatorId: staff.id,
          duration: typeof durationDays === "number" ? durationDays : null,
        },
      })

      await tx.notification.create({
        data: {
          type: "MODERATOR_ANNOUNCEMENT",
          userId: targetUserId,
          title: `Moderation action: ${actionType.replace(/_/g, " ").toLowerCase()}`,
          content: `A moderator took action on your account or content. Reason: ${reason.trim()}`,
        },
      }).catch(() => {})
    })

    await logSecurityEvent("SUSPICIOUS_ACTIVITY", {
      userId: staff.id,
      ip: getClientIp(request),
      metadata: { moderationAction: actionType, targetUserId, targetType, targetId },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Moderation action error:", error)
    if (error instanceof Error && error.message === "User not found") {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }
    if (error instanceof Error && ["Cannot take action on an administrator", "Only administrators can moderate moderators", "Bans require administrator role"].includes(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}

// GET — recent moderation actions (fresh DB-verified staff check)
export async function GET() {
  if (!(await requireModerator())) return forbidden()

  const actions = await prisma.moderationAction.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      moderator: {
        select: { profile: { select: { username: true } } },
      },
    },
  })

  return NextResponse.json({
    actions: actions.map((a) => ({
      id: a.id,
      type: a.type,
      reason: a.reason,
      targetUserId: a.targetUserId,
      moderator: a.moderator.profile?.username ?? "unknown",
      duration: a.duration,
      createdAt: a.createdAt,
    })),
  })
}
