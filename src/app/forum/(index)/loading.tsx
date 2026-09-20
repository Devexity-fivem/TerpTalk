import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div className="min-h-screen bg-background">
      <span className="sr-only" role="status">Loading…</span>
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-6">
          <Skeleton className="h-8 w-40 mb-2" />
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="min-w-0 lg:col-span-2 space-y-6">
            {[0, 1].map((i) => (
              <section key={i} className="bg-card/80 rounded-2xl border border-border/70 p-4">
                <Skeleton className="h-5 w-44 mb-4" />
                <div className="space-y-3">
                  {[0, 1, 2].map((j) => (
                    <div key={j} className="flex items-center gap-3">
                      <Skeleton className="w-10 h-10 rounded-lg shrink-0" />
                      <div className="flex-1 min-w-0">
                        <Skeleton className="h-4 w-3/4 mb-2" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
          <div className="space-y-6">
            <section className="bg-card/80 rounded-2xl border border-border/70 p-4">
              <Skeleton className="h-5 w-36 mb-3" />
              <div className="space-y-2">
                {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-4 w-full" />)}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
