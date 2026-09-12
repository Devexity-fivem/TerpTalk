import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, publicUserSelect, getClientIp, logSecurityEvent, isBanned, forbidden, blockExistsBetween } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { notifyMentions } from "@/lib/mentions"
import { notify } from "@/lib/notify"
import { checkMaintenance } from "@/lib/maintenance"

// POST — comment on a setup: { setupId, content }
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()

    if (await isBanned(session.user.id)) return forbidden()

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
    if (await isBanned(session.user.id)) return forbidden("Your account is suspended")

    const setup = await prisma.growSetup.findUnique({
      where: { id: setupId },
      select: {
        id: true,
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
        link: `/setups/${setupId}`,
        actorId: session.user.id,
      })
    }
    await notifyMentions(
      content, session.user.id, session.user.name || "Someone",
      `/setups/${setupId}`, `a comment on "${setup.title.slice(0, 50)}"`,
      [setup.authorId]
    )

    return NextResponse.json({ comment }, { status: 201 })
  } catch (error) {
    console.error("Setup comment error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
