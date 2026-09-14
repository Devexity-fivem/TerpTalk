import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, isBanned, forbidden } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { checkMaintenance } from "@/lib/maintenance"
import { awardReputation, grantBadge, REP_POINTS } from "@/lib/reputation"

// POST — mark onboarding as completed/dismissed. The timestamp is set
// server-side; the client only signals intent.
export async function POST() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()
    if (await isBanned(session.user.id)) return forbidden()

    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

    const rl = await rateLimit(`onboarding-complete:${session.user.id}`, 20, 60 * 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Slow down." }, { status: 429 })
    }

    // First-transition only — updateMany with the null guard means
    // re-calls and the profile/complete path can't double-trigger the
    // onboarding award (the rep key and badge are once-ever anyway).
    const marked = await prisma.user.updateMany({
      where: { id: session.user.id, onboardingCompletedAt: null },
      data: { onboardingCompletedAt: new Date() },
    })
    if (marked.count === 1) {
      await awardReputation(
        session.user.id,
        "ONBOARDING_COMPLETE",
        REP_POINTS.ONBOARDING_COMPLETE,
        "Finished setting up your account",
        { key: `onboard:${session.user.id}` }
      ).catch(() => {})
      await grantBadge(session.user.id, "Settled In").catch(() => false)
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Onboarding complete error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
