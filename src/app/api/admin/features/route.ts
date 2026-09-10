import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

const KNOWN_FEATURES = [
  { key: "reactions", label: "Reactions", default: true },
  { key: "polls", label: "Polls", default: true },
  { key: "messaging", label: "Direct Messaging", default: true },
  { key: "follows", label: "User/Category/Diary Follows", default: true },
  { key: "contests", label: "Contests", default: true },
  { key: "diaries", label: "Grow Diaries", default: true },
]

export async function GET() {
  const session = await getServerSession(authOptions)
  if (session?.user?.role !== "ADMINISTRATOR") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
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
  const session = await getServerSession(authOptions)
  if (session?.user?.role !== "ADMINISTRATOR") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
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
