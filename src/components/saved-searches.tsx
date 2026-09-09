"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Bookmark, Trash2, Loader2 } from "lucide-react"

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

  if (loading) {
    return <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
  }

  if (searches.length === 0) return null

  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <div className="flex items-center gap-2 mb-4">
        <Bookmark className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">Saved Searches</h2>
      </div>
      <ul className="space-y-2">
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
    </div>
  )
}
