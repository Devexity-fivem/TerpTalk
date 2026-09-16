import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rate-limit"
import { getClientIp, hashIp, activeAuthor } from "@/lib/security"
import { tokenizeSearchText } from "@/lib/search-terms"
import { isValidWizardResultId, wizardResultToTag } from "@/lib/symptom-tags"

const THREAD_SELECT = {
  id: true,
  slug: true,
  title: true,
  createdAt: true,
  replyCount: true,
  acceptedAnswerId: true,
  category: { select: { name: true, slug: true } },
  author: { select: { name: true, profile: { select: { username: true } } } },
} as const

// Community answers for a Plant Doctor result. Exact wizardResultId matches
// first (solved threads prioritized), then similar-title threads from the
// Plant Problems category as a fallback.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const resultId = searchParams.get("result")

    if (!resultId || !isValidWizardResultId(resultId)) {
      return NextResponse.json({ threads: [] })
    }

    const ip = getClientIp(request)
    const rl = await rateLimit(`symptom-threads:${hashIp(ip)}`, 20, 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ threads: [] })
    }

    const category = await prisma.category.findUnique({
      where: { slug: "plant-problems" },
      select: { id: true },
    })
    if (!category) {
      return NextResponse.json({ threads: [] })
    }

    const baseWhere = {
      deleted: false,
      categoryId: category.id,
      author: activeAuthor(),
    } as const

    // Exact matches on the wizard result — accepted-answer threads first.
    const exact = await prisma.thread.findMany({
      where: { ...baseWhere, wizardResultId: resultId },
      orderBy: [{ acceptedAnswerId: "desc" }, { createdAt: "desc" }],
      take: 5,
      select: THREAD_SELECT,
    })

    // Sort "solved" (has accepted answer) to the top, stable otherwise —
    // Postgres can't order by nulls-desc on a nullable FK portably here.
    exact.sort((a, b) => (b.acceptedAnswerId ? 1 : 0) - (a.acceptedAnswerId ? 1 : 0))

    let threads = exact

    // Fallback: fill with similar-titled threads in the same category so the
    // section still helps on symptoms nobody has asked about yet.
    if (threads.length < 3) {
      const tag = wizardResultToTag(resultId)
      const words = tokenizeSearchText(tag?.name.replace(/-/g, " ") ?? resultId.replace(/_/g, " "))
      if (words.length > 0) {
        const exactIds = threads.map((t) => t.id)
        const similar = await prisma.thread.findMany({
          where: {
            ...baseWhere,
            id: { notIn: exactIds },
            OR: [
              { tags: { some: { tag: { slug: tag?.slug ?? "__none__" } } } },
              ...words.map((word) => ({ title: { contains: word, mode: "insensitive" as const } })),
            ],
          },
          orderBy: [{ replyCount: "desc" }, { createdAt: "desc" }],
          take: 5 - threads.length,
          select: THREAD_SELECT,
        })
        threads = [...threads, ...similar]
      }
    }

    return NextResponse.json({
      threads: threads.map((t) => ({
        id: t.id,
        slug: t.slug,
        title: t.title,
        createdAt: t.createdAt,
        replyCount: t.replyCount,
        solved: !!t.acceptedAnswerId,
        category: t.category,
        authorName: t.author.profile?.username || t.author.name || "Member",
      })),
    })
  } catch (error) {
    console.error("Symptom threads error:", error)
    return NextResponse.json({ threads: [] })
  }
}
