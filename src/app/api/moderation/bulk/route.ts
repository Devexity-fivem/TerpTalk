import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireModerator } from "@/lib/require-staff"
import { getClientIp, isAdmin, logSecurityEvent } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { notificationLinkWhere } from "@/lib/notify"
import { staffDisplayName } from "@/lib/moderation"
import { reverseReputationBySource } from "@/lib/reputation"
import { deleteImagesIfUnreferenced } from "@/lib/blob"

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
    if (typeof reason !== "string" || !reason.trim() || reason.length > 500) {
      return NextResponse.json({ error: "Reason is required (max 500 chars)" }, { status: 400 })
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
      select: { id: true, slug: true, authorId: true, author: { select: { role: true } } },
    })

    const threadIds = new Set(threads.map((t) => t.id))
    const missing = ids.filter((id) => !threadIds.has(id))
    if (missing.length > 0) {
      return NextResponse.json({ error: "Some threads not found", missing }, { status: 400 })
    }

    if (!isAdmin(staff.role) && threads.some((t) => !["MEMBER", "VERIFIED_MEMBER"].includes(t.author.role))) {
      return NextResponse.json({ error: "Cannot moderate protected authors" }, { status: 403 })
    }
    // Restoring deleted content can undo an administrator's deletion —
    // restrict restore to admins.
    if (action === "restore" && !isAdmin(staff.role)) {
      return NextResponse.json({ error: "Only administrators can restore deleted content" }, { status: 403 })
    }

    const moderatorName = await staffDisplayName(staff.id)

    const data: Record<string, boolean> = {
      lock: { locked: true },
      unlock: { locked: false },
      pin: { pinned: true },
      unpin: { pinned: false },
      delete: { deleted: true },
      restore: { deleted: false },
    }[action] as Record<string, boolean>

    const ops = [
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
          moderatorName,
        })),
      }),
    ]
    // Drop notifications whose links would now point at deleted threads —
    // prefix-aware so deep links (?post=/#post-) are caught too.
    if (action === "delete") {
      ops.push(
        prisma.notification.deleteMany({
          where: notificationLinkWhere(threads.map((t) => `/forum/thread/${t.slug}`)),
        }),
        // Unlink any diary discussions pointing at these threads — same
        // cleanup as the single-delete paths.
        prisma.growDiary.updateMany({
          where: { threadId: { in: ids } },
          data: { threadId: null },
        })
      )
    }
    await prisma.$transaction(ops)

    // Reputation reconciliation for bulk deletes — same counter-entry
    // semantics as single deletions. Sequential per-thread to stay
    // bounded; each reversal is internally idempotent.
    if (action === "delete") {
      const imgs = await prisma.postImage.findMany({
        where: { OR: [{ threadId: { in: ids } }, { post: { threadId: { in: ids } } }] },
        select: { url: true },
      })
      await prisma.postImage.deleteMany({
        where: { OR: [{ threadId: { in: ids } }, { post: { threadId: { in: ids } } }] },
      })
      deleteImagesIfUnreferenced(imgs.map((i) => i.url)).catch(() => {})
      for (const t of threads) {
        const postIds = await prisma.post.findMany({ where: { threadId: t.id }, select: { id: true } })
        await reverseReputationBySource("THREAD", t.id, "Content removed by staff", staff.id).catch(() => 0)
        for (const p of postIds) {
          await reverseReputationBySource("POST", p.id, "Content removed by staff", staff.id).catch(() => 0)
        }
      }
    }

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
