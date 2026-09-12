import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/require-staff"
import { prisma } from "@/lib/prisma"
import { forbidden, getClientIp, logSecurityEvent } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { getPusher } from "@/lib/pusher"

// POST — broadcast an announcement to all users (ADMINISTRATOR only)
// { title, content, link? }
export async function POST(request: Request) {
  try {
    const user = await requireAdmin()
    if (!user) return forbidden()

    const rl = await rateLimit(`admin-announce:${user.id}`, 10, 60 * 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many announcements" }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))
    const { title, content, link } = body

    if (
      typeof title !== "string" || !title.trim() || title.length > 120 ||
      typeof content !== "string" || !content.trim() || content.length > 1000
    ) {
      return NextResponse.json(
        { error: "Title (max 120 chars) and content (max 1000 chars) required" },
        { status: 400 }
      )
    }
    if (link !== undefined && link !== null && link !== "" && (typeof link !== "string" || !/^\/[a-zA-Z0-9\-_/?=&%.]*$/.test(link))) {
      return NextResponse.json({ error: "Link must be a relative path like /forum" }, { status: 400 })
    }

    const MAX_RECIPIENTS = 5000
    const users = await prisma.user.findMany({
      // TerpBot never reads notifications — exclude it from broadcasts.
      where: { banned: false, id: { not: user.id }, profile: { isNot: { username: "terpbot" } } },
      select: { id: true },
      take: MAX_RECIPIENTS + 1,
    })

    if (users.length > MAX_RECIPIENTS) {
      return NextResponse.json(
        { error: `Too many recipients. Use a background job or reduce audience below ${MAX_RECIPIENTS}.` },
        { status: 413 }
      )
    }

    const BATCH = 500
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < users.length; i += BATCH) {
        await tx.notification.createMany({
          data: users.slice(i, i + BATCH).map((u) => ({
            userId: u.id,
            type: "MODERATOR_ANNOUNCEMENT",
            title: title.trim(),
            content: content.trim(),
            link: link?.trim() || null,
          })),
        })
      }

      await tx.moderationAction.create({
        data: {
          type: "ANNOUNCEMENT",
          reason: `Broadcast: ${title.trim()}`,
          targetUserId: user.id,
          moderatorId: user.id,
        },
      })
    })

    // Realtime fan-out — Pusher accepts up to 100 channels per call.
    const pusher = getPusher()
    if (pusher) {
      const dto = {
        type: "MODERATOR_ANNOUNCEMENT",
        title: title.trim(),
        content: content.trim(),
        link: link?.trim() || null,
        read: false,
      }
      const channels = users.map((u) => `private-user-${u.id}`)
      const pushes: Promise<unknown>[] = []
      for (let i = 0; i < channels.length; i += 100) {
        pushes.push(pusher.trigger(channels.slice(i, i + 100), "new-notification", dto))
      }
      Promise.allSettled(pushes).catch(() => {})
    }

    await logSecurityEvent("SUSPICIOUS_ACTIVITY", {
      userId: user.id,
      ip: getClientIp(request),
      metadata: { adminAction: "announcement", title: title.trim() },
    })

    return NextResponse.json({ ok: true, recipients: users.length })
  } catch (error) {
    console.error("Admin announce error:", error)
    return NextResponse.json({ error: "Failed to send announcement" }, { status: 500 })
  }
}
