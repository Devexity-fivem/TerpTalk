import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { getClientIp, hashIp, logSecurityEvent } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { notifyMany } from "@/lib/notify"

// POST — restricted-account self-service. No session: banned/suspended
// users can't log in, so this re-verifies username+password and returns the
// account's restriction status. Optionally records a review or deletion
// request as an APPEAL report for the moderation team.
//
// Security notes:
// - Wrong credentials and unrestricted accounts return the same generic
//   failure — the status is only revealed after a correct password.
// - Rate-limited like the login endpoint (per-IP).
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rl = await rateLimit(`restricted:${hashIp(ip)}`, 10, 15 * 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))
    const { username, password, message, requestDeletion } = body
    if (typeof username !== "string" || typeof password !== "string" || !username.trim() || !password) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }

    // Per-username cap too — IP rotation alone must not give unlimited
    // guesses against a single account.
    const userRl = await rateLimit(`restricted-user:${username.trim().toLowerCase()}`, 10, 15 * 60 * 1000)
    if (!userRl.allowed) {
      return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 })
    }

    const user = await prisma.user.findFirst({
      where: { profile: { username: { equals: username.trim(), mode: "insensitive" } } },
      select: {
        id: true, password: true, banned: true, bannedReason: true, suspendedUntil: true,
        profile: { select: { username: true } },
      },
    })

    const ok = !!user?.password && (await bcrypt.compare(password, user.password))
    if (!ok) {
      await logSecurityEvent("LOGIN_FAILURE", {
        ip,
        userAgent: request.headers.get("user-agent"),
        metadata: { reason: "invalid_credentials", endpoint: "restricted" },
      })
      return NextResponse.json({ error: "Invalid username or password" }, { status: 401 })
    }

    const suspended = !!user.suspendedUntil && user.suspendedUntil > new Date()
    if (!user.banned && !suspended) {
      // Correct credentials on a healthy account — nothing to see here.
      return NextResponse.json({ restricted: false })
    }

    const status = {
      restricted: true,
      banned: user.banned,
      suspendedUntil: suspended ? user.suspendedUntil!.toISOString() : null,
      reason: user.bannedReason || null,
    }

    // Appeal / deletion request — one pending request at a time.
    const trimmed = typeof message === "string" ? message.trim().slice(0, 1000) : ""
    if (trimmed || requestDeletion === true) {
      const existing = await prisma.report.findFirst({
        where: { type: "APPEAL", reporterId: user.id, status: { in: ["PENDING", "REVIEWING"] } },
        select: { id: true },
      })
      if (!existing) {
        await prisma.report.create({
          data: {
            type: "APPEAL",
            reason: requestDeletion ? "ACCOUNT_DELETION_REQUEST" : "ACCOUNT_REVIEW_REQUEST",
            description: trimmed || null,
            reporterId: user.id,
            reportedId: user.id,
            priority: "NORMAL",
          },
        })
        const moderators = await prisma.user.findMany({
          where: { role: { in: ["MODERATOR", "ADMINISTRATOR"] }, profile: { isNot: { username: "terpbot" } } },
          select: { id: true },
        })
        if (moderators.length > 0) {
          await notifyMany(
            moderators.map((m) => ({
              userId: m.id,
              type: "MODERATOR_ANNOUNCEMENT" as const,
              title: requestDeletion ? "Account deletion request" : "Account review request",
              content: `A restricted member requested ${requestDeletion ? "account deletion" : "a review of their restriction"}.`,
              link: "/moderation",
            }))
          ).catch(() => {})
        }
      }
    }

    return NextResponse.json(status)
  } catch (error) {
    console.error("Restricted status error:", error)
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 })
  }
}
