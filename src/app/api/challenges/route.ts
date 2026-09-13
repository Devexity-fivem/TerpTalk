import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { unauthorized } from "@/lib/security"
import { getChallengeProgress, currentWeekKey, weekStart } from "@/lib/challenges"

// GET — the signed-in member's weekly challenge progress. Owner-only:
// challenge progress reveals activity cadence, so it is never public.
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()

    const challenges = await getChallengeProgress(session.user.id)
    const start = weekStart()
    const endsAt = new Date(start.getTime() + 7 * 86400000)

    return NextResponse.json(
      { week: currentWeekKey(), endsAt, challenges },
      { headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } }
    )
  } catch (error) {
    console.error("Challenges error:", error)
    return NextResponse.json({ error: "Failed to load challenges" }, { status: 500 })
  }
}
