import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, getClientIp, logSecurityEvent, isBanned, forbidden } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { newRecoveryPhrase, hashPhrase } from "@/lib/recovery"

// GET — does the current user have a recovery phrase set?
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return unauthorized()
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { recoveryPhraseHash: true },
  })
  return NextResponse.json({ hasPhrase: !!user?.recoveryPhraseHash })
}

// POST — generate a NEW recovery phrase (replaces any existing one).
// The phrase is returned ONCE in this response — we only store its hash.
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()

    const rl = await rateLimit(`recovery-gen:${session.user.id}`, 5, 60 * 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 })
    }
    if (await isBanned(session.user.id)) return forbidden("Your account is suspended")

    const phrase = newRecoveryPhrase()
    const hash = await hashPhrase(phrase)

    await prisma.user.update({
      where: { id: session.user.id },
      data: { recoveryPhraseHash: hash },
    })

    await logSecurityEvent("RECOVERY_PHRASE_GENERATED", {
      userId: session.user.id,
      ip: getClientIp(request),
    })

    return NextResponse.json({ phrase })
  } catch (error) {
    console.error("Recovery phrase error:", error)
    return NextResponse.json({ error: "Failed to generate phrase" }, { status: 500 })
  }
}
