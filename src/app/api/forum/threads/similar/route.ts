import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rate-limit"
import { getClientIp } from "@/lib/security"

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "for", "of", "to", "in", "on", "at", "with", "by", "from",
  "my", "your", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did",
  "will", "would", "could", "should", "may", "might", "can", "i", "you", "he", "she", "it", "we", "they",
  "this", "that", "these", "those", "what", "how", "help", "please", "need", "question", "about",
])

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const title = searchParams.get("title")
  const categoryId = searchParams.get("categoryId")

  if (typeof title !== "string" || title.length < 4) {
    return NextResponse.json({ threads: [] })
  }

  // Rate limit: 20 similar checks per minute per IP
  const rl = await rateLimit(`similar-threads:${getClientIp(request)}`, 20, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ threads: [] })
  }

  const words = title
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    .slice(0, 8)

  if (words.length === 0) {
    return NextResponse.json({ threads: [] })
  }

  const threads = await prisma.thread.findMany({
    where: {
      deleted: false,
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
}
