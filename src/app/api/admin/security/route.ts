import { NextResponse } from "next/server"
import { parsePageParams } from "@/lib/pagination"
import { requireAdmin } from "@/lib/require-staff"
import { prisma } from "@/lib/prisma"
import { forbidden } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

// GET — recent security events (ADMINISTRATOR only)
// Note: ipHash/userAgent stay in the DB for abuse correlation but are
// never returned to the UI. Events are auto-purged after 90 days —
// security telemetry doesn't need indefinite retention.
const RETENTION_DAYS = 90
export async function GET(request: Request) {
  const admin = await requireAdmin()
  if (!admin) return forbidden()

  const rl = await rateLimit(`admin-security:${admin.id}`, 30, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const { searchParams } = new URL(request.url)
  const { limit, skip } = parsePageParams(searchParams)

  // Opportunistic retention enforcement
  prisma.securityEvent
    .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - RETENTION_DAYS * 86400_000) } } })
    .catch(() => {})
  prisma.rateLimit
    .deleteMany({ where: { expiresAt: { lt: new Date() } } })
    .catch(() => {})

  const events = await prisma.securityEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    skip,
  })

  const userIds = [...new Set(events.map((e) => e.userId).filter(Boolean))] as string[]
  const profiles = await prisma.profile.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, username: true },
  })
  const nameByUserId = new Map(profiles.map((p) => [p.userId, p.username]))

  return NextResponse.json({
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      user: e.userId ? (nameByUserId.get(e.userId) ?? "deleted user") : "anonymous",
      metadata: e.metadata,
      createdAt: e.createdAt,
    })),
  })
}
