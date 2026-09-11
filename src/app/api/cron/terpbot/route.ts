import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { postToGeneral } from "@/lib/terpbot"
import { currentWeekKey, previousWeekKey } from "@/lib/week"

// Daily TerpBot job — digests, grow tips, and contest-winner announcements.
// Invoked by the Vercel cron configured in vercel.json. Idempotent via
// Setting rows, so a duplicate invocation never double-posts.

const GROW_TIPS = [
  "Check runoff pH weekly — nutrient lockout usually shows up there first.",
  "LST beats topping for small tents: same yields, less recovery time.",
  "Water less, more often is a myth — water to ~10-20% runoff, then wait for the pot to feel light.",
  "A steady 75-80°F in flower keeps terps happy; big day/night swings stress the plant.",
  "Defoliate lightly at week 3 of flower — light penetration matters more than leaf count.",
  "Drying slow (60°F / 60% RH) preserves more terpenes than a warm, fast dry.",
  "Label every cut and seed — future you will forget which pheno was which.",
  "If leaves canoe up, your light or VPD is too hot before your nutrients are wrong.",
  "Silica early in veg = stronger branches for heavy flowers later.",
  "Don't harvest by calendar — check trichomes with a loupe: cloudy > amber for most growers.",
  "Airflow fixes more problems than nutrients do. Add a fan before you add a bottle.",
  "Take clone cuts before flipping to flower — it's nearly impossible after.",
  "Cure in jars with daily burps for week one; patience doubles the flavor.",
  "Calibrate your pH pen monthly — a drifting meter causes phantom deficiencies.",
]

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

  return NextResponse.json({ ok: true, posted })
}
