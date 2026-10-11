// ─── Product-event source attribution ─────────────────────────────
// Client-safe (no prisma) — imported by components, pages, and routes.
// `source` records WHICH SURFACE a member acted from. It is always one of
// this allowlist — never a URL, referrer, pathname, or free text. Anything
// outside the list collapses to null → reported as "unknown".

export const EVENT_SOURCES = [
  "onboarding",
  "discover",
  "strain",
  "question",
  "member_home",
  "following_feed",
  "digest",
  "notification",
  "diary",
  "profile",
  "unknown",
] as const

export type EventSource = (typeof EVENT_SOURCES)[number]

/** Validate an untrusted value against the source allowlist. */
export function eventSource(v: unknown): EventSource | null {
  return typeof v === "string" && (EVENT_SOURCES as readonly string[]).includes(v)
    ? (v as EventSource)
    : null
}

/**
 * Attach a `via` attribution param to an internal link. The param is
 * inserted into the query string BEFORE any `#fragment` so anchors like
 * `#update-<id>` keep working — and `updateLinkWhere`/`postLinkWhere`
 * notification cleanup still matches the fragment.
 */
export function withVia(href: string, source: EventSource | null | undefined): string {
  if (!source) return href
  const hash = href.indexOf("#")
  const base = hash === -1 ? href : href.slice(0, hash)
  const frag = hash === -1 ? "" : href.slice(hash)
  return `${base}${base.includes("?") ? "&" : "?"}via=${source}${frag}`
}
