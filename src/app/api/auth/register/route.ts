import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import { rateLimit } from "@/lib/rate-limit"
import {
  LIMITS,
  USERNAME_REGEX,
  RESERVED_USERNAMES,
  getClientIp,
  hashIp,
  logSecurityEvent,
} from "@/lib/security"
import { awardReputation, REP_POINTS } from "@/lib/reputation"
import { randomInt } from "crypto"

// Generate a captcha persisted in the database (works across serverless instances)
export async function GET(request: Request) {
  try {
    const ip = getClientIp(request)
    const rl = await rateLimit(`captcha:${hashIp(ip)}`, 20, 10 * 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 }
      )
    }

    const num1 = randomInt(1, 11)
    const num2 = randomInt(1, 11)

    const captcha = await prisma.captcha.create({
      data: {
        answer: String(num1 + num2),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 min
      },
    })

    // Opportunistic cleanup of expired captchas
    prisma.captcha
      .deleteMany({ where: { expiresAt: { lt: new Date() } } })
      .catch(() => {})

    return NextResponse.json({
      captcha: { id: captcha.id, question: `${num1} + ${num2} = ?` },
    })
  } catch (error) {
    console.error("Captcha generation error:", error)
    return NextResponse.json(
      { error: "Failed to generate captcha" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  const ip = getClientIp(request)
  const ipHash = hashIp(ip)
  const userAgent = request.headers.get("user-agent")

  try {
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

    const body = await request.json()
    const { username, password, captchaId, captchaAnswer, ageVerified, referralCode } = body

    if (!username || !password || !captchaId || !captchaAnswer) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    // Optional referral — a referrer's username; validate it exists if provided
    let referrerId: string | null = null
    let referrerUserId: string | null = null
    if (referralCode && typeof referralCode === "string" && referralCode.trim()) {
      const referrer = await prisma.profile.findUnique({
        where: { username: referralCode.trim() },
        select: { id: true, userId: true },
      })
      if (!referrer) {
        return NextResponse.json(
          { error: "Referral username not found" },
          { status: 400 }
        )
      }
      referrerId = referrer.id
      referrerUserId = referrer.userId
    }

    // Age verification — must be an explicit true attestation
    if (ageVerified !== true) {
      return NextResponse.json(
        { error: "You must confirm you are 21 or older" },
        { status: 400 }
      )
    }

    // Validate captcha server-side (single-use, expiring)
    const captcha = await prisma.captcha.findUnique({ where: { id: captchaId } })
    if (
      !captcha ||
      captcha.used ||
      captcha.expiresAt < new Date() ||
      String(captchaAnswer).trim() !== captcha.answer
    ) {
      if (captcha) {
        await prisma.captcha.delete({ where: { id: captcha.id } }).catch(() => {})
      }
      await logSecurityEvent("REGISTRATION_FAILED", {
        ip,
        userAgent,
        metadata: { reason: "captcha" },
      })
      return NextResponse.json(
        { error: "Invalid or expired security check" },
        { status: 400 }
      )
    }
    // Burn the captcha — single use
    await prisma.captcha.update({
      where: { id: captcha.id },
      data: { used: true },
    })

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

    if (RESERVED_USERNAMES.has(username.toLowerCase())) {
      return NextResponse.json(
        { error: "This username is reserved" },
        { status: 400 }
      )
    }

    // Password strength
    if (
      typeof password !== "string" ||
      password.length < LIMITS.PASSWORD_MIN ||
      password.length > LIMITS.PASSWORD_MAX
    ) {
      return NextResponse.json(
        { error: `Password must be between ${LIMITS.PASSWORD_MIN} and ${LIMITS.PASSWORD_MAX} characters` },
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

    const user = await prisma.user.create({
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

    await logSecurityEvent("REGISTRATION", {
      userId: user.id,
      ip,
      userAgent,
      metadata: referrerId ? { referredById: referrerId } : undefined,
    })

    // Reward the referrer
    if (referrerUserId) {
      await awardReputation(
        referrerUserId,
        "REFERRAL",
        REP_POINTS.REFERRAL,
        `Referred new member ${username}`
      ).catch(() => {})
      await prisma.notification.create({
        data: {
          userId: referrerUserId,
          type: "REFERRAL",
          title: "New referral",
          content: `${username} joined using your referral link`,
          link: "/profile",
        },
      }).catch(() => {})
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
