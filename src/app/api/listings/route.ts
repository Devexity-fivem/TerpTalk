import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { publicUserSelect, unauthorized, forbidden, getClientIp, logSecurityEvent, isBanned, isTrustedForLinks } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

const CATEGORIES = new Set(["EQUIPMENT", "SEEDS", "NUTRIENTS", "CLOTHING", "GEAR", "OTHER"])
const CONDITIONS = new Set(["NEW", "LIKE_NEW", "GOOD", "FAIR", "PARTS"])

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const category = searchParams.get("category")
    const q = searchParams.get("q")?.trim() || ""

    const listings = await prisma.listing.findMany({
      where: {
        status: "ACTIVE",
        ...(category && CATEGORIES.has(category) ? { category } : {}),
        ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
      },
      take: 50,
      orderBy: { createdAt: "desc" },
      include: {
        seller: { select: publicUserSelect },
        images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } },
        _count: { select: { inquiries: true } },
      },
    })

    return NextResponse.json({ listings })
  } catch (error) {
    console.error("Listings GET error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()

    if (await isBanned(session.user.id)) return forbidden("Your account is suspended")

    const trusted = await isTrustedForLinks(session.user.id)
    if (!trusted) {
      return NextResponse.json(
        { error: "You need 24 hours and 10 reputation to list items." },
        { status: 403 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const { title, description, price, condition, location, category, images } = body

    if (
      typeof title !== "string" || !title.trim() || title.length > 150 ||
      typeof description !== "string" || description.length < 20 || description.length > 5_000 ||
      (price !== undefined && price !== null && (typeof price !== "number" || price < 0 || price > 1_000_000)) ||
      (condition !== undefined && condition !== null && (typeof condition !== "string" || !CONDITIONS.has(condition))) ||
      (location !== undefined && location !== null && typeof location !== "string") ||
      typeof category !== "string" || !CATEGORIES.has(category) ||
      !Array.isArray(images) || images.length > 5
    ) {
      return NextResponse.json({ error: "Invalid listing data" }, { status: 400 })
    }

    const imageUrls = images
      .filter((img: unknown) => typeof img === "string" && /^https:\/\/.+/i.test(img) && img.length <= 500)
      .slice(0, 5)

    const rl = await rateLimit(`listing:${session.user.id}`, 10, 60 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: session.user.id,
        ip: getClientIp(request),
        metadata: { endpoint: "listings" },
      })
      return NextResponse.json({ error: "Slow down." }, { status: 429 })
    }

    const listing = await prisma.listing.create({
      data: {
        title: title.trim(),
        description: description.trim(),
        price: price ?? null,
        condition: condition ?? null,
        location: location ? location.trim().slice(0, 100) : null,
        category,
        sellerId: session.user.id,
        images: {
          create: imageUrls.map((url: string, i: number) => ({ url, sortOrder: i })),
        },
      },
      include: {
        seller: { select: publicUserSelect },
        images: { orderBy: { sortOrder: "asc" } },
      },
    })

    return NextResponse.json({ listing }, { status: 201 })
  } catch (error) {
    console.error("Listing POST error:", error)
    return NextResponse.json({ error: "Failed to create listing" }, { status: 500 })
  }
}
