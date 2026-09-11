import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { forbidden } from "@/lib/security"
import { requireAdmin } from "@/lib/require-staff"
import { rateLimit } from "@/lib/rate-limit"

const MAX_DAYS = 90
const MAX_CLICKS_WINDOW = 5000

// GET — affiliate click analytics (DB-verified admin only)
// ?days=7|30|90 (default 30)
export async function GET(request: Request) {
  const admin = await requireAdmin()
  if (!admin) return forbidden()

  const rl = await rateLimit(`admin-affiliate-stats:${admin.id}`, 10, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const { searchParams } = new URL(request.url)
  const rawDays = searchParams.get("days")
  const days = Math.min(
    Number.isInteger(Number(rawDays)) && Number(rawDays) > 0 ? Number(rawDays) : 30,
    MAX_DAYS
  )
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const [total, byPartner, byProduct, byPage, recent, clicks] = await Promise.all([
    prisma.affiliateClick.count(),
    prisma.affiliateClick.groupBy({ by: ["partnerId"], _count: true }),
    prisma.affiliateClick.groupBy({ by: ["productId"], _count: true }),
    prisma.affiliateClick.groupBy({ by: ["page"], _count: true, orderBy: { _count: { page: "desc" } }, take: 10 }),
    prisma.affiliateClick.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { page: true, createdAt: true, partner: { select: { name: true } }, product: { select: { name: true } } },
    }),
    prisma.affiliateClick.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: MAX_CLICKS_WINDOW,
      select: { createdAt: true },
    }),
  ])

  const partners = await prisma.affiliatePartner.findMany({ select: { id: true, name: true } })
  const products = await prisma.affiliateProduct.findMany({ select: { id: true, name: true } })
  const pName = Object.fromEntries(partners.map((p) => [p.id, p.name]))
  const prName = Object.fromEntries(products.map((p) => [p.id, p.name]))

  const byDay: Record<string, number> = {}
  for (const c of clicks) {
    const day = c.createdAt.toISOString().slice(0, 10)
    byDay[day] = (byDay[day] || 0) + 1
  }

  return NextResponse.json({
    total,
    byPartner: byPartner.map((b) => ({ name: pName[b.partnerId] || "?", clicks: b._count })),
    byProduct: byProduct.filter((b) => b.productId).map((b) => ({ name: prName[b.productId!] || "?", clicks: b._count })).sort((a, b) => b.clicks - a.clicks),
    byPage: byPage.map((b) => ({ page: b.page || "unknown", clicks: b._count })),
    byDay: Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).map(([day, clicks]) => ({ day, clicks })),
    recent,
  })
}
