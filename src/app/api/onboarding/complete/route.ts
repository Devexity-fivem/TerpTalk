import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, isBanned, forbidden } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

// POST — mark onboarding as completed/dismissed. The timestamp is set
// server-side; the client only signals intent.
export async function POST() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()
    if (await isBanned(session.user.id)) return forbidden()

    const rl = await rateLimit(`onboarding-complete:${session.user.id}`, 20, 60 * 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Slow down." }, { status: 429 })
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: { onboardingCompletedAt: new Date() },
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Onboarding complete error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
