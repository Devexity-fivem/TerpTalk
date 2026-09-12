import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { unauthorized, isBanned, forbidden } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { getSuggestedUsers } from "@/lib/onboarding"

// GET — suggested growers for onboarding. Auth-gated; the pool is cached
// globally and exclusions are applied per viewer.
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()
    if (await isBanned(session.user.id)) return forbidden()

    const rl = await rateLimit(`onboarding-suggestions:${session.user.id}`, 30, 10 * 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Slow down." }, { status: 429 })
    }

    const users = await getSuggestedUsers(session.user.id, 10)
    return NextResponse.json(
      { users },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    console.error("Onboarding suggestions error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
