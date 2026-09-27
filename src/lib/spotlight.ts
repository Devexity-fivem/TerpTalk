// Grower Spotlight — a deterministic weekly feature for the home page.
// Eligible members hold the grower-spotlight unlock (Cured rank, or a
// 100-day check-in streak marker) and own a public, live grow diary
// updated within the last two weeks. Pick is stable for the whole ISO
// week: sha1(`${weekKey}:${diaryId}`) ascending, first wins — no random,
// no reshuffle on cache miss.

import { createHash } from "crypto"
import { prisma } from "@/lib/prisma"
import { REP_RANKS } from "@/lib/progression-config"
import { activeAuthor } from "@/lib/security"
import { TERPBOT_USERNAME } from "@/lib/terpbot-constants"

const CURED_XP = REP_RANKS.find((r) => r.name === "Cured")!.threshold
const FRESH_WINDOW_MS = 14 * 86400000

export function isoWeekKey(now = new Date()): string {
  // ISO-8601 week: Thursday of the week pins both year and week number.
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`
}

export interface GrowerSpotlight {
  weekKey: string
  diary: {
    id: string
    slug: string | null
    title: string
    strain: string | null
    stage: string
    updatedAt: Date
  }
  author: {
    id: string
    username: string
    avatarUrl: string | null
    xp: number
  }
}

export async function getGrowerSpotlight(now = new Date()): Promise<GrowerSpotlight | null> {
  const weekKey = isoWeekKey(now)
  const freshSince = new Date(now.getTime() - FRESH_WINDOW_MS)

  // Streak route — non-reversed streak:100 markers grant eligibility even
  // below Cured rank (Garden Perks amendment).
  const streakOwners = (
    await prisma.progressionEvent.findMany({
      where: { reversedAt: null, key: { startsWith: "streak:100:" } },
      select: { userId: true },
    })
  ).map((r) => r.userId)

  const candidates = await prisma.growDiary.findMany({
    where: {
      deleted: false,
      harvested: false,
      visibility: "PUBLIC",
      updatedAt: { gte: freshSince },
      author: {
        ...activeAuthor(),
        role: { not: "ADMINISTRATOR" },
        profile: {
          username: { not: TERPBOT_USERNAME },
          unlockFrozen: false,
          publicMilestoneOptOut: false,
          OR: [{ xp: { gte: CURED_XP } }, { userId: { in: streakOwners } }],
        },
      },
    },
    select: {
      id: true,
      slug: true,
      title: true,
      strain: true,
      stage: true,
      updatedAt: true,
      author: {
        select: {
          id: true,
          profile: { select: { username: true, avatarUrl: true, xp: true } },
        },
      },
    },
  })

  const eligible = candidates.filter((d) => d.author.profile)
  if (eligible.length === 0) return null

  const hash = (diaryId: string) => createHash("sha1").update(`${weekKey}:${diaryId}`).digest("hex")
  const pick = eligible.sort((a, b) => hash(a.id).localeCompare(hash(b.id)))[0]

  return {
    weekKey,
    diary: {
      id: pick.id,
      slug: pick.slug,
      title: pick.title,
      strain: pick.strain,
      stage: pick.stage,
      updatedAt: pick.updatedAt,
    },
    author: {
      id: pick.author.id,
      username: pick.author.profile!.username,
      avatarUrl: pick.author.profile!.avatarUrl,
      xp: pick.author.profile!.xp,
    },
  }
}
