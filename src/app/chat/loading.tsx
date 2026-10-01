import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div className="min-h-screen bg-background">
      <span className="sr-only" role="status">Loading…</span>
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid md:grid-cols-[16rem_1fr] gap-6">
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full rounded-xl" />
            ))}
          </div>
          <section className="bg-card/80 rounded-2xl border border-border/70 p-4">
            <Skeleton className="h-6 w-48 mb-4" />
            <div className="space-y-4 mb-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-start gap-3">
                  <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className={`h-9 rounded-xl ${i % 2 ? "w-3/4" : "w-1/2"}`} />
                  </div>
                </div>
              ))}
            </div>
            <Skeleton className="h-11 w-full rounded-xl" />
          </section>
        </div>
      </div>
    </div>
  )
}
