import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { publicUserSelect, LIMITS, getClientIp, logSecurityEvent, isBanned, forbidden } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
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
    } = body

    if (typeof title !== "string" || !title.trim() ||
        typeof content !== "string" || !content.trim() ||
        typeof diaryId !== "string" || !diaryId) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
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
      },
      include: {
        author: { select: publicUserSelect },
      },
    })

    // Update diary stage if needed
    if (stage && stage !== diary.stage) {
      await prisma.growDiary.update({
        where: { id: diaryId },
        data: { stage },
      })
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