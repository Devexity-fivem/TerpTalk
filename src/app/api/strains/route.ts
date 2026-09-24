import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, LIMITS, getClientIp, hashIp, logSecurityEvent, isBanned, forbidden, enforceLinkTrust } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { awardReputation, REP_POINTS } from "@/lib/reputation"
import { STRAIN_MIN_PAID_DESCRIPTION } from "@/lib/reputation-config"
import { checkMaintenance } from "@/lib/maintenance"
import { escapeLike } from "@/lib/strain-stats"
import {
  STRAIN_TYPES,
  parseStrainEffects,
  parseStrainFlavors,
  parseStrainDifficulty,
  parseThc,
  parseFloweringWeeks,
} from "@/lib/strain-fields"
import { entitySlug } from "@/lib/slugs"
import { revalidateTag } from "next/cache"

// Lightweight strain search for the diary-form combobox. Public list —
// id + name only, enough to pick an existing community strain.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const q = (searchParams.get("q") ?? "").trim().slice(0, 80)

    const ip = getClientIp(request)
    const rl = await rateLimit(`strain-search:${hashIp(ip)}`, 30, 60 * 1000)
    if (!rl.allowed) return NextResponse.json({ strains: [] })

    const strains = await prisma.strain.findMany({
      where: q ? { name: { contains: escapeLike(q), mode: "insensitive" } } : {},
      orderBy: { name: "asc" },
      take: 15,
      select: { id: true, name: true, type: true },
    })
    return NextResponse.json({ strains })
  } catch (error) {
    console.error("Strain search error:", error)
    return NextResponse.json({ strains: [] })
  }
}

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
      effects,
      flavors,
      thcMin,
      thcMax,
      floweringWeeks,
      difficulty,
    } = body

    if (typeof name !== "string" || !name.trim()) {
      return NextResponse.json(
        { error: "Strain name is required" },
        { status: 400 }
      )
    }

    const cleanName = name.trim().slice(0, LIMITS.STRAIN_NAME_MAX)

    if (typeof type !== "string" || !(STRAIN_TYPES as readonly string[]).includes(type.toUpperCase())) {
      return NextResponse.json({ error: "Invalid strain type" }, { status: 400 })
    }

    // Catalog facets — every field optional and strictly bounded. A raw
    // number that fails bounds is rejected (not clamped) so the client
    // learns the value was dropped rather than silently mutated.
    const cleanEffects = parseStrainEffects(effects) ?? []
    const cleanFlavors = parseStrainFlavors(flavors) ?? []
    const cleanDifficulty = parseStrainDifficulty(typeof difficulty === "string" ? difficulty.toUpperCase() : difficulty)
    const cleanThcMin = parseThc(thcMin)
    const cleanThcMax = parseThc(thcMax)
    const cleanFlowering = parseFloweringWeeks(floweringWeeks)
    if (effects != null && cleanEffects.length === 0 && Array.isArray(effects) && effects.length > 0) {
      return NextResponse.json({ error: "Unknown effect value" }, { status: 400 })
    }
    if (flavors != null && cleanFlavors.length === 0 && Array.isArray(flavors) && flavors.length > 0) {
      return NextResponse.json({ error: "Unknown flavor value" }, { status: 400 })
    }
    if (difficulty != null && difficulty !== "" && cleanDifficulty == null) {
      return NextResponse.json({ error: "Invalid difficulty" }, { status: 400 })
    }
    if (thcMin != null && cleanThcMin == null) {
      return NextResponse.json({ error: `Invalid thcMin` }, { status: 400 })
    }
    if (thcMax != null && cleanThcMax == null) {
      return NextResponse.json({ error: `Invalid thcMax` }, { status: 400 })
    }
    if (cleanThcMin != null && cleanThcMax != null && cleanThcMin > cleanThcMax) {
      return NextResponse.json({ error: "thcMin cannot exceed thcMax" }, { status: 400 })
    }
    if (floweringWeeks != null && cleanFlowering == null) {
      return NextResponse.json({ error: "Invalid flowering weeks" }, { status: 400 })
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

    // name/genetics/breeder are echoed by TerpBot's /strain replies — leaving
    // them out would let untrusted users launder links through the bot.
    const linkBlock = await enforceLinkTrust(
      [name, genetics, breeder, description, growingInfo].filter((f): f is string => typeof f === "string").join("\n"),
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
        effects: cleanEffects,
        flavors: cleanFlavors,
        thcMin: cleanThcMin,
        thcMax: cleanThcMax,
        floweringWeeks: cleanFlowering,
        difficulty: cleanDifficulty,
        createdById: session.user.id,
      },
    })

    // Canonical slug — written once from the stored name + id suffix.
    strain.slug = entitySlug(strain.name, strain.id, "strain")
    await prisma.strain.update({ where: { id: strain.id }, data: { slug: strain.slug } })

    revalidateTag("strains", { expire: 0 })

    // Paying floor: a real description keeps bare-name strain stubs from
    // farming the catalog payout. The strain is still created either way.
    if ((strain.description?.length ?? 0) >= STRAIN_MIN_PAID_DESCRIPTION) {
      await awardReputation(
        session.user.id,
        "STRAIN_CREATED",
        REP_POINTS.STRAIN_CREATED,
        `Added strain "${name.slice(0, 60)}"`,
        { key: `strain:${strain.id}`, sourceType: "STRAIN", sourceId: strain.id }
      ).catch(() => {})
    }

    return NextResponse.json({ strain }, { status: 201 })
  } catch (error) {
    console.error("Strain creation error:", error)
    return NextResponse.json(
      { error: "Failed to create strain" },
      { status: 500 }
    )
  }
}
