import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { sessionCookieName } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { blockExistsBetween, getClientIp, hashIp, isSessionValid } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { PUBLIC_REP_TYPES, publicRepLabel, getReputationTier, getTierProgress } from "@/lib/reputation-config"
import { TERPBOT_USERNAME } from "@/lib/terpbot-constants"

// GET — public, sanitized reputation history for a member. Only shows event
// types in PUBLIC_REP_TYPES, uses safe labels instead of raw reasons (which
// can embed titles/usernames), and never exposes actor or staff details.
// Reversed events still appear (marked) — transparency about the record.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const ip = getClientIp(request)
  const rl = await rateLimit(`rep-history:${hashIp(ip)}`, 60, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  try {
    const { username } = await params
    if (typeof username !== "string" || username.length > 30) {
      return NextResponse.json({ error: "Invalid username" }, { status: 400 })
    }

    const profile = await prisma.profile.findFirst({
      where: { username: { equals: username, mode: "insensitive" }, user: { banned: false } },
      select: { userId: true, reputation: true },
    })
    if (!profile || username.toLowerCase() === TERPBOT_USERNAME) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    // Same block policy as the public profile endpoint — a member who
    // blocked the viewer doesn't expose their rep history to them.
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET, cookieName: sessionCookieName })
    let viewerId = token?.id as string | undefined
    if (viewerId && !(await isSessionValid(viewerId, token?.sessionVersion as number | undefined))) {
      viewerId = undefined
    }
    if (viewerId && viewerId !== profile.userId && (await blockExistsBetween(profile.userId, viewerId))) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const { searchParams } = new URL(request.url)
    const cursor = searchParams.get("cursor") || undefined

    const events = await prisma.reputationEvent.findMany({
      where: {
        userId: profile.userId,
        type: { in: [...PUBLIC_REP_TYPES] },
        // A reversal's counter-entry shows; the reversed original is stamped
        // with reversedAt and still listed so the record reads honestly.
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 26,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    const hasMore = events.length > 25
    const page = hasMore ? events.slice(0, 25) : events

    const tier = getReputationTier(profile.reputation)
    return NextResponse.json({
      reputation: profile.reputation,
      tier: { name: tier.name, icon: tier.icon, color: tier.color },
      progress: getTierProgress(profile.reputation),
      events: page.map((e) => ({
        id: e.id,
        label: publicRepLabel(e.type),
        amount: e.amount,
        reversed: !!e.reversedAt,
        createdAt: e.createdAt,
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    })
  } catch (error) {
    console.error("Reputation history error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
