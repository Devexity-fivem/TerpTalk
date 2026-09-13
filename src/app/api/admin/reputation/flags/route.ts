import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { forbidden } from "@/lib/security"
import { requireAdmin } from "@/lib/require-staff"
import { rateLimit } from "@/lib/rate-limit"
import { detectReputationSignals, materializeReputationFlags } from "@/lib/trust-signals"

// GET — reputation-abuse signals for staff review. Detection only: nothing
// here auto-punishes; every flag links to the member for manual inspection.
export async function GET(request: Request) {
  const admin = await requireAdmin()
  if (!admin) return forbidden()

  const rl = await rateLimit(`admin-rep-flags:${admin.id}`, 20, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const { searchParams } = new URL(request.url)
  const days = Math.min(30, Math.max(1, Number(searchParams.get("days")) || 7))

  // Upsert-on-read: persisting detector hits as AbuseFlag rows makes them
  // reviewable queue items (status/assignment/resolution) without needing a
  // separate scheduler pass — the daily cron also calls this.
  await materializeReputationFlags(days).catch((e) =>
    console.error("[flags] materialize failed:", e)
  )

  const [signals, staffActions] = await Promise.all([
    detectReputationSignals(days),

    // Recent staff rep actions for the audit feed.
    prisma.reputationEvent.findMany({
      where: {
        OR: [
          { type: "STAFF_ADJUSTMENT" },
          { type: "REVERSAL", actorId: { not: null } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true, type: true, userId: true, actorId: true, amount: true,
        reason: true, createdAt: true,
      },
    }),
  ])
  const { velocity, reciprocal, newAccounts } = signals

  // Resolve usernames for every flagged id in one query.
  const ids = new Set<string>()
  for (const v of velocity) ids.add(v.userId)
  for (const r of reciprocal) { ids.add(r.aId); ids.add(r.bId) }
  for (const n of newAccounts) ids.add(n.userId)
  for (const s of staffActions) { ids.add(s.userId); if (s.actorId) ids.add(s.actorId) }
  const users = ids.size
    ? await prisma.user.findMany({
        where: { id: { in: [...ids] } },
        select: { id: true, profile: { select: { username: true } } },
      })
    : []
  const name = new Map(users.map((u) => [u.id, u.profile?.username ?? "?"]))

  return NextResponse.json({
    velocity: velocity.map((v) => ({ username: name.get(v.userId), userId: v.userId, gained: v.gained })),
    reciprocalPairs: reciprocal.map((r) => ({
      a: name.get(r.aId), b: name.get(r.bId), mutual: r.mutual,
    })),
    newAccountLikes: newAccounts.map((n) => ({ username: name.get(n.userId), userId: n.userId, freshLikes: n.freshLikes })),
    staffActions: staffActions.map((s) => ({
      id: s.id, type: s.type, amount: s.amount, reason: s.reason, createdAt: s.createdAt,
      user: name.get(s.userId), staff: s.actorId ? name.get(s.actorId) : null,
    })),
  })
}
