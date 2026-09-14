import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/security"
import { ADMIN_ONLY_MOD_ACTIONS } from "@/lib/require-staff"

// Shared moderation enforcement — the single implementation used by both
// /api/moderation/actions and chat slash commands so a ban/warn behaves
// identically no matter which surface issued it.

type Db = Prisma.TransactionClient | typeof prisma

export type AccountActionType =
  | "WARNING"
  | "TEMPORARY_BAN"
  | "PERMANENT_BAN"
  | "UNBAN"
  | "REMOVE_SUSPENSION"

// Resolves the staff member's display name for audit snapshots. The
// ModerationAction row must remain attributable even after the staff
// account is deleted (moderator is SetNull; moderatorName survives).
export async function staffDisplayName(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, profile: { select: { username: true } } },
  })
  return user?.profile?.username || user?.name || "staff"
}

// Write an audit row. `moderatorName` is a snapshot so the record stays
// attributable if the moderator's account is later deleted.
export async function logModAction(
  db: Db,
  data: {
    type: string
    reason: string
    targetUserId: string
    moderatorId: string | null
    moderatorName?: string
    duration?: number | null
    reportId?: string | null
    flagId?: string | null
  }
) {
  const moderatorName =
    data.moderatorName ?? (data.moderatorId ? await staffDisplayName(data.moderatorId) : "system")
  return db.moderationAction.create({
    data: {
      type: data.type,
      reason: data.reason.trim().slice(0, 500),
      targetUserId: data.targetUserId,
      moderatorId: data.moderatorId,
      moderatorName,
      duration: data.duration ?? null,
      reportId: data.reportId ?? null,
      flagId: data.flagId ?? null,
    },
  })
}

// Account-level enforcement inside a caller-managed transaction. Throws
// Error("FORBIDDEN" | "USER_NOT_FOUND") for guard failures — callers map
// those to a uniform 403/404. Returns the anonymous target notification
// for the caller to push after commit.
export async function applyAccountActionInTx(
  tx: Prisma.TransactionClient,
  params: {
    actionType: AccountActionType
    targetUserId: string
    reason: string
    durationDays?: number
    staffId: string
    staffRole: string
    staffName: string
  }
) {
  const { actionType, targetUserId, reason, durationDays, staffId, staffRole, staffName } = params

  const target = await tx.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, role: true },
  })
  if (!target) throw new Error("USER_NOT_FOUND")
  if (targetUserId === staffId) throw new Error("FORBIDDEN")
  if (target.role === "ADMINISTRATOR") throw new Error("FORBIDDEN")
  if ((target.role === "MODERATOR" || target.role === "SUPPORT") && !isAdmin(staffRole)) {
    throw new Error("FORBIDDEN")
  }
  if (ADMIN_ONLY_MOD_ACTIONS.has(actionType) && !isAdmin(staffRole)) {
    throw new Error("FORBIDDEN")
  }

  if (actionType === "TEMPORARY_BAN") {
    if (typeof durationDays !== "number" || durationDays <= 0) throw new Error("INVALID_REQUEST")
    await tx.user.update({
      where: { id: targetUserId },
      data: {
        suspendedUntil: new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000),
        bannedReason: reason.trim(),
        sessionVersion: { increment: 1 },
      },
    })
    // Purge unread notifications this user triggered — a spam-bombed
    // target shouldn't keep finding bait in their notification list.
    await tx.notification.deleteMany({ where: { actorId: targetUserId, read: false } })
  } else if (actionType === "PERMANENT_BAN") {
    await tx.user.update({
      where: { id: targetUserId },
      data: { banned: true, suspendedUntil: null, bannedReason: reason.trim(), sessionVersion: { increment: 1 } },
    })
    await tx.notification.deleteMany({ where: { actorId: targetUserId, read: false } })
  } else if (actionType === "UNBAN") {
    await tx.user.update({
      where: { id: targetUserId },
      data: { banned: false, suspendedUntil: null, bannedReason: null, sessionVersion: { increment: 1 } },
    })
  } else if (actionType === "REMOVE_SUSPENSION") {
    // Lifts a temporary suspension only — must not unban.
    await tx.user.update({
      where: { id: targetUserId },
      data: { suspendedUntil: null, bannedReason: null, sessionVersion: { increment: 1 } },
    })
  }

  await tx.moderationAction.create({
    data: {
      type: actionType,
      reason: reason.trim().slice(0, 500),
      targetUserId,
      moderatorId: staffId,
      moderatorName: staffName,
      duration: typeof durationDays === "number" ? durationDays : null,
    },
  })

  // Intentionally anonymous — moderation notifications never name staff.
  return tx.notification
    .create({
      data: {
        type: "MODERATOR_ANNOUNCEMENT",
        userId: targetUserId,
        title: `Moderation action: ${actionType.replace(/_/g, " ").toLowerCase()}`,
        content: `A moderator took action on your account or content. Reason: ${reason.trim().slice(0, 200)}`,
      },
    })
    .catch(() => null)
}
