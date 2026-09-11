import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, getClientIp, logSecurityEvent, isBanned, forbidden, LIMITS } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { newRecoveryPhrase, hashPhrase } from "@/lib/recovery"
import bcrypt from "bcryptjs"

// GET — does the current user have a recovery phrase set?
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()
    if (await isBanned(session.user.id)) return forbidden()

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { recoveryPhraseHash: true },
    })
    return NextResponse.json({ hasPhrase: !!user?.recoveryPhraseHash })
  } catch (error) {
    console.error("Recovery phrase fetch error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}

// POST — generate a NEW recovery phrase (replaces any existing one).
// The phrase is returned ONCE in this response — we only store its hash.
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()

    const body = await request.json().catch(() => ({}))
    const { password } = body
    if (typeof password !== "string" || password.length < LIMITS.PASSWORD_MIN || password.length > LIMITS.PASSWORD_MAX) {
      return NextResponse.json({ error: "Current password is required" }, { status: 400 })
    }

    const rl = await rateLimit(`recovery-gen:${session.user.id}`, 5, 60 * 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 })
    }
    if (await isBanned(session.user.id)) return forbidden("Your account is suspended")

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { password: true },
    })
    if (!user?.password || !(await bcrypt.compare(password, user.password))) {
      await logSecurityEvent("AUTHORIZATION_FAILURE", { userId: session.user.id, ip: getClientIp(request), metadata: { endpoint: "profile/recovery" } })
      return NextResponse.json({ error: "Invalid password" }, { status: 403 })
    }

    const phrase = newRecoveryPhrase()
    const hash = await hashPhrase(phrase)

    await prisma.user.update({
      where: { id: session.user.id },
      data: { recoveryPhraseHash: hash, sessionVersion: { increment: 1 } },
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
