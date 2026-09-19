import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div className="min-h-screen bg-background">
      <span className="sr-only" role="status">Loading…</span>
      {/* Hero */}
      <section className="relative overflow-hidden py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto text-center">
          <Skeleton className="w-24 h-24 rounded-2xl mx-auto mb-8" />
          <Skeleton className="h-12 sm:h-14 w-full max-w-lg mx-auto mb-6" />
          <Skeleton className="h-5 w-full max-w-2xl mx-auto mb-2" />
          <Skeleton className="h-5 w-4/5 max-w-xl mx-auto mb-4" />
          <div className="flex justify-center gap-3 mt-6">
            <Skeleton className="h-11 w-36 rounded-lg" />
            <Skeleton className="h-11 w-36 rounded-lg" />
          </div>
        </div>
      </section>
      {/* Stats strip */}
      <section className="py-14 px-4 sm:px-6 lg:px-8 border-y border-border bg-secondary/30">
        <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </section>
      {/* Stream cards */}
      <section className="py-10 px-4 sm:px-6 lg:px-8 border-y border-border bg-secondary/20">
        <div className="max-w-7xl mx-auto">
          <Skeleton className="h-7 w-56 mb-2" />
          <Skeleton className="h-4 w-72 mb-5" />
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Skeleton className="h-64 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl hidden md:block" />
            <Skeleton className="h-64 w-full rounded-xl hidden lg:block" />
          </div>
        </div>
      </section>
    </div>
  )
}
