import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, publicUserSelect, getClientIp, logSecurityEvent, isBanned, forbidden } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { storeImage } from "@/lib/blob"
import { currentWeekKey } from "@/lib/week"

// GET — current week's entries with vote counts + whether I voted
export async function GET() {
  const session = await getServerSession(authOptions)
  const week = currentWeekKey()

  const entries = await prisma.contestEntry.findMany({
    where: { week },
    orderBy: { votes: { _count: "desc" } },
    take: 200, // weekly entries are bounded; cap anyway
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
      user: e.user,
      votes: e._count.votes,
      votedByMe: "votes" in e ? (e.votes as { id: string }[]).length > 0 : false,
      mine: e.userId === session?.user?.id,
    })),
  })
}

// POST — { action: "enter", image, caption } or { action: "vote", entryId }
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()

    const body = await request.json().catch(() => ({}))
    const action = body.action

    if (await isBanned(session.user.id)) return forbidden("Your account is suspended")

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
      const imageUrl = await storeImage(image, "contest")
      const entry = await prisma.contestEntry.create({
        data: {
          week: currentWeekKey(),
          imageUrl,
          caption: typeof caption === "string" ? caption.slice(0, 200) : null,
          userId: session.user.id,
        },
      })
      return NextResponse.json({ entry }, { status: 201 })
    }

    if (action === "vote") {
      const { entryId } = body
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
      // One vote per week per user
      const existing = await prisma.contestVote.findFirst({
        where: { userId: session.user.id, entry: { week: entry.week } },
        select: { id: true, entryId: true },
      })
      if (existing) {
        await prisma.contestVote.delete({ where: { id: existing!.id } })
        if (existing!.entryId === entryId) {
          return NextResponse.json({ voted: false }) // un-vote
        }
      }
      await prisma.contestVote.create({ data: { entryId, userId: session.user.id } })
      return NextResponse.json({ voted: true })
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  } catch (error) {
    console.error("Contest error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
