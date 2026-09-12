import { NextResponse, after } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import { rateLimit } from "@/lib/rate-limit"
import {
  LIMITS,
  USERNAME_REGEX,
  isReservedUsername,
  getClientIp,
  hashIp,
  logSecurityEvent,
} from "@/lib/security"
import { awardReputation, REP_POINTS } from "@/lib/reputation"
import { getBooleanSetting, SITE_SETTINGS } from "@/lib/settings"
import { checkMaintenance } from "@/lib/maintenance"
import { announceNewMember } from "@/lib/terpbot"
import { notify } from "@/lib/notify"

export async function POST(request: Request) {
  const ip = getClientIp(request)
  const ipHash = hashIp(ip)
  const userAgent = request.headers.get("user-agent")

  try {
    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

    if (!(await getBooleanSetting(SITE_SETTINGS.REGISTRATION_ENABLED, true))) {
      return NextResponse.json({ error: "Registration is currently disabled" }, { status: 403 })
    }

    // Rate limit: 5 registration attempts per 15 min per IP
    const rl = await rateLimit(`register:${ipHash}`, 5, 15 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        ip,
        userAgent,
        metadata: { endpoint: "auth/register" },
      })
      return NextResponse.json(
        { error: "Too many signup attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
      )
    }

    const body = await request.json().catch(() => ({}))
    const { username, password, ageVerified, referralCode, captchaId, captchaAnswer } = body

    if (!username || !password || !captchaId || !captchaAnswer) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    // Verify math captcha
    const captcha = await prisma.captcha.findUnique({
      where: { id: captchaId },
    })

    if (!captcha || captcha.used || captcha.expiresAt < new Date()) {
      return NextResponse.json(
        { error: "Challenge expired. Please refresh and try again." },
        { status: 400 }
      )
    }

    if (captcha.answer !== String(captchaAnswer).trim()) {
      await prisma.captcha.update({
        where: { id: captchaId },
        data: { used: true },
      })
      return NextResponse.json(
        { error: "Security check failed. Please try again." },
        { status: 400 }
      )
    }

    await prisma.captcha.update({
      where: { id: captchaId },
      data: { used: true },
    })

    // Optional referral — a referrer's username; validate it exists if provided
    let referrerId: string | null = null
    let referrerUserId: string | null = null
    if (referralCode && typeof referralCode === "string" && referralCode.trim()) {
      const referrer = await prisma.profile.findUnique({
        where: { username: referralCode.trim() },
        select: { id: true, userId: true },
      })
      // A stale or mistyped referral link must not block signup — just
      // drop the attribution rather than hard-failing the registration.
      referrerId = referrer?.id ?? null
      referrerUserId = referrer?.userId ?? null
    }

    // Age verification — must be an explicit true attestation
    if (ageVerified !== true) {
      return NextResponse.json(
        { error: "You must confirm you are 21 or older" },
        { status: 400 }
      )
    }

    // Security checks passed (honeypot + time gate + rate limit)

    // Username format
    if (
      typeof username !== "string" ||
      username.length < LIMITS.USERNAME_MIN ||
      username.length > LIMITS.USERNAME_MAX ||
      !USERNAME_REGEX.test(username)
    ) {
      return NextResponse.json(
        { error: "Username must be 3-20 characters: letters, numbers, underscores only" },
        { status: 400 }
      )
    }

    if (isReservedUsername(username)) {
      return NextResponse.json(
        { error: "This username is reserved" },
        { status: 400 }
      )
    }

    // Password strength (bcrypt truncates to 72 bytes, so enforce byte length)
    if (
      typeof password !== "string" ||
      password.length < LIMITS.PASSWORD_MIN ||
      password.length > LIMITS.PASSWORD_MAX ||
      Buffer.byteLength(password, "utf8") > 72
    ) {
      return NextResponse.json(
        { error: `Password must be between ${LIMITS.PASSWORD_MIN} and ${LIMITS.PASSWORD_MAX} characters and must not exceed 72 bytes` },
        { status: 400 }
      )
    }

    // Uniqueness (case-insensitive to prevent lookalike impersonation)
    const existingProfile = await prisma.profile.findFirst({
      where: { username: { equals: username, mode: "insensitive" } },
    })

    if (existingProfile) {
      return NextResponse.json(
        { error: "Username already taken" },
        { status: 400 }
      )
    }

    const hashedPassword = await bcrypt.hash(password, 12)

    let user
    try {
      user = await prisma.user.create({
        data: {
          name: username,
          password: hashedPassword,
          ageVerified: true,
          profile: {
            create: {
              username,
              referredById: referrerId,
            },
          },
        },
        include: {
          profile: {
            select: { username: true },
          },
        },
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return NextResponse.json({ error: "Username already taken" }, { status: 400 })
      }
      throw error
    }

    await logSecurityEvent("REGISTRATION", {
      userId: user.id,
      ip,
      userAgent,
      metadata: referrerId ? { referredById: referrerId } : undefined,
    })

    // TerpBot welcomes the new member in community chat — deferred so the
    // signup response isn't delayed by the post.
    after(() => announceNewMember(username).then(() => {}))

    // Reward the referrer
    if (referrerUserId) {
      await awardReputation(
        referrerUserId,
        "REFERRAL",
        REP_POINTS.REFERRAL,
        `Referred new member ${username}`
      ).catch(() => {})
      await notify({
        userId: referrerUserId,
        type: "REFERRAL",
        title: "New referral",
        content: `@${username} joined using your referral link`,
        link: `/u/${username}`,
        actorId: user.id,
      })
    }

    return NextResponse.json(
      {
        user: {
          id: user.id,
          name: user.name,
          username: user.profile?.username,
        },
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("Registration error:", error)
    await logSecurityEvent("REGISTRATION_FAILED", {
      ip,
      userAgent,
      metadata: { reason: "server_error" },
    })
    return NextResponse.json(
      { error: "Registration failed" },
      { status: 500 }
    )
  }
}
