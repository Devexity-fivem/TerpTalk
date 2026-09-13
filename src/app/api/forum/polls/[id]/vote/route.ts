import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, forbidden, isBanned, isModerator, isStaff } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { getTierPerks } from "@/lib/reputation"
import { checkMaintenance } from "@/lib/maintenance"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()

    if (await isBanned(session.user.id)) {
      return forbidden("Your account is suspended")
    }

    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

    // Poll voting is a Seedling-tier perk (750+ rep) — keeps poll brigading
    // expensive. Staff always can.
    if (!isStaff(session.user.role)) {
      const perks = await getTierPerks(session.user.id)
      if (!perks.pollVoting) {
        return forbidden("Poll voting unlocks at 750 reputation (Seedling)")
      }
    }

    const rl = await rateLimit(`poll-vote:${session.user.id}:${id}`, 10, 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many poll votes" }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))
    const { optionId } = body
    if (typeof optionId !== "string" || !optionId) {
      return NextResponse.json({ error: "Missing option" }, { status: 400 })
    }

    const poll = await prisma.poll.findUnique({
      where: { id },
      include: {
        thread: { select: { locked: true, deleted: true, category: { select: { hidden: true } } } },
        options: { where: { id: optionId }, select: { id: true } },
      },
    })

    if (!poll || !poll.thread || poll.thread.deleted || (poll.thread.category?.hidden && !isModerator(session.user.role))) {
      return NextResponse.json({ error: "Poll not found" }, { status: 404 })
    }
    if (poll.thread.locked) {
      return NextResponse.json({ error: "Thread is locked" }, { status: 403 })
    }
    if (poll.options.length === 0) {
      return NextResponse.json({ error: "Invalid option" }, { status: 400 })
    }

    const existing = await prisma.pollVote.findUnique({
      where: { pollId_userId: { pollId: id, userId: session.user.id } },
    })
    if (existing) {
      return NextResponse.json({ error: "You already voted in this poll" }, { status: 409 })
    }

    await prisma.pollVote.create({
      data: { pollId: id, optionId, userId: session.user.id },
    })

    const counts = await prisma.pollVote.groupBy({
      by: ["optionId"],
      where: { pollId: id },
      _count: { _all: true },
    })

    return NextResponse.json({
      voted: { optionId },
      counts: counts.map((c) => ({ optionId: c.optionId, count: c._count._all })),
      total: counts.reduce((sum, c) => sum + c._count._all, 0),
    })
  } catch (error) {
    console.error("Poll vote error:", error)
    return NextResponse.json({ error: "Failed to record vote" }, { status: 500 })
  }
}
