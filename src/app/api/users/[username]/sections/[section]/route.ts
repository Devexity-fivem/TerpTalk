import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { sessionCookieName } from "@/lib/auth"
import { getClientIp, hashIp, isSessionValid } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { getProfileSection, PUBLIC_PROFILE_NO_STORE, type ProfileTabSection } from "@/lib/public-profile"

const SECTIONS = new Set<ProfileTabSection>(["grows", "harvests", "followers", "following", "strains", "activity"])

// GET — cursor-paged grow portfolio page for the profile Grows/Harvests tabs.
// Same visibility/block scoping as the profile payload; never ships
// UNLISTED/PRIVATE rows to visitors.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string; section: string }> }
) {
  const ip = getClientIp(request)
  const rl = await rateLimit(`profile-section:${hashIp(ip)}`, 60, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  try {
    const { username, section } = await params
    if (typeof username !== "string" || username.length > 30) {
      return NextResponse.json({ error: "Invalid username" }, { status: 400 })
    }
    if (!SECTIONS.has(section as ProfileTabSection)) {
      return NextResponse.json({ error: "Unknown section" }, { status: 400 })
    }

    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET, cookieName: sessionCookieName })
    let viewerId = token?.id as string | undefined
    if (viewerId && !(await isSessionValid(viewerId, token?.sessionVersion as number | undefined))) {
      viewerId = undefined
    }

    const q = request.nextUrl.searchParams
    const cursor = q.get("cursor") ?? undefined
    // P3 deterministic filters — validated inside getProfileSection;
    // unknown values are ignored, never trusted.
    const statusRaw = q.get("status")
    const yearRaw = q.get("year")
    const filters = {
      ...(statusRaw === "active" || statusRaw === "completed" ? { status: statusRaw as "active" | "completed" } : {}),
      ...(q.get("strain") ? { strain: q.get("strain")!.slice(0, 80) } : {}),
      ...(q.get("stage") ? { stage: q.get("stage")!.slice(0, 20) } : {}),
      ...(yearRaw && /^\d{4}$/.test(yearRaw) ? { year: Number(yearRaw) } : {}),
    }
    const page = await getProfileSection(username, section as ProfileTabSection, viewerId, cursor, filters)
    if (!page) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }
    return NextResponse.json(page, { headers: PUBLIC_PROFILE_NO_STORE })
  } catch (error) {
    console.error("Profile section error:", error)
    return NextResponse.json({ error: "Failed to load section" }, { status: 500 })
  }
}
