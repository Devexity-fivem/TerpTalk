import { NextResponse, after } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, forbidden, isBanned, isAdmin } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { checkMaintenance } from "@/lib/maintenance"
import { announceHarvest } from "@/lib/terpbot"
import { revalidateTag } from "next/cache"
import { VALID_YIELD_UNITS } from "@/lib/yield"

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return unauthorized()

  if (await isBanned(session.user.id)) return forbidden()

  const maintenance = await checkMaintenance()
  if (maintenance) return maintenance

  const { id } = await params
  const diary = await prisma.growDiary.findUnique({
    where: { id },
    select: { id: true, authorId: true, deleted: true, startDate: true },
  })
  if (!diary || diary.deleted) return NextResponse.json({ error: "Diary not found" }, { status: 404 })

  const canEdit = diary.authorId === session.user.id || isAdmin((session.user as { role?: string }).role)
  if (!canEdit) return forbidden()

  const rl = await rateLimit(`diary-harvest:${session.user.id}`, 10, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many harvest updates" }, { status: 429 })
  }

  const body = await request.json().catch(() => ({}))
  const { harvested, harvestedAt, yieldAmount, yieldUnit } = body

  if (typeof harvested !== "boolean") {
    return NextResponse.json({ error: "harvested must be a boolean" }, { status: 400 })
  }

  const data: {
    harvested: boolean
    harvestedAt?: Date | null
    yieldAmount?: number | null
    yieldUnit?: string | null
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
  } else {
    data.harvestedAt = null
    data.yieldAmount = null
    data.yieldUnit = null
  }

  const updated = await prisma.growDiary.update({
    where: { id },
    data,
    include: {
      author: { select: { id: true, name: true, profile: { select: { username: true } } } },
    },
  })

  revalidateTag("diaries", { expire: 0 })
  revalidateTag("leaderboard", { expire: 0 })
  revalidateTag("strains", { expire: 0 })

  // TerpBot celebrates the harvest in community chat.
  if (harvested) {
    const username = updated.author.profile?.username || updated.author.name || "a member"
    const yieldText =
      updated.yieldAmount != null && updated.yieldUnit
        ? `${updated.yieldAmount}${updated.yieldUnit}`
        : undefined
    after(() => announceHarvest(username, updated.title, yieldText).then(() => {}))
  }

  return NextResponse.json({ diary: updated })
}
