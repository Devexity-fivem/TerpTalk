import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { unstable_cache } from "next/cache"
import { getClientIp, hashIp } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

function escapeLike(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
}

export async function GET(request: Request) {
  const ip = getClientIp(request)
  const rl = await rateLimit(`search-suggest:${hashIp(ip)}`, 60, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ suggestions: [] }, { status: 429 })
  }

  const { searchParams } = new URL(request.url)
  const raw = (searchParams.get("q") || "").trim().slice(0, 100)
  if (raw.length < 2) {
    return NextResponse.json({ suggestions: [] })
  }

  const q = escapeLike(raw)

  const getSearchSuggestions = unstable_cache(
    async (query: string) => {
      const [threads, strains, users, tags] = await Promise.all([
        prisma.thread.findMany({
          where: { deleted: false, category: { hidden: false }, title: { contains: query, mode: "insensitive" } },
          take: 4,
          orderBy: { views: "desc" },
          select: { title: true, slug: true },
        }),
        prisma.strain.findMany({
          where: { name: { contains: query, mode: "insensitive" } },
          take: 3,
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
        prisma.profile.findMany({
          where: { username: { contains: query, mode: "insensitive" }, user: { banned: false } },
          take: 3,
          orderBy: { reputation: "desc" },
          select: { username: true },
        }),
        prisma.tag.findMany({
          where: { name: { contains: query, mode: "insensitive" } },
          take: 3,
          orderBy: { name: "asc" },
          select: { name: true, slug: true },
        }),
      ])

      const suggestions = [
        ...threads.map((t) => ({ type: "thread" as const, title: t.title, slug: t.slug })),
        ...strains.map((s) => ({ type: "strain" as const, title: s.name, slug: s.id })),
        ...users.map((u) => ({ type: "user" as const, title: u.username, slug: u.username })),
        ...tags.map((t) => ({ type: "tag" as const, title: t.name, slug: t.slug })),
      ]

      return { suggestions }
    },
    ["search-suggest"],
    { revalidate: 60, tags: ["search"] }
  )

  const { suggestions } = await getSearchSuggestions(q)

  return NextResponse.json({ suggestions }, {
    headers: { "Cache-Control": "public, max-age=60, s-maxage=60" },
  })
}
