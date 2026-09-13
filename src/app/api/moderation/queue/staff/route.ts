import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { forbidden, STAFF_ROLES } from "@/lib/security"
import { requireModerator } from "@/lib/require-staff"
import { rateLimit } from "@/lib/rate-limit"

// GET — active staff list for the case-assignment picker. MODERATOR+ only:
// assignment is an action, so view-only SUPPORT doesn't need the roster.
export async function GET() {
  const staff = await requireModerator()
  if (!staff) return forbidden()

  const rl = await rateLimit(`queue-staff:${staff.id}`, 30, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const members = await prisma.user.findMany({
    where: { role: { in: [...STAFF_ROLES] }, banned: false },
    select: { id: true, role: true, profile: { select: { username: true } } },
    orderBy: { createdAt: "asc" },
  })

  return NextResponse.json({
    staff: members.map((m) => ({
      id: m.id,
      username: m.profile?.username ?? "unknown",
      role: m.role,
    })),
  })
}
