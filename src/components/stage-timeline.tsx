"use client"

import { cn } from "@/lib/utils"

const STAGES = ["GERMINATION", "SEEDLING", "VEGETATIVE", "FLOWER", "HARVEST", "DRYING", "CURING", "COMPLETED"]

const STAGE_COLORS: Record<string, string> = {
  GERMINATION: "bg-stone-500",
  SEEDLING: "bg-lime-500",
  VEGETATIVE: "bg-green-500",
  FLOWER: "bg-amber-500",
  HARVEST: "bg-orange-500",
  DRYING: "bg-yellow-600",
  CURING: "bg-purple-500",
  COMPLETED: "bg-emerald-500",
}

const STAGE_RING: Record<string, string> = {
  GERMINATION: "ring-stone-500/30",
  SEEDLING: "ring-lime-500/30",
  VEGETATIVE: "ring-green-500/30",
  FLOWER: "ring-amber-500/30",
  HARVEST: "ring-orange-500/30",
  DRYING: "ring-yellow-600/30",
  CURING: "ring-purple-500/30",
  COMPLETED: "ring-emerald-500/30",
}

interface Run {
  stage: string
  days: number
}

export default function StageTimeline({ current, runs }: { current: string; runs: Run[] }) {
  const currentIdx = STAGES.indexOf(current)

  return (
    <div className="mt-4 space-y-4">
      <div>
        <div className="flex items-center justify-between text-sm mb-1.5">
          <span className="font-medium">{current.replace(/_/g, " ")}</span>
          <span className="text-muted-foreground text-xs">
            {Math.round(((currentIdx + 1) / STAGES.length) * 100)}% through lifecycle
          </span>
        </div>
        <div className="h-2 bg-secondary rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${((currentIdx + 1) / STAGES.length) * 100}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
        {STAGES.map((stage, i) => {
          const completed = i <= currentIdx
          const isCurrent = stage === current
          return (
            <div key={stage} className="flex flex-col items-center gap-1.5 text-center">
              <div
                className={cn(
                  "w-6 h-6 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-[10px] sm:text-xs font-bold transition-colors",
                  completed ? `${STAGE_COLORS[stage]} text-white` : "bg-secondary text-muted-foreground",
                  isCurrent && `ring-2 ring-offset-2 ring-offset-background ${STAGE_RING[stage]}`
                )}
                aria-current={isCurrent ? "step" : undefined}
              >
                {i + 1}
              </div>
              <span
                className={cn(
                  "text-[10px] sm:text-xs leading-tight",
                  isCurrent ? "text-foreground font-medium" : "text-muted-foreground"
                )}
              >
                {stage.replace(/_/g, " ")}
              </span>
            </div>
          )
        })}
      </div>

      {runs.length > 0 && (
        <div>
          <div className="flex h-2 rounded-full overflow-hidden">
            {runs.map((r, i) => (
              <div
                key={i}
                className={`${STAGE_COLORS[r.stage] || "bg-secondary"} h-full`}
                style={{ width: `${(r.days / Math.max(1, runs.reduce((a, b) => a + b.days, 0))) * 100}%` }}
                title={`${r.stage} — ${r.days}d`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
            {runs.map((r, i) => (
              <span key={i} className="text-[10px] text-muted-foreground flex items-center gap-1">
                <span className={`w-2 h-2 rounded-sm ${STAGE_COLORS[r.stage] || "bg-secondary"}`} />
                {r.stage.toLowerCase()} {r.days}d
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
