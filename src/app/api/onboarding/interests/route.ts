import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, getClientIp, logSecurityEvent, isBanned, forbidden } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { checkMaintenance } from "@/lib/maintenance"

const MAX_SELECTIONS = 30

// POST — sync interest selections to category follows.
// { categoryIds: string[] } — ids are validated server-side; only
// non-hidden categories may be followed. Selections are synced: deselected
// categories are un-followed so the chips reflect reality on resume.
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()

    if (await isBanned(session.user.id)) return forbidden()

    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

    const body = await request.json().catch(() => ({}))
    const { categoryIds } = body
    if (
      !Array.isArray(categoryIds) ||
      categoryIds.length > MAX_SELECTIONS ||
      !categoryIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 64)
    ) {
      return NextResponse.json({ error: "Invalid interests" }, { status: 400 })
    }

    const rl = await rateLimit(`onboarding-interests:${session.user.id}`, 10, 10 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: session.user.id,
        ip: getClientIp(request),
        metadata: { endpoint: "onboarding/interests" },
      })
      return NextResponse.json({ error: "Slow down." }, { status: 429 })
    }

    const uniqueIds = [...new Set(categoryIds)]

    // Only real, non-hidden categories count — client ids are never trusted.
    const valid = uniqueIds.length > 0
      ? await prisma.category.findMany({
          where: { id: { in: uniqueIds }, hidden: false },
          select: { id: true },
        })
      : []

    await prisma.categoryFollow.deleteMany({
      where: { userId: session.user.id, categoryId: { notIn: valid.map((c) => c.id) } },
    })
    if (valid.length > 0) {
      await prisma.categoryFollow.createMany({
        data: valid.map((c) => ({ userId: session.user.id, categoryId: c.id })),
        skipDuplicates: true,
      })
    }

    return NextResponse.json({ ok: true, followed: valid.length })
  } catch (error) {
    console.error("Onboarding interests error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
