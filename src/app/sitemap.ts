import type { MetadataRoute } from "next"
import { prisma } from "@/lib/prisma"
import { activeAuthor, rankableProfile, REPUTATION_ORDER } from "@/lib/security"

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://terp-talk.vercel.app"

const STATIC = [
  { url: "/", priority: 1, changeFrequency: "daily" as const },
  { url: "/forum", priority: 0.9, changeFrequency: "daily" as const },
  { url: "/discover", priority: 0.9, changeFrequency: "daily" as const },
  { url: "/feed", priority: 0.7, changeFrequency: "daily" as const },
  { url: "/diaries", priority: 0.8, changeFrequency: "daily" as const },
  { url: "/setups", priority: 0.7, changeFrequency: "daily" as const },
  { url: "/strains", priority: 0.8, changeFrequency: "weekly" as const },
  { url: "/contest", priority: 0.6, changeFrequency: "weekly" as const },
  { url: "/leaderboard", priority: 0.6, changeFrequency: "daily" as const },
  { url: "/reputation", priority: 0.5, changeFrequency: "monthly" as const },
  { url: "/guides", priority: 0.7, changeFrequency: "weekly" as const },
  { url: "/help", priority: 0.7, changeFrequency: "weekly" as const },
  { url: "/deals", priority: 0.5, changeFrequency: "weekly" as const },
  { url: "/calculator", priority: 0.5, changeFrequency: "monthly" as const },
  { url: "/youtubers", priority: 0.6, changeFrequency: "weekly" as const },
  { url: "/about", priority: 0.5, changeFrequency: "monthly" as const },
  { url: "/terms", priority: 0.4, changeFrequency: "yearly" as const },
  { url: "/privacy", priority: 0.4, changeFrequency: "yearly" as const },
  { url: "/search", priority: 0.6, changeFrequency: "weekly" as const },
]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [categories, threads, diaries, strains, profiles, guides] = await Promise.all([
    prisma.category.findMany({ where: { hidden: false }, select: { slug: true, updatedAt: true } }),
    prisma.thread.findMany({
      where: { deleted: false, category: { hidden: false } },
      take: 100,
      orderBy: { updatedAt: "desc" },
      select: { slug: true, updatedAt: true },
    }),
    prisma.growDiary.findMany({
      where: { deleted: false, author: activeAuthor() },
      take: 50,
      orderBy: { updatedAt: "desc" },
      select: { id: true, updatedAt: true },
    }),
    prisma.strain.findMany({
      take: 50,
      orderBy: { createdAt: "desc" },
      select: { id: true, updatedAt: true },
    }),
    prisma.profile.findMany({
      // TerpBot excluded — its profile is a bot page, not member content.
      where: rankableProfile(),
      take: 50,
      orderBy: REPUTATION_ORDER,
      select: { username: true, joinDate: true },
    }),
    prisma.guide.findMany({
      where: { published: true },
      take: 100,
      orderBy: { updatedAt: "desc" },
      select: { slug: true, updatedAt: true },
    }),
  ])

  const pages: MetadataRoute.Sitemap = STATIC.map((p) => ({
    url: `${baseUrl}${p.url}`,
    lastModified: new Date(),
    changeFrequency: p.changeFrequency,
    priority: p.priority,
  }))

  pages.push(
    ...categories.map((c) => ({
      url: `${baseUrl}/forum/category/${c.slug}`,
      lastModified: c.updatedAt,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
    ...threads.map((t) => ({
      url: `${baseUrl}/forum/thread/${t.slug}`,
      lastModified: t.updatedAt,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    ...diaries.map((d) => ({
      url: `${baseUrl}/diaries/${d.id}`,
      lastModified: d.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    ...strains.map((s) => ({
      url: `${baseUrl}/strains/${s.id}`,
      lastModified: s.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    ...profiles.map((p) => ({
      url: `${baseUrl}/u/${p.username}`,
      lastModified: p.joinDate,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
    ...guides.map((g) => ({
      url: `${baseUrl}/guides/${g.slug}`,
      lastModified: g.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    }))
  )

  return pages
}
