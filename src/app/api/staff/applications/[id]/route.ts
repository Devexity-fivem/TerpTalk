import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { sessionCookieName } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, isSessionValid, forbidden, isAdmin } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { checkMaintenance } from "@/lib/maintenance"

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

    await prisma.$transaction(async (tx) => {
      if (status === "APPROVED") {
        await tx.user.update({
          where: { id: application.userId },
          data: { role: application.role },
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

      await tx.notification.create({
        data: {
          type: "MODERATOR_ANNOUNCEMENT",
          userId: application.userId,
          title: `Staff application ${status.toLowerCase()}`,
          content: `Your application for ${application.role} was ${status.toLowerCase()}.`,
          link: "/staff/apply",
        },
      }).catch(() => {})
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Failed to review staff application:", error)
    return NextResponse.json({ error: "Failed to review application" }, { status: 500 })
  }
}
