import { NextResponse, after } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, forbidden, isBanned, isAdmin, enforceLinkTrust } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { checkMaintenance } from "@/lib/maintenance"
import { announceHarvest } from "@/lib/terpbot"
import { notifyMany } from "@/lib/notify"
import { awardReputation, grantBadge, REP_POINTS } from "@/lib/reputation"
import { evaluateGrowJourney } from "@/lib/grow-journey"
import { revalidateTag } from "next/cache"
import { VALID_YIELD_UNITS } from "@/lib/yield"
import { parseHarvestDifficulty } from "@/lib/grow-fields"

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return unauthorized()

  if (await isBanned(session.user.id)) return forbidden()

  const maintenance = await checkMaintenance()
  if (maintenance) return maintenance

  const { id } = await params
  const diary = await prisma.growDiary.findUnique({
    where: { id },
    select: { id: true, authorId: true, deleted: true, startDate: true, harvested: true },
  })
  if (!diary || diary.deleted) return NextResponse.json({ error: "Diary not found" }, { status: 404 })

  const canEdit = diary.authorId === session.user.id || isAdmin((session.user as { role?: string }).role)
  if (!canEdit) return forbidden()

  const rl = await rateLimit(`diary-harvest:${session.user.id}`, 10, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many harvest updates" }, { status: 429 })
  }

  const body = await request.json().catch(() => ({}))
  const { harvested, harvestedAt, yieldAmount, yieldUnit, harvestRating, harvestDifficulty, harvestNotes } = body

  if (typeof harvested !== "boolean") {
    return NextResponse.json({ error: "harvested must be a boolean" }, { status: 400 })
  }

  // Optional harvest review — feeds strain-page member knowledge. Worth no
  // reputation: a paid review is a solicited review.
  let reviewRating: number | null | undefined // undefined = leave unchanged
  if ("harvestRating" in body) {
    if (harvestRating === null || harvestRating === "") {
      reviewRating = null
    } else {
      const r = Number(harvestRating)
      if (!Number.isInteger(r) || r < 1 || r > 10) {
        return NextResponse.json({ error: "Rating must be a whole number 1-10" }, { status: 400 })
      }
      reviewRating = r
    }
  }
  let reviewDifficulty: string | null | undefined
  if ("harvestDifficulty" in body) {
    if (harvestDifficulty === null || harvestDifficulty === "") {
      reviewDifficulty = null
    } else {
      reviewDifficulty = parseHarvestDifficulty(harvestDifficulty)
      if (!reviewDifficulty) {
        return NextResponse.json({ error: "Invalid difficulty" }, { status: 400 })
      }
    }
  }
  let reviewNotes: string | null | undefined
  if ("harvestNotes" in body) {
    if (harvestNotes === null || harvestNotes === "") {
      reviewNotes = null
    } else if (typeof harvestNotes !== "string" || harvestNotes.length > 1000) {
      return NextResponse.json({ error: "Notes must be under 1000 characters" }, { status: 400 })
    } else {
      reviewNotes = harvestNotes.trim() || null
    }
    // Notes render publicly on strain pages — same link gate as other
    // member-authored text.
    const linkBlock = await enforceLinkTrust(reviewNotes ?? "", session.user.id, request, "diary-harvest")
    if (linkBlock) return linkBlock
  }

  const data: {
    harvested: boolean
    harvestedAt?: Date | null
    yieldAmount?: number | null
    yieldUnit?: string | null
    harvestRating?: number | null
    harvestDifficulty?: string | null
    harvestNotes?: string | null
    stage: string
  } = {
    harvested,
    stage: harvested ? "HARVEST" : "FLOWER",
  }

  if (harvested) {
    if (harvestedAt) {
      const d = new Date(harvestedAt)
      // Harvest must fall within the grow's plausible window — after the
      // start date and not in the future (1-day slack for timezones).
      if (
        isNaN(d.getTime()) ||
        d.getTime() < new Date(diary.startDate).getTime() - 86400000 ||
        d.getTime() > Date.now() + 86400000
      ) {
        return NextResponse.json({ error: "Invalid harvestedAt date" }, { status: 400 })
      }
      data.harvestedAt = d
    } else {
      data.harvestedAt = new Date()
    }
    if (yieldAmount !== undefined && yieldAmount !== null && yieldAmount !== "") {
      const amount = Number(yieldAmount)
      if (Number.isNaN(amount) || amount < 0 || amount > 1_000_000) {
        return NextResponse.json({ error: "Invalid yield amount" }, { status: 400 })
      }
      data.yieldAmount = amount
    } else {
      data.yieldAmount = null
    }
    if (yieldUnit) {
      // Unknown units would be silently treated as grams by yield math —
      // restrict to the units the form offers.
      if (typeof yieldUnit !== "string" || !(VALID_YIELD_UNITS as readonly string[]).includes(yieldUnit)) {
        return NextResponse.json({ error: "Invalid yield unit" }, { status: 400 })
      }
      data.yieldUnit = yieldUnit
    } else {
      data.yieldUnit = null
    }
    if (reviewRating !== undefined) data.harvestRating = reviewRating
    if (reviewDifficulty !== undefined) data.harvestDifficulty = reviewDifficulty
    if (reviewNotes !== undefined) data.harvestNotes = reviewNotes
  } else {
    data.harvestedAt = null
    data.yieldAmount = null
    data.yieldUnit = null
    // Unmarking harvest retires the review with it — a review for a grow
    // that "wasn't actually harvested" shouldn't linger in strain stats.
    data.harvestRating = null
    data.harvestDifficulty = null
    data.harvestNotes = null
  }

  const updated = await prisma.growDiary.update({
    where: { id },
    data,
    include: {
      author: { select: { id: true, name: true, profile: { select: { username: true, publicMilestoneOptOut: true } } } },
    },
  })

  revalidateTag("diaries", { expire: 0 })
  revalidateTag("leaderboard", { expire: 0 })
  revalidateTag("strains", { expire: 0 })
  // Community harvest stats aggregate yield/rating/difficulty/duration.
  revalidateTag("analytics", { expire: 0 })

  // Harvest payout — once per diary (keyed), only for a documented cycle:
  // at least 4 diary updates. Toggling harvested off/on can't re-pay; the
  // payout is to the diary's AUTHOR even when an admin flips the flag.
  if (harvested && !diary.harvested) {
    const updateCount = await prisma.diaryUpdate.count({ where: { diaryId: id } })
    if (updateCount >= 4) {
      await awardReputation(
        diary.authorId,
        "HARVEST_LOGGED",
        REP_POINTS.HARVEST_LOGGED,
        `Logged harvest for "${updated.title.slice(0, 60)}"`,
        { key: `harvest:${id}`, sourceType: "DIARY", sourceId: id }
      ).catch(() => {})
    }

    // Photoperiod — a single diary spanning a whole season to harvest.
    const spanDays =
      (new Date(updated.harvestedAt ?? Date.now()).getTime() - new Date(updated.startDate).getTime()) / 86400000
    if (spanDays >= 120) {
      await grantBadge(diary.authorId, "Photoperiod", { announce: true }).catch(() => false)
    }
  }

  // TerpBot celebrates the harvest in community chat — only on the
  // false→true transition so toggling can't spam the room. The diary
  // title is sanitized inside announceHarvest.
  // Reconcile journey milestones — harvest flips HARVESTED/COMPLETE on,
  // un-harvest claws them back.
  await evaluateGrowJourney(id).catch(() => {})

  if (harvested && !diary.harvested) {
    // Members who opt out of public recognition are celebrated as "a member".
    const username =
      !updated.author.profile?.publicMilestoneOptOut &&
      (updated.author.profile?.username || updated.author.name)
        ? updated.author.profile?.username || updated.author.name!
        : "a member"
    const yieldText =
      updated.yieldAmount != null && updated.yieldUnit
        ? `${updated.yieldAmount}${updated.yieldUnit}`
        : undefined
    after(() => announceHarvest(username, updated.title, yieldText).then(() => {}))

    // Diary followers get a real notification for the harvest — the TerpBot
    // chat post above expires after ~3 days. notifyMany handles pref, ban,
    // and block filtering; the groupKey makes the false→true edge once-only.
    after(async () => {
      const followers = await prisma.diaryFollow.findMany({
        where: { diaryId: id, userId: { not: diary.authorId } },
        select: { userId: true },
        take: 5000,
      })
      if (followers.length === 0) return
      const authorName = updated.author.profile?.username || updated.author.name || "Someone"
      await notifyMany(
        followers.map((f) => ({
          userId: f.userId,
          type: "DIARY_UPDATE" as const,
          title: "Diary harvested",
          content: `@${authorName} harvested "${updated.title.slice(0, 50)}"${yieldText ? ` — reported yield ${yieldText}` : ""}`,
          link: `/diaries/${id}`,
          actorId: diary.authorId,
          groupKey: `diary-harvest:${id}`,
          dedupeMs: 24 * 60 * 60 * 1000,
        }))
      ).catch(() => {})
    })
  }

  return NextResponse.json({ diary: updated })
}
