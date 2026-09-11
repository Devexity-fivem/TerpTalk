import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/require-staff"
import { rateLimit } from "@/lib/rate-limit"

const KNOWN_FEATURES = [
  { key: "reactions", label: "Reactions", default: true },
  { key: "polls", label: "Polls", default: true },
  { key: "messaging", label: "Direct Messaging", default: true },
  { key: "follows", label: "User/Category/Diary Follows", default: true },
  { key: "contests", label: "Contests", default: true },
  { key: "diaries", label: "Grow Diaries", default: true },
]

export async function GET() {
  const admin = await requireAdmin()
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  const rl = await rateLimit(`admin-features:${admin.id}`, 60, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const settings = await prisma.setting.findMany({
    where: { key: { startsWith: "feature:" } },
    select: { key: true, value: true },
  })

  const values = new Map(settings.map((s) => [s.key, s.value === "true"]))
  const features = KNOWN_FEATURES.map((f) => ({
    ...f,
    enabled: values.has(`feature:${f.key}`) ? values.get(`feature:${f.key}`)! : f.default,
  }))

  return NextResponse.json({ features })
}

export async function PUT(request: Request) {
  const admin = await requireAdmin()
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  const rl = await rateLimit(`admin-features-put:${admin.id}`, 60, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const body = await request.json().catch(() => ({}))
  const { key, enabled } = body
  if (typeof key !== "string" || typeof enabled !== "boolean") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }
  if (!KNOWN_FEATURES.some((f) => f.key === key)) {
    return NextResponse.json({ error: "Unknown feature" }, { status: 400 })
  }

  await prisma.setting.upsert({
    where: { key: `feature:${key}` },
    update: { value: enabled ? "true" : "false" },
    create: { key: `feature:${key}`, value: enabled ? "true" : "false" },
  })

  return NextResponse.json({ ok: true })
}
