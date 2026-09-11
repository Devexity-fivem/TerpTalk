import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma"
import { getClientIp, hashIp } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

const VIEW_COOKIE = "tt_thread_views"
const VIEW_COOLDOWN_MS = 24 * 60 * 60 * 1000
const COOKIE_MAX_AGE_S = 7 * 24 * 60 * 60
const MAX_COOKIE_ENTRIES = 100

function parseViews(value: string | undefined): Record<string, number> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return Object.fromEntries(
        (Object.entries(parsed) as [string, unknown][]).filter(([, v]) => typeof v === "number")
      ) as Record<string, number>
    }
  } catch {
    // ignore malformed cookie
  }
  return {}
}

function trimViews(views: Record<string, number>): Record<string, number> {
  const entries = Object.entries(views)
  if (entries.length <= MAX_COOKIE_ENTRIES) return views
  return Object.fromEntries(
    entries
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_COOKIE_ENTRIES)
  )
}

// Track a thread view once per browser per day. This removes the need to
// write to the database on every thread page render (a major write amplifier
// on the free tier) while still counting legitimate views.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const threadId = typeof body.threadId === "string" ? body.threadId : ""
    if (!threadId) {
      return NextResponse.json({ error: "Missing threadId" }, { status: 400 })
    }

    const ip = getClientIp(request)
    const rl = await rateLimit(`thread-view:${hashIp(ip)}`, 120, 15 * 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many views" }, { status: 429 })
    }

    const thread = await prisma.thread.findUnique({
      where: { id: threadId },
      select: { id: true, deleted: true, category: { select: { hidden: true } } },
    })
    if (!thread || thread.deleted) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 })
    }
    if (thread.category?.hidden) {
      return NextResponse.json({ ok: true, incremented: false })
    }

    const cookieStore = await cookies()
    const existing = parseViews(cookieStore.get(VIEW_COOKIE)?.value)
    const now = Date.now()

    const last = existing[threadId]
    if (last && now - last < VIEW_COOLDOWN_MS) {
      return NextResponse.json({ ok: true, incremented: false })
    }

    await prisma.thread.update({
      where: { id: threadId },
      data: { views: { increment: 1 } },
    })

    const updated = trimViews({ ...existing, [threadId]: now })
    cookieStore.set({
      name: VIEW_COOKIE,
      value: JSON.stringify(updated),
      path: "/",
      maxAge: COOKIE_MAX_AGE_S,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    })

    return NextResponse.json({ ok: true, incremented: true })
  } catch (error) {
    console.error("Thread view tracking error:", error)
    return NextResponse.json({ error: "Failed to record view" }, { status: 500 })
  }
}
