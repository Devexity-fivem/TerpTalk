import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rate-limit"
import { getClientIp, hashIp } from "@/lib/security"
import { tokenizeSearchText } from "@/lib/search-terms"

const TITLE_MAX = 200

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const rawTitle = searchParams.get("title")
    const rawCategoryId = searchParams.get("categoryId")

    if (typeof rawTitle !== "string" || rawTitle.length < 4 || rawTitle.length > TITLE_MAX) {
      return NextResponse.json({ threads: [] })
    }

    // Rate limit: 20 similar checks per minute per IP (hashed)
    const ip = getClientIp(request)
    const rl = await rateLimit(`similar-threads:${hashIp(ip)}`, 20, 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ threads: [] })
    }

    const categoryId = typeof rawCategoryId === "string" && rawCategoryId ? rawCategoryId : undefined

    const title = rawTitle.slice(0, TITLE_MAX)
    const words = tokenizeSearchText(title)

    if (words.length === 0) {
      return NextResponse.json({ threads: [] })
    }

    const threads = await prisma.thread.findMany({
      where: {
        deleted: false,
        category: { hidden: false },
        ...(categoryId ? { categoryId } : {}),
        OR: words.map((word) => ({ title: { contains: word, mode: "insensitive" } })),
      },
      take: 5,
      orderBy: [
        { pinned: "desc" },
        { createdAt: "desc" },
      ],
      select: {
        id: true,
        slug: true,
        title: true,
        createdAt: true,
        replyCount: true,
        category: { select: { name: true, slug: true } },
      },
    })

    return NextResponse.json({ threads })
  } catch (error) {
    console.error("Similar threads error:", error)
    return NextResponse.json({ threads: [] })
  }
}
