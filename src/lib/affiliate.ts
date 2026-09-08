// Shared affiliate helpers — validation, disclosure, URL fallback
export const DEFAULT_DISCLOSURE =
  "Affiliate Disclosure: TerpTalk may earn a commission from qualifying purchases made through some links on this page. This does not affect the price you pay."

// Only allow https URLs (or http for dev) — blocks javascript:/data: URIs
export function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === "https:" || (process.env.NODE_ENV === "development" && u.protocol === "http:")
  } catch { return false }
}

export function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)
}

export const cleanText = (s: unknown, max: number): string | null =>
  typeof s === "string" ? s.trim().slice(0, max) || null : null
