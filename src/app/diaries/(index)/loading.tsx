import { Skeleton } from "@/components/ui/skeleton"

function DiaryCardSkeleton() {
  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <Skeleton className="h-40 w-full rounded-none" />
      <div className="p-4">
        <Skeleton className="h-5 w-3/4 mb-2" />
        <Skeleton className="h-3 w-1/2 mb-3" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      </div>
    </div>
  )
}

export default function Loading() {
  return (
    <div className="min-h-screen bg-background">
      <span className="sr-only" role="status">Loading…</span>
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-6">
          <Skeleton className="h-8 w-44 mb-2" />
          <Skeleton className="h-4 w-full max-w-lg" />
        </div>
        <section className="bg-card rounded-xl border border-border p-5 mb-6">
          <Skeleton className="h-5 w-48 mb-4" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        </section>
        <div className="mb-6">
          <Skeleton className="h-6 w-40 mb-3" />
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className={i === 1 ? "hidden md:block" : i === 2 ? "hidden lg:block" : ""}>
                <DiaryCardSkeleton />
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="flex justify-between items-center mb-3 gap-3 flex-wrap">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-9 w-32 rounded-lg" />
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div key={i} className={i === 0 ? "" : i < 3 ? "hidden md:block" : "hidden lg:block"}>
                <DiaryCardSkeleton />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
