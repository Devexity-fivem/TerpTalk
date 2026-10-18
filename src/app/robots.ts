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
        // /auth is intentionally crawlable — the pages carry noindex, and
        // crawling is required for that directive to be seen (a disallow
        // would hide it and can leave signin/signup URLs indexed as
        // "indexed without content").
        "/go/",
        "/api/",
        "/_next/",
      ],
    },
    sitemap: `${process.env.NEXT_PUBLIC_SITE_URL || "https://terp-talk.vercel.app"}/sitemap-index.xml`,
  }
}
