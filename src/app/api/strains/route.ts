import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, LIMITS, getClientIp, logSecurityEvent, isBanned, forbidden, enforceLinkTrust } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { awardReputation, REP_POINTS } from "@/lib/reputation"
import { checkMaintenance } from "@/lib/maintenance"
import { revalidateTag } from "next/cache"

export async function POST(request: Request) {
  try {
    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

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

    const cleanName = name.trim().slice(0, LIMITS.STRAIN_NAME_MAX)

    const VALID_TYPES = new Set(["SATIVA", "INDICA", "HYBRID", "RUDERALIS", "AUTO_FLOWER", "CBD", "OTHER"])
    if (typeof type !== "string" || !VALID_TYPES.has(type.toUpperCase())) {
      return NextResponse.json({ error: "Invalid strain type" }, { status: 400 })
    }

    if (
      (genetics && typeof genetics === "string" && genetics.length > 200) ||
      (breeder && typeof breeder === "string" && breeder.length > 200) ||
      (description && typeof description === "string" && description.length > LIMITS.DESCRIPTION_MAX) ||
      (growingInfo && typeof growingInfo === "string" && growingInfo.length > LIMITS.DESCRIPTION_MAX)
    ) {
      return NextResponse.json({ error: "Content exceeds maximum length" }, { status: 400 })
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

    const linkBlock = await enforceLinkTrust(
      [description, growingInfo].filter((f): f is string => typeof f === "string").join("\n"),
      session.user.id,
      request,
      "strains"
    )
    if (linkBlock) return linkBlock

    // Check if strain already exists (case-insensitive)
    const existingStrain = await prisma.strain.findFirst({
      where: { name: { equals: cleanName, mode: "insensitive" } },
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
        name: cleanName,
        genetics: typeof genetics === "string" ? genetics.trim().slice(0, 200) : null,
        breeder: typeof breeder === "string" ? breeder.trim().slice(0, 200) : null,
        type: type.toUpperCase(),
        description: typeof description === "string" ? description.trim().slice(0, LIMITS.DESCRIPTION_MAX) : null,
        growingInfo: typeof growingInfo === "string" ? growingInfo.trim().slice(0, LIMITS.DESCRIPTION_MAX) : null,
        createdById: session.user.id,
      },
    })

    revalidateTag("strains", { expire: 0 })

    await awardReputation(
      session.user.id,
      "STRAIN_CREATED",
      REP_POINTS.STRAIN_CREATED,
      `Added strain "${name.slice(0, 60)}"`,
      { key: `strain:${strain.id}`, sourceType: "STRAIN", sourceId: strain.id }
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
