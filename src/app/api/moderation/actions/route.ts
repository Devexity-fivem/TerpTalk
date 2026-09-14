import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, isAdmin, forbidden, getClientIp, logSecurityEvent } from "@/lib/security"
import { requireModerator, ADMIN_ONLY_MOD_ACTIONS } from "@/lib/require-staff"
import { rateLimit } from "@/lib/rate-limit"
import { emitNotificationPush, notificationLinkWhere, postLinkWhere } from "@/lib/notify"
import { reverseReputationBySource, reverseReputationByActor } from "@/lib/reputation"
import { applyAccountActionInTx, staffDisplayName } from "@/lib/moderation"
import { deleteImagesIfUnreferenced } from "@/lib/blob"

const CONTENT_TYPES = new Set(["THREAD", "POST", "CHAT_MESSAGE", "DIARY", "SETUP"])
const ACTION_TYPES = new Set([
  "WARNING", "CONTENT_DELETION", "TEMPORARY_BAN", "PERMANENT_BAN", "UNBAN", "REMOVE_SUSPENSION",
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

    if (durationDays !== undefined && durationDays !== null && (!Number.isInteger(durationDays) || durationDays <= 0 || durationDays > 365)) {
      return NextResponse.json({ error: "durationDays must be a positive integer up to 365" }, { status: 400 })
    }

    if (actionType === "TEMPORARY_BAN" && typeof durationDays !== "number") {
      return NextResponse.json({ error: "durationDays is required for temporary suspensions" }, { status: 400 })
    }

    if (targetUserId === staff.id) {
      return NextResponse.json({ error: "Cannot take action on yourself" }, { status: 400 })
    }

    const staffName = await staffDisplayName(staff.id)
    const isAccountAction = ["WARNING", "TEMPORARY_BAN", "PERMANENT_BAN", "UNBAN", "REMOVE_SUSPENSION"].includes(actionType)
    // PIN/LOCK resolve the real target from the thread inside the tx.
    let effectiveTargetUserId = targetUserId

    let createdNotification: Awaited<ReturnType<typeof prisma.notification.create>> | null = null
    const deletedBlobUrls: string[] = []
    await prisma.$transaction(async (tx) => {
      if (isAccountAction) {
        // Shared enforcement — identical semantics to chat /warn /mute /ban.
        createdNotification = await applyAccountActionInTx(tx, {
          actionType: actionType as "WARNING" | "TEMPORARY_BAN" | "PERMANENT_BAN" | "UNBAN" | "REMOVE_SUSPENSION",
          targetUserId,
          reason,
          durationDays,
          staffId: staff.id,
          staffRole: staff.role,
          staffName,
        })
      } else {
        // Guards for content/thread actions — non-admin staff may not act
        // on fellow staff or administrators' content.
        const target = await tx.user.findUnique({
          where: { id: targetUserId },
          select: { id: true, role: true },
        })
        if (!target) {
          throw new Error("USER_NOT_FOUND")
        }
        if (target.role === "ADMINISTRATOR") {
          throw new Error("FORBIDDEN")
        }
        if ((target.role === "MODERATOR" || target.role === "SUPPORT") && !isAdmin(staff.role)) {
          throw new Error("FORBIDDEN")
        }
        if (ADMIN_ONLY_MOD_ACTIONS.has(actionType) && !isAdmin(staff.role)) {
          throw new Error("FORBIDDEN")
        }
      }

      if (actionType === "CONTENT_DELETION") {
        if (!targetType || !CONTENT_TYPES.has(targetType) || typeof targetId !== "string" || !targetId) {
          throw new Error("INVALID_REQUEST")
        }
        let ok = false
        let deletedLink: string | null = null
        switch (targetType) {
          case "THREAD": {
            const t = await tx.thread.findUnique({ where: { id: targetId }, select: { slug: true } })
            ok = !!(await tx.thread.updateMany({ where: { id: targetId, authorId: targetUserId }, data: { deleted: true } })).count
            if (ok && t) {
              deletedLink = `/forum/thread/${t.slug}`
              // Detach image rows so deleted content can't keep blobs live.
              const imgs = await tx.postImage.findMany({
                where: { OR: [{ threadId: targetId }, { post: { threadId: targetId } }] },
                select: { url: true },
              })
              await tx.postImage.deleteMany({
                where: { OR: [{ threadId: targetId }, { post: { threadId: targetId } }] },
              })
              deletedBlobUrls.push(...imgs.map((i) => i.url))
            }
            break
          }
          case "POST": {
            const p = await tx.post.findUnique({ where: { id: targetId }, select: { threadId: true } })
            ok = !!(await tx.post.updateMany({ where: { id: targetId, authorId: targetUserId }, data: { deleted: true } })).count
            if (ok) {
              // Deep-linked notifications (?post=/#post-) would dangle.
              await tx.notification.deleteMany({ where: postLinkWhere(targetId) })
              const imgs = await tx.postImage.findMany({ where: { postId: targetId }, select: { url: true } })
              await tx.postImage.deleteMany({ where: { postId: targetId } })
              deletedBlobUrls.push(...imgs.map((i) => i.url))
            }
            if (ok && p) {
              // Keep thread.replyCount in sync — same rule as the user-facing
              // DELETE: non-deleted posts minus a live opening post.
              const remaining = await tx.post.count({ where: { threadId: p.threadId, deleted: false } })
              const op = await tx.post.findFirst({
                where: { threadId: p.threadId },
                orderBy: { createdAt: "asc" },
                select: { deleted: true },
              })
              await tx.thread.update({
                where: { id: p.threadId },
                data: { replyCount: Math.max(0, remaining - (op && !op.deleted ? 1 : 0)) },
              })
              // Deleting the accepted answer un-solves the thread.
              await tx.thread.updateMany({
                where: { acceptedAnswerId: targetId },
                data: { acceptedAnswerId: null },
              })
            }
            break
          }
          case "CHAT_MESSAGE":
            ok = !!(await tx.chatMessage.updateMany({ where: { id: targetId, authorId: targetUserId }, data: { deleted: true } })).count
            break
          case "DIARY":
            ok = !!(await tx.growDiary.updateMany({ where: { id: targetId, authorId: targetUserId }, data: { deleted: true } })).count
            if (ok) {
              deletedLink = `/diaries/${targetId}`
              const imgs = await tx.diaryImage.findMany({
                where: { update: { diaryId: targetId } },
                select: { url: true },
              })
              await tx.diaryImage.deleteMany({ where: { update: { diaryId: targetId } } })
              deletedBlobUrls.push(...imgs.map((i) => i.url))
            }
            break
          case "SETUP":
            ok = !!(await tx.growSetup.updateMany({ where: { id: targetId, authorId: targetUserId }, data: { deleted: true } })).count
            if (ok) {
              deletedLink = `/setups/${targetId}`
              const imgs = await tx.setupImage.findMany({ where: { setupId: targetId }, select: { url: true } })
              await tx.setupImage.deleteMany({ where: { setupId: targetId } })
              deletedBlobUrls.push(...imgs.map((i) => i.url))
            }
            break
        }
        if (!ok) {
          throw new Error("CONTENT_NOT_FOUND")
        }
        // Drop notifications that would now point at deleted content —
        // prefix-aware so deep links (?post=/#post-) are caught too.
        if (deletedLink) {
          await tx.notification.deleteMany({ where: notificationLinkWhere(deletedLink) })
        }
      }

      if (actionType === "PIN_THREAD" || actionType === "LOCK_THREAD") {
        if (typeof targetId !== "string" || !targetId) {
          throw new Error("INVALID_REQUEST")
        }
        const thread = await tx.thread.findUnique({
          where: { id: targetId },
          select: { pinned: true, locked: true, authorId: true, author: { select: { role: true } } },
        })
        if (!thread) {
          throw new Error("CONTENT_NOT_FOUND")
        }
        if (!isAdmin(staff.role) && !["MEMBER", "VERIFIED_MEMBER"].includes(thread.author.role)) {
          throw new Error("FORBIDDEN")
        }
        await tx.thread.update({
          where: { id: targetId },
          data: actionType === "PIN_THREAD" ? { pinned: !thread.pinned } : { locked: !thread.locked },
        })
        // Audit/notify the thread author — not the caller-supplied id.
        effectiveTargetUserId = thread.authorId
      }

      if (!isAccountAction) {
        await tx.moderationAction.create({
          data: {
            type: actionType,
            reason: reason.trim(),
            targetUserId: effectiveTargetUserId,
            moderatorId: staff.id,
            moderatorName: staffName,
            duration: typeof durationDays === "number" ? durationDays : null,
          },
        })

        // Intentionally anonymous — moderation notifications never name staff.
        createdNotification = await tx.notification.create({
          data: {
            type: "MODERATOR_ANNOUNCEMENT",
            userId: effectiveTargetUserId,
            title: `Moderation action: ${actionType.replace(/_/g, " ").toLowerCase()}`,
            content: `A moderator took action on your account or content. Reason: ${reason.trim()}`,
          },
        }).catch(() => null)
      }
    })

    if (createdNotification) {
      emitNotificationPush(effectiveTargetUserId, createdNotification)
    }

    // Soft-deleted content must not leave live public blobs behind.
    if (deletedBlobUrls.length > 0) {
      deleteImagesIfUnreferenced(deletedBlobUrls).catch(() => {})
    }

    // Reputation reconciliation — idempotent counter-entries, never silent edits.
    if (actionType === "CONTENT_DELETION" && typeof targetId === "string") {
      if (targetType === "THREAD") {
        const postIds = await prisma.post.findMany({ where: { threadId: targetId }, select: { id: true } })
        await reverseReputationBySource("THREAD", targetId, "Content removed by staff", staff.id).catch(() => 0)
        for (const p of postIds) {
          await reverseReputationBySource("POST", p.id, "Content removed by staff", staff.id).catch(() => 0)
        }
      } else if (targetType === "POST" || targetType === "DIARY" || targetType === "SETUP") {
        await reverseReputationBySource(targetType, targetId, "Content removed by staff", staff.id).catch(() => 0)
      }
    }
    // A permanent ban voids reputation the banned account granted others
    // (likes they cast, answers they accepted). Their own earned history stays.
    if (actionType === "PERMANENT_BAN") {
      await reverseReputationByActor(targetUserId, "Granting account permanently banned").catch(() => 0)
    }

    await logSecurityEvent("SUSPICIOUS_ACTIVITY", {
      userId: staff.id,
      ip: getClientIp(request),
      metadata: { moderationAction: actionType, targetUserId, targetType, targetId },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Moderation action error:", error)
    if (error instanceof Error && error.message === "USER_NOT_FOUND") {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }
    if (error instanceof Error && ["FORBIDDEN", "INVALID_REQUEST", "CONTENT_NOT_FOUND"].includes(error.message)) {
      // Do not leak whether a target is an admin/moderator or why an action failed.
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}

// GET — recent moderation actions (fresh DB-verified staff check)
export async function GET(request: Request) {
  const staff = await requireModerator()
  if (!staff) return forbidden()

  const rl = await rateLimit(`mod-actions:${staff.id}`, 30, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const { searchParams } = new URL(request.url)
  const page = Math.max(1, Number(searchParams.get("page")) || 1)
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 50))
  const skip = (page - 1) * limit

  const actions = await prisma.moderationAction.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    skip,
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
      moderator: a.moderator?.profile?.username ?? a.moderatorName ?? "unknown",
      duration: a.duration,
      createdAt: a.createdAt,
    })),
  })
}
