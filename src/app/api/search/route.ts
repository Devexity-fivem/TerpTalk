import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { unstable_cache } from "next/cache"
import { getClientIp, hashIp } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { snippet } from "@/lib/seo"

// Escape PostgreSQL LIKE wildcards so a query cannot enumerate the whole table.
function escapeLike(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
}

// Excerpt centred on the first match so users see *why* a result matched.
function matchSnippet(text: string, q: string, max = 160): string {
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx === -1) return snippet(text, max)
  const start = Math.max(0, idx - 60)
  const excerpt = `${start > 0 ? "…" : ""}${text.slice(start, start + max)}${start + max < text.length ? "…" : ""}`
  return excerpt.replace(/\s+/g, " ").trim()
}

// Suspended accounts behave like banned ones in search results — their
// profiles should not be discoverable while suspended.
const activeUser = {
  banned: false,
  OR: [{ suspendedUntil: null }, { suspendedUntil: { lt: new Date() } }],
}

const TYPES = new Set(["all", "threads", "strains", "users", "diaries", "guides", "setups", "tags"])
const ALL_LIMIT = 10
const TYPE_PAGE = 20
const MAX_PAGE = 50

const getSearchResults = unstable_cache(
  async (q: string, t: string, sort: string, categorySlug: string, page: number) => {
    const contains = { contains: q, mode: "insensitive" as const }
    const limit = t === "all" ? ALL_LIMIT : TYPE_PAGE
    const skip = t === "all" ? 0 : (page - 1) * limit

    // Category scoping: an unknown or hidden slug narrows to zero threads —
    // never widen to "all categories", and never reveal that a hidden slug exists.
    let categoryId: string | undefined
    let badCategory = false
    if (categorySlug) {
      const category = await prisma.category.findUnique({
        where: { slug: categorySlug },
        select: { id: true, hidden: true },
      })
      if (category && !category.hidden) categoryId = category.id
      else badCategory = true
    }
    const threadCategory = badCategory
      ? { id: "__none__" }
      : { hidden: false, ...(categoryId ? { id: categoryId } : {}) }

    const orderBy = sort === "popular" ? { views: "desc" as const } : { createdAt: "desc" as const }

    // Post-content matches — one bounded query that also yields the matched
    // post per thread (for ?post= deep links and match snippets). Most recent
    // matching post wins per thread.
    const matchedPostByThread = new Map<string, { id: string; snippet: string }>()
    if (t === "all" || t === "threads") {
      const postMatches = await prisma.post.findMany({
        where: {
          deleted: false,
          content: contains,
          thread: { deleted: false, category: threadCategory },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, threadId: true, content: true },
      })
      for (const p of postMatches) {
        if (!matchedPostByThread.has(p.threadId)) {
          matchedPostByThread.set(p.threadId, { id: p.id, snippet: matchSnippet(p.content, q) })
        }
      }
    }
    const postThreadIds = [...matchedPostByThread.keys()]

    const threadSelect = {
      id: true,
      title: true,
      slug: true,
      createdAt: true,
      views: true,
      replyCount: true,
      category: { select: { name: true } },
      acceptedAnswer: {
        select: {
          id: true,
          deleted: true,
          content: true,
          author: { select: { name: true, profile: { select: { username: true } } } },
        },
      },
    } as const

    const [threadsRaw, strainsRaw, usersRaw, diariesRaw, guidesRaw, setupsRaw, tagsRaw] = await Promise.all([
      (t === "all" || t === "threads") ? (async () => {
        const base = { deleted: false, category: threadCategory }
        // Tier 1: title or tag match. Tier 2: body or reply match.
        // Title/tag hits always outrank body/reply hits.
        const fetchN = skip + limit + 1
        const tier1 = await prisma.thread.findMany({
          where: { ...base, OR: [{ title: contains }, { tags: { some: { tag: { name: contains } } } }] },
          orderBy,
          take: fetchN,
          select: threadSelect,
        })
        const tier2 = await prisma.thread.findMany({
          where: {
            ...base,
            NOT: { OR: [{ title: contains }, { tags: { some: { tag: { name: contains } } } }] },
            OR: [{ content: contains }, { id: { in: postThreadIds } }],
          },
          orderBy,
          take: fetchN,
          select: threadSelect,
        })
        return [...tier1, ...tier2]
      })() : [],
      (t === "all" || t === "strains") ? prisma.strain.findMany({
        where: { OR: [{ name: contains }, { genetics: contains }, { breeder: contains }, { description: contains }] },
        take: limit + 1,
        skip,
        orderBy: { name: "asc" },
        select: { id: true, name: true, type: true, genetics: true },
      }) : [],
      (t === "all" || t === "users") ? prisma.profile.findMany({
        where: {
          username: contains,
          user: activeUser,
        },
        take: limit + 1,
        skip,
        select: {
          username: true,
          avatarUrl: true,
          reputation: true,
          bio: true,
        },
        orderBy: { reputation: "desc" },
      }) : [],
      (t === "all" || t === "diaries") ? prisma.growDiary.findMany({
        where: {
          deleted: false,
          author: activeUser,
          OR: [
            { title: contains },
            { strain: contains },
            { description: contains },
            { genetics: contains },
            { updates: { some: { content: contains } } },
          ],
        },
        take: limit + 1,
        skip,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          strain: true,
          stage: true,
          _count: { select: { updates: true } },
        },
      }) : [],
      (t === "all" || t === "guides") ? prisma.guide.findMany({
        where: {
          published: true,
          OR: [{ title: contains }, { excerpt: contains }, { content: contains }],
        },
        take: limit + 1,
        skip,
        orderBy: { title: "asc" },
        select: { id: true, slug: true, title: true, excerpt: true, topic: true },
      }) : [],
      (t === "all" || t === "setups") ? prisma.growSetup.findMany({
        where: {
          deleted: false,
          author: activeUser,
          OR: [{ title: contains }, { strain: contains }, { description: contains }],
        },
        take: limit + 1,
        skip,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          strain: true,
          author: { select: { profile: { select: { username: true } }, name: true } },
        },
      }) : [],
      (t === "all" || t === "tags") ? prisma.tag.findMany({
        where: { name: contains },
        take: limit + 1,
        skip,
        orderBy: { name: "asc" },
        select: {
          name: true,
          slug: true,
          _count: {
            select: { threads: { where: { thread: { deleted: false, category: { hidden: false } } } } },
          },
        },
      }) : [],
    ])

    // Threads: tiers are already in relevance order — apply skip/limit to the
    // combined list (other buckets use DB-level skip/take).
    const threadCombined = threadsRaw
    const hasMoreThreads = threadCombined.length > skip + limit
    const threads = threadCombined.slice(skip, skip + limit).map((t) => {
      const accepted = t.acceptedAnswer && !t.acceptedAnswer.deleted ? t.acceptedAnswer : null
      const matchedPost = matchedPostByThread.get(t.id) ?? null
      return {
        id: t.id,
        title: t.title,
        slug: t.slug,
        createdAt: t.createdAt,
        views: t.views,
        replyCount: t.replyCount,
        category: t.category,
        solved: !!accepted,
        answerSnippet: accepted ? snippet(accepted.content, 140) : null,
        answerAuthor: accepted ? accepted.author.profile?.username || accepted.author.name : null,
        matchedPost,
      }
    })

    const paginate = <T>(rows: T[]): T[] => rows.slice(0, limit)
    const hasMore = {
      threads: hasMoreThreads,
      strains: strainsRaw.length > limit,
      users: usersRaw.length > limit,
      diaries: diariesRaw.length > limit,
      guides: guidesRaw.length > limit,
      setups: setupsRaw.length > limit,
      tags: tagsRaw.length > limit,
    }

    return {
      threads,
      strains: paginate(strainsRaw),
      users: paginate(usersRaw),
      diaries: paginate(diariesRaw),
      guides: paginate(guidesRaw),
      setups: paginate(setupsRaw),
      tags: paginate(tagsRaw),
      hasMore,
    }
  },
  ["search-results"],
  { revalidate: 60, tags: ["search"] }
)

// GET ?q= — global search across threads, strains, users, diaries, guides,
// setups and tags (public data only). `?page=` paginates single-type views.
export async function GET(request: Request) {
  const ip = getClientIp(request)

  // Rate limit — search runs several LIKE queries per request; cap by hashed IP
  const rl = await rateLimit(`search:${hashIp(ip)}`, 30, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many searches" }, { status: 429 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const raw = (searchParams.get("q") || "").trim().slice(0, 100)
    const type = TYPES.has(searchParams.get("type") || "") ? (searchParams.get("type") as string) : "all"
    const sort = searchParams.get("sort") === "popular" ? "popular" : "latest"
    const categorySlug = (searchParams.get("category") || "").slice(0, 60)
    const page = Math.max(1, Math.min(MAX_PAGE, parseInt(searchParams.get("page") || "1") || 1))

    const EMPTY = { threads: [], strains: [], users: [], diaries: [], guides: [], setups: [], tags: [], hasMore: {} }
    if (raw.length < 2) {
      return NextResponse.json(EMPTY)
    }

    // Lowercased for cache-key dedup — matching is case-insensitive anyway.
    const q = escapeLike(raw.toLowerCase())

    const results = await getSearchResults(q, type, sort, categorySlug, page)

    return NextResponse.json(results, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=60" },
    })
  } catch (error) {
    console.error("Search error:", error)
    return NextResponse.json({ error: "Search failed" }, { status: 500 })
  }
}
