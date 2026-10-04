import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, publicUserSelect, getClientIp, logSecurityEvent, getSecurityUser, isBannedRow, forbidden, blockExistsBetween, enforceLinkTrust } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { notifyMentions } from "@/lib/mentions"
import { notify, notifyMany, commentLinkWhere } from "@/lib/notify"
import { checkMaintenance } from "@/lib/maintenance"
import { setupPath } from "@/lib/slugs"
import { revalidateTag } from "next/cache"

// POST — comment on a setup: { setupId, content }
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()

    const securityUser = await getSecurityUser(session.user.id)
    if (isBannedRow(securityUser)) return forbidden()

    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

    const { setupId, content } = await request.json().catch(() => ({}))
    if (typeof setupId !== "string" || typeof content !== "string" || content.trim().length < 2) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 })
    }
    if (content.length > 2000) {
      return NextResponse.json({ error: "Comment too long" }, { status: 400 })
    }

    const rl = await rateLimit(`setup-comment:${session.user.id}`, 30, 10 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: session.user.id, ip: getClientIp(request), metadata: { endpoint: "setup-comments" },
      })
      return NextResponse.json({ error: "Slow down." }, { status: 429 })
    }
    if (isBannedRow(securityUser)) return forbidden("Your account is suspended")

    const setup = await prisma.growSetup.findUnique({
      where: { id: setupId },
      select: {
        id: true,
        slug: true,
        title: true,
        authorId: true,
        deleted: true,
        author: { select: { profile: { select: { notifyOnComment: true } } } },
      },
    })
    if (!setup || setup.deleted) {
      return NextResponse.json({ error: "Setup not found" }, { status: 404 })
    }
    if (await blockExistsBetween(session.user.id, setup.authorId)) return forbidden()

    const linkBlock = await enforceLinkTrust(content, session.user.id, request, "setups/comments")
    if (linkBlock) return linkBlock

    const comment = await prisma.setupComment.create({
      data: { setupId, authorId: session.user.id, content: content.trim() },
      include: { author: { select: publicUserSelect } },
    })

    if (setup.authorId !== session.user.id) {
      await notify({
        userId: setup.authorId,
        type: "COMMENT",
        title: "New comment on your setup",
        content: `@${session.user.name || "Someone"} commented on "${setup.title.slice(0, 60)}"`,
        link: `${setupPath(setup)}#comment-${comment.id}`,
        actorId: session.user.id,
      })
    }
    await notifyMentions(
      content, session.user.id, session.user.name || "Someone",
      `${setupPath(setup)}#comment-${comment.id}`, `a comment on "${setup.title.slice(0, 50)}"`,
      [setup.authorId]
    )

    // Prior participants — an earlier commenter is told when the
    // conversation continues, so the owner's answer reaches the asker.
    // The query excludes the new comment (participants of 1..N-1 only) and
    // the actor; the owner already got the COMMENT notification above.
    // notifyMany re-checks prefs (notifyOnComment), bans/suspension, and
    // mutual blocks. The groupKey keys per recipient+setup+actor so one
    // noisy commenter can't stack notifications — while a different
    // commenter (e.g. the owner answering) still notifies immediately.
    const prior = await prisma.setupComment.findMany({
      where: { setupId, deleted: false, id: { not: comment.id }, authorId: { not: session.user.id } },
      select: { authorId: true },
      distinct: ["authorId"],
    })
    const participants = prior.map((p) => p.authorId).filter((id) => id !== setup.authorId)
    if (participants.length > 0) {
      await notifyMany(
        participants.map((userId) => ({
          userId,
          type: "COMMENT" as const,
          title: "New comment on a setup you commented on",
          content: `@${session.user.name || "Someone"} also commented on "${setup.title.slice(0, 60)}"`,
          link: `${setupPath(setup)}#comment-${comment.id}`,
          actorId: session.user.id,
          groupKey: `setup-comment:${setup.id}:${session.user.id}`,
          dedupeMs: 60 * 60 * 1000,
        }))
      )
    }

    return NextResponse.json({ comment }, { status: 201 })
  } catch (error) {
    console.error("Setup comment error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}

// DELETE — delete own setup comment: { id }
// Soft-delete, same as every other member-speech surface: the row stays
// for moderation/audit while the public page filters `deleted: false`.
// Setup owners intentionally cannot remove others' comments — matching
// thread OPs, who can't delete others' posts either (posts route).
// Reputation has no comment award — nothing to reverse.
export async function DELETE(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()
    const body = await request.json().catch(() => ({}))
    const { id } = body
    if (typeof id !== "string" || !id) {
      return NextResponse.json({ error: "Missing comment id" }, { status: 400 })
    }

    const comment = await prisma.setupComment.findUnique({
      where: { id },
      select: { id: true, authorId: true, setupId: true },
    })
    if (!comment) {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 })
    }
    if (comment.authorId !== session.user.id) return forbidden()

    await prisma.$transaction(async (tx) => {
      // updateMany keeps a repeated delete idempotent instead of erroring.
      await tx.setupComment.updateMany({ where: { id, deleted: false }, data: { deleted: true } })
      // COMMENT + MENTION notifications for this comment all carry the
      // same `#comment-<id>` link — one sweep covers them.
      await tx.notification.deleteMany({ where: commentLinkWhere(id) })
    })
    revalidateTag("setups", { expire: 0 })

    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error("Setup comment delete error:", error)
    return NextResponse.json({ error: "Failed to delete comment" }, { status: 500 })
  }
}
