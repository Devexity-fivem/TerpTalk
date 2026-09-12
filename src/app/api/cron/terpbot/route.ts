import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { postToGeneral, GROW_TIPS } from "@/lib/terpbot"
import { currentWeekKey, previousWeekKey, currentMonthKey, previousMonthKey } from "@/lib/week"
import { resolveWeeklyWinner, resolveMonthlyDiaryWinner } from "@/lib/contest-awards"

// Daily TerpBot job — digests, grow tips, and contest-winner announcements.
// Invoked by the Vercel cron configured in vercel.json. Idempotent via
// Setting rows, so a duplicate invocation never double-posts.

// Give the job real headroom — without this the platform default can be as
// low as 10s on legacy Hobby, silently truncating the run.
export const maxDuration = 60

async function wasDone(key: string): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key }, select: { value: true } })
  return row?.value === "1"
}

async function markDone(key: string) {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: "1" },
    update: { value: "1" },
  })
}

export async function GET(request: NextRequest) {
  // Vercel sends Authorization: Bearer $CRON_SECRET when that env var is set.
  // Otherwise accept the vercel-cron user-agent; the route is idempotent so
  // a replayed/forged call can never post twice for the same period.
  const secret = process.env.CRON_SECRET
  if (secret) {
    if (request.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  } else {
    const ua = request.headers.get("user-agent") || ""
    if (!ua.startsWith("vercel-cron")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const posted: string[] = []
  const failed: string[] = []

  // ── Daily digest + grow tip (once per UTC day) ───────────────────────
  const today = new Date().toISOString().slice(0, 10)
  const digestKey = `terpbot:digest:${today}`
  if (!(await wasDone(digestKey))) {
    await markDone(digestKey)
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const [members, threads, updates] = await Promise.all([
        prisma.user.count({ where: { createdAt: { gte: since }, banned: false } }),
        prisma.thread.count({ where: { createdAt: { gte: since }, deleted: false } }),
        prisma.diaryUpdate.count({ where: { createdAt: { gte: since } } }),
      ])
      const dayOfYear = Math.floor(Date.now() / 86400000)
      const tip = GROW_TIPS[dayOfYear % GROW_TIPS.length]
      const activity =
        members + threads + updates > 0
          ? `Yesterday: ${members} new member${members === 1 ? "" : "s"}, ${threads} new thread${threads === 1 ? "" : "s"}, ${updates} diary update${updates === 1 ? "" : "s"}.`
          : "Quiet day yesterday — start a thread or update your diary to get things going."
      // Two separate posts — combining them into one message read like a
      // merged double-post in the chat UI.
      await postToGeneral(`📊 ${activity}`)
      await postToGeneral(`💡 Grow tip: ${tip}`)
      posted.push("digest")
    } catch (e) {
      console.error("[terpbot] digest failed:", e)
      failed.push("digest")
    }
  }

  // ── Weekly contest winner (once per ISO week) ────────────────────────
  const prevWeek = previousWeekKey()
  const contestKey = `terpbot:contest:${prevWeek}`
  if (currentWeekKey() !== prevWeek && !(await wasDone(contestKey))) {
    await markDone(contestKey)
    try {
      // resolveWeeklyWinner also awards the Weekly Winner badge + notifies.
      const winner = await resolveWeeklyWinner(prevWeek)
      if (winner && winner._count.votes > 0) {
        const name = winner.user.profile?.username || winner.user.name || "a member"
        await postToGeneral(
          `🏆 Last week's photo contest winner: @${name} with ${winner._count.votes} vote${winner._count.votes === 1 ? "" : "s"}! This week's contest is open — submit your best budshot on the Contest page.`
        )
        posted.push("contest")
      }
    } catch (e) {
      console.error("[terpbot] weekly contest failed:", e)
      failed.push("contest")
    }
  }

  // ── Monthly diary contest winner (once per calendar month) ─────────
  const prevMonth = previousMonthKey()
  const diaryContestKey = `terpbot:diary-contest:${prevMonth}`
  if (currentMonthKey() !== prevMonth && !(await wasDone(diaryContestKey))) {
    await markDone(diaryContestKey)
    try {
      // resolveMonthlyDiaryWinner also awards the badge + notifies the winner.
      const winner = await resolveMonthlyDiaryWinner(prevMonth)
      if (winner && winner._count.votes > 0) {
        const name = winner.user.profile?.username || winner.user.name || "a member"
        await postToGeneral(
          `🏆 Last month's Diary of the Month winner: @${name} with "${winner.diary.title.slice(0, 60)}" (${winner._count.votes} vote${winner._count.votes === 1 ? "" : "s"})! This month's contest is open — enter a well-documented diary on the Contest page.`
        )
        posted.push("diary-contest")
      }
    } catch (e) {
      console.error("[terpbot] diary contest failed:", e)
      failed.push("diary-contest")
    }
  }

  // ── Notification retention (once per UTC day) ──────────────────────
  // Read notifications are already pruned per-user on PATCH; this sweeps
  // the rows that never get touched — unread items and inactive users.
  const cleanupKey = `terpbot:notification-cleanup:${today}`
  if (!(await wasDone(cleanupKey))) {
    await markDone(cleanupKey)
    try {
      await prisma.notification.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } },
      })
      posted.push("notification-cleanup")
    } catch (e) {
      console.error("[terpbot] notification cleanup failed:", e)
      failed.push("notification-cleanup")
    }
  }

  return NextResponse.json({ ok: failed.length === 0, posted, failed })
}
