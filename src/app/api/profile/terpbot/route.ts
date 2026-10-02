import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { sessionCookieName } from "@/lib/auth"
import { unauthorized, isSessionValid } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { buildProfileIntel } from "@/lib/terpbot-profile"

/**
 * GET /api/profile/terpbot — TerpBot Profile Intelligence (P5).
 *
 * Owner-only by construction: the subject is the session user, there is
 * no username/userId parameter, so no caller can ever request another
 * member's data. The payload deliberately mixes the owner's private
 * rows (allowed — it is their own data) and must never be embedded in
 * any public surface.
 */
export async function GET(request: NextRequest) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET, cookieName: sessionCookieName })
  let viewerId = token?.id as string | undefined
  if (viewerId && !(await isSessionValid(viewerId, token?.sessionVersion as number | undefined))) {
    viewerId = undefined
  }
  if (!viewerId) return unauthorized()
  // Deferred + bounded: the About tab fetches this lazily; the analysis
  // itself is a fixed set of aggregates + at most one grow snapshot.
  const rl = await rateLimit(`profile-terpbot:${viewerId}`, 30, 60 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many insight requests — try again later" },
      { status: 429 }
    )
  }

  const intel = await buildProfileIntel(viewerId)
  return NextResponse.json(intel, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  })
}
