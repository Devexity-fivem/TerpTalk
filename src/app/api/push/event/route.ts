import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { unauthorized } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { recordPushEvent } from "@/lib/web-push"

// Client-observed push lifecycle steps that no server action can see:
// the invitation was shown, the browser permission was denied, or an OS
// notification was clicked (posted by the service worker). Type and a
// bounded category only — no content, no endpoint, no URL.
const CLIENT_TYPES = new Set(["PROMPT_SHOWN", "PERMISSION_DENIED", "CLICKED"])
const CATEGORIES = new Set(["REPLY", "MENTION", "ACCEPTED_ANSWER", "weekly-digest", "pd-followup"])

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return unauthorized()
  const body = (await request.json().catch(() => ({}))) as { type?: unknown; category?: unknown }
  if (typeof body.type !== "string" || !CLIENT_TYPES.has(body.type)) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 })
  }
  const rl = await rateLimit(`push-event:${session.user.id}`, 60, 60 * 60 * 1000)
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  const category = typeof body.category === "string" && CATEGORIES.has(body.category) ? body.category : null
  await recordPushEvent({
    type: body.type as "PROMPT_SHOWN" | "PERMISSION_DENIED" | "CLICKED",
    userId: session.user.id,
    category,
  })
  return NextResponse.json({ ok: true })
}
