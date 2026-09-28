import { cn } from "@/lib/utils"
import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

export interface StatItem {
  label: string
  value: ReactNode
  icon?: LucideIcon
  /** Optional link destination — renders the stat as a link */
  href?: string
  /** Secondary line under the value */
  hint?: string
}

interface StatStripProps {
  items: StatItem[]
  className?: string
}

/**
 * Compact summary-stat strip — label-over-value cells for high-value numbers
 * (profile stats, leaderboards, dashboard totals). Wraps responsively; not
 * for arbitrary per-page metrics.
 */
export default function StatStrip({ items, className }: StatStripProps) {
  return (
    <ul className={cn("grid grid-cols-2 gap-2 sm:grid-cols-4", className)}>
      {items.map((s) => {
        const inner = (
          <>
            <span className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {s.icon && <s.icon className="h-3 w-3" aria-hidden="true" />}
              {s.label}
            </span>
            <span className="mt-0.5 block text-lg font-semibold tabular-nums text-foreground">{s.value}</span>
            {s.hint && <span className="block text-[11px] text-muted-foreground">{s.hint}</span>}
          </>
        )
        const cls = cn(
          "block rounded-xl bg-secondary/40 px-3 py-2.5 min-w-0",
          s.href && "transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )
        return (
          <li key={s.label}>
            {s.href ? (
              <Link href={s.href} className={cls}>
                {inner}
              </Link>
            ) : (
              <div className={cls}>{inner}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
