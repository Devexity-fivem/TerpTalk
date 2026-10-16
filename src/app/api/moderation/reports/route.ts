import { NextResponse } from "next/server"
import { parsePageParams } from "@/lib/pagination"
import { prisma } from "@/lib/prisma"
import { forbidden, getClientIp, isAdmin, isSupport, logSecurityEvent } from "@/lib/security"
import { requireModerator, requireStaff } from "@/lib/require-staff"
import { logModAction } from "@/lib/moderation"
import { rateLimit } from "@/lib/rate-limit"

const VALID_REPORT_STATUSES = ["PENDING", "REVIEWING", "ESCALATED", "RESOLVED", "DISMISSED"]
const MAX_DAYS = 90
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

  const { limit, skip } = parsePageParams(searchParams)

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

  // Attach safe target previews (no sensitive user data) — batched per
  // target type so a full page of reports costs 6 queries, not `limit`.
  const idsByType = (type: string) =>
    reports.filter((r) => r.type === type && r.targetId).map((r) => r.targetId as string)
  const [threads, posts, chatMessages, diaries, setups, profiles] = await Promise.all([
    prisma.thread.findMany({
      where: { id: { in: idsByType("THREAD") } },
      select: { id: true, title: true, slug: true, deleted: true, authorId: true },
    }),
    prisma.post.findMany({
      where: { id: { in: idsByType("POST") } },
      select: { id: true, content: true, deleted: true, thread: { select: { slug: true } } },
    }),
    prisma.chatMessage.findMany({
      where: { id: { in: idsByType("CHAT_MESSAGE") } },
      select: { id: true, content: true, deleted: true },
    }),
    prisma.growDiary.findMany({
      where: { id: { in: idsByType("DIARY") } },
      select: { id: true, title: true },
    }),
    prisma.growSetup.findMany({
      where: { id: { in: idsByType("SETUP") } },
      select: { id: true, title: true },
    }),
    // Reported profiles are keyed by userId, not row id.
    prisma.profile.findMany({
      where: { userId: { in: idsByType("PROFILE") } },
      select: { userId: true, username: true, bio: true },
    }),
  ])
  const previews = {
    THREAD: new Map(threads.map((t) => [t.id, t])),
    POST: new Map(posts.map((p) => [p.id, p])),
    CHAT_MESSAGE: new Map(chatMessages.map((m) => [m.id, m])),
    DIARY: new Map(diaries.map((d) => [d.id, d])),
    SETUP: new Map(setups.map((s) => [s.id, s])),
    PROFILE: new Map(profiles.map((p) => [p.userId, { username: p.username, bio: p.bio }])),
  } as Record<string, Map<string, unknown>>

  const enriched = reports.map((r) => {
      const target = r.targetId ? previews[r.type]?.get(r.targetId) ?? null : null
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
        reporter: isSupport(staff.role) ? null : r.reporter?.profile?.username ?? null,
        reportedUserId: r.reportedId,
        assignedToId: r.assignedToId,
        targetId: r.targetId,
        target,
      }
    })

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
  // Staff may not adjudicate cases about themselves (non-admin only).
  if (report.reportedId === staff.id && !isAdmin(staff.role)) {
    return NextResponse.json({ error: "You cannot act on a case about yourself" }, { status: 403 })
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

  await logModAction(prisma, {
    type: `REPORT_${status}`,
    reason: resolution?.trim() || `Report marked ${status.toLowerCase()}`,
    targetUserId: report.reportedId,
    moderatorId: staff.id,
    reportId: report.id,
  })

  await logSecurityEvent("SUSPICIOUS_ACTIVITY", {
    userId: staff.id,
    ip: getClientIp(request),
    metadata: { action: `report_${status.toLowerCase()}`, reportId },
  })

  return NextResponse.json({ ok: true })
}
