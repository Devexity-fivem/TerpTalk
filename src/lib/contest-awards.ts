// Shared contest winner resolution + badge awarding. Called from the
// /contest page (display) AND the TerpBot cron (announcement) so winner
// badges are awarded reliably even if nobody visits the contest page.
import { prisma } from "@/lib/prisma"
import { publicUserSelect, activeAuthor } from "@/lib/security"
import { getBadgeByName } from "@/lib/badge-registry"
import { notify } from "@/lib/notify"
import { revalidateTag } from "next/cache"

async function awardBadge(userId: string, name: string, fallback: { description: string; icon: string; rarity: string; requirement: string }, content: string) {
  const def = getBadgeByName(name)
  const badge = await prisma.badge.upsert({
    where: { name },
    update: {},
    create: {
      name,
      description: def?.description ?? fallback.description,
      icon: def?.icon ?? fallback.icon,
      color: def?.rarity ?? fallback.rarity,
      requirement: def?.requirement ?? fallback.requirement,
    },
  })
  const has = await prisma.userBadge.findUnique({
    where: { userId_badgeId: { userId, badgeId: badge.id } },
  })
  if (has) return false
  await prisma.userBadge.create({ data: { userId, badgeId: badge.id } }).catch(() => {})
  await notify({ userId, type: "BADGE", title: `🏆 ${name}!`, content, link: "/contest" })
  return true
}

// Banned/suspended winners are skipped; ties break to the earliest entry
// so the winner is deterministic and matches the announcement.
export async function resolveWeeklyWinner(week: string) {
  const top = await prisma.contestEntry.findFirst({
    where: { week, user: activeAuthor() },
    orderBy: [{ votes: { _count: "desc" } }, { createdAt: "asc" }],
    include: { user: { select: publicUserSelect }, _count: { select: { votes: true } } },
  })
  if (!top || top._count.votes === 0) return null
  await awardBadge(
    top.userId,
    "Weekly Winner",
    { description: "Won Budshot of the Week", icon: "Trophy", rarity: "legendary", requirement: "Win a weekly photo contest" },
    "Your photo took the top spot. Check your new badge."
  )
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
  await awardBadge(
    top.userId,
    "Diary of the Month",
    { description: "Won Diary of the Month", icon: "Trophy", rarity: "legendary", requirement: "Win the monthly grow diary contest" },
    `Your diary "${top.diary.title.slice(0, 50)}" took the top spot. Check your new badge.`
  )
  // Winners get the diary featured — this is the only writer for
  // GrowDiary.featured, so the "Featured" surfaces always reflect a win.
  await prisma.growDiary.update({
    where: { id: top.diaryId },
    data: { featured: true },
  }).catch(() => {})
  revalidateTag("diaries", { expire: 0 })
  return top
}
