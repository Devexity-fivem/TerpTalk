import { rankDisplay } from "@/lib/progression-config"
import Tooltip from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

// Public rank identity — renders the member's progression rank as a
// compact icon+name chip. Pure presentation: progression-config is
// Prisma-free, so this is safe in client and server components alike.
//
// Privacy: callers must pass the profile's publicMilestoneOptOut — opted-out
// members render nothing (their internal progression is unaffected).
// Accessibility: the rank name is always real text (never color-only) and
// the chip carries an aria-label for screen readers. The apex shimmer is
// CSS-only and neutralised by the global prefers-reduced-motion rule.

interface TierChipProps {
  xp: number
  publicMilestoneOptOut?: boolean | null
  // sm = inline with usernames (posts/chat/lists); md = profile cards
  size?: "sm" | "md"
  className?: string
}

export default function TierChip({ xp, publicMilestoneOptOut, size = "sm", className }: TierChipProps) {
  // Rollout flag — display only, no progression data at stake. Set
  // NEXT_PUBLIC_VISIBLE_STATUS=false + redeploy to hide all rank chips.
  if (process.env.NEXT_PUBLIC_VISIBLE_STATUS === "false") return null
  if (publicMilestoneOptOut) return null
  const rank = rankDisplay(xp)
  return (
    <Tooltip content={`${rank.name} rank — earned through community contributions`}>
      <span
        role="img"
        aria-label={`${rank.name} rank`}
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full font-medium align-middle whitespace-nowrap",
          rank.bg,
          rank.color,
          size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs",
          rank.name === "Master Cultivator" && "tier-chip-deity",
          className
        )}
      >
        <span aria-hidden="true">{rank.icon}</span>
        {rank.name}
      </span>
    </Tooltip>
  )
}
