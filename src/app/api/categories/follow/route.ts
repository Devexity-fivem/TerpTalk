import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, getClientIp, logSecurityEvent, isBanned, forbidden, isModerator } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { checkMaintenance } from "@/lib/maintenance"

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()

    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

    const body = await request.json().catch(() => ({}))
    const { categoryId } = body

    if (typeof categoryId !== "string" || !categoryId) {
      return NextResponse.json({ error: "categoryId is required" }, { status: 400 })
    }

    const rl = await rateLimit(`category-follow:${session.user.id}`, 60, 10 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: session.user.id,
        ip: getClientIp(request),
        metadata: { endpoint: "categories/follow" },
      })
      return NextResponse.json({ error: "Slow down." }, { status: 429 })
    }

    if (await isBanned(session.user.id)) return forbidden("Your account is suspended")

    const currentUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    })

    const category = await prisma.category.findUnique({ where: { id: categoryId } })
    if (!category) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 })
    }

    if (category.hidden && !isModerator(currentUser?.role)) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 })
    }

    const existing = await prisma.categoryFollow.findUnique({
      where: { userId_categoryId: { userId: session.user.id, categoryId } },
    })
    if (existing) {
      await prisma.categoryFollow.delete({ where: { id: existing.id } })
      return NextResponse.json({ following: false })
    }

    await prisma.categoryFollow.create({
      data: { userId: session.user.id, categoryId },
    })
    return NextResponse.json({ following: true })
  } catch (error) {
    console.error("Category follow error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
