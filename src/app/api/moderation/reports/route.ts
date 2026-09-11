import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { forbidden, getClientIp, logSecurityEvent } from "@/lib/security"
import { requireModerator } from "@/lib/require-staff"

const VALID_REPORT_STATUSES = ["PENDING", "REVIEWING", "ESCALATED", "RESOLVED", "DISMISSED"]

// GET — moderation queue (DB-verified moderators/admins only)
export async function GET(request: Request) {
  const staff = await requireModerator()
  if (!staff) return forbidden()

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
    take: 100,
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
        resolution: r.resolution,
        createdAt: r.createdAt,
        reporter: r.reporter.profile?.username ?? "unknown",
        reportedUserId: r.reportedId,
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

  // Only admins can escalate reports
  if (status === "ESCALATED" && staff.role !== "ADMINISTRATOR") {
    return forbidden("Only administrators can escalate reports")
  }

  await prisma.report.update({
    where: { id: reportId },
    data: { status, resolution: resolution?.trim() || null },
  })

  await prisma.moderationAction.create({
    data: {
      type: `REPORT_${status}`,
      reason: resolution?.trim() || `Report marked ${status.toLowerCase()}`,
      targetUserId: report.reportedId,
      moderatorId: staff.id,
    },
  })

  await logSecurityEvent("SUSPICIOUS_ACTIVITY", {
    userId: staff.id,
    ip: getClientIp(request),
    metadata: { action: `report_${status.toLowerCase()}`, reportId },
  })

  return NextResponse.json({ ok: true })
}
