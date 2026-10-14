// Client-safe Moment vocabulary — no Prisma, no server imports. The
// server module (lib/moments.ts) re-exports these so the parser that stores
// hashtags and the renderer that links them can never disagree.

export const MOMENT_KINDS = ["POST", "STORY"] as const
export type MomentKind = (typeof MOMENT_KINDS)[number]
export const MOMENT_VISIBILITIES = ["PUBLIC", "FOLLOWERS"] as const
export type MomentVisibility = (typeof MOMENT_VISIBILITIES)[number]

export const MOMENT_CONTENT_MAX = 1000
export const STORY_CAPTION_MAX = 200
export const MOMENT_COMMENT_MAX = 1000
export const MOMENT_MAX_TAGS = 10
export const STORY_TTL_MS = 24 * 60 * 60 * 1000

export const momentPath = (id: string) => `/m/${id}`
export const hashtagPath = (slug: string) => `/tags/${slug}`

// `#tag` preceded by start/whitespace/punctuation; letter first, then
// letters/digits/underscore, 2–30 chars total.
export const HASHTAG_RE = /(^|[^\p{L}\p{N}_&/#])#([A-Za-z][A-Za-z0-9_]{1,29})(?![A-Za-z0-9_])/gu

/** Distinct lowercase hashtag names in first-seen order, capped. */
export function parseHashtags(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(HASHTAG_RE)) {
    const name = m[2].toLowerCase()
    if (!out.includes(name)) out.push(name)
    if (out.length >= MOMENT_MAX_TAGS) break
  }
  return out
}

/** Tag slug for a hashtag name — same charset as the forum tag slugs. */
export function hashtagSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)
}
