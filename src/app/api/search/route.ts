import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { unstable_cache } from "next/cache"
import { getClientIp, hashIp } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

// Escape PostgreSQL LIKE wildcards so a query cannot enumerate the whole table.
function escapeLike(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
}

const getSearchResults = unstable_cache(
  async (q: string, t: string, sort: string, categorySlug: string) => {
    const contains = { contains: q, mode: "insensitive" as const }

    let categoryId: string | undefined
    if (categorySlug) {
      const category = await prisma.category.findUnique({ where: { slug: categorySlug }, select: { id: true } })
      if (category) categoryId = category.id
    }

    const threadOrderBy = sort === "popular" ? { views: "desc" as const } : { createdAt: "desc" as const }

    const postThreadIds = (t === "all" || t === "threads")
      ? await prisma.post.findMany({
          where: {
            deleted: false,
            content: contains,
            thread: { deleted: false, category: { hidden: false, ...(categoryId ? { id: categoryId } : {}) } },
          },
          take: 10,
          select: { threadId: true },
        }).then((posts) => posts.map((p) => p.threadId))
      : []

    const [threads, strains, users, diaries] = await Promise.all([
      (t === "all" || t === "threads") ? prisma.thread.findMany({
        where: {
          deleted: false,
          category: { hidden: false, ...(categoryId ? { id: categoryId } : {}) },
          OR: [{ title: contains }, { content: contains }, { id: { in: postThreadIds } }],
        },
        take: 10,
        orderBy: threadOrderBy,
        select: {
          id: true,
          title: true,
          slug: true,
          createdAt: true,
          views: true,
          replyCount: true,
          category: { select: { name: true } },
        },
      }) : [],
      (t === "all" || t === "strains") ? prisma.strain.findMany({
        where: { OR: [{ name: contains }, { genetics: contains }, { breeder: contains }] },
        take: 10,
        select: { id: true, name: true, type: true, genetics: true },
      }) : [],
      (t === "all" || t === "users") ? prisma.profile.findMany({
        where: {
          username: contains,
          user: { banned: false },
        },
        take: 10,
        select: {
          username: true,
          avatarUrl: true,
          reputation: true,
        },
        orderBy: { reputation: "desc" },
      }) : [],
      (t === "all" || t === "diaries") ? prisma.growDiary.findMany({
        where: { deleted: false, OR: [{ title: contains }, { strain: contains }, { description: contains }] },
        take: 10,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          strain: true,
          stage: true,
          _count: { select: { updates: true } },
        },
      }) : [],
    ])

    return { threads, strains, users, diaries }
  },
  ["search-results"],
  { revalidate: 60, tags: ["search"] }
)

// GET ?q= — global search across threads, strains, users, diaries (public data only)
export async function GET(request: Request) {
  const ip = getClientIp(request)

  // Rate limit — search runs up to 4 LIKE queries per request; cap by hashed IP
  const rl = await rateLimit(`search:${hashIp(ip)}`, 30, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many searches" }, { status: 429 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const raw = (searchParams.get("q") || "").trim().slice(0, 100)
    const type = searchParams.get("type") || "all"
    const sort = searchParams.get("sort") || "latest"
    const categorySlug = searchParams.get("category") || ""

    if (raw.length < 2) {
      return NextResponse.json({ threads: [], strains: [], users: [], diaries: [] })
    }

    const q = escapeLike(raw)

    const selectedTypes = new Set<string>(["all", "threads", "strains", "users", "diaries"])
    const t = selectedTypes.has(type) ? type : "all"

    const { threads, strains, users, diaries } = await getSearchResults(q, t, sort, categorySlug)

    return NextResponse.json({ threads, strains, users, diaries }, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=60" },
    })
  } catch (error) {
    console.error("Search error:", error)
    return NextResponse.json({ error: "Search failed" }, { status: 500 })
  }
}
