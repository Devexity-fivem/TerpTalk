import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div className="min-h-screen bg-background">
      <span className="sr-only" role="status">Loading…</span>
      <div className="max-w-4xl mx-auto px-4 py-8">
        <Skeleton className="h-8 w-32 mb-6" />
        <Skeleton className="h-11 w-full rounded-lg mb-6" />
        <div className="flex flex-wrap gap-2 mb-6">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-8 w-20 rounded-lg" />
          ))}
        </div>
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-card rounded-lg border border-border p-4">
              <Skeleton className="h-5 w-2/3 mb-2" />
              <Skeleton className="h-3.5 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
