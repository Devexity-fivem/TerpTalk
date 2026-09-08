import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://terp-talk.vercel.app"
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/admin", "/moderation", "/profile", "/settings", "/notifications"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  }
}
