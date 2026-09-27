"use client"

import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { REP_RANKS, RANK_DISPLAY, rankFromXp, nextRank } from "@/lib/progression-config"
import { InfoTip } from "@/components/ui/tooltip"

interface ReputationRoadmapProps {
  xp: number
  compact?: boolean
}

export default function ReputationRoadmap({ xp, compact }: ReputationRoadmapProps) {
  const current = rankFromXp(xp)
  const next = nextRank(xp)

  return (
    <div className={cn("bg-card/80 rounded-2xl border border-border/70 p-6", compact && "p-4")}>
      <h3 className={cn("font-semibold mb-4 flex items-center gap-1.5", compact ? "text-base" : "text-lg")}>
        Rank Roadmap
        <InfoTip content="Ranks unlock automatically at each XP threshold. Filled markers are earned, the amber marker is next, and each rank lists what it opens up." />
      </h3>
      <div className="relative space-y-4 before:absolute before:left-3.5 before:top-2 before:bottom-2 before:w-px before:bg-border">
        {REP_RANKS.map((rank, i) => {
          const display = RANK_DISPLAY[rank.name] ?? RANK_DISPLAY.Seed
          const earned = xp >= rank.threshold
          const isNext = next?.threshold === rank.threshold
          const isCurrent = current.threshold === rank.threshold

          return (
            <div key={rank.threshold} className="relative flex items-start gap-3 pl-1">
              <div
                className={cn(
                  "relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold",
                  earned
                    ? "border-primary bg-primary text-primary-foreground"
                    : isNext
                      ? "border-amber-500/50 bg-amber-950/40 text-warning"
                      : "border-border bg-card text-muted-foreground"
                )}
              >
                {earned ? <Check className="h-3.5 w-3.5" /> : <span>{i + 1}</span>}
              </div>
              <div className={cn("flex-1", compact && "text-sm")}>
                <div className="flex items-center gap-2">
                  <span className={cn("text-base", earned ? "text-foreground" : "text-muted-foreground")}>{display.icon}</span>
                  <span
                    className={cn(
                      "font-semibold",
                      isCurrent ? display.color : earned ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {rank.name}
                  </span>
                  {isCurrent && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary">Current</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{display.benefit}</p>
                <p className={cn("text-[10px] mt-1", earned ? "text-primary/80" : "text-muted-foreground")}>
                  {earned ? `Unlocked at ${rank.threshold.toLocaleString()} XP` : `Requires ${rank.threshold.toLocaleString()} XP`}
                </p>
              </div>
            </div>
          )
        })}
      </div>
      {!compact && (
        <p className="text-xs text-muted-foreground mt-4">
          Keep growing to climb ranks. Higher ranks unlock more community features and serious bragging rights.
        </p>
      )}
    </div>
  )
}
