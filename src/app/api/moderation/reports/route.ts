import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { isModerator, forbidden, getClientIp, logSecurityEvent } from "@/lib/security"

// GET — moderation queue (moderators/admins only)
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!isModerator(session.user.role)) {
    return forbidden()
  }

  const reports = await prisma.report.findMany({
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
                  select: {
                    id: true,
                    content: true,
                    deleted: true,
                    thread: { select: { slug: true } },
                  },
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

// PATCH — resolve or dismiss a report (moderators/admins only)
export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!isModerator(session.user.role)) {
    return forbidden()
  }

  const body = await request.json().catch(() => ({}))
  const { reportId, status, resolution } = body

  if (
    typeof reportId !== "string" ||
    !reportId ||
    !["RESOLVED", "DISMISSED", "REVIEWING"].includes(status)
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

  await prisma.report.update({
    where: { id: reportId },
    data: { status, resolution: resolution?.trim() || null },
  })

  await prisma.moderationAction.create({
    data: {
      type: `REPORT_${status}`,
      reason: resolution?.trim() || `Report marked ${status.toLowerCase()}`,
      targetUserId: report.reportedId,
      moderatorId: session.user.id,
    },
  })

  await logSecurityEvent("SUSPICIOUS_ACTIVITY", {
    userId: session.user.id,
    ip: getClientIp(request),
    metadata: { action: `report_${status.toLowerCase()}`, reportId },
  })

  return NextResponse.json({ ok: true })
}
