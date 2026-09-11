import { NextResponse } from "next/server"
import { getSetting, SITE_SETTINGS } from "@/lib/settings"

const ALLOWED_LINK_PREFIXES = ["/", "https://", "http://"]

function isSafeLink(link: string): boolean {
  if (!link) return false
  const lower = link.trim().toLowerCase()
  if (lower.startsWith("javascript:")) return false
  if (lower.startsWith("data:")) return false
  if (lower.startsWith("vbscript:")) return false
  return ALLOWED_LINK_PREFIXES.some((p) => lower.startsWith(p))
}

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

  const safeLink = isSafeLink(link || "") ? link!.trim() : undefined

  return NextResponse.json({
    enabled: true,
    title: title?.trim().slice(0, 200) ?? null,
    content: content?.trim().slice(0, 500) ?? null,
    link: safeLink,
  })
}
