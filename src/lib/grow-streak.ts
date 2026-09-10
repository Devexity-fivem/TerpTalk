import { prisma } from "@/lib/prisma"

export async function getGrowStreak(userId: string): Promise<{ streak: number; totalUpdates: number; harvestedDiaries: number }> {
  const [updates, harvestedDiaries] = await Promise.all([
    prisma.diaryUpdate.findMany({
      where: { authorId: userId, diary: { deleted: false } },
      orderBy: { createdAt: "desc" },
      take: 1000,
      select: { createdAt: true },
    }),
    prisma.growDiary.count({
      where: { authorId: userId, deleted: false, harvested: true },
    }),
  ])

  const days = [...new Set(updates.map((u) => new Date(u.createdAt).toDateString()))]
    .map((d) => new Date(d).getTime())
    .sort((a, b) => b - a)

  let streak = 0
  for (let i = 0; i < days.length; i++) {
    const expected = days[0] - i * 86400000
    if (Math.abs(days[i] - expected) < 43200000) streak++
    else break
  }

  return { streak, totalUpdates: updates.length, harvestedDiaries }
}
