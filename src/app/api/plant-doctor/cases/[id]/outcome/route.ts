import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { unauthorized, getClientIp } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { reportPlantDoctorOutcome } from "@/lib/plant-doctor"
import { isPdOutcome } from "@/lib/plant-doctor-outcomes"

// Append a grower-reported outcome to a tracked case. Owner-only
// (lib re-checks ownership); the append-only model keeps earlier reports
// so a corrected outcome never erases history.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()

    // Same bound as case creation (pd-case: 20/hr, user+IP key) — outcome
    // appends are the sibling owner-scoped mutation in this loop.
    const rl = await rateLimit(`pd-outcome:${session.user.id}:${getClientIp(request)}`, 20, 60 * 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const { id } = await params

    const body = await request.json().catch(() => ({}))
    const { outcome, note } = body ?? {}
    if (!isPdOutcome(outcome)) {
      return NextResponse.json({ error: "Invalid outcome" }, { status: 400 })
    }

    const r = await reportPlantDoctorOutcome({
      caseId: id,
      userId: session.user.id,
      outcome,
      note: typeof note === "string" ? note : null,
    })
    if ("error" in r) {
      return NextResponse.json({ error: r.error === "not found" ? "Case not found" : "Invalid outcome" }, { status: r.error === "not found" ? 404 : 400 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Plant doctor outcome error:", error)
    return NextResponse.json({ error: "Failed to save outcome" }, { status: 500 })
  }
}
