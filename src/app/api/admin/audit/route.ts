import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/require-staff"
import { prisma } from "@/lib/prisma"
import { forbidden } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

const MAX_DAYS = 90
const MAX_PAGE_SIZE = 100

// GET — centralized admin audit log (ADMINISTRATOR only)
// Combines moderation actions and security events, newest first.
// ?from=ISO&to=ISO&page=1&limit=100
export async function GET(request: Request) {
  const admin = await requireAdmin()
  if (!admin) {
    return forbidden()
  }

  const rl = await rateLimit(`admin-audit:${admin.id}`, 30, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const { searchParams } = new URL(request.url)
  const q = (searchParams.get("q") || "").trim().toLowerCase().slice(0, 60)
  const dateFrom = searchParams.get("from")
  const dateTo = searchParams.get("to")

  let fromDate: Date | undefined
  let toDate: Date | undefined
  if (dateFrom) {
    fromDate = new Date(dateFrom)
    if (isNaN(fromDate.getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 })
    }
  }
  if (dateTo) {
    toDate = new Date(dateTo)
    if (isNaN(toDate.getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 })
    }
  }
  if (fromDate && toDate && toDate.getTime() - fromDate.getTime() > MAX_DAYS * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ error: `Date range must be within ${MAX_DAYS} days` }, { status: 400 })
  }

  const page = Math.max(1, Number(searchParams.get("page")) || 1)
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(searchParams.get("limit")) || 100))
  const skip = (page - 1) * limit

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
      take: limit,
      skip,
      include: { moderator: { select: { profile: { select: { username: true } } } } },
    }),
    prisma.securityEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip,
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
