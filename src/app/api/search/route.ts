import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// GET ?q= — global search across threads, strains, users, diaries (public data only)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = (searchParams.get("q") || "").trim()
  if (q.length < 2) {
    return NextResponse.json({ threads: [], strains: [], users: [], diaries: [] })
  }

  const contains = { contains: q, mode: "insensitive" as const }

  const [threads, strains, users, diaries] = await Promise.all([
    prisma.thread.findMany({
      where: { deleted: false, OR: [{ title: contains }, { content: contains }] },
      take: 10,
      orderBy: { createdAt: "desc" },
      select: {
        id: true, title: true, slug: true, createdAt: true,
        category: { select: { name: true } },
        _count: { select: { posts: { where: { deleted: false } } } },
      },
    }),
    prisma.strain.findMany({
      where: { OR: [{ name: contains }, { genetics: contains }, { breeder: contains }] },
      take: 10,
      select: { id: true, name: true, type: true, genetics: true },
    }),
    prisma.profile.findMany({
      where: { username: contains, user: { banned: false } },
      take: 10,
      select: { username: true, avatarUrl: true, bio: true, reputation: true },
    }),
    prisma.growDiary.findMany({
      where: { deleted: false, OR: [{ title: contains }, { strain: contains }, { description: contains }] },
      take: 10,
      orderBy: { createdAt: "desc" },
      select: {
        id: true, title: true, strain: true, stage: true,
        _count: { select: { updates: true } },
      },
    }),
  ])

  return NextResponse.json({ threads, strains, users, diaries })
}
