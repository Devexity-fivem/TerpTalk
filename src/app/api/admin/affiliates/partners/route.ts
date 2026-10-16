import { NextResponse } from "next/server"
import { parsePageParams } from "@/lib/pagination"
import { prisma } from "@/lib/prisma"
import { unauthorized, forbidden } from "@/lib/security"
import { requireAdmin } from "@/lib/require-staff"
import { isValidUrl, slugify, cleanText, DEFAULT_DISCLOSURE } from "@/lib/affiliate"
import { rateLimit } from "@/lib/rate-limit"
import { revalidateTag } from "next/cache"

// null → null; valid date → Date; garbage → undefined sentinel (caller 400s)
// so a malformed promoStart/promoEnd can't reach Prisma as `Invalid Date`.
function parseOptionalDate(v: unknown): Date | null | undefined {
  if (v === null || v === undefined || v === "") return null
  const d = new Date(v as string)
  return Number.isNaN(d.getTime()) ? undefined : d
}

// GET — all partners (admin view incl. inactive)
export async function GET(request: Request) {
  const admin = await requireAdmin()
  if (!admin) return unauthorized()

  const rl = await rateLimit(`admin-affiliate-partners:${admin.id}`, 30, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const { searchParams } = new URL(request.url)
  const { limit, skip } = parsePageParams(searchParams)

  const partners = await prisma.affiliatePartner.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { products: true, clicks: true } } },
    take: limit,
    skip,
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

  const promoStart = parseOptionalDate(body.promoStart)
  const promoEnd = parseOptionalDate(body.promoEnd)
  if (promoStart === undefined || promoEnd === undefined) {
    return NextResponse.json({ error: "Invalid promo date" }, { status: 400 })
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
      promoStart,
      promoEnd,
      active: body.active !== false,
      featured: !!body.featured,
      adminNotes: cleanText(body.adminNotes, 1000),
    },
  })
  revalidateTag("deals", { expire: 0 })
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
  if (fields.promoStart !== undefined && parseOptionalDate(fields.promoStart) === undefined) {
    return NextResponse.json({ error: "Invalid promo date" }, { status: 400 })
  }
  if (fields.promoEnd !== undefined && parseOptionalDate(fields.promoEnd) === undefined) {
    return NextResponse.json({ error: "Invalid promo date" }, { status: 400 })
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
      ...(fields.promoStart !== undefined && { promoStart: parseOptionalDate(fields.promoStart) }),
      ...(fields.promoEnd !== undefined && { promoEnd: parseOptionalDate(fields.promoEnd) }),
      ...(fields.active !== undefined && { active: !!fields.active }),
      ...(fields.featured !== undefined && { featured: !!fields.featured }),
      ...(fields.adminNotes !== undefined && { adminNotes: cleanText(fields.adminNotes, 1000) }),
    },
  }).catch(() => null)
  if (!partner) return NextResponse.json({ error: "Partner not found" }, { status: 404 })
  revalidateTag("deals", { expire: 0 })
  return NextResponse.json({ partner })
}

// DELETE — ?id=
export async function DELETE(request: Request) {
  const session = await requireAdmin()
  if (!session) return forbidden()
  const { searchParams } = new URL(request.url)
  const id = searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })
  const deleted = await prisma.affiliatePartner.deleteMany({ where: { id } })
  if (!deleted.count) return NextResponse.json({ error: "Partner not found" }, { status: 404 })
  revalidateTag("deals", { expire: 0 })
  return NextResponse.json({ ok: true })
}
