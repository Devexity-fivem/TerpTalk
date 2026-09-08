import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, isAdmin, forbidden } from "@/lib/security"
import { isValidUrl, slugify, cleanText, DEFAULT_DISCLOSURE } from "@/lib/affiliate"

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return null
  if (!isAdmin((session.user as { role?: string }).role)) return null
  return session
}

// GET — all partners (admin view incl. inactive)
export async function GET() {
  if (!(await requireAdmin())) return unauthorized()
  const partners = await prisma.affiliatePartner.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { products: true, clicks: true } } },
  })
  const setting = await prisma.setting.findUnique({ where: { key: "affiliateDisclosure" } })
  return NextResponse.json({
    partners,
    disclosure: setting?.value || DEFAULT_DISCLOSURE,
  })
}

// POST — create partner or update disclosure: { type: "partner", ... } | { type: "disclosure", value }
export async function POST(request: Request) {
  const session = await requireAdmin()
  if (!session) return forbidden()

  const body = await request.json().catch(() => ({}))

  if (body.type === "disclosure") {
    const value = cleanText(body.value, 500)
    if (!value) return NextResponse.json({ error: "Disclosure required" }, { status: 400 })
    await prisma.setting.upsert({
      where: { key: "affiliateDisclosure" },
      update: { value },
      create: { key: "affiliateDisclosure", value },
    })
    return NextResponse.json({ ok: true })
  }

  const { name, websiteUrl, affiliateUrl } = body
  if (!name || !websiteUrl || !affiliateUrl) {
    return NextResponse.json({ error: "Name, website URL and affiliate URL required" }, { status: 400 })
  }
  if (!isValidUrl(websiteUrl) || !isValidUrl(affiliateUrl)) {
    return NextResponse.json({ error: "URLs must be valid https:// links" }, { status: 400 })
  }

  const base = slugify(String(name))
  let slug = base
  while (await prisma.affiliatePartner.findUnique({ where: { slug } })) {
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`
  }

  const partner = await prisma.affiliatePartner.create({
    data: {
      name: String(name).slice(0, 80),
      slug,
      logoUrl: cleanText(body.logoUrl, 500),
      websiteUrl,
      affiliateUrl,
      promoCode: cleanText(body.promoCode, 40),
      description: String(body.description || "").slice(0, 1000),
      promoText: cleanText(body.promoText, 300),
      promoStart: body.promoStart ? new Date(body.promoStart) : null,
      promoEnd: body.promoEnd ? new Date(body.promoEnd) : null,
      active: body.active !== false,
      featured: !!body.featured,
      adminNotes: cleanText(body.adminNotes, 1000),
    },
  })
  return NextResponse.json({ partner }, { status: 201 })
}

// PATCH — update partner: { id, ...fields }
export async function PATCH(request: Request) {
  const session = await requireAdmin()
  if (!session) return forbidden()
  const body = await request.json().catch(() => ({}))
  const { id, ...fields } = body
  if (typeof id !== "string") return NextResponse.json({ error: "id required" }, { status: 400 })

  if (fields.affiliateUrl && !isValidUrl(fields.affiliateUrl)) {
    return NextResponse.json({ error: "Invalid affiliate URL" }, { status: 400 })
  }
  if (fields.websiteUrl && !isValidUrl(fields.websiteUrl)) {
    return NextResponse.json({ error: "Invalid website URL" }, { status: 400 })
  }

  const partner = await prisma.affiliatePartner.update({
    where: { id },
    data: {
      ...(fields.name && { name: String(fields.name).slice(0, 80) }),
      ...(fields.logoUrl !== undefined && { logoUrl: cleanText(fields.logoUrl, 500) }),
      ...(fields.websiteUrl && { websiteUrl: fields.websiteUrl }),
      ...(fields.affiliateUrl && { affiliateUrl: fields.affiliateUrl }),
      ...(fields.promoCode !== undefined && { promoCode: cleanText(fields.promoCode, 40) }),
      ...(fields.description !== undefined && { description: String(fields.description).slice(0, 1000) }),
      ...(fields.promoText !== undefined && { promoText: cleanText(fields.promoText, 300) }),
      ...(fields.promoStart !== undefined && { promoStart: fields.promoStart ? new Date(fields.promoStart) : null }),
      ...(fields.promoEnd !== undefined && { promoEnd: fields.promoEnd ? new Date(fields.promoEnd) : null }),
      ...(fields.active !== undefined && { active: !!fields.active }),
      ...(fields.featured !== undefined && { featured: !!fields.featured }),
      ...(fields.adminNotes !== undefined && { adminNotes: cleanText(fields.adminNotes, 1000) }),
    },
  })
  return NextResponse.json({ partner })
}

// DELETE — ?id=
export async function DELETE(request: Request) {
  const session = await requireAdmin()
  if (!session) return forbidden()
  const { searchParams } = new URL(request.url)
  const id = searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })
  await prisma.affiliatePartner.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
