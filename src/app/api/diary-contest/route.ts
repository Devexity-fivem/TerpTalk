import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, publicUserSelect, getClientIp, hashIp, logSecurityEvent, isBanned, forbidden, activeAuthor } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { currentMonthKey, monthRange } from "@/lib/week"
import { getBooleanSetting, SITE_SETTINGS } from "@/lib/settings"
import { checkMaintenance } from "@/lib/maintenance"

// Diary of the Month — parallel to the weekly Budshot contest. Entries are
// diaries (not photos), so the models live alongside ContestEntry/ContestVote
// rather than sharing them.

const MIN_MONTH_UPDATES = 4 // documentation-frequency gate for eligibility
const VOTER_MIN_AGE_DAYS = 7
const VOTER_MIN_REPUTATION = 10

function userDto(u: { name?: string | null; image?: string | null; profile?: { username?: string | null } | null; role?: string | null }) {
  return {
    name: u.name,
    username: u.profile?.username ?? null,
    image: u.image ?? null,
    role: u.role ?? null,
  }
}

async function eligibleDiaryIds(userId: string): Promise<Set<string>> {
  const { start, end } = monthRange(currentMonthKey())
  // Eligibility: ≥ MIN_MONTH_UPDATES updates created this month AND at least
  // one photo update on the diary ever — rewards documented, photographed grows.
  const candidates = await prisma.growDiary.findMany({
    where: { authorId: userId, deleted: false },
    select: {
      id: true,
      _count: { select: { updates: { where: { createdAt: { gte: start, lt: end } } } } },
      updates: { where: { images: { some: {} } }, take: 1, select: { id: true } },
    },
  })
  return new Set(
    candidates
      .filter((d) => d._count.updates >= MIN_MONTH_UPDATES && d.updates.length > 0)
      .map((d) => d.id)
  )
}

// GET — current month's entries with vote counts + the caller's eligible diaries
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    const ip = getClientIp(request)
    const rl = await rateLimit(`diary-contest:${hashIp(ip)}`, 60, 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const month = currentMonthKey()

    const entries = await prisma.diaryContestEntry.findMany({
      where: { month, diary: { deleted: false, author: activeAuthor() } },
      orderBy: [{ votes: { _count: "desc" } }, { createdAt: "asc" }],
      take: 50,
      include: {
        user: { select: publicUserSelect },
        _count: { select: { votes: true } },
        diary: {
          select: {
            id: true,
            title: true,
            strain: true,
            stage: true,
            harvested: true,
            _count: { select: { updates: true } },
            updates: {
              take: 1,
              orderBy: { createdAt: "desc" },
              select: { images: { take: 1, orderBy: { order: "asc" as const }, select: { url: true } } },
            },
          },
        },
        ...(session?.user?.id && {
          votes: { where: { userId: session.user.id }, select: { id: true } },
        }),
      },
    })

    let eligible: { id: string; title: string; strain: string | null }[] = []
    let alreadyEntered = false
    if (session?.user?.id) {
      const [ids, mine] = await Promise.all([
        eligibleDiaryIds(session.user.id),
        prisma.diaryContestEntry.findFirst({
          where: { userId: session.user.id, month },
          select: { diaryId: true },
        }),
      ])
      alreadyEntered = !!mine
      if (!alreadyEntered && ids.size > 0) {
        eligible = await prisma.growDiary.findMany({
          where: { id: { in: [...ids] } },
          select: { id: true, title: true, strain: true },
        })
      }
    }

    return NextResponse.json({
      month,
      entries: entries.map((e) => ({
        id: e.id,
        user: userDto(e.user),
        votes: e._count.votes,
        votedByMe: "votes" in e ? (e.votes as { id: string }[]).length > 0 : false,
        mine: e.userId === session?.user?.id,
        diary: {
          id: e.diary.id,
          title: e.diary.title,
          strain: e.diary.strain,
          stage: e.diary.stage,
          harvested: e.diary.harvested,
          updateCount: e.diary._count.updates,
          thumb: e.diary.updates[0]?.images[0]?.url ?? null,
        },
      })),
      eligible,
      alreadyEntered,
    })
  } catch (error) {
    console.error("Diary contest GET error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}

// POST — { action: "enter", diaryId } or { action: "vote", entryId }
export async function POST(request: Request) {
  try {
    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()

    if (await isBanned(session.user.id)) return forbidden("Your account is suspended")

    if (!(await getBooleanSetting(SITE_SETTINGS.CONTEST_ENABLED, true))) {
      return forbidden("Contests are currently disabled")
    }

    const body = await request.json().catch(() => ({}))
    const action = body.action
    const month = currentMonthKey()

    if (action === "enter") {
      const rl = await rateLimit(`diary-contest-enter:${session.user.id}`, 3, 60 * 60 * 1000)
      if (!rl.allowed) {
        await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
          userId: session.user.id, ip: getClientIp(request), metadata: { endpoint: "diary-contest", action: "enter" },
        })
        return NextResponse.json({ error: "Too many attempts" }, { status: 429 })
      }

      const { diaryId } = body
      if (typeof diaryId !== "string" || !diaryId) {
        return NextResponse.json({ error: "Invalid diary id" }, { status: 400 })
      }

      const existing = await prisma.diaryContestEntry.findFirst({
        where: { userId: session.user.id, month },
      })
      if (existing) {
        return NextResponse.json({ error: "You have already entered this month" }, { status: 409 })
      }

      const eligible = await eligibleDiaryIds(session.user.id)
      if (!eligible.has(diaryId)) {
        return NextResponse.json(
          { error: `Diary needs ${MIN_MONTH_UPDATES}+ updates this month and at least one photo to enter` },
          { status: 400 }
        )
      }

      const entry = await prisma.diaryContestEntry
        .create({ data: { month, diaryId, userId: session.user.id } })
        .catch(() => null)
      if (!entry) {
        return NextResponse.json({ error: "Already entered" }, { status: 409 })
      }
      return NextResponse.json({ entry }, { status: 201 })
    }

    if (action === "vote") {
      const { entryId } = body
      if (typeof entryId !== "string" || !entryId) {
        return NextResponse.json({ error: "Invalid entry id" }, { status: 400 })
      }

      // Voter trust gate — a monthly badge is worth more than a weekly one,
      // so sockpuppet voting costs real account age + reputation.
      const voter = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { createdAt: true, role: true, profile: { select: { reputation: true } } },
      })
      const ageDays = voter ? (Date.now() - new Date(voter.createdAt).getTime()) / 86400000 : 0
      const rep = voter?.profile?.reputation ?? 0
      const staff = voter?.role === "ADMINISTRATOR" || voter?.role === "MODERATOR"
      if (!staff && (ageDays < VOTER_MIN_AGE_DAYS || rep < VOTER_MIN_REPUTATION)) {
        return forbidden("Voting requires an account at least 7 days old with 10+ reputation")
      }

      const rl = await rateLimit(`diary-contest-vote:${session.user.id}`, 20, 60 * 1000)
      if (!rl.allowed) {
        await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
          userId: session.user.id, ip: getClientIp(request), metadata: { endpoint: "diary-contest", action: "vote" },
        })
        return NextResponse.json({ error: "Too many attempts" }, { status: 429 })
      }

      const entry = await prisma.diaryContestEntry.findUnique({
        where: { id: entryId },
        select: { id: true, month: true, userId: true, diary: { select: { deleted: true } } },
      })
      if (!entry || entry.month !== month || entry.diary.deleted) {
        return NextResponse.json({ error: "Entry not found" }, { status: 404 })
      }
      if (entry.userId === session.user.id) {
        return NextResponse.json({ error: "Can't vote for your own entry" }, { status: 400 })
      }

      // One vote per month per user — (userId, month) unique key makes the
      // swap a single atomic upsert instead of a delete+create race window.
      const vote = await prisma.diaryContestVote.upsert({
        where: { userId_month: { userId: session.user.id, month } },
        create: { entryId, userId: session.user.id, month },
        update: { entryId },
      })
      return NextResponse.json({ voted: true, voteId: vote.id })
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  } catch (error) {
    console.error("Diary contest error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
