import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, publicUserSelect, LIMITS, getClientIp, logSecurityEvent, isBanned, forbidden, enforceLinkTrust } from "@/lib/security"
import { awardReputation, grantBadge, repRateLimit, REP_POINTS } from "@/lib/reputation"
import { storeImages, deleteImagesIfUnreferenced } from "@/lib/blob"
import { checkMaintenance } from "@/lib/maintenance"
import { notifyMany } from "@/lib/notify"
import { revalidateTag } from "next/cache"
import { diaryDay, diaryWeek } from "@/lib/diary-weeks"

export async function POST(request: Request) {
  let storedImages: string[] = []

  try {
    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return unauthorized()
    }

    const body = await request.json().catch(() => ({}))
    const {
      diaryId,
      title,
      content,
      dayNumber,
      weekNumber,
      stage,
      temperature,
      humidity,
      vpd,
      ph,
      ec,
      feeding,
      training,
      images,
    } = body

    if (
      typeof title !== "string" || !title.trim() ||
      typeof content !== "string" || !content.trim() ||
      typeof diaryId !== "string" || !diaryId
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    if (title.length > LIMITS.DIARY_TITLE_MAX || content.length > LIMITS.POST_CONTENT_MAX) {
      return NextResponse.json(
        { error: "Content exceeds maximum length" },
        { status: 400 }
      )
    }

    // Validate controlled fields — stage must be a real stage, numbers must be numbers
    const VALID_STAGES = new Set(["GERMINATION", "SEEDLING", "VEGETATIVE", "FLOWER", "HARVEST", "DRYING", "CURING", "COMPLETED"])
    if (stage !== undefined && stage !== null && !VALID_STAGES.has(stage)) {
      return NextResponse.json({ error: "Invalid stage" }, { status: 400 })
    }
    for (const n of [dayNumber, weekNumber, temperature, humidity, vpd, ph, ec]) {
      if (n !== undefined && n !== null && typeof n !== "number") {
        return NextResponse.json({ error: "Numeric fields must be numbers" }, { status: 400 })
      }
    }

    // Sanity bounds — keep implausible readings out of charts and aggregates.
    const RANGES: [unknown, number, number, string][] = [
      [temperature, -40, 140, "temperature"],
      [humidity, 0, 100, "humidity"],
      [vpd, 0, 6, "vpd"],
      [ph, 0, 14, "ph"],
      [ec, 0, 15, "ec"],
      [dayNumber, 0, 1000, "dayNumber"],
      [weekNumber, 0, 150, "weekNumber"],
    ]
    for (const [v, lo, hi, name] of RANGES) {
      if (typeof v === "number" && (v < lo || v > hi)) {
        return NextResponse.json({ error: `${name} is out of range` }, { status: 400 })
      }
    }

    const cleanStr = (v: unknown, max: number) =>
      typeof v === "string" ? v.trim().slice(0, max) || null : null

    if (Array.isArray(images) && images.length > 20) {
      return NextResponse.json({ error: "Too many images" }, { status: 400 })
    }
    const validImages = Array.isArray(images)
      ? images.filter((i: unknown) => typeof i === "string" && /^data:image\/(png|jpe?g|webp);base64,/.test(i) && i.length <= 400_000).slice(0, 4)
      : []

    // Rate limit + ban check before any expensive work
    const rl = await repRateLimit(session.user.id, `diary-update:${session.user.id}`, 30, 60 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: session.user.id,
        ip: getClientIp(request),
        metadata: { endpoint: "diaries/updates" },
      })
      return NextResponse.json(
        { error: "Too many updates. Please try again later." },
        { status: 429 }
      )
    }

    if (await isBanned(session.user.id)) {
      return forbidden("Your account is suspended")
    }

    // Validate diary exists and user is the author
    const diary = await prisma.growDiary.findUnique({
      where: { id: diaryId },
    })

    if (!diary || diary.deleted) {
      return NextResponse.json(
        { error: "Diary not found" },
        { status: 404 }
      )
    }

    if (diary.authorId !== session.user.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 403 }
      )
    }

    const linkBlock = await enforceLinkTrust(`${title}\n${content}`, session.user.id, request, "diaries/updates")
    if (linkBlock) return linkBlock

    // Offload to Blob storage when configured (keeps DB rows small)
    storedImages = await storeImages(validImages, "diary-updates")

    // Derive day/week from the diary start date when the client doesn't
    // supply them — manual entry is no longer exposed in the form.
    const derivedDay = typeof dayNumber === "number" ? dayNumber : diaryDay(diary.startDate, new Date())
    const derivedWeek = typeof weekNumber === "number" ? weekNumber : diaryWeek(diary.startDate, new Date())

    // Create update
    const update = await prisma.diaryUpdate.create({
      data: {
        title,
        content,
        diaryId,
        authorId: session.user.id,
        dayNumber: derivedDay,
        weekNumber: derivedWeek,
        stage: stage || diary.stage,
        temperature: typeof temperature === "number" ? temperature : null,
        humidity: typeof humidity === "number" ? humidity : null,
        vpd: typeof vpd === "number" ? vpd : null,
        ph: typeof ph === "number" ? ph : null,
        ec: typeof ec === "number" ? ec : null,
        feeding: cleanStr(feeding, 300),
        training: cleanStr(training, 300),
        // Attach up to 4 client-resized photos
        ...(storedImages.length > 0 && {
          images: {
            create: storedImages.map((url: string, i: number) => ({
              url,
              order: i,
            })),
          },
        }),
      },
      include: {
        author: { select: publicUserSelect },
        images: true,
      },
    })

    // One paying update per diary per UTC day — keyed so extra updates and
    // retries don't farm.
    const updateDay = new Date().toISOString().slice(0, 10)
    await awardReputation(
      session.user.id,
      "DIARY_UPDATE",
      REP_POINTS.DIARY_UPDATE,
      `Updated diary "${diary.title.slice(0, 60)}"`,
      { key: `diaryupd:${diaryId}:${updateDay}`, sourceType: "DIARY", sourceId: diaryId }
    ).catch(() => {})

    // Update diary stage only on an explicit change. The form defaults to the
    // diary's current stage, so an untouched select never regresses it.
    if (stage && stage !== diary.stage) {
      await prisma.growDiary.update({
        where: { id: diaryId },
        data: { stage },
      })
    }

    revalidateTag("diaries", { expire: 0 })

    // Award 7-day streak badge if earned
    const recentUpdates = await prisma.diaryUpdate.findMany({
      where: { authorId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { createdAt: true },
    })
    const days = [...new Set(recentUpdates.map((u) => u.createdAt.toDateString()))].map((d) => new Date(d).getTime()).sort((a, b) => b - a)
    let streak = 0
    for (let i = 0; i < days.length; i++) {
      if (Math.abs(days[i] - (days[0] - i * 86400000)) < 43200000) streak++
      else break
    }
    if (streak >= 7) {
      await grantBadge(session.user.id, "Dedicated Grower", {
        content: "You earned the \"Dedicated Grower\" badge — 7 days of updates in a row, impressive consistency!",
      })
    }

    // Notify diary followers (not the author) — notifyMany filters
    // prefs, banned recipients, and blocks in bulk.
    const followers = await prisma.diaryFollow.findMany({
      where: { diaryId, userId: { not: session.user.id } },
      select: { userId: true },
    })
    if (followers.length > 0) {
      const authorName = session.user.name || "Someone"
      await notifyMany(
        followers.map((f) => ({
          userId: f.userId,
          type: "DIARY_UPDATE" as const,
          title: "Diary updated",
          content: `@${authorName} added "${update.title.slice(0, 60)}" to "${diary.title.slice(0, 50)}"`,
          link: `/diaries/${diaryId}`,
          actorId: session.user.id,
        }))
      )
    }

    return NextResponse.json({ update }, { status: 201 })
  } catch (error) {
    // Clean up any already-uploaded Blob objects if the diary update could not be created.
    deleteImagesIfUnreferenced(storedImages).catch(() => {})
    console.error("Update creation error:", error)
    return NextResponse.json(
      { error: "Failed to create update" },
      { status: 500 }
    )
  }
}