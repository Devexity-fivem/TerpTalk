import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/require-staff"
import { prisma } from "@/lib/prisma"
import { forbidden } from "@/lib/security"

// GET — recent security events (ADMINISTRATOR only)
export async function GET() {
  const session = { user: await requireAdmin() }
  if (!session.user) return forbidden()

  const events = await prisma.securityEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
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
