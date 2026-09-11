import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { sessionCookieName } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, isSessionValid, forbidden, isAdmin, publicUserSelect } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { checkMaintenance } from "@/lib/maintenance"

export async function GET(request: NextRequest) {
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

    const rl = await rateLimit(`staff-applications:${userId}`, 120, 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status") ?? "PENDING"

    const applications = await prisma.staffApplication.findMany({
      where: { status },
      orderBy: { createdAt: "desc" },
      include: {
        applicant: { select: publicUserSelect },
      },
    })

    const formatted = applications.map(a => ({
      id: a.id,
      role: a.role,
      why: a.why,
      experience: a.experience,
      about: a.about,
      status: a.status,
      reviewNote: a.reviewNote,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      applicant: {
        id: a.applicant.id,
        name: a.applicant.name,
        username: a.applicant.profile?.username ?? null,
        image: a.applicant.image ?? null,
        role: a.applicant.role ?? null,
      },
    }))

    return NextResponse.json({ applications: formatted })
  } catch (error) {
    console.error("Failed to load staff applications:", error)
    return NextResponse.json({ error: "Failed to load applications" }, { status: 500 })
  }
}
