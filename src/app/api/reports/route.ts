import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rate-limit"
import { unauthorized, forbidden, getClientIp, logSecurityEvent, isBanned } from "@/lib/security"
import { notifyMany } from "@/lib/notify"
import { reportPriority } from "@/lib/trust-signals"

const REPORT_TYPES = new Set([
  "THREAD",
  "POST",
  "CHAT_MESSAGE",
  "PROFILE",
  "DIARY",
  "SETUP",
])

const REPORT_REASONS = new Set([
  "SPAM",
  "HARASSMENT",
  "THREATS",
  "ILLEGAL_CONTENT",
  "SCAM",
  "MALICIOUS_LINKS",
  "OTHER",
])

// POST — submit a report: { type, targetId, reason, description? }
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return unauthorized()
    }

    if (await isBanned(session.user.id)) return forbidden("Your account is suspended")

    const rl = await rateLimit(`report:${session.user.id}`, 10, 60 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: session.user.id,
        ip: getClientIp(request),
        metadata: { endpoint: "reports" },
      })
      return NextResponse.json(
        { error: "Too many reports. Please try again later." },
        { status: 429 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const { type, targetId, reason, description } = body

    if (
      typeof type !== "string" ||
      !REPORT_TYPES.has(type) ||
      typeof reason !== "string" ||
      !REPORT_REASONS.has(reason) ||
      typeof targetId !== "string" ||
      !targetId
    ) {
      return NextResponse.json({ error: "Invalid report" }, { status: 400 })
    }

    if (description && (typeof description !== "string" || description.length > 1000)) {
      return NextResponse.json({ error: "Description too long" }, { status: 400 })
    }

    // Resolve the reported user (content author) from the target — server-side only
    let reportedUserId: string | null = null
    switch (type) {
      case "THREAD": {
        const t = await prisma.thread.findUnique({ where: { id: targetId }, select: { authorId: true } })
        reportedUserId = t?.authorId ?? null
        break
      }
      case "POST": {
        const p = await prisma.post.findUnique({ where: { id: targetId }, select: { authorId: true } })
        reportedUserId = p?.authorId ?? null
        break
      }
      case "CHAT_MESSAGE": {
        const m = await prisma.chatMessage.findUnique({ where: { id: targetId }, select: { authorId: true } })
        reportedUserId = m?.authorId ?? null
        break
      }
      case "PROFILE": {
        const u = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } })
        reportedUserId = u?.id ?? null
        break
      }
      case "DIARY": {
        const d = await prisma.growDiary.findUnique({ where: { id: targetId }, select: { authorId: true } })
        reportedUserId = d?.authorId ?? null
        break
      }
      case "SETUP": {
        const s = await prisma.growSetup.findUnique({ where: { id: targetId }, select: { authorId: true } })
        reportedUserId = s?.authorId ?? null
        break
      }
    }

    if (!reportedUserId) {
      return NextResponse.json({ error: "Reported content not found" }, { status: 404 })
    }

    if (reportedUserId === session.user.id) {
      return NextResponse.json({ error: "Cannot report your own content" }, { status: 400 })
    }

    // Prevent duplicate open reports for the same target from the same user
    const duplicate = await prisma.report.findFirst({
      where: {
        reporterId: session.user.id,
        type,
        targetId,
        status: { in: ["PENDING", "REVIEWING", "ESCALATED"] },
      },
      select: { id: true },
    })
    if (duplicate) {
      return NextResponse.json({ error: "You already reported this" }, { status: 409 })
    }

    await prisma.report.create({
      data: {
        type,
        reason,
        description: description?.trim() || null,
        reporterId: session.user.id,
        reportedId: reportedUserId,
        targetId,
        priority: reportPriority(reason),
      },
    })

    // Notify moderators — never TerpBot, even if its role is elevated again.
    const moderators = await prisma.user.findMany({
      where: { role: { in: ["MODERATOR", "ADMINISTRATOR"] }, profile: { isNot: { username: "terpbot" } } },
      select: { id: true },
    })
    if (moderators.length > 0) {
      // Reporter intentionally unnamed — reports are confidential.
      await notifyMany(
        moderators.map((m) => ({
          userId: m.id,
          type: "MODERATOR_ANNOUNCEMENT" as const,
          title: "New report submitted",
          content: `A ${type.toLowerCase()} was reported for ${reason.toLowerCase().replace(/_/g, " ")}.`,
          link: "/moderation",
        }))
      )
    }

    return NextResponse.json(
      { message: "Report submitted. Our moderation team will review it." },
      { status: 201 }
    )
  } catch (error) {
    console.error("Report submission error:", error)
    return NextResponse.json({ error: "Failed to submit report" }, { status: 500 })
  }
}
