import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { forbidden } from "@/lib/security"
import { requireAdmin } from "@/lib/require-staff"

// GET — affiliate click analytics (DB-verified admin only)
export async function GET() {
  if (!(await requireAdmin())) return forbidden()

  const [total, byPartner, byProduct, byPage, recent] = await Promise.all([
    prisma.affiliateClick.count(),
    prisma.affiliateClick.groupBy({ by: ["partnerId"], _count: true }),
    prisma.affiliateClick.groupBy({ by: ["productId"], _count: true }),
    prisma.affiliateClick.groupBy({ by: ["page"], _count: true, orderBy: { _count: { page: "desc" } }, take: 10 }),
    prisma.affiliateClick.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { page: true, createdAt: true, partner: { select: { name: true } }, product: { select: { name: true } } },
    }),
  ])

  const partners = await prisma.affiliatePartner.findMany({ select: { id: true, name: true } })
  const products = await prisma.affiliateProduct.findMany({ select: { id: true, name: true } })
  const pName = Object.fromEntries(partners.map((p) => [p.id, p.name]))
  const prName = Object.fromEntries(products.map((p) => [p.id, p.name]))

  // Clicks per day, last 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000)
  const clicks = await prisma.affiliateClick.findMany({
    where: { createdAt: { gte: thirtyDaysAgo } },
    select: { createdAt: true },
  })
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
