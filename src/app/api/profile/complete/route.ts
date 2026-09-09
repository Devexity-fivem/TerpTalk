import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, LIMITS, USERNAME_REGEX, RESERVED_USERNAMES, getClientIp, logSecurityEvent, isBanned, forbidden } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return unauthorized()
    }

    const rl = await rateLimit(`profile-complete:${session.user.id}`, 15, 60 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: session.user.id, ip: getClientIp(request), metadata: { endpoint: "profile/complete" },
      })
      return NextResponse.json({ error: "Too many attempts" }, { status: 429 })
    }

    if (await isBanned(session.user.id)) return forbidden()

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }
    const { username, bio, location, website } = body as Record<string, unknown>

    if (Object.keys(body as Record<string, unknown>).length === 0) {
      return NextResponse.json({ error: "No fields provided" }, { status: 400 })
    }

    // Validate username if provided
    if (username !== undefined) {
      if (
        typeof username !== "string" ||
        username.length < LIMITS.USERNAME_MIN ||
        username.length > LIMITS.USERNAME_MAX ||
        !USERNAME_REGEX.test(username)
      ) {
        return NextResponse.json(
          { error: "Username must be 3-20 characters: letters, numbers, underscores only" },
          { status: 400 }
        )
      }

      if (RESERVED_USERNAMES.has(username.toLowerCase())) {
        return NextResponse.json(
          { error: "This username is reserved" },
          { status: 400 }
        )
      }

      const existingProfile = await prisma.profile.findFirst({
        where: { username: { equals: username.trim(), mode: "insensitive" } },
      })

      if (existingProfile && existingProfile.userId !== session.user.id) {
        return NextResponse.json(
          { error: "Username already taken" },
          { status: 400 }
        )
      }
    }

    const cleanBio = typeof bio === "string" ? bio.trim().slice(0, LIMITS.BIO_MAX) || null : bio === undefined ? undefined : null
    const cleanLocation = typeof location === "string" ? location.trim().slice(0, 100) || null : location === undefined ? undefined : null
    let cleanWebsite: string | null | undefined = undefined
    if (website !== undefined) {
      if (website !== null && (typeof website !== "string" || website.length > LIMITS.URL_MAX)) {
        return NextResponse.json({ error: "Website URL too long" }, { status: 400 })
      }
      if (typeof website === "string" && website.trim()) {
        try {
          const url = new URL(website.trim())
          if (url.protocol !== "https:") {
            return NextResponse.json({ error: "Invalid website URL" }, { status: 400 })
          }
          cleanWebsite = url.toString().slice(0, LIMITS.URL_MAX)
        } catch {
          return NextResponse.json({ error: "Invalid website URL" }, { status: 400 })
        }
      } else {
        cleanWebsite = null
      }
    }

    // Update profile
    const profile = await prisma.profile.update({
      where: { userId: session.user.id },
      data: {
        ...(typeof username === "string" && { username: username.trim() }),
        ...(cleanBio !== undefined && { bio: cleanBio }),
        ...(cleanLocation !== undefined && { location: cleanLocation }),
        ...(cleanWebsite !== undefined && { website: cleanWebsite }),
      },
      select: {
        username: true,
        bio: true,
        location: true,
        website: true,
        reputation: true,
      },
    })

    return NextResponse.json({ profile }, { status: 200 })
  } catch (error) {
    console.error("Profile update error:", error)
    return NextResponse.json(
      { error: "Failed to update profile" },
      { status: 500 }
    )
  }
}
