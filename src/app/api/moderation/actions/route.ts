import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, isModerator, isAdmin, forbidden, getClientIp, logSecurityEvent } from "@/lib/security"

const CONTENT_TYPES = new Set(["THREAD", "POST", "CHAT_MESSAGE", "DIARY", "SETUP"])
const ACTION_TYPES = new Set(["WARNING", "CONTENT_DELETION", "TEMPORARY_BAN", "PERMANENT_BAN", "UNBAN"])

// POST — take a moderation action (moderators/admins only)
// { actionType, targetType?, targetId?, targetUserId, reason, durationDays? }
export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return unauthorized()
  }
  if (!isModerator(session.user.role)) {
    await logSecurityEvent("AUTHORIZATION_FAILURE", {
      userId: session.user.id,
      ip: getClientIp(request),
      metadata: { endpoint: "moderation/actions" },
    })
    return forbidden()
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

  // Cannot moderate yourself
  if (targetUserId === session.user.id) {
    return NextResponse.json({ error: "Cannot take action on yourself" }, { status: 400 })
  }

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, role: true, banned: true },
  })
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  // Moderators cannot act on admins or other moderators; admins cannot act on other admins
  if (target.role === "ADMINISTRATOR") {
    return forbidden("Cannot take action on an administrator")
  }
  if (target.role === "MODERATOR" && !isAdmin(session.user.role)) {
    return forbidden("Only administrators can moderate moderators")
  }

  // Bans are admin-only in the beta
  if (["TEMPORARY_BAN", "PERMANENT_BAN", "UNBAN"].includes(actionType) && !isAdmin(session.user.role)) {
    return forbidden("Bans require administrator role")
  }

  // Delete content if requested
  if (actionType === "CONTENT_DELETION") {
    if (!targetType || !CONTENT_TYPES.has(targetType) || typeof targetId !== "string" || !targetId) {
      return NextResponse.json({ error: "targetType and targetId required for content deletion" }, { status: 400 })
    }
    switch (targetType) {
      case "THREAD":
        await prisma.thread.update({ where: { id: targetId }, data: { deleted: true } })
        break
      case "POST":
        await prisma.post.update({ where: { id: targetId }, data: { deleted: true } })
        break
      case "CHAT_MESSAGE":
        await prisma.chatMessage.update({ where: { id: targetId }, data: { deleted: true } })
        break
      case "DIARY":
        await prisma.growDiary.update({ where: { id: targetId }, data: { deleted: true } })
        break
      case "SETUP":
        await prisma.growSetup.update({ where: { id: targetId }, data: { deleted: true } })
        break
    }
  }

  if (actionType === "TEMPORARY_BAN" || actionType === "PERMANENT_BAN") {
    await prisma.user.update({
      where: { id: targetUserId },
      data: { banned: true, bannedReason: reason.trim() },
    })
  }

  if (actionType === "UNBAN") {
    await prisma.user.update({
      where: { id: targetUserId },
      data: { banned: false, bannedReason: null },
    })
  }

  await prisma.moderationAction.create({
    data: {
      type: actionType,
      reason: reason.trim(),
      targetUserId,
      moderatorId: session.user.id,
      duration: typeof durationDays === "number" ? durationDays : null,
    },
  })

  // Notify the affected user (except for pure content deletion where a report notification suffices)
  await prisma.notification.create({
    data: {
      type: "MODERATOR_ANNOUNCEMENT",
      userId: targetUserId,
      title: `Moderation action: ${actionType.replace(/_/g, " ").toLowerCase()}`,
      content: `A moderator took action on your account or content. Reason: ${reason.trim()}`,
    },
  })

  await logSecurityEvent("SUSPICIOUS_ACTIVITY", {
    userId: session.user.id,
    ip: getClientIp(request),
    metadata: { moderationAction: actionType, targetUserId, targetType, targetId },
  })

  return NextResponse.json({ ok: true })
}

// GET — recent moderation actions (moderators see action log; no sensitive data)
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return unauthorized()
  }
  if (!isModerator(session.user.role)) {
    return forbidden()
  }

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
