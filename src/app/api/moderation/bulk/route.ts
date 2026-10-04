import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireModerator } from "@/lib/require-staff"
import { getClientIp, isAdmin, logSecurityEvent } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { notificationLinkWhere } from "@/lib/notify"
import { staffDisplayName } from "@/lib/moderation"
import { enqueueReversals, drainMany } from "@/lib/reputation-outbox"
import { enqueueXpReversals, drainXpMany } from "@/lib/progression-outbox"
import { deleteImagesIfUnreferenced } from "@/lib/blob"
import { revalidateTag } from "next/cache"

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
        // One audit row per thread — the item-level target identity lives on
        // each row so a bulk op stays fully reconstructable without relying
        // on the SecurityEvent summary.
        data: threads.map((t) => ({
          type: action === "delete" || action === "restore" ? "CONTENT_DELETION" : "CONTENT_EDIT",
          reason: reason || `Bulk ${action} by moderator`,
          targetUserId: t.authorId,
          moderatorId: staff.id,
          moderatorName,
          targetType: "THREAD",
          targetId: t.id,
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
    // semantics as single deletions. Durable intents are enqueued post-commit
    // (a ≤100-thread batch can't hold per-post inserts in one interactive tx);
    // ping/cron drains close the residual crash window.
    if (action === "delete") {
      const imgs = await prisma.postImage.findMany({
        where: { OR: [{ threadId: { in: ids } }, { post: { threadId: { in: ids } } }] },
        select: { url: true },
      })
      await prisma.postImage.deleteMany({
        where: { OR: [{ threadId: { in: ids } }, { post: { threadId: { in: ids } } }] },
      })
      deleteImagesIfUnreferenced(imgs.map((i) => i.url)).catch(() => {})
      // One bulk read for all posts — grouped by thread in memory — instead
      // of a per-thread findMany inside the reversal loop.
      const allPosts = await prisma.post.findMany({
        where: { threadId: { in: ids } },
        select: { id: true, threadId: true },
      })
      const postsByThread = new Map<string, string[]>()
      for (const p of allPosts) {
        const list = postsByThread.get(p.threadId)
        if (list) list.push(p.id)
        else postsByThread.set(p.threadId, [p.id])
      }
      for (const t of threads) {
        const postIds = postsByThread.get(t.id) ?? []
        const repIntents: Parameters<typeof enqueueReversals>[1] = [
          { kind: "SOURCE", sourceType: "THREAD", sourceId: t.id, reason: "Content removed by staff", requestedBy: staff.id },
          ...postIds.map((postId) => ({ kind: "SOURCE" as const, sourceType: "POST", sourceId: postId, reason: "Content removed by staff", requestedBy: staff.id })),
        ]
        const batch = await enqueueReversals(prisma, repIntents)
        const xpBatch = await enqueueXpReversals(prisma, repIntents)
        await drainMany(batch)
        await drainXpMany(xpBatch)
      }
    }

    await logSecurityEvent("SUSPICIOUS_ACTIVITY", {
      userId: staff.id,
      ip: getClientIp(request),
      // Bounded by the 100-id request cap — ids keep the bulk event itself
      // reconstructable in addition to the per-thread ModerationAction rows.
      metadata: { action, count: ids.length, reason, targetIds: ids },
    })

    // Bulk-deleted/restored threads can carry wizardResultId + accepted
    // answers — keep Plant Doctor outcome stats honest.
    if (action === "delete" || action === "restore") {
      revalidateTag("analytics", { expire: 0 })
    }

    return NextResponse.json({ updated: threads.length })
  } catch (error) {
    console.error("Bulk moderation error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
