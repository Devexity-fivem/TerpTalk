import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/require-staff"
import { prisma } from "@/lib/prisma"
import { forbidden, getClientIp, logSecurityEvent } from "@/lib/security"

// POST — broadcast an announcement to all users (ADMINISTRATOR only)
// { title, content, link? }
export async function POST(request: Request) {
  const session = { user: await requireAdmin() }
  if (!session.user) return forbidden()

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

  const users = await prisma.user.findMany({
    where: { banned: false, id: { not: session.user.id } },
    select: { id: true },
  })

  // Chunked inserts — a single createMany over a large user base
  // would blow the query size limit
  const BATCH = 500
  for (let i = 0; i < users.length; i += BATCH) {
    await prisma.notification.createMany({
      data: users.slice(i, i + BATCH).map((u) => ({
        userId: u.id,
        type: "MODERATOR_ANNOUNCEMENT",
        title: title.trim(),
        content: content.trim(),
        link: link?.trim() || null,
      })),
    })
  }

  await prisma.moderationAction.create({
    data: {
      type: "ANNOUNCEMENT",
      reason: `Broadcast: ${title.trim()}`,
      targetUserId: session.user.id,
      moderatorId: session.user.id,
    },
  })

  await logSecurityEvent("SUSPICIOUS_ACTIVITY", {
    userId: session.user.id,
    ip: getClientIp(request),
    metadata: { adminAction: "announcement", title: title.trim() },
  })

  return NextResponse.json({ ok: true, recipients: users.length })
}
