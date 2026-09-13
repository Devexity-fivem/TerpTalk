import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, publicUserSelect, getClientIp, hashIp, logSecurityEvent, isBanned, forbidden, enforceLinkTrust, activeAuthor } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { storeImage, deleteImagesIfUnreferenced } from "@/lib/blob"
import { currentWeekKey } from "@/lib/week"
import { getBooleanSetting, SITE_SETTINGS } from "@/lib/settings"
import { checkMaintenance } from "@/lib/maintenance"

function userDto(u: { id?: string; name?: string | null; image?: string | null; profile?: { username?: string | null } | null; role?: string | null }) {
  return {
    name: u.name,
    username: u.profile?.username ?? null,
    image: u.image ?? null,
    role: u.role ?? null,
  }
}

// GET — current week's entries with vote counts + whether I voted
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    const ip = getClientIp(request)
    const rl = await rateLimit(`contest:${hashIp(ip)}`, 60, 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const week = currentWeekKey()

    const entries = await prisma.contestEntry.findMany({
      where: { week, user: activeAuthor() },
      orderBy: [{ votes: { _count: "desc" } }, { createdAt: "asc" }],
      take: 50,
      include: {
        user: { select: publicUserSelect },
        _count: { select: { votes: true } },
        ...(session?.user?.id && {
          votes: { where: { userId: session.user.id }, select: { id: true } },
        }),
      },
    })

    return NextResponse.json({
      week,
      entries: entries.map((e) => ({
        id: e.id,
        imageUrl: e.imageUrl,
        caption: e.caption,
        user: userDto(e.user),
        votes: e._count.votes,
        votedByMe: "votes" in e ? (e.votes as { id: string }[]).length > 0 : false,
        mine: e.userId === session?.user?.id,
      })),
    })
  } catch (error) {
    console.error("Contest GET error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}

// POST — { action: "enter", image, caption } or { action: "vote", entryId }
export async function POST(request: Request) {
  let imageUrl: string | undefined

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

    if (action === "enter") {
      const rl = await rateLimit(`contest-enter:${session.user.id}`, 3, 60 * 60 * 1000)
      if (!rl.allowed) {
        await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
          userId: session.user.id, ip: getClientIp(request), metadata: { endpoint: "contest" },
        })
        return NextResponse.json({ error: "Too many attempts" }, { status: 429 })
      }
      const { image, caption } = body
      if (typeof image !== "string" || image.length > 400_000 || !/^data:image\/(png|jpe?g|webp);base64,/.test(image)) {
        return NextResponse.json({ error: "Image must be a JPG, PNG or WebP upload" }, { status: 400 })
      }
      if (typeof caption === "string" && caption.trim()) {
        const linkBlock = await enforceLinkTrust(caption, session.user.id, request, "contest")
        if (linkBlock) return linkBlock
      }

      const currentWeek = currentWeekKey()
      const existing = await prisma.contestEntry.findFirst({
        where: { userId: session.user.id, week: currentWeek },
      })
      if (existing) {
        return NextResponse.json({ error: "You have already entered this week" }, { status: 409 })
      }

      imageUrl = await storeImage(image, "contest")
      const entry = await prisma.contestEntry
        .create({
          data: {
            week: currentWeek,
            imageUrl,
            caption: typeof caption === "string" ? caption.slice(0, 200) : null,
            userId: session.user.id,
          },
        })
        .catch(() => null)
      if (!entry) {
        return NextResponse.json({ error: "You have already entered this week" }, { status: 409 })
      }
      return NextResponse.json({ entry }, { status: 201 })
    }

    if (action === "vote") {
      const { entryId } = body
      if (typeof entryId !== "string" || !entryId) {
        return NextResponse.json({ error: "Invalid entry id" }, { status: 400 })
      }

      // Voter trust gate — same bar as the monthly diary contest so
      // sockpuppet voting costs real account age + reputation.
      const voter = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { createdAt: true, role: true, profile: { select: { reputation: true } } },
      })
      const voterAgeDays = voter ? (Date.now() - voter.createdAt.getTime()) / 86400000 : 0
      const voterRep = voter?.profile?.reputation ?? 0
      const voterStaff = voter?.role === "ADMINISTRATOR" || voter?.role === "MODERATOR"
      if (!voterStaff && (voterAgeDays < 7 || voterRep < 10)) {
        return forbidden("Voting requires an account at least 7 days old with 10+ reputation")
      }

      const rl = await rateLimit(`contest-vote:${session.user.id}`, 20, 60 * 1000)
      if (!rl.allowed) {
        await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
          userId: session.user.id, ip: getClientIp(request), metadata: { endpoint: "contest", action: "vote" },
        })
        return NextResponse.json({ error: "Too many attempts" }, { status: 429 })
      }

      const entry = await prisma.contestEntry.findUnique({
        where: { id: entryId },
        select: { id: true, week: true, userId: true },
      })
      if (!entry || entry.week !== currentWeekKey()) {
        return NextResponse.json({ error: "Entry not found" }, { status: 404 })
      }
      if (entry.userId === session.user.id) {
        return NextResponse.json({ error: "Can't vote for your own entry" }, { status: 400 })
      }

      // One vote per week per user — the (userId, week) unique key makes the
      // swap a single atomic upsert instead of a delete+create race window.
      const currentWeek = currentWeekKey()
      const vote = await prisma.contestVote.upsert({
        where: { userId_week: { userId: session.user.id, week: currentWeek } },
        create: { entryId, userId: session.user.id, week: currentWeek },
        update: { entryId },
      })
      return NextResponse.json({ voted: true, voteId: vote.id })
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  } catch (error) {
    // Clean up the uploaded Blob if the contest entry could not be recorded.
    deleteImagesIfUnreferenced([imageUrl]).catch(() => {})
    console.error("Contest error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
