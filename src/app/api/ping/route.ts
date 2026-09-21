import { NextRequest, NextResponse } from "next/server"
import { after } from "next/server"
import { getToken } from "next-auth/jwt"
import { prisma } from "@/lib/prisma"
import { sessionCookieName } from "@/lib/auth"
import { forbidden, unauthorized } from "@/lib/security"
import { awardReputation } from "@/lib/reputation"
import { evaluateChallenges } from "@/lib/challenges"
import { evaluateQuests } from "@/lib/quests"
import { evaluateStreaks } from "@/lib/streaks"
import { pruneChatMessagesIfDue } from "@/lib/chat-cleanup"
import { drainPendingReversals } from "@/lib/reputation-outbox"
import { rateLimit } from "@/lib/rate-limit"

// POST — lightweight presence ping; updates lastSeenAt + ONLINE status.
// Uses JWT verification instead of getServerSession to avoid an extra DB round-trip.
export async function POST(request: NextRequest) {
  try {
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
      cookieName: sessionCookieName,
    })
    const userId = token?.id as string | undefined
    if (!userId) return unauthorized()

    // Fetch banned, sessionVersion, and lastSeenAt in one query; only write when stale (>15 min)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        banned: true, sessionVersion: true, lastSeenAt: true,
        profile: { select: { hideOnlineStatus: true } },
      },
    })
    if (!user || user.banned || (token?.sessionVersion as number | undefined ?? 0) !== (user.sessionVersion ?? 0)) {
      return forbidden()
    }

    const stale =
      !user.lastSeenAt ||
      Date.now() - user.lastSeenAt.getTime() > 15 * 60 * 1000
    if (stale) {
      await prisma.user.update({
        where: { id: userId },
        // Members who hide their online status still get lastSeenAt (it
        // drives throttling/onboarding) but never get stamped ONLINE.
        data: { lastSeenAt: new Date(), status: user.profile?.hideOnlineStatus ? "OFFLINE" : "ONLINE" },
      })

      // Daily check-in rep — keyed per UTC day so concurrent pings and
      // retries can never double-award (the find-then-award race is gone).
      const dayKey = new Date().toISOString().slice(0, 10)
      await awardReputation(userId, "DAILY_LOGIN", 1, "Daily check-in", {
        key: `daily:${userId}:${dayKey}`,
      }).catch(() => {})
    }

    // Background work, throttled to once per hour (chat prune) and the same
    // ~15-min staleness cadence as above (weekly challenge + daily quest
    // evaluation). Deferred via after() so multi-query evaluation never
    // delays the ping.
    after(async () => {
      await pruneChatMessagesIfDue()
      // Throttled reputation-outbox drain — bounds a failed reversal's
      // phantom-rep lifetime to ~5 minutes instead of waiting for cron.
      const drainOk = await rateLimit("reversal-drain", 1, 5 * 60 * 1000).then((r) => r.allowed).catch(() => false)
      if (drainOk) await drainPendingReversals(10).catch(() => {})
      if (stale) {
        await evaluateChallenges(userId).catch(() => [])
        await evaluateQuests(userId).catch(() => [])
        // Runs right after today's check-in award lands — streak
        // milestones pay once-ever per member.
        await evaluateStreaks(userId).catch(() => [])
      }
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Ping error:", error)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
