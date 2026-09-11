"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Bookmark, Trash2 } from "lucide-react"

interface SavedSearch {
  id: string
  name: string
  query: string
  filters: string
  createdAt: string
}

export default function SavedSearches() {
  const [searches, setSearches] = useState<SavedSearch[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/saved-searches")
      .then((res) => (res.ok ? res.json() : { searches: [] }))
      .then((d) => setSearches(d.searches || []))
      .catch(() => setSearches([]))
      .finally(() => setLoading(false))
  }, [])

  const remove = async (id: string) => {
    const res = await fetch("/api/saved-searches", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
    if (res.ok) {
      setSearches((prev) => prev.filter((s) => s.id !== id))
    }
  }

  // Render nothing while loading to avoid a layout shift in the grid —
  // once loaded the card stays mounted even when empty so the two-column
  // profile grid keeps its symmetric pairing.
  if (loading) return null

  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <div className="flex items-center gap-2 mb-4">
        <Bookmark className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">Saved Searches</h2>
      </div>
      {searches.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No saved searches. Use Save on the search page to pin a query here.
        </p>
      ) : (
      <ul className="space-y-2 max-h-80 overflow-y-auto">
        {searches.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3">
            <Link
              href={`/search?q=${encodeURIComponent(s.query)}`}
              className="text-sm hover:text-primary hover:underline"
            >
              {s.name}
            </Link>
            <button
              onClick={() => remove(s.id)}
              title="Remove"
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </li>
        ))}
      </ul>
      )}
    </div>
  )
}
