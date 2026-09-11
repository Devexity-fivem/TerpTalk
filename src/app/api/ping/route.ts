import { NextRequest, NextResponse } from "next/server"
import { after } from "next/server"
import { getToken } from "next-auth/jwt"
import { prisma } from "@/lib/prisma"
import { sessionCookieName } from "@/lib/auth"
import { forbidden, unauthorized } from "@/lib/security"
import { awardReputation } from "@/lib/reputation"
import { pruneChatMessagesIfDue } from "@/lib/chat-cleanup"

// POST — lightweight presence ping; updates lastSeenAt + ONLINE status.
// Uses JWT verification instead of getServerSession to avoid an extra DB round-trip.
export async function POST(request: NextRequest) {
  try {
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
      cookieName: sessionCookieName,
    })
    const userId = token?.id as string | undefined
    if (!userId) return unauthorized()

    // Fetch banned, sessionVersion, and lastSeenAt in one query; only write when stale (>15 min)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { banned: true, sessionVersion: true, lastSeenAt: true },
    })
    if (!user || user.banned || (token?.sessionVersion as number | undefined ?? 0) !== (user.sessionVersion ?? 0)) {
      return forbidden()
    }

    const stale =
      !user.lastSeenAt ||
      Date.now() - user.lastSeenAt.getTime() > 15 * 60 * 1000
    if (stale) {
      await prisma.user.update({
        where: { id: userId },
        data: { lastSeenAt: new Date(), status: "ONLINE" },
      })

      // Award a small daily check-in rep once per 24 hours.
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const recentLogin = await prisma.reputationEvent.findFirst({
        where: { userId, type: "DAILY_LOGIN", createdAt: { gte: dayAgo } },
        orderBy: { createdAt: "desc" },
      })
      if (!recentLogin) {
        await awardReputation(userId, "DAILY_LOGIN", 1, "Daily check-in")
      }
    }

    // Prune old chat messages in the background, throttled to once per hour.
    after(async () => {
      await pruneChatMessagesIfDue()
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Ping error:", error)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
