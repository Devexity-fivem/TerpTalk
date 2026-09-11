import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/require-staff"
import { prisma } from "@/lib/prisma"
import { forbidden } from "@/lib/security"

// GET — centralized admin audit log (ADMINISTRATOR only)
// Combines moderation actions and security events, newest first.
export async function GET(request: Request) {
  const admin = await requireAdmin()
  if (!admin) {
    return forbidden()
  }

  const { searchParams } = new URL(request.url)
  const q = (searchParams.get("q") || "").trim().toLowerCase().slice(0, 60)
  const dateFrom = searchParams.get("from")
  const dateTo = searchParams.get("to")

  const fromDate = dateFrom ? new Date(dateFrom) : undefined
  const toDate = dateTo ? new Date(dateTo) : undefined
  if ((dateFrom && isNaN(fromDate?.getTime() ?? 0)) || (dateTo && isNaN(toDate?.getTime() ?? 0))) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 })
  }

  const where = {
    createdAt: {
      ...(fromDate ? { gte: fromDate } : {}),
      ...(toDate ? { lte: toDate } : {}),
    },
  }

  const [modActions, secEvents] = await Promise.all([
    prisma.moderationAction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { moderator: { select: { profile: { select: { username: true } } } } },
    }),
    prisma.securityEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ])

  // Resolve usernames for security events separately (no relation on userId)
  const userIds = new Set<string | null>(secEvents.map((e) => e.userId).filter(Boolean))
  const users = await prisma.user.findMany({
    where: { id: { in: Array.from(userIds) as string[] } },
    select: { id: true, profile: { select: { username: true } } },
  })
  const usernameById = new Map(users.map((u) => [u.id, u.profile?.username ?? u.id]))

  const merged = [
    ...modActions.map((a) => ({
      id: a.id,
      kind: "moderation" as const,
      type: a.type,
      reason: a.reason,
      actorId: a.moderatorId,
      actor: a.moderator.profile?.username ?? a.moderatorId,
      targetId: a.targetUserId,
      duration: a.duration,
      metadata: null as string | null,
      createdAt: a.createdAt,
    })),
    ...secEvents.map((e) => ({
      id: e.id,
      kind: "security" as const,
      type: e.type,
      reason: "",
      actorId: e.userId,
      actor: e.userId ? usernameById.get(e.userId) ?? e.userId : "anonymous",
      targetId: e.userId,
      metadata: e.metadata,
      createdAt: e.createdAt,
    })),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .filter((e) => {
      if (!q) return true
      return (
        e.type.toLowerCase().includes(q) ||
        e.actor.toLowerCase().includes(q) ||
        e.reason.toLowerCase().includes(q) ||
        (e.metadata?.toLowerCase().includes(q) ?? false)
      )
    })

  return NextResponse.json({ events: merged })
}
