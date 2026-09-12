import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, forbidden, getClientIp, logSecurityEvent, isBanned } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { awardReputation, REP_POINTS } from "@/lib/reputation"
import { checkMaintenance } from "@/lib/maintenance"
import { notify, postDeepLink } from "@/lib/notify"

const VALID_REACTION_TYPES = new Set(["LIKE", "LOVE", "LAUGH", "THINKING", "FIRE", "THUMBS_UP", "THUMBS_DOWN"])

const REACTION_EMOJI: Record<string, string> = {
  LIKE: "❤️",
  LOVE: "😍",
  LAUGH: "😂",
  THINKING: "🤔",
  FIRE: "🔥",
  THUMBS_UP: "👍",
  THUMBS_DOWN: "👎",
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return unauthorized()
    }

    if (await isBanned(session.user.id)) return forbidden()

    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

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

    // Verify the target exists and is not deleted
    let targetAuthorId: string | null = null
    let targetLink: string | null = null
    let targetTitle: string | null = null
    if (hasPostId) {
      const post = await prisma.post.findUnique({
        where: { id: postId, deleted: false },
        select: {
          authorId: true,
          thread: { select: { slug: true, title: true, deleted: true, category: { select: { hidden: true } } } },
        },
      })
      if (!post || post.thread?.deleted || post.thread?.category?.hidden) {
        return NextResponse.json({ error: "Post not found" }, { status: 404 })
      }
      targetAuthorId = post.authorId
      targetLink = post.thread ? postDeepLink(post.thread.slug, postId) : null
      targetTitle = post.thread?.title ?? null
    } else if (hasDiaryId) {
      const diary = await prisma.growDiary.findUnique({
        where: { id: diaryId, deleted: false },
        select: { authorId: true, title: true },
      })
      if (!diary) {
        return NextResponse.json({ error: "Diary not found" }, { status: 404 })
      }
      targetAuthorId = diary.authorId
      targetLink = `/diaries/${diaryId}`
      targetTitle = diary.title
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
    if (type === "LIKE" && targetAuthorId && targetAuthorId !== session.user.id) {
      await awardReputation(
        targetAuthorId,
        "LIKE_RECEIVED",
        REP_POINTS.LIKE_RECEIVED,
        "Someone liked your content"
      ).catch(() => {})
    }

    // Notify the content author — once per actor per target per day so
    // reaction toggling can't flood the inbox. notify() also enforces
    // the recipient's notifyOnReaction pref, bans, and blocks.
    if (targetAuthorId && targetAuthorId !== session.user.id) {
      const emoji = REACTION_EMOJI[type] ?? "👍"
      const targetKind = hasPostId ? "post" : "grow diary"
      const context = targetTitle ? ` on "${targetTitle.slice(0, 60)}"` : ""
      await notify({
        userId: targetAuthorId,
        type: "REACTION",
        title: "New reaction",
        content: `${session.user.name ?? "Someone"} reacted ${emoji} to your ${targetKind}${context}`,
        link: targetLink,
        actorId: session.user.id,
        groupKey: `REACTION:${hasPostId ? `post:${postId}` : `diary:${diaryId}`}`,
        dedupeMs: 24 * 60 * 60 * 1000,
      })
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