import type { MetadataRoute } from "next"
import { prisma } from "@/lib/prisma"
import { activeAuthor, rankableProfile, XP_ORDER } from "@/lib/security"
import { publicDiaryWhere } from "@/lib/diary-visibility"
import { diaryPath, strainPath, setupPath } from "@/lib/slugs"
import { breederPath, normalizeBreederName } from "@/lib/breeders"

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://terp-talk.vercel.app"

// Chunked sitemap (generateSitemaps → /sitemap/<id>.xml; the index is
// served by app/sitemap-index.xml/route.ts). One chunk per entity type —
// no artificial take caps, so every public strain/thread/diary/profile/
// guide/setup/tag/moment is reachable. Chunks stay well under the 50k-URL
// per-file limit; if any entity ever approaches it, split that segment by
// adding ids rather than capping rows.
//
// lastmod policy: only real record timestamps are emitted. Static routes
// have no underlying row, so they ship no lastmod rather than a fake
// "generated just now" timestamp.
//
// Regenerate at most hourly so a diary visibility flip leaves the sitemap
// quickly; entries only get dropped, never leak private rows.
export const revalidate = 3600

// Chunk registry — the index handler reads the same list.
export const SITEMAP_CHUNKS = [
  "site",      // static routes + forum categories
  "threads",
  "diaries",
  "strains",   // strains + breeder grouping pages
  "profiles",
  "guides",
  "setups",
  "tags",
  "moments",
] as const

export async function generateSitemaps() {
  return SITEMAP_CHUNKS.map((_, id) => ({ id }))
}

const STATIC = [
  { url: "/", priority: 1, changeFrequency: "daily" as const },
  { url: "/forum", priority: 0.9, changeFrequency: "daily" as const },
  { url: "/discover", priority: 0.9, changeFrequency: "daily" as const },
  // /feed is intentionally absent — it's a member-personalized surface
  // (Following / For You tabs), not a canonical SEO destination.
  { url: "/diaries", priority: 0.8, changeFrequency: "daily" as const },
  { url: "/setups", priority: 0.7, changeFrequency: "daily" as const },
  { url: "/strains", priority: 0.8, changeFrequency: "weekly" as const },
  { url: "/questions", priority: 0.8, changeFrequency: "daily" as const },
  { url: "/growers", priority: 0.7, changeFrequency: "daily" as const },
  { url: "/contest", priority: 0.6, changeFrequency: "weekly" as const },
  { url: "/leaderboard", priority: 0.6, changeFrequency: "daily" as const },
  { url: "/leaderboard/yields", priority: 0.5, changeFrequency: "weekly" as const },
  { url: "/reputation", priority: 0.5, changeFrequency: "monthly" as const },
  { url: "/guides", priority: 0.7, changeFrequency: "weekly" as const },
  { url: "/help", priority: 0.7, changeFrequency: "weekly" as const },
  { url: "/plant-doctor", priority: 0.6, changeFrequency: "monthly" as const },
  { url: "/rules", priority: 0.5, changeFrequency: "monthly" as const },
  { url: "/deals", priority: 0.5, changeFrequency: "weekly" as const },
  { url: "/calculator", priority: 0.5, changeFrequency: "monthly" as const },
  { url: "/youtubers", priority: 0.6, changeFrequency: "weekly" as const },
  { url: "/about", priority: 0.5, changeFrequency: "monthly" as const },
  { url: "/terms", priority: 0.4, changeFrequency: "yearly" as const },
  { url: "/privacy", priority: 0.4, changeFrequency: "yearly" as const },
  // /search intentionally absent — the page is noindex,nofollow, so a
  // sitemap entry would contradict the indexation policy.
]

export default async function sitemap(props: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  const id = Number(await props.id)
  const chunk = SITEMAP_CHUNKS[id]
  if (!chunk) return []

  if (chunk === "site") {
    const categories = await prisma.category.findMany({
      where: { hidden: false },
      select: { slug: true, updatedAt: true },
    })
    return [
      // No lastModified on static routes — there is no underlying record,
      // and a generation-time stamp would claim false freshness.
      ...STATIC.map((p) => ({
        url: `${baseUrl}${p.url}`,
        changeFrequency: p.changeFrequency,
        priority: p.priority,
      })),
      ...categories.map((c) => ({
        url: `${baseUrl}/forum/category/${c.slug}`,
        lastModified: c.updatedAt,
        changeFrequency: "daily" as const,
        priority: 0.8,
      })),
    ]
  }

  if (chunk === "threads") {
    const threads = await prisma.thread.findMany({
      where: { deleted: false, category: { hidden: false }, author: activeAuthor() },
      orderBy: { updatedAt: "desc" },
      select: { slug: true, updatedAt: true },
    })
    return threads.map((t) => ({
      url: `${baseUrl}/forum/thread/${t.slug}`,
      lastModified: t.updatedAt,
      changeFrequency: "daily" as const,
      priority: 0.7,
    }))
  }

  if (chunk === "diaries") {
    const diaries = await prisma.growDiary.findMany({
      where: { deleted: false, author: activeAuthor(), ...publicDiaryWhere },
      orderBy: { updatedAt: "desc" },
      select: { id: true, slug: true, updatedAt: true },
    })
    return diaries.map((d) => ({
      url: `${baseUrl}${diaryPath(d)}`,
      lastModified: d.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    }))
  }

  if (chunk === "strains") {
    const strains = await prisma.strain.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, slug: true, breeder: true, updatedAt: true },
    })
    // Breeder grouping pages — one URL per distinct breeder name
    // (case-insensitive, canonical spelling from the first occurrence).
    // lastmod = newest member strain's updatedAt: the breeder page's
    // content is its strain list, so a catalog change under that breeder
    // is the last truthful modification signal available.
    const breederStamp = new Map<string, Date>()
    const breeders = [...new Map(
      strains
        .filter((s) => s.breeder?.trim())
        .map((s) => [normalizeBreederName(s.breeder!), s.breeder!.trim()])
    ).values()]
    for (const s of strains) {
      if (!s.breeder?.trim()) continue
      const key = normalizeBreederName(s.breeder)
      const prev = breederStamp.get(key)
      if (!prev || s.updatedAt > prev) breederStamp.set(key, s.updatedAt)
    }
    return [
      ...strains.map((s) => ({
        url: `${baseUrl}${strainPath(s)}`,
        lastModified: s.updatedAt,
        changeFrequency: "weekly" as const,
        priority: 0.6,
      })),
      ...breeders.map((breeder) => ({
        url: `${baseUrl}${breederPath(breeder)}`,
        lastModified: breederStamp.get(normalizeBreederName(breeder)),
        changeFrequency: "weekly" as const,
        priority: 0.4,
      })),
    ]
  }

  if (chunk === "profiles") {
    const profiles = await prisma.profile.findMany({
      // TerpBot excluded — its profile is a bot page, not member content.
      where: rankableProfile(),
      orderBy: XP_ORDER,
      select: { username: true },
    })
    // No Profile.updatedAt exists — omit lastmod rather than claim joinDate
    // is a modification time.
    return profiles.map((p) => ({
      url: `${baseUrl}/u/${p.username}`,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    }))
  }

  if (chunk === "guides") {
    const guides = await prisma.guide.findMany({
      where: { published: true },
      orderBy: { updatedAt: "desc" },
      select: { slug: true, updatedAt: true },
    })
    return guides.map((g) => ({
      url: `${baseUrl}/guides/${g.slug}`,
      lastModified: g.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    }))
  }

  if (chunk === "setups") {
    const setups = await prisma.growSetup.findMany({
      where: { deleted: false, author: activeAuthor() },
      orderBy: { updatedAt: "desc" },
      select: { id: true, slug: true, updatedAt: true },
    })
    return setups.map((s) => ({
      url: `${baseUrl}${setupPath(s)}`,
      lastModified: s.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    }))
  }

  if (chunk === "tags") {
    // Only tags backed by at least one visible thread — empty tag pages
    // are thin content and shouldn't be search destinations.
    const tags = await prisma.tag.findMany({
      where: {
        threads: {
          some: {
            thread: { deleted: false, category: { hidden: false }, author: activeAuthor() },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      select: { slug: true, updatedAt: true },
    })
    return tags.map((t) => ({
      url: `${baseUrl}/forum/tags/${t.slug}`,
      lastModified: t.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    }))
  }

  // moments — permanently-visible PUBLIC posts only. STORYs expire and
  // FOLLOWERS moments aren't indexable content (/m/[id] 404s for them).
  const moments = await prisma.moment.findMany({
    where: { kind: "POST", visibility: "PUBLIC", deleted: false, author: activeAuthor() },
    orderBy: { updatedAt: "desc" },
    select: { id: true, updatedAt: true },
  })
  return moments.map((m) => ({
    url: `${baseUrl}/m/${m.id}`,
    lastModified: m.updatedAt,
    changeFrequency: "weekly" as const,
    priority: 0.4,
  }))
}
