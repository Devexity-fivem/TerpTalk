import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireModerator } from "@/lib/require-staff"
import { getClientIp, logSecurityEvent } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

const BULK_ACTIONS = new Set(["lock", "unlock", "pin", "unpin", "delete", "restore"])

export async function POST(request: Request) {
  try {
    const staff = await requireModerator()
    if (!staff) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const { ids, action, reason } = body

    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100) {
      return NextResponse.json({ error: "Provide 1-100 thread ids" }, { status: 400 })
    }
    if (typeof action !== "string" || !BULK_ACTIONS.has(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 })
    }
    if (ids.some((id) => typeof id !== "string" || !id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 })
    }

    const rl = await rateLimit(`bulk-mod:${staff.id}`, 30, 10 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: staff.id,
        ip: getClientIp(request),
        metadata: { endpoint: "moderation/bulk" },
      })
      return NextResponse.json({ error: "Slow down." }, { status: 429 })
    }

    const threads = await prisma.thread.findMany({
      where: { id: { in: ids } },
      select: { id: true, authorId: true },
    })

    const threadIds = new Set(threads.map((t) => t.id))
    const missing = ids.filter((id) => !threadIds.has(id))
    if (missing.length > 0) {
      return NextResponse.json({ error: "Some threads not found", missing }, { status: 400 })
    }

    const data: Record<string, boolean> = {
      lock: { locked: true },
      unlock: { locked: false },
      pin: { pinned: true },
      unpin: { pinned: false },
      delete: { deleted: true },
      restore: { deleted: false },
    }[action] as Record<string, boolean>

    await prisma.$transaction([
      prisma.thread.updateMany({
        where: { id: { in: ids } },
        data,
      }),
      prisma.moderationAction.createMany({
        data: threads.map((t) => ({
          type: action === "delete" || action === "restore" ? "CONTENT_DELETION" : "CONTENT_EDIT",
          reason: reason || `Bulk ${action} by moderator`,
          targetUserId: t.authorId,
          moderatorId: staff.id,
        })),
      }),
    ])

    await logSecurityEvent("SUSPICIOUS_ACTIVITY", {
      userId: staff.id,
      ip: getClientIp(request),
      metadata: { action, count: ids.length, reason },
    })

    return NextResponse.json({ updated: threads.length })
  } catch (error) {
    console.error("Bulk moderation error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
