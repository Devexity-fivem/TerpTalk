import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div className="min-h-screen bg-background">
      <span className="sr-only" role="status">Loading…</span>
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-8">
          <Skeleton className="h-8 w-44 mb-2" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="space-y-2.5">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="flex items-center gap-3 bg-card/80 rounded-xl border border-border/70 px-4 py-3">
              <Skeleton className="h-6 w-6 rounded-md shrink-0" />
              <Skeleton className="h-9 w-9 rounded-full shrink-0" />
              <div className="flex-1 min-w-0 space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
              <Skeleton className="h-5 w-14 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
