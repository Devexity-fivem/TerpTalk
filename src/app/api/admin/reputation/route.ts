import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { forbidden, getClientIp, logSecurityEvent } from "@/lib/security"
import { requireAdmin } from "@/lib/require-staff"
import { rateLimit } from "@/lib/rate-limit"
import { applyReputationAward, demoteIfNeeded, REP_EVENT_TYPES } from "@/lib/reputation"
import { STAFF_ADJUST_MAX } from "@/lib/reputation-config"
import { notify } from "@/lib/notify"

// POST { username, delta, reason } — admin-only manual reputation adjustment.
// Bounded to ±500 per action, writes a STAFF_ADJUSTMENT ledger entry plus a
// ModerationAction and security audit row — balances are never silently set.
export async function POST(request: Request) {
  try {
    const admin = await requireAdmin()
    if (!admin) {
      return forbidden()
    }

    const rl = await rateLimit(`admin-reputation:${admin.id}`, 30, 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))
    const { username, delta, reason } = body
    if (
      typeof username !== "string" || !username.trim() ||
      typeof delta !== "number" || !Number.isInteger(delta) || delta === 0 ||
      Math.abs(delta) > STAFF_ADJUST_MAX ||
      typeof reason !== "string" || !reason.trim() || reason.length > 500
    ) {
      return NextResponse.json(
        { error: `Requires username, an integer delta within ±${STAFF_ADJUST_MAX}, and a reason` },
        { status: 400 }
      )
    }

    const profile = await prisma.profile.findFirst({
      where: { username: { equals: username.trim(), mode: "insensitive" } },
      select: { userId: true, username: true, user: { select: { role: true } } },
    })
    if (!profile) return NextResponse.json({ error: "User not found" }, { status: 404 })
    if (profile.userId === admin.id || profile.user.role === "ADMINISTRATOR") {
      return forbidden()
    }

    const res = await applyReputationAward(
      profile.userId,
      REP_EVENT_TYPES.STAFF_ADJUSTMENT,
      delta,
      `Staff adjustment: ${reason.trim()}`,
      { actorId: admin.id, force: true }
    )
    if (!res.awarded) {
      return NextResponse.json({ error: "Adjustment not applied" }, { status: 409 })
    }

    if (delta < 0) {
      await demoteIfNeeded(profile.userId).catch(() => null)
    }

    await prisma.moderationAction.create({
      data: {
        type: "REPUTATION_ADJUSTMENT",
        reason: `${delta > 0 ? "+" : ""}${delta} — ${reason.trim()}`,
        targetUserId: profile.userId,
        moderatorId: admin.id,
      },
    })
    await logSecurityEvent("SUSPICIOUS_ACTIVITY", {
      userId: admin.id,
      ip: getClientIp(request),
      metadata: { reputationAction: "adjustment", delta, targetUserId: profile.userId },
    })
    await notify({
      userId: profile.userId,
      type: "REPUTATION",
      title: "Reputation adjusted",
      content: `Staff adjusted your reputation by ${delta > 0 ? "+" : ""}${delta}.`,
      link: "/profile",
    }).catch(() => null)

    return NextResponse.json({ ok: true, newRep: res.newRep })
  } catch (error) {
    console.error("Reputation adjustment error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
