import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rate-limit"
import { unauthorized, forbidden, getClientIp, logSecurityEvent, isBanned } from "@/lib/security"

export const FEEDBACK_TYPES = new Set(["BUG", "UX", "FEATURE", "CONTENT", "OTHER"])

const TITLE_MAX = 150
const MESSAGE_MAX = 5000
const PAGE_PATH_MAX = 300

// POST — submit feedback: { type, title, message, pagePath? }
// Members only. source is always USER here — admins use the admin endpoint.
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return unauthorized()
    }

    if (await isBanned(session.user.id)) return forbidden("Your account is suspended")

    // A few submissions per hour per user — feedback is a signal inbox,
    // not a conversation channel.
    const rl = await rateLimit(`feedback:${session.user.id}`, 5, 60 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: session.user.id,
        ip: getClientIp(request),
        metadata: { endpoint: "feedback" },
      })
      return NextResponse.json(
        { error: "Too much feedback too fast. Please try again later." },
        { status: 429 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const { type, title, message, pagePath } = body

    if (
      typeof type !== "string" ||
      !FEEDBACK_TYPES.has(type) ||
      typeof title !== "string" ||
      !title.trim() ||
      title.length > TITLE_MAX ||
      typeof message !== "string" ||
      !message.trim() ||
      message.length > MESSAGE_MAX
    ) {
      return NextResponse.json({ error: "Invalid feedback" }, { status: 400 })
    }

    // pagePath is captured client-side but treated as untrusted — it must be a
    // same-origin path, not an arbitrary URL or oversized blob.
    let path: string | null = null
    if (typeof pagePath === "string" && pagePath.startsWith("/") && !pagePath.startsWith("//") && pagePath.length <= PAGE_PATH_MAX) {
      path = pagePath
    }

    // Coarse device class from the UA header — enough to reproduce
    // mobile-only layout bugs without storing the raw user agent.
    const ua = request.headers.get("user-agent") || ""
    const deviceType = /iPad|Tablet/i.test(ua)
      ? "tablet"
      : /Mobi|Android|iPhone/i.test(ua)
        ? "mobile"
        : ua
          ? "desktop"
          : null

    const feedback = await prisma.feedback.create({
      data: {
        authorId: session.user.id,
        type,
        title: title.trim(),
        message: message.trim(),
        pagePath: path,
        deviceType,
        source: "USER",
      },
      select: { id: true },
    })

    return NextResponse.json({ ok: true, id: feedback.id })
  } catch (error) {
    console.error("Feedback submission error:", error)
    return NextResponse.json({ error: "Failed to save feedback" }, { status: 500 })
  }
}
