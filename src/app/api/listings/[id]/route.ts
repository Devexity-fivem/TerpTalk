import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { publicUserSelect, unauthorized, forbidden, isBanned, isModerator } from "@/lib/security"

const CATEGORIES = new Set(["EQUIPMENT", "SEEDS", "NUTRIENTS", "CLOTHING", "GEAR", "OTHER"])
const CONDITIONS = new Set(["NEW", "LIKE_NEW", "GOOD", "FAIR", "PARTS"])
const STATUSES = new Set(["ACTIVE", "SOLD", "REMOVED"])

async function canModify(listingId: string, userId: string, role?: string | null) {
  const listing = await prisma.listing.findUnique({ where: { id: listingId }, select: { sellerId: true } })
  if (!listing) return null
  if (listing.sellerId === userId || isModerator(role)) return listing
  return null
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const listing = await prisma.listing.findUnique({
      where: { id, status: "ACTIVE" },
      include: {
        seller: { select: publicUserSelect },
        images: { orderBy: { sortOrder: "asc" } },
        _count: { select: { inquiries: true } },
      },
    })
    if (!listing) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ listing })
  } catch (error) {
    console.error("Listing GET error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()
    if (await isBanned(session.user.id)) return forbidden()

    const { id } = await params
    const listing = await canModify(id, session.user.id, session.user.role)
    if (!listing) return forbidden()

    const body = await request.json().catch(() => ({}))
    const { title, description, price, condition, location, category, status, images } = body

    if (
      (title !== undefined && (typeof title !== "string" || title.length === 0 || title.length > 150)) ||
      (description !== undefined && (typeof description !== "string" || description.length > 5_000)) ||
      (price !== undefined && price !== null && (typeof price !== "number" || price < 0 || price > 1_000_000)) ||
      (condition !== undefined && condition !== null && (typeof condition !== "string" || !CONDITIONS.has(condition))) ||
      (location !== undefined && location !== null && typeof location !== "string") ||
      (category !== undefined && (typeof category !== "string" || !CATEGORIES.has(category))) ||
      (status !== undefined && (typeof status !== "string" || !STATUSES.has(status))) ||
      (images !== undefined && (!Array.isArray(images) || images.length > 5))
    ) {
      return NextResponse.json({ error: "Invalid listing data" }, { status: 400 })
    }

    let imageUpdate = undefined
    if (Array.isArray(images)) {
      const imageUrls = images
        .filter((img: unknown) => typeof img === "string" && /^https:\/\/.+/i.test(img) && img.length <= 500)
        .slice(0, 5)
      imageUpdate = {
        deleteMany: {},
        create: imageUrls.map((url: string, i: number) => ({ url, sortOrder: i })),
      }
    }

    const updated = await prisma.listing.update({
      where: { id },
      data: {
        ...(title !== undefined ? { title: title.trim() } : {}),
        ...(description !== undefined ? { description: description.trim() } : {}),
        ...(price !== undefined ? { price: price ?? null } : {}),
        ...(condition !== undefined ? { condition: condition ?? null } : {}),
        ...(location !== undefined ? { location: location ? location.trim().slice(0, 100) : null } : {}),
        ...(category !== undefined ? { category } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(imageUpdate ? { images: imageUpdate } : {}),
      },
      include: {
        seller: { select: publicUserSelect },
        images: { orderBy: { sortOrder: "asc" } },
      },
    })

    return NextResponse.json({ listing: updated })
  } catch (error) {
    console.error("Listing PATCH error:", error)
    return NextResponse.json({ error: "Failed to update listing" }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()
    if (await isBanned(session.user.id)) return forbidden()

    const { id } = await params
    const listing = await canModify(id, session.user.id, session.user.role)
    if (!listing) return forbidden()

    await prisma.listing.update({ where: { id }, data: { status: "REMOVED" } })
    return NextResponse.json({ removed: true })
  } catch (error) {
    console.error("Listing DELETE error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
