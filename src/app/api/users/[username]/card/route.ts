import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { sessionCookieName } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { blockExistsBetween, getClientIp, hashIp, isSessionValid } from "@/lib/security"
import { getReputationTier, getTrustStanding } from "@/lib/reputation-config"
import { getTrustScore } from "@/lib/reputation"
import { getProfileTitle } from "@/lib/cosmetics"
import { rateLimit } from "@/lib/rate-limit"
import { TERPBOT_USERNAME } from "@/lib/terpbot-constants"

const NO_STORE = { "Cache-Control": "no-store, max-age=0, must-revalidate" }

// GET — lightweight social-status card for the UserPopover. Deliberately
// separate from the full profile endpoint so hover/tap previews don't pay
// for recent threads, diaries, or reputation history.
//
// Privacy contract:
// - banned/suspended/deleted users 404
// - a block in either direction 404s (same as the full profile)
// - publicMilestoneOptOut hides tier, reputation, and trust standing
// - never exposes email, reports, DMs, security data, or private fields
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const ip = getClientIp(request)
  const rl = await rateLimit(`user-card:${hashIp(ip)}`, 60, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  try {
    const { username } = await params
    if (typeof username !== "string" || username.length > 30) {
      return NextResponse.json({ error: "Invalid username" }, { status: 400 })
    }

    const profile = await prisma.profile.findFirst({
      where: { username: { equals: username, mode: "insensitive" } },
      select: {
        username: true,
        bio: true,
        avatarUrl: true,
        reputation: true,
        avatarFrame: true,
        profileTitle: true,
        publicMilestoneOptOut: true,
        user: {
          select: {
            id: true,
            name: true,
            image: true,
            role: true,
            createdAt: true,
            banned: true,
            suspendedUntil: true,
            badges: {
              orderBy: [{ pinned: "desc" as const }, { earnedAt: "asc" as const }],
              take: 4,
              select: { badge: { select: { name: true, icon: true } } },
            },
            _count: {
              select: { diaryCreator: true },
            },
          },
        },
      },
    })

    const suspended = !!profile?.user.suspendedUntil && profile.user.suspendedUntil > new Date()
    if (!profile || profile.user.banned || suspended) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const isBot = profile.username === TERPBOT_USERNAME

    // Block check only runs for signed-in viewers viewing someone else.
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET, cookieName: sessionCookieName })
    let viewerId = token?.id as string | undefined
    if (viewerId && !(await isSessionValid(viewerId, token?.sessionVersion as number | undefined))) {
      viewerId = undefined
    }
    if (viewerId && viewerId !== profile.user.id) {
      if (await blockExistsBetween(profile.user.id, viewerId)) {
        return NextResponse.json({ error: "User not found" }, { status: 404 })
      }
    }

    // Completed grows = harvested, non-deleted diaries.
    const harvestedGrows = isBot
      ? 0
      : await prisma.growDiary.count({
          where: { authorId: profile.user.id, deleted: false, harvested: true },
        })

    // Trust standing is a peer-validation signal — like tier it hides when
    // the member opts out of public status display.
    const hideStatus = profile.publicMilestoneOptOut
    const trustScore = hideStatus || isBot ? 0 : await getTrustScore(profile.user.id)
    const standing = hideStatus || isBot ? null : getTrustStanding(trustScore)
    const tier = hideStatus ? null : getReputationTier(profile.reputation)

    return NextResponse.json(
      {
        username: profile.username,
        name: profile.user.name,
        isBot,
        role: profile.user.role,
        image: profile.user.image || profile.avatarUrl,
        avatarFrame: profile.avatarFrame,
        customTitle: getProfileTitle(profile.profileTitle)?.name ?? null,
        bio: profile.bio ? profile.bio.slice(0, 160) : null,
        joinDate: profile.user.createdAt,
        statusHidden: hideStatus,
        reputation: hideStatus ? null : profile.reputation,
        tier: tier ? { name: tier.name, icon: tier.icon, color: tier.color, bg: tier.bg } : null,
        trustStanding: standing ? { name: standing.name, icon: standing.icon, color: standing.color, bg: standing.bg } : null,
        badges: profile.user.badges.map((b) => ({ name: b.badge.name, icon: b.badge.icon })),
        harvestedGrows,
        totalGrows: profile.user._count.diaryCreator,
      },
      { headers: NO_STORE }
    )
  } catch (error) {
    console.error("User card error:", error)
    return NextResponse.json({ error: "Failed to load user card" }, { status: 500 })
  }
}
