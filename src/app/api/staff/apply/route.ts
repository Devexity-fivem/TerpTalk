import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { sessionCookieName } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, isSessionValid, forbidden } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { checkMaintenance } from "@/lib/maintenance"
import { notifyMany } from "@/lib/notify"

const VALID_ROLES = new Set(["SUPPORT", "MODERATOR"])

export async function POST(request: NextRequest) {
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

    const rl = await rateLimit(`staff-apply:${userId}`, 5, 60 * 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many applications" }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))
    const { role, why, experience, about } = body

    if (!VALID_ROLES.has(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 })
    }

    if (
      typeof why !== "string" || !why.trim() ||
      typeof experience !== "string" || !experience.trim() ||
      typeof about !== "string" || !about.trim()
    ) {
      return NextResponse.json({ error: "All fields are required" }, { status: 400 })
    }

    if (why.length > 2000 || experience.length > 2000 || about.length > 2000) {
      return NextResponse.json({ error: "Each field must be 2000 characters or less" }, { status: 400 })
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    })
    if (!user) return forbidden()
    if (["SUPPORT", "MODERATOR", "ADMINISTRATOR"].includes(user.role ?? "")) {
      return NextResponse.json({ error: "You already hold a staff role" }, { status: 400 })
    }

    const existing = await prisma.staffApplication.findFirst({
      where: { userId, status: "PENDING" },
    })
    if (existing) {
      return NextResponse.json({ error: "You already have a pending application" }, { status: 400 })
    }

    const application = await prisma.staffApplication.create({
      data: {
        userId,
        role,
        why: why.trim(),
        experience: experience.trim(),
        about: about.trim(),
      },
    })

    const admins = await prisma.user.findMany({
      where: { role: { in: ["MODERATOR", "ADMINISTRATOR"] }, banned: false, profile: { isNot: { username: "terpbot" } } },
      select: { id: true },
    })
    if (admins.length > 0) {
      await notifyMany(
        admins.map((a) => ({
          userId: a.id,
          type: "MODERATOR_ANNOUNCEMENT" as const,
          title: "New staff application",
          content: `A member applied for the ${role.toLowerCase()} role.`,
          link: "/admin/staff/applications",
        }))
      )
    }

    return NextResponse.json({ ok: true, application: { id: application.id, role: application.role } }, { status: 201 })
  } catch (error) {
    console.error("Staff application error:", error)
    return NextResponse.json({ error: "Failed to submit application" }, { status: 500 })
  }
}
