import type { MetadataRoute } from "next"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://terp-talk.vercel.app"

  const staticRoutes: MetadataRoute.Sitemap = [
    "", "/forum", "/diaries", "/setups", "/strains", "/feed", "/about", "/terms", "/privacy", "/leaderboard", "/deals", "/guides", "/help", "/contest",
  ].map((path) => ({
    url: `${base}${path}`,
    lastModified: new Date(),
    changeFrequency: "daily",
    priority: path === "" ? 1 : 0.8,
  }))

  const [threads, strains, profiles, diaries] = await Promise.all([
    prisma.thread.findMany({
      where: { deleted: false },
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 5000,
    }),
    prisma.strain.findMany({
      select: { id: true, updatedAt: true },
      take: 5000,
    }),
    prisma.profile.findMany({
      where: { user: { banned: false } },
      select: { username: true },
      take: 5000,
    }),
    prisma.growDiary.findMany({
      where: { deleted: false },
      select: { id: true, updatedAt: true },
      take: 5000,
    }),
  ])

  return [
    ...staticRoutes,
    ...threads.map((t) => ({
      url: `${base}/forum/thread/${t.slug}`,
      lastModified: t.updatedAt,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    ...strains.map((s) => ({
      url: `${base}/strains/${s.id}`,
      lastModified: s.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    ...profiles.map((p) => ({
      url: `${base}/u/${p.username}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
    ...diaries.map((d) => ({
      url: `${base}/diaries/${d.id}`,
      lastModified: d.updatedAt,
      changeFrequency: "daily" as const,
      priority: 0.6,
    })),
  ]
}
