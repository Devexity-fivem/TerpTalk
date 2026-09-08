import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getClientIp, logSecurityEvent } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

const VALID_REACTION_TYPES = new Set(["LIKE", "LOVE", "LAUGH", "THINKING", "FIRE", "THUMBS_UP", "THUMBS_DOWN"])

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
    const { type, postId, diaryId } = body

    if (typeof type !== "string" || !VALID_REACTION_TYPES.has(type) || (!postId && !diaryId)) {
      return NextResponse.json(
        { error: "Invalid request" },
        { status: 400 }
      )
    }

    if (postId && diaryId) {
      return NextResponse.json(
        { error: "Reaction can only target one resource" },
        { status: 400 }
      )
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
        ...(postId && { postId }),
        ...(diaryId && { diaryId }),
      },
    })

    if (existingReaction) {
      // Remove existing reaction
      await prisma.reaction.delete({
        where: { id: existingReaction.id },
      })

      return NextResponse.json({ 
        reaction: null, 
        action: "removed" 
      })
    }

    // Create new reaction
    const reaction = await prisma.reaction.create({
      data: {
        type,
        userId: session.user.id,
        ...(postId && { postId }),
        ...(diaryId && { diaryId }),
      },
    })

    return NextResponse.json({ reaction, action: "added" }, { status: 201 })
  } catch (error) {
    console.error("Reaction error:", error)
    return NextResponse.json(
      { error: "Failed to handle reaction" },
      { status: 500 }
    )
  }
}