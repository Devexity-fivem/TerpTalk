import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getClientIp, hashIp, logSecurityEvent, LIMITS } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { isValidPhrase, verifyPhrase, newRecoveryPhrase, hashPhrase } from "@/lib/recovery"
import bcrypt from "bcryptjs"

// POST — reset password with username + 12-word recovery phrase:
// { username, phrase, newPassword }
export async function POST(request: Request) {
  try {
    const ip = getClientIp(request)
    const ipHash = hashIp(ip)

    // Strict rate limit — per IP and per username
    const ipRl = await rateLimit(`recover:${ipHash}`, 5, 60 * 60 * 1000)
    if (!ipRl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", { ip, metadata: { endpoint: "recover", scope: "ip" } })
      return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))
    const username = typeof body.username === "string" ? body.username.trim().slice(0, 64) : ""
    const phrase = typeof body.phrase === "string" ? body.phrase : ""
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : ""

    if (
      !username ||
      !phrase ||
      newPassword.length < LIMITS.PASSWORD_MIN ||
      newPassword.length > LIMITS.PASSWORD_MAX ||
      Buffer.byteLength(newPassword, "utf8") > 72
    ) {
      return NextResponse.json(
        { error: "Username, 12-word phrase, and a new password are required." },
        { status: 400 }
      )
    }

    if (!isValidPhrase(phrase)) {
      return NextResponse.json({ error: "Invalid recovery phrase." }, { status: 400 })
    }

    const userRl = await rateLimit(`recover-user:${username.toLowerCase()}`, 5, 60 * 60 * 1000)
    if (!userRl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", { ip, metadata: { endpoint: "recover", scope: "user", username } })
      return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 })
    }

    const profile = await prisma.profile.findFirst({
      where: { username: { equals: username, mode: "insensitive" } },
      select: { userId: true },
    })

    // Also try matching account name if no username match
    const user = profile?.userId
      ? await prisma.user.findUnique({
          where: { id: profile.userId },
          select: { id: true, recoveryPhraseHash: true, banned: true, name: true, sessionVersion: true },
        })
      : await prisma.user.findFirst({
          where: { name: { equals: username, mode: "insensitive" } },
          select: { id: true, recoveryPhraseHash: true, banned: true, name: true, sessionVersion: true },
        })

    // Uniform failure — don't reveal whether the account or phrase exists
    const fail = async () => {
      await logSecurityEvent("RECOVERY_FAILED", { ip, metadata: { endpoint: "recover" } })
      return NextResponse.json({ error: "Recovery failed — check your username and phrase." }, { status: 400 })
    }

    if (!user || user.banned || !user.recoveryPhraseHash) return fail()

    const ok = await verifyPhrase(phrase, user.recoveryPhraseHash)
    if (!ok) return fail()

    const newPhrase = newRecoveryPhrase()
    const [hashed, newPhraseHash] = await Promise.all([
      bcrypt.hash(newPassword, 12),
      hashPhrase(newPhrase),
    ])

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashed,
        recoveryPhraseHash: newPhraseHash,
        sessionVersion: { increment: 1 },
      },
    })

    await logSecurityEvent("RECOVERY_SUCCESS", { userId: user.id, ip })

    return NextResponse.json({ ok: true, phrase: newPhrase })
  } catch (error) {
    console.error("Recovery error:", error)
    return NextResponse.json({ error: "Recovery failed" }, { status: 500 })
  }
}
