import { getReputationTier } from "@/lib/reputation-config"
import { cn } from "@/lib/utils"

// Public tier identity — renders the member's reputation tier as a compact
// icon+name chip. Pure presentation: reputation-config is Prisma-free, so
// this is safe in client and server components alike.
//
// Privacy: callers must pass the profile's publicMilestoneOptOut — opted-out
// members render nothing (their internal progression is unaffected).
// Accessibility: the tier name is always real text (never color-only) and
// the chip carries an aria-label for screen readers. The Deity shimmer is
// CSS-only and neutralised by the global prefers-reduced-motion rule.

interface TierChipProps {
  reputation: number
  publicMilestoneOptOut?: boolean | null
  // sm = inline with usernames (posts/chat/lists); md = profile cards
  size?: "sm" | "md"
  className?: string
}

export default function TierChip({ reputation, publicMilestoneOptOut, size = "sm", className }: TierChipProps) {
  // Rollout flag — display only, no reputation data at stake. Set
  // NEXT_PUBLIC_VISIBLE_STATUS=false + redeploy to hide all tier chips.
  if (process.env.NEXT_PUBLIC_VISIBLE_STATUS === "false") return null
  if (publicMilestoneOptOut) return null
  const tier = getReputationTier(reputation)
  return (
    <span
      role="img"
      aria-label={`${tier.name} tier`}
      title={`${tier.name} tier`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium align-middle whitespace-nowrap",
        tier.bg,
        tier.color,
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs",
        tier.name === "Cannabis Deity" && "tier-chip-deity",
        className
      )}
    >
      <span aria-hidden="true">{tier.icon}</span>
      {tier.name}
    </span>
  )
}
