import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { postToGeneral, GROW_TIPS } from "@/lib/terpbot"
import { currentWeekKey, previousWeekKey, currentMonthKey, previousMonthKey } from "@/lib/week"

// Daily TerpBot job — digests, grow tips, and contest-winner announcements.
// Invoked by the Vercel cron configured in vercel.json. Idempotent via
// Setting rows, so a duplicate invocation never double-posts.

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

  // ── Daily digest + grow tip (once per UTC day) ───────────────────────
  const today = new Date().toISOString().slice(0, 10)
  const digestKey = `terpbot:digest:${today}`
  if (!(await wasDone(digestKey))) {
    await markDone(digestKey)
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const [members, threads, updates] = await Promise.all([
      prisma.user.count({ where: { createdAt: { gte: since } } }),
      prisma.thread.count({ where: { createdAt: { gte: since }, deleted: false } }),
      prisma.diaryUpdate.count({ where: { createdAt: { gte: since } } }),
    ])
    const dayOfYear = Math.floor(Date.now() / 86400000)
    const tip = GROW_TIPS[dayOfYear % GROW_TIPS.length]
    const activity =
      members + threads + updates > 0
        ? `Yesterday: ${members} new member${members === 1 ? "" : "s"}, ${threads} new thread${threads === 1 ? "" : "s"}, ${updates} diary update${updates === 1 ? "" : "s"}.`
        : "Quiet day yesterday — start a thread or update your diary to get things going."
    await postToGeneral(`📊 ${activity}\n💡 Grow tip: ${tip}`)
    posted.push("digest")
  }

  // ── Weekly contest winner (once per ISO week) ────────────────────────
  const prevWeek = previousWeekKey()
  const contestKey = `terpbot:contest:${prevWeek}`
  if (currentWeekKey() !== prevWeek && !(await wasDone(contestKey))) {
    await markDone(contestKey)
    const winner = await prisma.contestEntry.findFirst({
      where: { week: prevWeek },
      orderBy: { votes: { _count: "desc" } },
      include: {
        user: { select: { name: true, profile: { select: { username: true } } } },
        _count: { select: { votes: true } },
      },
    })
    if (winner && winner._count.votes > 0) {
      const name = winner.user.profile?.username || winner.user.name || "a member"
      await postToGeneral(
        `🏆 Last week's photo contest winner: @${name} with ${winner._count.votes} vote${winner._count.votes === 1 ? "" : "s"}! This week's contest is open — submit your best budshot on the Contest page.`
      )
      posted.push("contest")
    }
  }

  // ── Monthly diary contest winner (once per calendar month) ─────────
  const prevMonth = previousMonthKey()
  const diaryContestKey = `terpbot:diary-contest:${prevMonth}`
  if (currentMonthKey() !== prevMonth && !(await wasDone(diaryContestKey))) {
    await markDone(diaryContestKey)
    const winner = await prisma.diaryContestEntry.findFirst({
      where: { month: prevMonth, diary: { deleted: false }, user: { banned: false } },
      orderBy: [{ votes: { _count: "desc" } }, { createdAt: "asc" }],
      include: {
        user: { select: { name: true, profile: { select: { username: true } } } },
        diary: { select: { title: true } },
        _count: { select: { votes: true } },
      },
    })
    if (winner && winner._count.votes > 0) {
      const name = winner.user.profile?.username || winner.user.name || "a member"
      await postToGeneral(
        `🏆 Last month's Diary of the Month winner: @${name} with "${winner.diary.title.slice(0, 60)}" (${winner._count.votes} vote${winner._count.votes === 1 ? "" : "s"})! This month's contest is open — enter a well-documented diary on the Contest page.`
      )
      posted.push("diary-contest")
    }
  }

  // ── Notification retention (once per UTC day) ──────────────────────
  // Read notifications are already pruned per-user on PATCH; this sweeps
  // the rows that never get touched — unread items and inactive users.
  const cleanupKey = `terpbot:notification-cleanup:${today}`
  if (!(await wasDone(cleanupKey))) {
    await markDone(cleanupKey)
    await prisma.notification.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } },
    })
    posted.push("notification-cleanup")
  }

  return NextResponse.json({ ok: true, posted })
}
