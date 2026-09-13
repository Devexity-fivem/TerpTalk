import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { forbidden, getClientIp, logSecurityEvent, STAFF_ROLES } from "@/lib/security"
import { requireModerator } from "@/lib/require-staff"
import { rateLimit } from "@/lib/rate-limit"
import { notifyMany } from "@/lib/notify"

const MAX_BULK = 50

// POST — bounded bulk triage on queue items. Only lifecycle actions are
// allowed here (resolve / dismiss / assign) — enforcement (content removal,
// warnings, bans, reputation changes) is deliberately NOT bulkable; those go
// through the existing moderation routes with their own per-target checks.
// Every item produces its own ModerationAction + SecurityEvent audit row.
export async function POST(request: Request) {
  const staff = await requireModerator()
  if (!staff) return forbidden()

  const rl = await rateLimit(`queue-bulk:${staff.id}`, 30, 10 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const body = await request.json().catch(() => ({}))
  const { items, action, assignTo } = body
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_BULK) {
    return NextResponse.json({ error: `items must contain 1-${MAX_BULK} entries` }, { status: 400 })
  }
  if (action !== "resolve" && action !== "dismiss" && action !== "assign") {
    return NextResponse.json({ error: "Unsupported bulk action" }, { status: 400 })
  }
  for (const it of items) {
    if (!it || (it.kind !== "REPORT" && it.kind !== "FLAG") || typeof it.id !== "string" || !it.id) {
      return NextResponse.json({ error: "Malformed items" }, { status: 400 })
    }
  }

  let assigneeName = ""
  if (action === "assign") {
    if (typeof assignTo !== "string" || !assignTo) {
      return NextResponse.json({ error: "assignTo required" }, { status: 400 })
    }
    const target = await prisma.user.findUnique({
      where: { id: assignTo },
      select: { role: true, banned: true, profile: { select: { username: true } } },
    })
    if (!target || target.banned || !STAFF_ROLES.has(target.role)) {
      return NextResponse.json({ error: "Assignee must be active staff" }, { status: 400 })
    }
    assigneeName = target.profile?.username ?? "unknown"
  }

  const succeeded: string[] = []
  const failed: { id: string; error: string }[] = []

  for (const it of items as { kind: "REPORT" | "FLAG"; id: string }[]) {
    try {
      const item = it.kind === "REPORT"
        ? await prisma.report.findUnique({ where: { id: it.id } })
        : await prisma.abuseFlag.findUnique({ where: { id: it.id } })
      if (!item) {
        failed.push({ id: it.id, error: "not found" })
        continue
      }
      if (it.kind === "REPORT" && (item as { reporterId?: string }).reporterId === staff.id) {
        failed.push({ id: it.id, error: "own report" })
        continue
      }
      if (action !== "assign" && (item.status === "RESOLVED" || item.status === "DISMISSED")) {
        failed.push({ id: it.id, error: "already closed" })
        continue
      }

      const table = it.kind === "REPORT" ? prisma.report : prisma.abuseFlag
      const prefix = it.kind === "REPORT" ? "REPORT" : "FLAG"
      const linkField = it.kind === "REPORT" ? { reportId: it.id } : { flagId: it.id }
      const targetUserId = it.kind === "REPORT"
        ? (item as { reportedId: string }).reportedId
        : (item as { userId: string }).userId

      if (action === "assign") {
        await (table as typeof prisma.report).update({
          where: { id: it.id },
          data: {
            assignedToId: assignTo,
            ...(item.status === "PENDING" ? { status: "REVIEWING" } : {}),
          },
        })
      } else {
        const status = action === "resolve" ? "RESOLVED" : "DISMISSED"
        await (table as typeof prisma.report).update({
          where: { id: it.id },
          data: { status, resolvedById: staff.id, resolvedAt: new Date() },
        })
      }

      await prisma.moderationAction.create({
        data: {
          type: action === "assign" ? `${prefix}_ASSIGNED` : `${prefix}_${action === "resolve" ? "RESOLVED" : "DISMISSED"}`,
          reason: action === "assign" ? `Bulk assigned to @${assigneeName}` : `Bulk ${action}d`,
          targetUserId,
          moderatorId: staff.id,
          ...linkField,
        },
      })
      succeeded.push(it.id)
    } catch {
      failed.push({ id: it.id, error: "update failed" })
    }
  }

  await logSecurityEvent("SUSPICIOUS_ACTIVITY", {
    userId: staff.id,
    ip: getClientIp(request),
    metadata: { action: `queue_bulk_${action}`, count: succeeded.length, failedCount: failed.length },
  })

  if (action === "assign" && assignTo !== staff.id && succeeded.length > 0) {
    await notifyMany([{
      userId: assignTo,
      type: "MODERATOR_ANNOUNCEMENT" as const,
      title: "Cases assigned to you",
      content: `${succeeded.length} case${succeeded.length === 1 ? "" : "s"} assigned to you for review.`,
      link: "/moderation",
    }]).catch(() => {})
  }

  return NextResponse.json({ ok: true, succeeded: succeeded.length, failed })
}
