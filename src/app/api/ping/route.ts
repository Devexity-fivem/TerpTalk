import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

// POST — lightweight presence ping; updates lastSeenAt + ONLINE status.
// Called once per session from the navigation component.
export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  // Only write if lastSeen is stale (>15 min) to avoid write-per-request
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { lastSeenAt: true },
  })
  const stale = !user?.lastSeenAt || Date.now() - user.lastSeenAt.getTime() > 15 * 60 * 1000
  if (stale) {
    await prisma.user.update({
      where: { id: session.user.id },
      data: { lastSeenAt: new Date(), status: "ONLINE" },
    })
  }

  return NextResponse.json({ ok: true })
}
