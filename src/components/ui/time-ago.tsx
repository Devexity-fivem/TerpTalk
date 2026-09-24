import { formatRelativeTime } from "@/lib/time"
import { cn } from "@/lib/utils"

interface TimeAgoProps {
  value: string | Date
  className?: string
}

/**
 * Relative timestamp ("2h ago") with the absolute time on hover. Server-safe —
 * pure string math; suppressHydrationWarning covers the edge where the
 * boundary flips between server render and hydration.
 */
export default function TimeAgo({ value, className }: TimeAgoProps) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return (
    <time
      dateTime={d.toISOString()}
      title={d.toLocaleString()}
      className={cn("tabular-nums", className)}
      suppressHydrationWarning
    >
      {formatRelativeTime(d)}
    </time>
  )
}
