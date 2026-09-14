import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { sessionCookieName } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, isSessionValid, forbidden, isAdmin, getClientIp, logSecurityEvent } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { checkMaintenance } from "@/lib/maintenance"
import { emitNotificationPush } from "@/lib/notify"
import { logModAction } from "@/lib/moderation"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
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

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    })
    if (!user || !isAdmin(user.role)) return forbidden()

    const rl = await rateLimit(`staff-review:${userId}`, 60, 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))
    const { status, reviewNote } = body

    if (status !== "APPROVED" && status !== "REJECTED") {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 })
    }

    const application = await prisma.staffApplication.findUnique({
      where: { id },
      include: { applicant: { select: { id: true } } },
    })
    if (!application) {
      return NextResponse.json({ error: "Application not found" }, { status: 404 })
    }
    if (application.status !== "PENDING") {
      return NextResponse.json({ error: "Application already reviewed" }, { status: 400 })
    }

    let createdNotification: Awaited<ReturnType<typeof prisma.notification.create>> | null = null
    await prisma.$transaction(async (tx) => {
      if (status === "APPROVED") {
        // Applications can only grant staff-review roles — never admin.
        if (application.role !== "SUPPORT" && application.role !== "MODERATOR") {
          throw new Error("INVALID_ROLE")
        }
        // Recheck the applicant at grant time: a banned user or someone
        // already holding a staff role must not be blindly overwritten.
        const applicant = await tx.user.findUnique({
          where: { id: application.userId },
          select: { role: true, banned: true },
        })
        if (!applicant || applicant.banned) throw new Error("INVALID_REQUEST")
        if (applicant.role !== "MEMBER" && applicant.role !== "VERIFIED_MEMBER") {
          throw new Error("ALREADY_STAFF")
        }
        await tx.user.update({
          where: { id: application.userId },
          data: { role: application.role, sessionVersion: { increment: 1 } },
        })
      }

      await tx.staffApplication.update({
        where: { id },
        data: {
          status,
          reviewNote: typeof reviewNote === "string" ? reviewNote.trim().slice(0, 1000) : null,
          reviewedBy: userId,
        },
      })

      await logModAction(tx, {
        type: "STAFF_APPLICATION",
        reason: `Application ${status.toLowerCase()}: ${application.role}${status === "APPROVED" ? " (role granted)" : ""}`,
        targetUserId: application.userId,
        moderatorId: userId,
      })

      createdNotification = await tx.notification.create({
        data: {
          type: "MODERATOR_ANNOUNCEMENT",
          userId: application.userId,
          title: `Staff application ${status.toLowerCase()}`,
          content: `Your application for ${application.role} was ${status.toLowerCase()}.`,
          link: status === "APPROVED" ? "/moderation" : "/staff/apply",
        },
      }).catch(() => null)
    })

    if (createdNotification) {
      emitNotificationPush(application.userId, createdNotification)
    }

    await logSecurityEvent("SUSPICIOUS_ACTIVITY", {
      userId,
      ip: getClientIp(request),
      metadata: { adminAction: "staff_application_review", applicationId: id, status, applicantId: application.userId },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_ROLE") {
      return NextResponse.json({ error: "Applications cannot grant that role" }, { status: 400 })
    }
    if (error instanceof Error && error.message === "ALREADY_STAFF") {
      return NextResponse.json({ error: "Applicant already holds a staff role — change it via admin tools" }, { status: 409 })
    }
    if (error instanceof Error && error.message === "INVALID_REQUEST") {
      return NextResponse.json({ error: "Applicant cannot be granted a role" }, { status: 400 })
    }
    console.error("Failed to review staff application:", error)
    return NextResponse.json({ error: "Failed to review application" }, { status: 500 })
  }
}
