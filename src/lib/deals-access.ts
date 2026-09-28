// Deals gating (Garden Perks) — pure so both the /deals page and the
// /go/[slug] redirect enforce the same rule without drift.
//
// A product is visible to a viewer iff:
//   - minRank is null, OR the viewer's XP meets that rank's threshold, AND
//   - publicAt is null or already past, OR the viewer has the early-access
//     unlock (First look).
// Guests are `viewer: null` — they see only fully public deals.

import { REP_RANKS } from "@/lib/progression-config"

// The registry ids these rank-tier product gates implement — a locked
// product's chip names its tier's unlock so members see the same promise
// the progression registry makes. `early-access` is enforced per-viewer
// in canSeeDeal callers (hasUnlock) rather than via a product tier.
export const DEAL_TIER_UNLOCK_ID: Record<string, string> = {
  Rooted: "members-deals",
  Cultivator: "top-shelf-deals",
}

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
