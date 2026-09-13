import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { forbidden, getClientIp, isSupport, logSecurityEvent } from "@/lib/security"
import { requireModerator, requireStaff } from "@/lib/require-staff"
import { rateLimit } from "@/lib/rate-limit"

const VALID_REPORT_STATUSES = ["PENDING", "REVIEWING", "ESCALATED", "RESOLVED", "DISMISSED"]
const MAX_DAYS = 90
const MAX_PAGE_SIZE = 100

// GET — moderation queue (DB-verified staff: support, moderators, admins)
export async function GET(request: Request) {
  const staff = await requireStaff()
  if (!staff) return forbidden()

  const rl = await rateLimit(`mod-reports:${staff.id}`, 30, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const { searchParams } = new URL(request.url)
  const status = searchParams.get("status") || undefined
  const reason = searchParams.get("reason") || undefined
  const dateFrom = searchParams.get("from")
  const dateTo = searchParams.get("to")

  const fromDate = dateFrom ? new Date(dateFrom) : undefined
  const toDate = dateTo ? new Date(dateTo) : undefined
  if ((dateFrom && isNaN(fromDate?.getTime() ?? 0)) || (dateTo && isNaN(toDate?.getTime() ?? 0))) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 })
  }
  if (fromDate && toDate && toDate.getTime() - fromDate.getTime() > MAX_DAYS * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ error: `Date range must be within ${MAX_DAYS} days` }, { status: 400 })
  }

  const page = Math.max(1, Number(searchParams.get("page")) || 1)
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(searchParams.get("limit")) || 50))
  const skip = (page - 1) * limit

  const where: Record<string, unknown> = {
    createdAt: {
      ...(fromDate ? { gte: fromDate } : {}),
      ...(toDate ? { lte: toDate } : {}),
    },
  }

  if (status && status !== "ALL" && VALID_REPORT_STATUSES.includes(status)) {
    where.status = status
  }
  if (reason && reason !== "ALL") {
    where.reason = reason
  }

  const reports = await prisma.report.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    skip,
    include: {
      reporter: {
        select: { id: true, profile: { select: { username: true } } },
      },
    },
  })

  // Attach safe target previews (no sensitive user data)
  const enriched = await Promise.all(
    reports.map(async (r) => {
      let target: unknown = null
      try {
        switch (r.type) {
          case "THREAD":
            target = r.targetId
              ? await prisma.thread.findUnique({
                  where: { id: r.targetId },
                  select: { id: true, title: true, slug: true, deleted: true, authorId: true },
                })
              : null
            break
          case "POST":
            target = r.targetId
              ? await prisma.post.findUnique({
                  where: { id: r.targetId },
                  select: { id: true, content: true, deleted: true, thread: { select: { slug: true } } },
                })
              : null
            break
          case "CHAT_MESSAGE":
            target = r.targetId
              ? await prisma.chatMessage.findUnique({
                  where: { id: r.targetId },
                  select: { id: true, content: true, deleted: true },
                })
              : null
            break
          case "DIARY":
            target = r.targetId
              ? await prisma.growDiary.findUnique({
                  where: { id: r.targetId },
                  select: { id: true, title: true },
                })
              : null
            break
          case "SETUP":
            target = r.targetId
              ? await prisma.growSetup.findUnique({
                  where: { id: r.targetId },
                  select: { id: true, title: true },
                })
              : null
            break
          case "PROFILE":
            target = r.targetId
              ? await prisma.profile.findUnique({
                  where: { userId: r.targetId },
                  select: { username: true, bio: true },
                })
              : null
            break
        }
      } catch {
        target = null
      }
      return {
        id: r.id,
        type: r.type,
        reason: r.reason,
        description: r.description,
        status: r.status,
        priority: r.priority,
        resolution: r.resolution,
        createdAt: r.createdAt,
        // Reporter identity is confidential from view-only SUPPORT staff.
        reporter: isSupport(staff.role) ? null : r.reporter.profile?.username ?? "unknown",
        reportedUserId: r.reportedId,
        assignedToId: r.assignedToId,
        targetId: r.targetId,
        target,
      }
    })
  )

  return NextResponse.json({ reports: enriched })
}

// PATCH — resolve, dismiss, escalate, or set under review a report
export async function PATCH(request: Request) {
  const staff = await requireModerator()
  if (!staff) return forbidden()

  const rl = await rateLimit(`mod-reports-mutate:${staff.id}`, 30, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const body = await request.json().catch(() => ({}))
  const { reportId, status, resolution } = body

  if (
    typeof reportId !== "string" ||
    !reportId ||
    !VALID_REPORT_STATUSES.includes(status)
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  if (resolution && (typeof resolution !== "string" || resolution.length > 500)) {
    return NextResponse.json({ error: "Resolution note too long" }, { status: 400 })
  }

  const report = await prisma.report.findUnique({ where: { id: reportId } })
  if (!report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 })
  }

  // requireModerator already excludes SUPPORT; moderators escalate TO admins,
  // so no additional role restriction applies here. Staff can't adjudicate
  // reports they filed themselves.
  if (report.reporterId === staff.id) {
    return NextResponse.json({ error: "You cannot act on your own report" }, { status: 403 })
  }

  const terminal = status === "RESOLVED" || status === "DISMISSED"
  await prisma.report.update({
    where: { id: reportId },
    data: {
      status,
      resolution: resolution?.trim() || null,
      resolvedById: terminal ? staff.id : null,
      resolvedAt: terminal ? new Date() : null,
    },
  })

  await prisma.moderationAction.create({
    data: {
      type: `REPORT_${status}`,
      reason: resolution?.trim() || `Report marked ${status.toLowerCase()}`,
      targetUserId: report.reportedId,
      moderatorId: staff.id,
      reportId: report.id,
    },
  })

  await logSecurityEvent("SUSPICIOUS_ACTIVITY", {
    userId: staff.id,
    ip: getClientIp(request),
    metadata: { action: `report_${status.toLowerCase()}`, reportId },
  })

  return NextResponse.json({ ok: true })
}
