import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div className="min-h-screen bg-background">
      <span className="sr-only" role="status">Loading…</span>
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-8">
          <Skeleton className="h-8 w-28 mb-2" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="flex gap-2 mb-6">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-9 w-24 rounded-lg" />
          ))}
        </div>
        <div className="space-y-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-card/80 rounded-2xl border border-border/70 p-4">
              <div className="flex items-center gap-3 mb-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="space-y-1.5">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
              <Skeleton className="h-4 w-3/4 mb-1.5" />
              <Skeleton className="h-3.5 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
