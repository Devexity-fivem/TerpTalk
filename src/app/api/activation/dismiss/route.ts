import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { checkMaintenance } from "@/lib/maintenance"

// POST — durably dismiss the home activation panel for this member.
// The timestamp is set server-side; the client only signals intent.
// Dismissal hides guidance — it never marks a milestone complete, and
// re-calls are idempotent.
export async function POST() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()
    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

    const rl = await rateLimit(`activation-dismiss:${session.user.id}`, 20, 60 * 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Slow down." }, { status: 429 })
    }

    await prisma.user.updateMany({
      where: { id: session.user.id, activationDismissedAt: null },
      data: { activationDismissedAt: new Date() },
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Activation dismiss error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
