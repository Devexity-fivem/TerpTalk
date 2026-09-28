import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Named loading compositions — dimensions approximate real content so pages
 * don't shift when data lands. Add a composition per recurring shape; don't
 * build one-off skeleton walls inline.
 */

export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-border/70 bg-card/80 p-4 space-y-3", className)}>
      <Skeleton className="h-5 w-1/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-4/5" />
    </div>
  )
}

export function ListSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/60 px-4 py-3">
          <Skeleton className="h-9 w-9 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        </div>
      ))}
      <span className="sr-only" role="status">Loading…</span>
    </div>
  )
}

export function StatStripSkeleton({ cells = 4, className }: { cells?: number; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-2 sm:grid-cols-4", className)} aria-hidden="true">
      {Array.from({ length: cells }, (_, i) => (
        <div key={i} className="rounded-xl bg-secondary/40 px-3 py-2.5 space-y-2">
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-5 w-10" />
        </div>
      ))}
    </div>
  )
}

export function ProfileHeaderSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("bg-card/80 rounded-2xl border border-border/70 p-4 overflow-hidden", className)} aria-hidden="true">
      <div className="tt-spectrum-bar -mx-4 -mt-4 mb-4 h-1 opacity-60" />
      <div className="flex items-start gap-4">
        <Skeleton className="w-20 h-20 rounded-full shrink-0" />
        <div className="flex-1 min-w-0 space-y-3">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-64 max-w-full" />
          <Skeleton className="h-4 w-full max-w-md" />
          <div className="flex gap-2 pt-1">
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
        </div>
      </div>
      <span className="sr-only" role="status">Loading profile…</span>
    </div>
  )
}

export function SectionSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-border/70 bg-card/80 p-4 sm:p-5 space-y-3", className)} aria-hidden="true">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  )
}
