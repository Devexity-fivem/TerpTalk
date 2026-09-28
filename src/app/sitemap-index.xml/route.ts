import { NextResponse } from "next/server"
import { SITEMAP_CHUNKS } from "@/app/sitemap"

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://terp-talk.vercel.app"

// /sitemap-index.xml — the sitemap index. The chunk bodies live at
// /sitemap/<id>.xml via generateSitemaps in app/sitemap.ts. This Next
// version reserves /sitemap.xml for the metadata convention and does not
// serve a sitemap index automatically, so the index lives on its own
// URL and robots.txt points here.
export const revalidate = 3600

export function GET() {
  const lastmod = new Date().toISOString()
  const entries = SITEMAP_CHUNKS.map(
    (_, id) =>
      `  <sitemap><loc>${baseUrl}/sitemap/${id}.xml</loc><lastmod>${lastmod}</lastmod></sitemap>`
  ).join("\n")
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${entries}\n` +
    `</sitemapindex>`
  return new NextResponse(xml, {
    headers: { "Content-Type": "application/xml" },
  })
}
