import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, forbidden, getClientIp, logSecurityEvent, isModerator, getTrustLevel } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

const TOPICS = new Set(["BASICS", "NUTRIENTS", "HARVEST", "PESTS", "ENVIRONMENT", "GENETICS", "TRAINING", "LAW"])

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()

    const { slug } = await params

    const guide = await prisma.guide.findUnique({
      where: { slug },
      select: { id: true, authorId: true, slug: true, title: true, published: true },
    })
    if (!guide) {
      return NextResponse.json({ error: "Guide not found" }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    const { title, excerpt, content, topic } = body

    if (
      typeof title !== "string" || title.trim().length === 0 || title.length > 150 ||
      typeof excerpt !== "string" || excerpt.length > 500 ||
      typeof content !== "string" || content.length > 50_000 ||
      (topic !== undefined && (typeof topic !== "string" || !TOPICS.has(topic)))
    ) {
      return NextResponse.json({ error: "Invalid fields" }, { status: 400 })
    }

    const rl = await rateLimit(`guide-edit:${session.user.id}`, 20, 10 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: session.user.id,
        ip: getClientIp(request),
        metadata: { endpoint: "guides/[slug]" },
      })
      return NextResponse.json({ error: "Slow down." }, { status: 429 })
    }

    // Permission: author, moderator, or established+ community member
    let canEdit = guide.authorId === session.user.id || isModerator(session.user.role)
    if (!canEdit) {
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { createdAt: true, banned: true, role: true, profile: { select: { reputation: true } } },
      })
      if (!user || user.banned) return forbidden()
      const level = getTrustLevel(user.createdAt, user.profile?.reputation ?? 0)
      canEdit = ["Established", "Veteran", "Expert"].includes(level) || isModerator(user.role)
    }

    if (!canEdit) {
      return forbidden("You need Established trust or higher to edit guides")
    }

    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.guide.findUnique({
        where: { id: guide.id },
        select: { content: true },
      })
      if (!current) throw new Error("Guide missing")

      await tx.guideEdit.create({
        data: { guideId: guide.id, editorId: session.user.id, content: current.content },
      })

      return tx.guide.update({
        where: { id: guide.id },
        data: {
          title: title.trim(),
          excerpt: excerpt.trim(),
          content: content.trim(),
          ...(topic ? { topic } : {}),
        },
      })
    })

    await logSecurityEvent("SUSPICIOUS_ACTIVITY", {
      userId: session.user.id,
      ip: getClientIp(request),
      metadata: { endpoint: "guides/[slug]", action: "EDIT", guideId: guide.id },
    })

    return NextResponse.json({ guide: updated })
  } catch (error) {
    console.error("Guide edit error:", error)
    return NextResponse.json({ error: "Failed to update guide" }, { status: 500 })
  }
}
