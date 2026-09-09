import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, LIMITS, USERNAME_REGEX, RESERVED_USERNAMES, getClientIp, logSecurityEvent } from "@/lib/security"
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

    const body = await request.json().catch(() => ({}))
    const { username, bio, location, website } = body

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
        where: { username: { equals: username, mode: "insensitive" } },
      })

      if (existingProfile && existingProfile.userId !== session.user.id) {
        return NextResponse.json(
          { error: "Username already taken" },
          { status: 400 }
        )
      }
    }

    // Validate lengths
    if (bio && bio.length > LIMITS.BIO_MAX) {
      return NextResponse.json({ error: "Bio too long" }, { status: 400 })
    }
    if (location && location.length > 100) {
      return NextResponse.json({ error: "Location too long" }, { status: 400 })
    }
    if (website && website.length > LIMITS.URL_MAX) {
      return NextResponse.json({ error: "Website URL too long" }, { status: 400 })
    }

    // Basic URL validation
    if (website) {
      try {
        const url = new URL(website)
        if (url.protocol !== "https:") {
          return NextResponse.json({ error: "Invalid website URL" }, { status: 400 })
        }
      } catch {
        return NextResponse.json({ error: "Invalid website URL" }, { status: 400 })
      }
    }

    // Update profile
    const profile = await prisma.profile.update({
      where: { userId: session.user.id },
      data: {
        ...(username && { username }),
        ...(bio !== undefined && { bio }),
        ...(location !== undefined && { location }),
        ...(website !== undefined && { website }),
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
