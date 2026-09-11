import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rate-limit"
import { unauthorized, forbidden, isBanned } from "@/lib/security"
import { checkMaintenance } from "@/lib/maintenance"

// GET — list users I have blocked (private to requester)
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return unauthorized()
    }
    if (await isBanned(session.user.id)) return forbidden()

    const blocks = await prisma.block.findMany({
      where: { blockerId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        createdAt: true,
        blocked: {
          select: {
            id: true,
            profile: { select: { username: true } },
          },
        },
      },
    })

    return NextResponse.json({
      blocks: blocks.map((b) => ({
        id: b.id,
        userId: b.blocked.id,
        username: b.blocked.profile?.username ?? "unknown",
        createdAt: b.createdAt,
      })),
    })
  } catch (error) {
    console.error("Blocks fetch error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}

// POST — block a user: { userId }
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return unauthorized()
    }
    if (await isBanned(session.user.id)) return forbidden()

    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

    const rl = await rateLimit(`block:${session.user.id}`, 30, 60 * 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))
    const { userId } = body

    if (typeof userId !== "string" || !userId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 })
    }

    if (userId === session.user.id) {
      return NextResponse.json({ error: "Cannot block yourself" }, { status: 400 })
    }

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    })
    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const existing = await prisma.block.findUnique({
      where: {
        blockerId_blockedId: {
          blockerId: session.user.id,
          blockedId: userId,
        },
      },
    })
    if (existing) {
      return NextResponse.json({ blocked: true })
    }

    await prisma.block.create({
      data: { blockerId: session.user.id, blockedId: userId },
    })

    // Remove any follow relationships in both directions
    await prisma.follow.deleteMany({
      where: {
        OR: [
          { followerId: session.user.id, followingId: userId },
          { followerId: userId, followingId: session.user.id },
        ],
      },
    })

    return NextResponse.json({ blocked: true }, { status: 201 })
  } catch (error) {
    console.error("Block error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}

// DELETE — unblock: { userId }
export async function DELETE(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return unauthorized()
    }

    const body = await request.json().catch(() => ({}))
    const { userId } = body

    if (typeof userId !== "string" || !userId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 })
    }

    await prisma.block.deleteMany({
      where: { blockerId: session.user.id, blockedId: userId },
    })

    return NextResponse.json({ blocked: false })
  } catch (error) {
    console.error("Unblock error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
