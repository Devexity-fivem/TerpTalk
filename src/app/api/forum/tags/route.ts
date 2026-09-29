import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getClientIp, hashIp, activeAuthor } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

// Public: list tags. Optionally search with ?q=soil
export async function GET(request: Request) {
  try {
    const ip = getClientIp(request)
    const rl = await rateLimit(`forum-tags:${hashIp(ip)}`, 60, 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const { searchParams } = new URL(request.url)
    const q = searchParams.get("q")?.trim().toLowerCase().slice(0, 40) || ""

    // Same visibility rule as search's tag bucket: counts cover only live
    // public threads by active authors, and a tag used solely inside
    // hidden (staff) categories isn't listed at all. Unused tags stay.
    const visibleThread = { deleted: false, category: { hidden: false }, author: activeAuthor() }
    const tags = await prisma.tag.findMany({
      where: {
        OR: [{ threads: { none: {} } }, { threads: { some: { thread: visibleThread } } }],
        ...(q ? { AND: [{ OR: [{ name: { startsWith: q } }, { slug: { startsWith: q } }] }] } : {}),
      },
      take: q ? 10 : 200,
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: { threads: { where: { thread: visibleThread } } },
        },
      },
    })

    return NextResponse.json({
      tags: tags.map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        color: t.color,
        count: t._count.threads,
      })),
    })
  } catch (error) {
    console.error("Tag list error:", error)
    return NextResponse.json({ tags: [] }, { status: 500 })
  }
}
