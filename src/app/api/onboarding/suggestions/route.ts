import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { unauthorized } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { getSuggestedGrowers } from "@/lib/suggested-growers"

// GET — suggested growers for onboarding. Auth-gated; delegates to the
// canonical deterministic engine — a member with grow/profile signals gets
// personalized, reasoned matches; a brand-new member gets the same
// eligible fallback pool Discover serves.
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()
    const rl = await rateLimit(`onboarding-suggestions:${session.user.id}`, 30, 10 * 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Slow down." }, { status: 429 })
    }

    const growers = await getSuggestedGrowers(session.user.id, { limit: 6 })
    return NextResponse.json(
      { growers },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    console.error("Onboarding suggestions error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
