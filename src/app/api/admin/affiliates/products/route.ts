import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, isAdmin, forbidden } from "@/lib/security"
import { isValidUrl, slugify, cleanText } from "@/lib/affiliate"

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id || !isAdmin((session.user as { role?: string }).role)) return null
  return session
}

// GET — all products with partner + click counts
export async function GET() {
  if (!(await requireAdmin())) return unauthorized()
  const products = await prisma.affiliateProduct.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      partner: { select: { id: true, name: true, slug: true, promoCode: true, affiliateUrl: true, active: true } },
      _count: { select: { clicks: true } },
    },
  })
  return NextResponse.json({ products })
}

// POST — create product
export async function POST(request: Request) {
  if (!(await requireAdmin())) return forbidden()
  const body = await request.json().catch(() => ({}))
  const { name, partnerId, description, category } = body

  if (!name || !partnerId || !description || !category) {
    return NextResponse.json({ error: "Name, partner, description and category required" }, { status: 400 })
  }
  const partner = await prisma.affiliatePartner.findUnique({ where: { id: partnerId }, select: { id: true } })
  if (!partner) return NextResponse.json({ error: "Partner not found" }, { status: 404 })

  for (const u of [body.productUrl, body.affiliateUrl, body.imageUrl]) {
    if (u && !isValidUrl(u)) {
      return NextResponse.json({ error: "URLs must be valid https:// links" }, { status: 400 })
    }
  }

  const base = slugify(String(name))
  let slug = base
  while (await prisma.affiliateProduct.findUnique({ where: { slug } })) {
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`
  }

  const product = await prisma.affiliateProduct.create({
    data: {
      name: String(name).slice(0, 100),
      slug,
      partnerId,
      productUrl: body.productUrl || null,
      affiliateUrl: body.affiliateUrl || null,
      imageUrl: body.imageUrl || null,
      description: String(description).slice(0, 2000),
      category: String(category).slice(0, 60),
      pros: cleanText(body.pros, 2000),
      cons: cleanText(body.cons, 2000),
      recommendedFor: cleanText(body.recommendedFor, 300),
      price: cleanText(body.price, 40),
      promoCode: cleanText(body.promoCode, 40),
      active: body.active !== false,
      featured: !!body.featured,
    },
  })
  return NextResponse.json({ product }, { status: 201 })
}

// PATCH — update product fields
export async function PATCH(request: Request) {
  if (!(await requireAdmin())) return forbidden()
  const body = await request.json().catch(() => ({}))
  const { id, ...fields } = body
  if (typeof id !== "string") return NextResponse.json({ error: "id required" }, { status: 400 })

  for (const k of ["productUrl", "affiliateUrl", "imageUrl"]) {
    if (fields[k] && !isValidUrl(fields[k])) {
      return NextResponse.json({ error: `Invalid ${k}` }, { status: 400 })
    }
  }

  const product = await prisma.affiliateProduct.update({
    where: { id },
    data: {
      ...(fields.name && { name: String(fields.name).slice(0, 100) }),
      ...(fields.productUrl !== undefined && { productUrl: fields.productUrl || null }),
      ...(fields.affiliateUrl !== undefined && { affiliateUrl: fields.affiliateUrl || null }),
      ...(fields.imageUrl !== undefined && { imageUrl: fields.imageUrl || null }),
      ...(fields.description !== undefined && { description: String(fields.description).slice(0, 2000) }),
      ...(fields.category && { category: String(fields.category).slice(0, 60) }),
      ...(fields.pros !== undefined && { pros: cleanText(fields.pros, 2000) }),
      ...(fields.cons !== undefined && { cons: cleanText(fields.cons, 2000) }),
      ...(fields.recommendedFor !== undefined && { recommendedFor: cleanText(fields.recommendedFor, 300) }),
      ...(fields.price !== undefined && { price: cleanText(fields.price, 40) }),
      ...(fields.promoCode !== undefined && { promoCode: cleanText(fields.promoCode, 40) }),
      ...(fields.active !== undefined && { active: !!fields.active }),
      ...(fields.featured !== undefined && { featured: !!fields.featured }),
    },
  })
  return NextResponse.json({ product })
}

export async function DELETE(request: Request) {
  if (!(await requireAdmin())) return forbidden()
  const id = new URL(request.url).searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })
  await prisma.affiliateProduct.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
