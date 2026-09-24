// Breeder grouping over the free-text Strain.breeder field — no Breeder
// model. Grouping is case-insensitive and punctuation-insensitive so
// "Fast Buds", "FastBuds" and "FAST BUDS" resolve to one canonical page.

/** Punctuation/space-insensitive comparison key. */
export function normalizeBreederName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

/** Canonical URL for a breeder page: lowercase, spaces → dashes. */
export function breederPath(name: string): string {
  return `/strains/breeder/${encodeURIComponent(name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""))}`
}

/** Resolve a URL segment back to a comparison key. */
export function breederKeyFromSlug(slug: string): string {
  let decoded = slug
  try {
    decoded = decodeURIComponent(slug)
  } catch {
    // malformed encoding — fall through with the raw segment
  }
  return normalizeBreederName(decoded)
}
