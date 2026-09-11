import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/moderation",
        "/profile",
        "/settings",
        "/messages",
        "/notifications",
        "/auth",
        "/api/",
        "/_next/",
      ],
    },
    sitemap: `${process.env.NEXT_PUBLIC_SITE_URL || "https://terp-talk.vercel.app"}/sitemap.xml`,
  }
}
