import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { sessionCookieName } from "@/lib/auth"
import { getClientIp, hashIp, isSessionValid } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { getPublicProfileData, PUBLIC_PROFILE_NO_STORE } from "@/lib/public-profile"

// GET — public profile by username (PublicProfileDTO; safe fields only)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const ip = getClientIp(request)
  const rl = await rateLimit(`public-profile:${hashIp(ip)}`, 60, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  try {
    const { username } = await params
    if (typeof username !== "string" || username.length > 30) {
      return NextResponse.json({ error: "Invalid username" }, { status: 400 })
    }

    // Use JWT token for the viewer instead of a full DB session lookup —
    // resolved up front so diary lists/counts can be visibility-scoped.
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET, cookieName: sessionCookieName })
    let viewerId = token?.id as string | undefined
    if (viewerId && !(await isSessionValid(viewerId, token?.sessionVersion as number | undefined))) {
      viewerId = undefined
    }

    // All aggregation + privacy scoping lives in lib/public-profile — same
    // data the /u/[username] server component renders.
    const data = await getPublicProfileData(username, viewerId)
    if (!data) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const { profile, viewerBlocked, viewerFollowing, recentProgression, recentThreads, growDiaries, growSetups, harvestShelf } = data

    return NextResponse.json({
      profile,
      viewerBlocked,
      recentProgression,
      viewerFollowing,
      recentThreads,
      growDiaries,
      growSetups,
      harvestShelf,
    }, { headers: PUBLIC_PROFILE_NO_STORE })
  } catch (error) {
    console.error("Public profile error:", error)
    return NextResponse.json({ error: "Failed to load profile" }, { status: 500 })
  }
}
