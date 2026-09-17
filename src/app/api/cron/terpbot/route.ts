import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runCronTask } from "@/lib/cron-claim"
import { postToGeneral, GROW_TIPS, sanitizeEcho } from "@/lib/terpbot"
import { scanDormantThreads } from "@/lib/terpbot-assist"
import { recordBotEvent } from "@/lib/terpbot-events"
import { currentWeekKey, previousWeekKey, currentMonthKey, previousMonthKey } from "@/lib/week"
import { resolveWeeklyWinner, resolveMonthlyDiaryWinner } from "@/lib/contest-awards"
import { resolveWeeklyRecognition } from "@/lib/weekly-recognition"
import { materializeReputationFlags } from "@/lib/trust-signals"
import { reconcileReferralPayouts } from "@/lib/reputation"

// Daily TerpBot job — digests, grow tips, and contest-winner announcements.
// Invoked by the Vercel cron configured in vercel.json.
//
// Idempotency model: each period task is *claimed* atomically with a Setting
// row (unique key). The claim value is `running:<ts>` while work executes and
// `1` once it succeeds. A crash or failure leaves a claim that either goes
// stale (reclaimed by a later run) or is released immediately on failure —
// so a failed task retries on the next invocation instead of being silently
// marked complete for the whole period.

// Give the job real headroom — without this the platform default can be as
// low as 10s on legacy Hobby, silently truncating the run.
export const maxDuration = 60

// Claim/mark/release semantics live in lib/cron-claim so the regression
// suite can exercise them directly.

export async function GET(request: NextRequest) {
  // Fail closed: without CRON_SECRET the vercel-cron user-agent header is
  // forgeable by anyone. Unsigned requests are only accepted outside
  // production (local/manual runs).
  const secret = process.env.CRON_SECRET
  if (secret) {
    if (request.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  } else {
    if (process.env.NODE_ENV === "production") {
      console.error("[cron] CRON_SECRET is not configured — refusing to run in production")
      // Uniform 401 — don't reveal configuration state to unauthenticated callers.
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const ua = request.headers.get("user-agent") || ""
    if (!ua.startsWith("vercel-cron") && !ua.startsWith("Mozilla") && !ua.includes("curl")) {
      // Dev convenience: accept local tools but still reject empty UAs.
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const posted: string[] = []
  const failed: string[] = []

  // Post-marker check: an ANNOUNCEMENT BotEvent row means this exact post
  // already landed. Retried tasks consult it so a bookkeeping failure can
  // never re-post an announcement; a failed post (no marker) stays retryable.
  const wasAnnounced = (key: string) =>
    prisma.botEvent
      .findUnique({ where: { key }, select: { id: true } })
      .then(Boolean)
      .catch(() => false)

  // ── Daily digest + grow tip (once per UTC day) ───────────────────────
  const today = new Date().toISOString().slice(0, 10)
  await runCronTask(`terpbot:digest:${today}`, async () => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const [members, threads, updates] = await Promise.all([
      prisma.user.count({ where: { createdAt: { gte: since }, banned: false } }),
      prisma.thread.count({ where: { createdAt: { gte: since }, deleted: false } }),
      // Only count updates on live diaries from active authors.
      prisma.diaryUpdate.count({
        where: {
          createdAt: { gte: since },
          diary: { deleted: false },
          author: { banned: false },
        },
      }),
    ])
    const dayOfYear = Math.floor(Date.now() / 86400000)
    const tip = GROW_TIPS[dayOfYear % GROW_TIPS.length]
    const activity =
      members + threads + updates > 0
        ? `Last 24 hours: ${members} new member${members === 1 ? "" : "s"}, ${threads} new thread${threads === 1 ? "" : "s"}, ${updates} diary update${updates === 1 ? "" : "s"}.`
        : "Quiet last 24 hours — start a thread or update your diary to get things going."
    // Two separate posts — combining them into one message read like a
    // merged double-post in the chat UI. Each is marker-checked so a
    // retried run never duplicates the one that already landed; a dropped
    // post throws, releasing the claim so the next invocation retries.
    const digestKey = `announce:digest:${today}`
    if (!(await wasAnnounced(digestKey))) {
      const dto = await postToGeneral(`📊 ${activity}`)
      if (!dto) throw new Error("digest post to #general failed")
      await recordBotEvent({ type: "ANNOUNCEMENT", key: digestKey, command: "digest" }).catch(() => {})
    }
    const tipKey = `announce:tip:${today}`
    if (!(await wasAnnounced(tipKey))) {
      const dto = await postToGeneral(`💡 Grow tip: ${tip}`)
      if (!dto) throw new Error("grow-tip post to #general failed")
      await recordBotEvent({ type: "ANNOUNCEMENT", key: tipKey, command: "tip" }).catch(() => {})
    }
    return "digest"
  }, posted, failed, "digest")

  // ── Weekly contest winner (once per ISO week) ────────────────────────
  const prevWeek = previousWeekKey()
  if (currentWeekKey() !== prevWeek) {
    await runCronTask(`terpbot:contest:${prevWeek}`, async () => {
      // resolveWeeklyWinner also awards the Weekly Winner badge + notifies.
      const winner = await resolveWeeklyWinner(prevWeek)
      if (winner && winner._count.votes > 0) {
        // publicMilestoneOptOut members still win — they're just not named.
        const opt = await prisma.profile.findUnique({
          where: { userId: winner.user.id },
          select: { publicMilestoneOptOut: true },
        })
        const name = winner.user.profile?.username || winner.user.name
        const who = opt?.publicMilestoneOptOut || !name ? "a member" : `@${name}`
        const contestKey = `announce:contest:${prevWeek}`
        if (!(await wasAnnounced(contestKey))) {
          const contestDto = await postToGeneral(
            `🏆 Last week's photo contest winner: ${who} with ${winner._count.votes} vote${winner._count.votes === 1 ? "" : "s"}! This week's contest is open — submit your best budshot on the Contest page.`
          )
          if (!contestDto) throw new Error("contest-winner post to #general failed")
          await recordBotEvent({ type: "ANNOUNCEMENT", key: contestKey, command: "contest" }).catch(() => {})
        }
        return "contest"
      }
      return null
    }, posted, failed, "contest")

    // ── Grower of the Week (once per ISO week) ────────────────────────
    // resolveWeeklyRecognition awards the badge + keyed WEEKLY_AWARD and
    // is idempotent — the cron key just makes the announcement once.
    await runCronTask(`terpbot:gotw:${prevWeek}`, async () => {
      const winner = await resolveWeeklyRecognition(prevWeek)
      if (!winner) return null
      const who = winner.username ? `@${winner.username}` : "a member"
      const gotwKey = `announce:gotw:${prevWeek}`
      if (!(await wasAnnounced(gotwKey))) {
        const dto = await postToGeneral(
          `🌿 Grower of the Week: ${who}! Most reputation earned last week. This week's board resets Monday — every member starts at zero on the This Week leaderboard.`
        )
        if (!dto) throw new Error("grower-of-the-week post to #general failed")
        await recordBotEvent({ type: "ANNOUNCEMENT", key: gotwKey, command: "gotw" }).catch(() => {})
      }
      return "gotw"
    }, posted, failed, "gotw")
  }

  // ── Monthly diary contest winner (once per calendar month) ─────────
  const prevMonth = previousMonthKey()
  if (currentMonthKey() !== prevMonth) {
    await runCronTask(`terpbot:diary-contest:${prevMonth}`, async () => {
      // resolveMonthlyDiaryWinner also awards the badge + notifies the winner.
      const winner = await resolveMonthlyDiaryWinner(prevMonth)
      if (winner && winner._count.votes > 0) {
        const opt = await prisma.profile.findUnique({
          where: { userId: winner.user.id },
          select: { publicMilestoneOptOut: true },
        })
        const name = winner.user.profile?.username || winner.user.name
        const who = opt?.publicMilestoneOptOut || !name ? "a member" : `@${name}`
        const diaryKey = `announce:diary-contest:${prevMonth}`
        if (!(await wasAnnounced(diaryKey))) {
          const diaryDto = await postToGeneral(
            `🏆 Last month's Diary of the Month winner: ${who} with "${sanitizeEcho(winner.diary.title, 60)}" (${winner._count.votes} vote${winner._count.votes === 1 ? "" : "s"})! This month's contest is open — enter a well-documented diary on the Contest page.`
          )
          if (!diaryDto) throw new Error("diary-contest-winner post to #general failed")
          await recordBotEvent({ type: "ANNOUNCEMENT", key: diaryKey, command: "diary-contest" }).catch(() => {})
        }
        return "diary-contest"
      }
      return null
    }, posted, failed, "diary-contest")
  }

  // ── Notification retention (once per UTC day) ──────────────────────
  // Read notifications are already pruned per-user on PATCH; this sweeps
  // the rows that never get touched — unread items and inactive users.
  await runCronTask(`terpbot:notification-cleanup:${today}`, async () => {
    await prisma.notification.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } },
    })
    return "notification-cleanup"
  }, posted, failed, "notification-cleanup")

  // ── Dormant-thread assists (once per UTC day) ──────────────────────
  // Threads that went quiet send the OP one private TerpBot nudge —
  // never a public callout, never a fabricated answer. Per-thread claims
  // inside scanDormantThreads make re-runs idempotent.
  await runCronTask(`terpbot:dormant:${today}`, async () => {
    const { dormant, unresolved } = await scanDormantThreads()
    return `dormant:${dormant},unresolved:${unresolved}`
  }, posted, failed, "dormant-scan")

  // ── Referral payout reconciliation (once per UTC day) ─────────────
  // Safety net for qualifying referrals whose deferred payout trigger was
  // lost (dropped after() work, an earlier side-effect stage failing, or a
  // referee who went dormant right after qualifying). Idempotent — the
  // referral:<refereeId> key makes a concurrent normal-path payout a no-op.
  // A partially-failed sweep throws inside work(), releasing the claim so a
  // later invocation retries the remaining referees.
  await runCronTask(`reputation:referral-sweep:${today}`, async () => {
    const { candidates, attempted, failed: sweepFailed } = await reconcileReferralPayouts()
    return `referral-sweep:${candidates}c/${attempted}a/${sweepFailed}f`
  }, posted, failed, "referral-sweep")

  // ── Trust & safety signal scan (once per UTC day) ──────────────────
  // A plain system task — not a TerpBot capability. Detectors only flag;
  // humans decide. Flags persist as AbuseFlag rows for the staff workqueue.
  await runCronTask(`safety:signal-scan:${today}`, async () => {
    const { created } = await materializeReputationFlags(7)
    return `signal-scan:${created}`
  }, posted, failed, "signal-scan")

  return NextResponse.json({ ok: failed.length === 0, posted, failed })
}
