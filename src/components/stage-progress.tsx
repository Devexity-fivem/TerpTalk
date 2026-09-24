import { STAGE_ORDER, STAGE_LABELS } from "@/lib/diary-weeks"
import { cn } from "@/lib/utils"

interface StageProgressProps {
  /** Raw diary stage enum value (GERMINATION … COMPLETED) */
  stage: string
  /** Show the label + update-count caption row under the track */
  caption?: string
  className?: string
}

/**
 * Segmented lifecycle track — the grow's position seed → cure. Completed
 * segments stay emerald, the current segment glows violet (LED spectrum),
 * future segments sit muted. Shared by the diaries grid, member cockpit,
 * and anywhere a grow's stage should be visible at a glance.
 */
export default function StageProgress({ stage, caption, className }: StageProgressProps) {
  const stageIdx = Math.max(0, STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]))
  return (
    <div className={className}>
      <div className="flex gap-0.5" aria-label={`Stage: ${STAGE_LABELS[stage] ?? stage}`}>
        {STAGE_ORDER.map((s, i) => (
          <span
            key={s}
            className={cn(
              "h-1 flex-1 rounded-full",
              i < stageIdx ? "bg-primary/70" : i === stageIdx ? "bg-spectrum" : "bg-secondary"
            )}
          />
        ))}
      </div>
      {caption != null && (
        <div className="mt-1.5 flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          <span>{STAGE_LABELS[stage] ?? stage}</span>
          <span>{caption}</span>
        </div>
      )}
    </div>
  )
}
