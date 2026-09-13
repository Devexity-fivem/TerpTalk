// Shared contest winner resolution + badge awarding. Called from the
// /contest page (display) AND the TerpBot cron (announcement) so winner
// badges are awarded reliably even if nobody visits the contest page.
import { prisma } from "@/lib/prisma"
import { publicUserSelect, activeAuthor } from "@/lib/security"
import { applyReputationAward, grantBadge, REP_POINTS } from "@/lib/reputation"
import { revalidateTag } from "next/cache"

// Banned/suspended winners are skipped; ties break to the earliest entry
// so the winner is deterministic and matches the announcement.
export async function resolveWeeklyWinner(week: string) {
  const top = await prisma.contestEntry.findFirst({
    where: { week, user: activeAuthor() },
    orderBy: [{ votes: { _count: "desc" } }, { createdAt: "asc" }],
    include: { user: { select: publicUserSelect }, _count: { select: { votes: true } } },
  })
  if (!top || top._count.votes === 0) return null
  await grantBadge(top.userId, "Weekly Winner", {
    content: "Your photo took the top spot in Budshot of the Week. Check your new badge.",
    link: "/contest",
  })
  await awardFinalists("weekly", week, top.userId)
  // Winner reputation — keyed per period so re-resolution can never double-pay.
  await applyReputationAward(
    top.userId,
    "CONTEST_WEEKLY_WIN",
    REP_POINTS.CONTEST_WEEKLY_WIN,
    "Won Budshot of the Week",
    { key: `contestwin:${week}:${top.userId}`, sourceType: "CONTEST", sourceId: week }
  ).catch(() => null)
  return top
}

export async function resolveMonthlyDiaryWinner(month: string) {
  const top = await prisma.diaryContestEntry.findFirst({
    where: { month, diary: { deleted: false }, user: activeAuthor() },
    orderBy: [{ votes: { _count: "desc" } }, { createdAt: "asc" }],
    include: {
      user: { select: publicUserSelect },
      _count: { select: { votes: true } },
      diary: { select: { id: true, title: true } },
    },
  })
  if (!top || top._count.votes === 0) return null
  await grantBadge(top.userId, "Diary of the Month", {
    content: `Your diary "${top.diary.title.slice(0, 50)}" took the top spot. Check your new badge.`,
    link: "/contest",
  })
  await awardFinalists("monthly", month, top.userId)
  await applyReputationAward(
    top.userId,
    "CONTEST_MONTHLY_WIN",
    REP_POINTS.CONTEST_MONTHLY_WIN,
    "Won Diary of the Month",
    { key: `dcontestwin:${month}:${top.userId}`, sourceType: "CONTEST", sourceId: month }
  ).catch(() => null)
  // Winners get the diary featured — this is the only writer for
  // GrowDiary.featured, so the "Featured" surfaces always reflect a win.
  await prisma.growDiary.update({
    where: { id: top.diaryId },
    data: { featured: true },
  }).catch(() => {})
  revalidateTag("diaries", { expire: 0 })
  return top
}

// "Contest Finalist" for the rest of the top 5 (non-winner, active entrants).
async function awardFinalists(kind: "weekly" | "monthly", period: string, winnerId: string) {
  const where =
    kind === "weekly"
      ? { week: period, user: activeAuthor() }
      : { month: period, diary: { deleted: false }, user: activeAuthor() }
  const top5 =
    kind === "weekly"
      ? await prisma.contestEntry.findMany({
          where,
          orderBy: [{ votes: { _count: "desc" } }, { createdAt: "asc" }],
          take: 5,
          select: { userId: true },
        })
      : await prisma.diaryContestEntry.findMany({
          where,
          orderBy: [{ votes: { _count: "desc" } }, { createdAt: "asc" }],
          take: 5,
          select: { userId: true },
        })
  for (const e of top5) {
    if (e.userId === winnerId) continue
    await grantBadge(e.userId, "Contest Finalist", {
      content: "You finished top 5 in a community contest — a finalist badge is yours.",
      link: "/contest",
    })
  }
}
