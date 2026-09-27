// Deals gating (Garden Perks) — pure so both the /deals page and the
// /go/[slug] redirect enforce the same rule without drift.
//
// A product is visible to a viewer iff:
//   - minRank is null, OR the viewer's XP meets that rank's threshold, AND
//   - publicAt is null or already past, OR the viewer has the early-access
//     unlock (First look).
// Guests are `viewer: null` — they see only fully public deals.

import { REP_RANKS } from "@/lib/progression-config"

export interface DealGate {
  minRank: string | null
  publicAt: Date | null
}

export interface DealViewer {
  xp: number
  earlyAccess: boolean
}

export function canSeeDeal(
  product: DealGate,
  viewer: DealViewer | null,
  now = new Date()
): boolean {
  if (product.minRank) {
    const threshold = REP_RANKS.find((r) => r.name === product.minRank)?.threshold ?? Infinity
    if (!viewer || viewer.xp < threshold) return false
  }
  if (product.publicAt && product.publicAt.getTime() > now.getTime() && !viewer?.earlyAccess) {
    return false
  }
  return true
}
