import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, forbidden, getClientIp, logSecurityEvent, isBanned } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { awardReputation, REP_POINTS } from "@/lib/reputation"

const VALID_REACTION_TYPES = new Set(["LIKE", "LOVE", "LAUGH", "THINKING", "FIRE", "THUMBS_UP", "THUMBS_DOWN"])

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return unauthorized()
    }

    if (await isBanned(session.user.id)) return forbidden()

    const body = await request.json().catch(() => ({}))
    const { type, postId, diaryId } = body

    const hasPostId = typeof postId === "string" && postId.length > 0
    const hasDiaryId = typeof diaryId === "string" && diaryId.length > 0

    if (
      typeof type !== "string" ||
      !VALID_REACTION_TYPES.has(type) ||
      (!hasPostId && !hasDiaryId) ||
      (hasPostId && hasDiaryId)
    ) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }

    // Rate limit: 120 reactions per 10 minutes per user
    const rl = await rateLimit(`reaction:${session.user.id}`, 120, 10 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: session.user.id,
        ip: getClientIp(request),
        metadata: { endpoint: "reactions" },
      })
      return NextResponse.json(
        { error: "Too many reactions. Please slow down." },
        { status: 429 }
      )
    }

    // Check if reaction already exists
    const existingReaction = await prisma.reaction.findFirst({
      where: {
        userId: session.user.id,
        ...(hasPostId ? { postId } : {}),
        ...(hasDiaryId ? { diaryId } : {}),
      },
    })

    if (existingReaction) {
      if (existingReaction.type === type) {
        // Same type — toggle off
        await prisma.reaction.delete({ where: { id: existingReaction.id } })
        return NextResponse.json({ reaction: null, action: "removed" })
      }
      // Different type — switch reaction
      const updated = await prisma.reaction.update({
        where: { id: existingReaction.id },
        data: { type },
      })
      return NextResponse.json({ reaction: updated, action: "switched" })
    }

    // Create new reaction
    const reaction = await prisma.reaction.create({
      data: {
        type,
        userId: session.user.id,
        ...(hasPostId ? { postId } : {}),
        ...(hasDiaryId ? { diaryId } : {}),
      },
    })

    // Award the content author for a LIKE (not for self-likes)
    if (type === "LIKE") {
      const target = hasPostId
        ? await prisma.post.findUnique({ where: { id: postId }, select: { authorId: true } })
        : await prisma.growDiary.findUnique({ where: { id: diaryId }, select: { authorId: true } })
      if (target && target.authorId !== session.user.id) {
        await awardReputation(
          target.authorId,
          "LIKE_RECEIVED",
          REP_POINTS.LIKE_RECEIVED,
          "Someone liked your content"
        ).catch(() => {})
      }
    }

    return NextResponse.json({ reaction, action: "added" }, { status: 201 })
  } catch (error) {
    console.error("Reaction error:", error)
    return NextResponse.json(
      { error: "Failed to handle reaction" },
      { status: 500 }
    )
  }
}