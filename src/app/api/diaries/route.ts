import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, publicUserSelect, LIMITS, getClientIp, logSecurityEvent, isBanned, forbidden } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { awardReputation, REP_POINTS } from "@/lib/reputation"
import { checkMaintenance } from "@/lib/maintenance"

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
      title,
      description,
      strain,
      genetics,
      growType,
      startDate,
      medium,
      containerSize,
      lighting,
      nutrients,
      equipment,
      spaceDimensions,
    } = body

    if (typeof title !== "string" || !title.trim() || !startDate) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    if (title.length > LIMITS.DIARY_TITLE_MAX || (description && description.length > LIMITS.DESCRIPTION_MAX)) {
      return NextResponse.json(
        { error: "Content exceeds maximum length" },
        { status: 400 }
      )
    }

    const VALID_GROW_TYPES = new Set(["INDOOR", "OUTDOOR", "GREENHOUSE", "HYDROPONIC", "OTHER"])
    if (typeof growType !== "string" || !VALID_GROW_TYPES.has(growType)) {
      return NextResponse.json({ error: "Invalid grow type" }, { status: 400 })
    }

    const stringFields = [strain, genetics, medium, containerSize, lighting, nutrients, equipment, spaceDimensions]
    if (stringFields.some((f) => typeof f === "string" && f.length > 500)) {
      return NextResponse.json({ error: "A field exceeds maximum length" }, { status: 400 })
    }

    const parsedStartDate = new Date(startDate)
    if (isNaN(parsedStartDate.getTime())) {
      return NextResponse.json(
        { error: "Invalid start date" },
        { status: 400 }
      )
    }
    const now = new Date()
    if (parsedStartDate.getTime() > now.getTime() + 365 * 24 * 60 * 60 * 1000 || parsedStartDate.getFullYear() < 1970) {
      return NextResponse.json({ error: "Invalid start date" }, { status: 400 })
    }

    // Rate limit: 5 diaries per day per user
    const rl = await rateLimit(`diary:${session.user.id}`, 5, 24 * 60 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: session.user.id,
        ip: getClientIp(request),
        metadata: { endpoint: "diaries" },
      })
      return NextResponse.json(
        { error: "Too many diaries created. Please try again later." },
        { status: 429 }
      )
    }

    if (await isBanned(session.user.id)) {
      return forbidden("Your account is suspended")
    }

    // Create grow diary
    const diary = await prisma.growDiary.create({
      data: {
        title,
        description,
        strain,
        genetics,
        growType,
        startDate: parsedStartDate,
        medium,
        containerSize,
        lighting,
        nutrients,
        equipment,
        spaceDimensions,
        authorId: session.user.id,
      },
      include: {
        author: { select: publicUserSelect },
      },
    })

    await awardReputation(
      session.user.id,
      "DIARY_CREATED",
      REP_POINTS.DIARY_CREATED,
      `Started grow diary "${diary.title.slice(0, 60)}"`
    ).catch(() => {})

    return NextResponse.json({ diary }, { status: 201 })
  } catch (error) {
    console.error("Diary creation error:", error)
    return NextResponse.json(
      { error: "Failed to create diary" },
      { status: 500 }
    )
  }
}