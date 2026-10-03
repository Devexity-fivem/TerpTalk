import { prisma } from "@/lib/prisma"
import { SITE_SETTINGS } from "@/lib/settings"
import { sanitizeHref } from "@/lib/markdown"

export interface SiteAnnouncement {
  enabled: boolean
  title?: string | null
  content?: string | null
  link?: string
}

const ANNOUNCEMENT_KEYS = [
  SITE_SETTINGS.ANNOUNCEMENT_TITLE,
  SITE_SETTINGS.ANNOUNCEMENT_CONTENT,
  SITE_SETTINGS.ANNOUNCEMENT_LINK,
] as const

/**
 * Public announcement bundle — one batched Setting read shared by the root
 * layout (server-rendered banner) and GET /api/settings/announcement.
 * Only announcement_* keys are read; no other settings cross the boundary.
 */
export async function getSiteAnnouncement(): Promise<SiteAnnouncement> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: [...ANNOUNCEMENT_KEYS] } },
    select: { key: true, value: true },
  })
  const values = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const title = values[SITE_SETTINGS.ANNOUNCEMENT_TITLE]?.trim() ?? ""
  const content = values[SITE_SETTINGS.ANNOUNCEMENT_CONTENT]?.trim() ?? ""

  if (!title && !content) {
    return { enabled: false }
  }

  // Canonical safe-link validation — same rules as markdown links:
  // no javascript:/data:/vbscript:, no protocol-relative or backslash
  // external resolution.
  const link = values[SITE_SETTINGS.ANNOUNCEMENT_LINK]?.trim()
  const safeLink = link ? sanitizeHref(link) ?? undefined : undefined

  return {
    enabled: true,
    title: title.slice(0, 200) || null,
    content: content.slice(0, 500) || null,
    link: safeLink,
  }
}
