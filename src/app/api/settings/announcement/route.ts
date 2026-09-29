import { NextResponse } from "next/server"
import { getSetting, SITE_SETTINGS } from "@/lib/settings"
import { sanitizeHref } from "@/lib/markdown"

// GET — public announcement, safe for all users
export async function GET() {
  const [title, content, link] = await Promise.all([
    getSetting(SITE_SETTINGS.ANNOUNCEMENT_TITLE),
    getSetting(SITE_SETTINGS.ANNOUNCEMENT_CONTENT),
    getSetting(SITE_SETTINGS.ANNOUNCEMENT_LINK),
  ])

  if (!title?.trim() && !content?.trim()) {
    return NextResponse.json({ enabled: false })
  }

  // Canonical safe-link validation — same rules as markdown links:
  // no javascript:/data:/vbscript:, no protocol-relative or backslash
  // external resolution.
  const safeLink = link?.trim() ? sanitizeHref(link.trim()) ?? undefined : undefined

  return NextResponse.json({
    enabled: true,
    title: title?.trim().slice(0, 200) ?? null,
    content: content?.trim().slice(0, 500) ?? null,
    link: safeLink,
  })
}
