import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { pushConfigured, recordPushEvent } from "@/lib/web-push"

// Web Push subscription storage — owner-scoped. Stores only the three
// values the Web Push protocol needs (endpoint, p256dh, auth); nothing
// about the browser or device. Push is a delivery channel for existing
// notifications, so there is no per-type push preference here: the
// member's notification preferences already decide what gets created.

const MAX_SUBS_PER_USER = 10
const B64URL = /^[A-Za-z0-9_-]+=*$/

function parseSubscription(body: unknown): { endpoint: string; p256dh: string; auth: string } | null {
  const b = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null
  const endpoint = b?.endpoint
  const p256dh = b?.keys?.p256dh
  const auth = b?.keys?.auth
  if (typeof endpoint !== "string" || typeof p256dh !== "string" || typeof auth !== "string") return null
  if (endpoint.length > 1000 || p256dh.length > 200 || auth.length > 100) return null
  if (!B64URL.test(p256dh) || !B64URL.test(auth)) return null
  try {
    if (new URL(endpoint).protocol !== "https:") return null
  } catch {
    return null
  }
  return { endpoint, p256dh, auth }
}

// GET — channel status for the caller: is push configured server-side and
// does this member have any opted-in browser. Endpoints are never returned.
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return unauthorized()
  const count = await prisma.pushSubscription.count({ where: { userId: session.user.id } })
  return NextResponse.json({
    configured: pushConfigured(),
    publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null,
    subscriptions: count,
  })
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()
    if (!pushConfigured()) return NextResponse.json({ error: "Push is not available" }, { status: 503 })

    const rl = await rateLimit(`push-sub:${session.user.id}`, 20, 60 * 60 * 1000)
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

    const sub = parseSubscription(await request.json().catch(() => null))
    if (!sub) return NextResponse.json({ error: "Invalid subscription" }, { status: 400 })

    // An endpoint belongs to one browser profile. If another account was
    // signed in there before, the subscription moves to the current
    // member — the previous account must never push to this browser.
    await prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: { userId: session.user.id, ...sub },
      update: { userId: session.user.id, p256dh: sub.p256dh, auth: sub.auth, failureCount: 0 },
    })

    // Bound per-member fan-out: keep the newest MAX_SUBS_PER_USER.
    const stale = await prisma.pushSubscription.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: "desc" },
      skip: MAX_SUBS_PER_USER,
      select: { id: true },
    })
    if (stale.length) await prisma.pushSubscription.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } })

    await recordPushEvent({ type: "PERMISSION_GRANTED", userId: session.user.id })
    return NextResponse.json({ subscribed: true }, { status: 201 })
  } catch (error) {
    console.error("Push subscribe error:", error)
    return NextResponse.json({ error: "Failed to subscribe" }, { status: 500 })
  }
}

// DELETE — remove this browser's subscription ({ endpoint }) or, with no
// endpoint, every subscription the caller owns ("turn push off").
export async function DELETE(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()
    const body = (await request.json().catch(() => ({}))) as { endpoint?: unknown }
    const where =
      typeof body?.endpoint === "string" && body.endpoint
        ? { userId: session.user.id, endpoint: body.endpoint }
        : { userId: session.user.id }
    const { count } = await prisma.pushSubscription.deleteMany({ where })
    if (count > 0) await recordPushEvent({ type: "SUBSCRIPTION_REMOVED", userId: session.user.id, category: "member" })
    return NextResponse.json({ removed: count })
  } catch (error) {
    console.error("Push unsubscribe error:", error)
    return NextResponse.json({ error: "Failed to unsubscribe" }, { status: 500 })
  }
}
