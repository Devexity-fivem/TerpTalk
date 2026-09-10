import Link from "next/link"
import CannabisLeaf from "@/components/cannabis-leaf"

export default function NotFound() {
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center px-4 py-16 text-center">
      <div className="bg-primary/10 p-5 rounded-2xl ring-1 ring-primary/30 mb-6">
        <CannabisLeaf className="w-12 h-12 text-primary" />
      </div>
      <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">404 — Page not found</h1>
      <p className="text-muted-foreground max-w-md mb-8">
        That page doesn&apos;t exist or may have been moved. Head back to the community and keep growing.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Back to home
        </Link>
        <Link
          href="/forum"
          className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium rounded-lg bg-card border border-border hover:bg-secondary transition-colors"
        >
          Browse forums
        </Link>
      </div>
    </div>
  )
}
