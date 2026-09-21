import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { MEANINGFUL_UPDATE_SQL } from "@/lib/meaningful-update"

// Streak = consecutive UTC days with at least one MEANINGFUL update (the
// shared predicate from meaningful-update.ts — ≥10 chars, a photo, or env
// readings), ending today or yesterday. Computed from DISTINCT days (not
// raw update rows) so the fetch is bounded by streak length in days — 400
// days of updates returns 400 rows max instead of up to 1000 update rows.
// The predicate lives in SQL so a day of pure filler can't push real days
// past the LIMIT window. totalUpdates is a cheap indexed count.
// publicOnly scopes every count to PUBLIC diaries — use it anywhere the
// result is shown to someone other than the author.
export async function getGrowStreak(
  userId: string,
  { publicOnly = false }: { publicOnly?: boolean } = {},
): Promise<{ streak: number; totalUpdates: number; harvestedDiaries: number }> {
  const [days, totalUpdates, harvestedDiaries] = await Promise.all([
    prisma.$queryRaw<{ d: Date }[]>`
      SELECT DISTINCT (du."createdAt" AT TIME ZONE 'UTC')::date AS d
      FROM "DiaryUpdate" du
      JOIN "GrowDiary" g ON g.id = du."diaryId"
      WHERE du."authorId" = ${userId} AND g."deleted" = false
      AND ${MEANINGFUL_UPDATE_SQL}
      ${publicOnly ? Prisma.sql`AND g."visibility" = 'PUBLIC'` : Prisma.empty}
      ORDER BY d DESC
      LIMIT 400`,
    prisma.diaryUpdate.count({
      where: { authorId: userId, diary: { deleted: false, ...(publicOnly ? { visibility: "PUBLIC" } : {}) } },
    }),
    prisma.growDiary.count({
      where: { authorId: userId, deleted: false, harvested: true, ...(publicOnly ? { visibility: "PUBLIC" } : {}) },
    }),
  ])

  const dayMs = days.map((r) => new Date(r.d).getTime())
  const DAY = 86400000

  let streak = 0
  if (dayMs.length > 0) {
    const today = Math.floor(Date.now() / DAY) * DAY
    // A streak counts if the most recent update was today or yesterday.
    if (today - dayMs[0] <= DAY) {
      streak = 1
      for (let i = 1; i < dayMs.length; i++) {
        if (dayMs[i - 1] - dayMs[i] === DAY) streak++
        else break
      }
    }
  }

  return { streak, totalUpdates, harvestedDiaries }
}
