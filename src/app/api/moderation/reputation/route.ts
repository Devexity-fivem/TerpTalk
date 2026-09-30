import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, forbidden, getClientIp, logSecurityEvent, isAdmin, isStaff } from "@/lib/security"
import { requireModerator } from "@/lib/require-staff"
import { rateLimit } from "@/lib/rate-limit"
import { reverseReputationEvent, REP_EVENT_TYPES, publicRepLabel } from "@/lib/reputation"
import { reverseProgressionEvent } from "@/lib/progression"
import { publicXpLabel } from "@/lib/progression-config"
import { logModAction } from "@/lib/moderation"

// Non-reversible V2 event types — markers, system bookkeeping, and the
// reversal chain itself carry no clawbackable award.
const NON_REVERSIBLE_V2 = new Set([
  "REVERSAL",
  "REINSTATE",
  "MILESTONE",
  "LEGACY_STANDING",
  "STANDING_RECOVERY",
  "UNLOCK_FREEZE",
  "STANDING_ONLY",
])

// GET ?username=&cursor= — staff view of a member's full progression ledger.
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
    select: { userId: true, username: true, xp: true, standing: true },
  })
  if (!profile) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  const events = await prisma.progressionEvent.findMany({
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
  const sum = await prisma.progressionEvent.aggregate({
    where: { userId: profile.userId },
    _sum: { xp: true, standing: true },
  })
  const ledgerSum = sum._sum.xp ?? 0
  const standingSum = sum._sum.standing ?? 0

  return NextResponse.json({
    user: { id: profile.userId, username: profile.username, xp: profile.xp, standing: profile.standing },
    ledgerSum,
    standingSum,
    drift: profile.xp - ledgerSum,
    standingDrift: profile.standing - standingSum,
    events: page.map((e) => ({
      id: e.id,
      type: e.type,
      label: publicXpLabel(e.type),
      xp: e.xp,
      standing: e.standing,
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

    // V2 progression ledger first — the live economy. Legacy
    // ReputationEvent ids fall through to the frozen-ledger reversal so
    // historical rows remain auditable.
    const event = await prisma.progressionEvent.findUnique({
      where: { id: eventId },
      select: { id: true, userId: true, type: true, reversedAt: true, reversalFinal: true, user: { select: { role: true } } },
    })

    if (event) {
      if (event.reversedAt || event.reversalFinal) {
        return NextResponse.json({ error: "Already reversed" }, { status: 409 })
      }
      if (NON_REVERSIBLE_V2.has(event.type)) {
        return NextResponse.json({ error: "This event type cannot be reversed" }, { status: 400 })
      }
      if (event.type === "STAFF_ADJUSTMENT" && !isAdmin(staff.role)) {
        return forbidden()
      }
      if (isAdmin(event.user.role) || event.userId === staff.id) {
        return forbidden()
      }
      // Moderators can't strip progression from fellow staff.
      if (isStaff(event.user.role) && !isAdmin(event.user.role) && !isAdmin(staff.role)) {
        return forbidden()
      }

      // final: staff reversals must not silently reinstate via keyed
      // re-triggers (re-like, re-accept, challenge re-evaluation).
      const result = await reverseProgressionEvent(eventId, `Staff reversal: ${reason.trim()}`, staff.id, { final: true })
      if (!result.reversed) {
        return NextResponse.json({ error: "Already reversed" }, { status: 409 })
      }

      await logModAction(prisma, {
        type: "REPUTATION_REVERSAL",
        reason: `${reason.trim()} (event ${eventId}, ${event.type})`,
        targetUserId: event.userId,
        moderatorId: staff.id,
      })
      await logSecurityEvent("SUSPICIOUS_ACTIVITY", {
        userId: staff.id,
        ip: getClientIp(request),
        metadata: { reputationAction: "reversal", eventId, targetUserId: event.userId },
      })

      return NextResponse.json({ ok: true, newXp: result.newXp })
    }

    const legacy = await prisma.reputationEvent.findUnique({
      where: { id: eventId },
      select: { id: true, userId: true, type: true, reversedAt: true, user: { select: { role: true } } },
    })
    if (!legacy) return NextResponse.json({ error: "Event not found" }, { status: 404 })
    if (legacy.reversedAt) return NextResponse.json({ error: "Already reversed" }, { status: 409 })
    if (legacy.type === REP_EVENT_TYPES.REVERSAL || legacy.type === REP_EVENT_TYPES.REINSTATE || legacy.type === REP_EVENT_TYPES.LEGACY_MIGRATION || legacy.type === REP_EVENT_TYPES.MILESTONE) {
      return NextResponse.json({ error: "This event type cannot be reversed" }, { status: 400 })
    }
    if (legacy.type === REP_EVENT_TYPES.STAFF_ADJUSTMENT && !isAdmin(staff.role)) {
      return forbidden()
    }
    if (isAdmin(legacy.user.role) || legacy.userId === staff.id) {
      return forbidden()
    }
    if (isStaff(legacy.user.role) && !isAdmin(legacy.user.role) && !isAdmin(staff.role)) {
      return forbidden()
    }

    const result = await reverseReputationEvent(eventId, `Staff reversal: ${reason.trim()}`, staff.id, { final: true })
    if (!result.reversed) {
      return NextResponse.json({ error: "Already reversed" }, { status: 409 })
    }

    await logModAction(prisma, {
      type: "REPUTATION_REVERSAL",
      reason: `${reason.trim()} (legacy event ${eventId}, ${legacy.type})`,
      targetUserId: legacy.userId,
      moderatorId: staff.id,
    })
    await logSecurityEvent("SUSPICIOUS_ACTIVITY", {
      userId: staff.id,
      ip: getClientIp(request),
      metadata: { reputationAction: "reversal", eventId, targetUserId: legacy.userId, ledger: "legacy" },
    })

    return NextResponse.json({ ok: true, newRep: result.newRep })
  } catch (error) {
    console.error("Reputation reversal error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
