import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, forbidden, getClientIp, logSecurityEvent, isAdmin } from "@/lib/security"
import { requireModerator } from "@/lib/require-staff"
import { rateLimit } from "@/lib/rate-limit"
import { reverseReputationEvent, REP_EVENT_TYPES, publicRepLabel } from "@/lib/reputation"

// GET ?username=&cursor= — staff view of a member's full reputation ledger.
// Sees everything the public view hides (staff adjustments, raw reasons,
// actor attribution, reversal linkage).
export async function GET(request: Request) {
  const staff = await requireModerator()
  if (!staff) return forbidden()

  const rl = await rateLimit(`mod-reputation:${staff.id}`, 60, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const { searchParams } = new URL(request.url)
  const username = (searchParams.get("username") || "").trim().slice(0, 30)
  const cursor = searchParams.get("cursor") || undefined
  if (!username) {
    return NextResponse.json({ error: "username required" }, { status: 400 })
  }

  const profile = await prisma.profile.findFirst({
    where: { username: { equals: username, mode: "insensitive" } },
    select: { userId: true, username: true, reputation: true },
  })
  if (!profile) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  const events = await prisma.reputationEvent.findMany({
    where: { userId: profile.userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 51,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })
  const hasMore = events.length > 50
  const page = hasMore ? events.slice(0, 50) : events

  // Resolve actor usernames for display (bounded by page size).
  const actorIds = [...new Set(page.map((e) => e.actorId).filter((x): x is string => !!x))]
  const actors = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, profile: { select: { username: true } } },
      })
    : []
  const actorName = new Map(actors.map((a) => [a.id, a.profile?.username ?? null]))

  // Drift: balance vs ledger sum — every row counts (reversedAt is status).
  const sum = await prisma.reputationEvent.aggregate({
    where: { userId: profile.userId },
    _sum: { amount: true },
  })
  const ledgerSum = sum._sum.amount ?? 0

  return NextResponse.json({
    user: { id: profile.userId, username: profile.username, reputation: profile.reputation },
    ledgerSum,
    drift: profile.reputation - ledgerSum,
    events: page.map((e) => ({
      id: e.id,
      type: e.type,
      label: publicRepLabel(e.type),
      amount: e.amount,
      reason: e.reason,
      key: e.key,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      actor: e.actorId ? actorName.get(e.actorId) ?? null : null,
      reversedAt: e.reversedAt,
      reversalOfId: e.reversalOfId,
      createdAt: e.createdAt,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  })
}

// POST { eventId, reason } — reverse a single ledger event. Moderators can
// reverse community awards; reversing a STAFF_ADJUSTMENT requires an admin.
// Never targets admin accounts or the staff member themselves.
export async function POST(request: Request) {
  try {
    const staff = await requireModerator()
    if (!staff) {
      const session = await getServerSession(authOptions).catch(() => null)
      if (session?.user?.id) {
        await logSecurityEvent("AUTHORIZATION_FAILURE", {
          userId: session.user.id,
          ip: getClientIp(request),
          metadata: { endpoint: "moderation/reputation" },
        })
      }
      return session?.user?.id ? forbidden() : unauthorized()
    }

    const rl = await rateLimit(`mod-rep-mutate:${staff.id}`, 30, 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))
    const { eventId, reason } = body
    if (typeof eventId !== "string" || !eventId || typeof reason !== "string" || !reason.trim() || reason.length > 500) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }

    const event = await prisma.reputationEvent.findUnique({
      where: { id: eventId },
      select: { id: true, userId: true, type: true, reversedAt: true, user: { select: { role: true } } },
    })
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 })
    if (event.reversedAt) return NextResponse.json({ error: "Already reversed" }, { status: 409 })
    if (event.type === REP_EVENT_TYPES.REVERSAL || event.type === REP_EVENT_TYPES.REINSTATE || event.type === REP_EVENT_TYPES.LEGACY_MIGRATION) {
      return NextResponse.json({ error: "This event type cannot be reversed" }, { status: 400 })
    }
    if (event.type === REP_EVENT_TYPES.STAFF_ADJUSTMENT && !isAdmin(staff.role)) {
      return forbidden()
    }
    if (event.user.role === "ADMINISTRATOR" || event.userId === staff.id) {
      return forbidden()
    }

    const result = await reverseReputationEvent(eventId, `Staff reversal: ${reason.trim()}`, staff.id)
    if (!result.reversed) {
      return NextResponse.json({ error: "Already reversed" }, { status: 409 })
    }

    await prisma.moderationAction.create({
      data: {
        type: "REPUTATION_REVERSAL",
        reason: `${reason.trim()} (event ${eventId}, ${event.type})`,
        targetUserId: event.userId,
        moderatorId: staff.id,
      },
    })
    await logSecurityEvent("SUSPICIOUS_ACTIVITY", {
      userId: staff.id,
      ip: getClientIp(request),
      metadata: { reputationAction: "reversal", eventId, targetUserId: event.userId },
    })

    return NextResponse.json({ ok: true, newRep: result.newRep })
  } catch (error) {
    console.error("Reputation reversal error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
