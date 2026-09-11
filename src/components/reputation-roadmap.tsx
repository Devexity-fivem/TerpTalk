"use client"

import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { REP_TIERS, getReputationTier, getNextTier } from "@/lib/reputation-config"

interface ReputationRoadmapProps {
  reputation: number
  compact?: boolean
}

export default function ReputationRoadmap({ reputation, compact }: ReputationRoadmapProps) {
  const current = getReputationTier(reputation)
  const next = getNextTier(reputation)

  return (
    <div className={cn("bg-card rounded-lg border border-border p-6", compact && "p-4")}>
      <h3 className={cn("font-semibold mb-4", compact ? "text-base" : "text-lg")}>Reputation Roadmap</h3>
      <div className="relative space-y-4 before:absolute before:left-3.5 before:top-2 before:bottom-2 before:w-px before:bg-border">
        {REP_TIERS.map((tier, i) => {
          const earned = reputation >= tier.threshold
          const isNext = next?.threshold === tier.threshold
          const isCurrent = current.threshold === tier.threshold

          return (
            <div key={tier.threshold} className="relative flex items-start gap-3 pl-1">
              <div
                className={cn(
                  "relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold",
                  earned
                    ? "border-primary bg-primary text-primary-foreground"
                    : isNext
                      ? "border-amber-500/50 bg-amber-950/40 text-amber-300"
                      : "border-border bg-card text-muted-foreground"
                )}
              >
                {earned ? <Check className="h-3.5 w-3.5" /> : <span>{i + 1}</span>}
              </div>
              <div className={cn("flex-1", compact && "text-sm")}>
                <div className="flex items-center gap-2">
                  <span className={cn("text-base", earned ? "text-foreground" : "text-muted-foreground")}>{tier.icon}</span>
                  <span
                    className={cn(
                      "font-semibold",
                      isCurrent ? tier.color : earned ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {tier.name}
                  </span>
                  {isCurrent && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary">Current</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{tier.benefit}</p>
                <p className={cn("text-[10px] mt-1", earned ? "text-primary/80" : "text-muted-foreground")}>
                  {earned ? `Unlocked at ${tier.threshold} rep` : `Requires ${tier.threshold} rep`}
                </p>
              </div>
            </div>
          )
        })}
      </div>
      {!compact && (
        <p className="text-xs text-muted-foreground mt-4">
          Keep contributing to climb tiers. Higher tiers unlock more community features and perks.
        </p>
      )}
    </div>
  )
}
