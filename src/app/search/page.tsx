import { Suspense } from "react"
import { buildMetadata } from "@/lib/seo"
import SearchResults from "@/components/search-results"

export const metadata = buildMetadata({
  title: "Search",
  description: "Search threads, strains, growers, and grow diaries on TerpTalk.",
  robots: { index: false, follow: false },
})

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-6">Search TerpTalk</h1>
        <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
          {/* key forces a fresh fetch-state when the query changes */}
          <SearchResults key={q || ""} />
        </Suspense>
      </div>
    </div>
  )
}
