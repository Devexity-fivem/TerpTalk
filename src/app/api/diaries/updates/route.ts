import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, publicUserSelect, LIMITS, getClientIp, logSecurityEvent, isBanned, forbidden } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { awardReputation, REP_POINTS } from "@/lib/reputation"

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return unauthorized()
    }

    const body = await request.json()
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

    if (typeof title !== "string" || !title.trim() ||
        typeof content !== "string" || !content.trim() ||
        typeof diaryId !== "string" || !diaryId) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    // Validate any uploaded images are data URIs
    const validImages = Array.isArray(images)
      ? images.filter((i: unknown) => typeof i === "string" && /^data:image\/(png|jpe?g|webp);base64,/.test(i) && i.length <= 400_000).slice(0, 4)
      : []
    if (Array.isArray(images) && images.length > 0 && validImages.length === 0) {
      return NextResponse.json({ error: "Invalid image format" }, { status: 400 })
    }

    if (title.length > LIMITS.TITLE_MAX || content.length > LIMITS.POST_CONTENT_MAX) {
      return NextResponse.json(
        { error: "Content exceeds maximum length" },
        { status: 400 }
      )
    }

    // Rate limit: 30 updates per hour per user
    const rl = await rateLimit(`diary-update:${session.user.id}`, 30, 60 * 60 * 1000)
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

    if (!diary) {
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

    // Create update
    const update = await prisma.diaryUpdate.create({
      data: {
        title,
        content,
        diaryId,
        authorId: session.user.id,
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
        // Attach up to 4 client-resized photos
        ...(validImages.length > 0 && {
          images: {
            create: validImages.map((url: string, i: number) => ({
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

    await awardReputation(
      session.user.id,
      "DIARY_UPDATE",
      REP_POINTS.DIARY_UPDATE,
      `Updated diary "${diary.title.slice(0, 60)}"`
    ).catch(() => {})

    // Update diary stage if needed
    if (stage && stage !== diary.stage) {
      await prisma.growDiary.update({
        where: { id: diaryId },
        data: { stage },
      })
    }

    // Notify diary followers (not the author)
    const followers = await prisma.diaryFollow.findMany({
      where: { diaryId, userId: { not: session.user.id } },
      select: { userId: true },
    })
    if (followers.length > 0) {
      const authorName = session.user.name || "Someone"
      await prisma.notification.createMany({
        data: followers.map((f) => ({
          userId: f.userId,
          type: "DIARY_UPDATE",
          title: "Diary updated",
          content: `${authorName} added "${update.title.slice(0, 60)}" to "${diary.title.slice(0, 50)}"`,
          link: `/diaries/${diaryId}`,
        })),
      }).catch(() => {})
    }

    return NextResponse.json({ update }, { status: 201 })
  } catch (error) {
    console.error("Update creation error:", error)
    return NextResponse.json(
      { error: "Failed to create update" },
      { status: 500 }
    )
  }
}