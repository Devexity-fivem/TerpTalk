import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div className="min-h-screen bg-background">
      <span className="sr-only" role="status">Loading…</span>
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8">
          <Skeleton className="h-9 w-56 mb-2" />
          <Skeleton className="h-4 w-full max-w-xl" />
        </div>
        <Skeleton className="h-10 w-full rounded-lg mb-6" />
        <div className="flex justify-between items-center mb-6 gap-3 flex-wrap">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-9 w-28 rounded-lg" />
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className={i === 0 ? "" : i < 2 ? "hidden md:block" : i < 3 ? "hidden lg:block" : "hidden xl:block"}>
              <div className="bg-card rounded-xl border border-border p-4">
                <Skeleton className="h-5 w-3/4 mb-2" />
                <Skeleton className="h-3 w-1/2 mb-3" />
                <div className="flex gap-2 mb-3">
                  <Skeleton className="h-5 w-14 rounded-full" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <Skeleton className="h-3 w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
