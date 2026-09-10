import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { prisma } from "@/lib/prisma"

// POST — lightweight presence ping; updates lastSeenAt + ONLINE status.
// Uses JWT verification instead of getServerSession to avoid an extra DB round-trip.
export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })
    const userId = token?.id as string | undefined
    if (!userId) {
      return NextResponse.json({ ok: false }, { status: 401 })
    }

    // Fetch banned + lastSeenAt in one query; only write when stale (>15 min)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { banned: true, lastSeenAt: true },
    })
    if (!user || user.banned) {
      return NextResponse.json({ ok: false }, { status: 403 })
    }

    const stale =
      !user.lastSeenAt ||
      Date.now() - user.lastSeenAt.getTime() > 15 * 60 * 1000
    if (stale) {
      await prisma.user.update({
        where: { id: userId },
        data: { lastSeenAt: new Date(), status: "ONLINE" },
      })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Ping error:", error)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
