import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, forbidden, isBanned, getClientIp, logSecurityEvent } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()
    if (await isBanned(session.user.id)) return forbidden()

    const { id } = await params

    const listing = await prisma.listing.findUnique({
      where: { id, status: "ACTIVE" },
      select: { id: true, sellerId: true, title: true },
    })
    if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 })
    if (listing.sellerId === session.user.id) {
      return NextResponse.json({ error: "Cannot inquire on your own listing" }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const { message } = body
    if (typeof message !== "string" || message.trim().length < 10 || message.length > 2_000) {
      return NextResponse.json({ error: "Message must be 10-2000 characters" }, { status: 400 })
    }

    const rl = await rateLimit(`listing-inquiry:${session.user.id}`, 20, 60 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: session.user.id,
        ip: getClientIp(request),
        metadata: { endpoint: "listings/[id]/inquire" },
      })
      return NextResponse.json({ error: "Slow down." }, { status: 429 })
    }

    const inquiry = await prisma.listingInquiry.create({
      data: {
        listingId: id,
        senderId: session.user.id,
        message: message.trim(),
      },
    })

    await prisma.notification.create({
      data: {
        userId: listing.sellerId,
        type: "LISTING_INQUIRY",
        title: "New inquiry on your listing",
        content: `Someone asked about "${listing.title.slice(0, 80)}"`,
        link: `/marketplace/${listing.id}`,
      },
    }).catch(() => {})

    return NextResponse.json({ inquiry }, { status: 201 })
  } catch (error) {
    console.error("Listing inquiry error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
