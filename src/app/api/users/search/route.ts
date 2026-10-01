import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { publicUserSelect, isBanned, getClientIp, hashIp, blockedUserIds } from "@/lib/security"
import { rateLimitMany } from "@/lib/rate-limit"
import { escapeLike } from "@/lib/strain-stats"

export async function GET(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ users: [] }, { status: 401 })
  }

  const userId = session.user.id
  if (await isBanned(userId)) {
    return NextResponse.json({ users: [] }, { status: 403 })
  }

  const [rl, ipRl] = await rateLimitMany([
    { key: `users-search:${userId}`, limit: 30, windowMs: 60 * 1000 },
    { key: `users-search-ip:${hashIp(getClientIp(request))}`, limit: 60, windowMs: 60 * 1000 },
  ])
  if (!rl.allowed || !ipRl.allowed) {
    return NextResponse.json({ users: [] }, { status: 429 })
  }

  const { searchParams } = new URL(request.url)
  const raw = (searchParams.get("q") || "").trim().slice(0, 60)
  if (!raw) {
    return NextResponse.json({ users: [] })
  }

  const q = escapeLike(raw)
  // Mention/DM pickers honor blocks in both directions, like global search.
  const blocked = await blockedUserIds(userId)

  const users = await prisma.user.findMany({
    where: {
      banned: false,
      ...(blocked.length ? { id: { notIn: blocked } } : {}),
      // TerpBot is a bot, not a community member — keep it out of user pickers.
      profile: { isNot: { username: "terpbot" } },
      // Suspended accounts aren't discoverable while suspended (same rule
      // as isBanned() — mention pickers shouldn't surface them either).
      AND: [{ OR: [{ suspendedUntil: null }, { suspendedUntil: { lt: new Date() } }] }],
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { profile: { username: { contains: q, mode: "insensitive" } } },
      ],
    },
    take: 10,
    select: publicUserSelect,
    orderBy: { name: "asc" },
  })

  return NextResponse.json({ users })
}
