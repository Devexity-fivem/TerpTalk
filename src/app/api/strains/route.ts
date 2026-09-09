import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, LIMITS, getClientIp, logSecurityEvent, isBanned, forbidden } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { awardReputation, REP_POINTS } from "@/lib/reputation"

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return unauthorized()
    }

    const body = await request.json().catch(() => ({}))
    const {
      name,
      genetics,
      breeder,
      type,
      description,
      growingInfo,
    } = body

    if (typeof name !== "string" || !name.trim()) {
      return NextResponse.json(
        { error: "Strain name is required" },
        { status: 400 }
      )
    }

    if (name.length > LIMITS.STRAIN_NAME_MAX || (description && description.length > LIMITS.DESCRIPTION_MAX)) {
      return NextResponse.json(
        { error: "Content exceeds maximum length" },
        { status: 400 }
      )
    }

    // Rate limit: 10 strains per day per user
    const rl = await rateLimit(`strain:${session.user.id}`, 10, 24 * 60 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: session.user.id,
        ip: getClientIp(request),
        metadata: { endpoint: "strains" },
      })
      return NextResponse.json(
        { error: "Too many submissions. Please try again later." },
        { status: 429 }
      )
    }

    if (await isBanned(session.user.id)) {
      return forbidden("Your account is suspended")
    }

    // Check if strain already exists
    const existingStrain = await prisma.strain.findUnique({
      where: { name },
    })

    if (existingStrain) {
      return NextResponse.json(
        { error: "Strain already exists" },
        { status: 400 }
      )
    }

    // Create strain
    const strain = await prisma.strain.create({
      data: {
        name,
        genetics,
        breeder,
        type,
        description,
        growingInfo,
        createdById: session.user.id,
      },
    })

    await awardReputation(
      session.user.id,
      "STRAIN_CREATED",
      REP_POINTS.STRAIN_CREATED,
      `Added strain "${name.slice(0, 60)}"`
    ).catch(() => {})

    return NextResponse.json({ strain }, { status: 201 })
  } catch (error) {
    console.error("Strain creation error:", error)
    return NextResponse.json(
      { error: "Failed to create strain" },
      { status: 500 }
    )
  }
}
