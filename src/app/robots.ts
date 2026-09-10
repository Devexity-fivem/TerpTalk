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
    sitemap: "https://terptalks.com/sitemap.xml",
  }
}
