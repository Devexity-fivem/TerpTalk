"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Bookmark, MessageSquare } from "@/lib/icons"

interface SavedThread {
  id: string
  threadId: string
  title: string
  slug: string
  category: string
  author: string
  replies: number
  savedAt: string
}

export default function SavedThreads() {
  const [items, setItems] = useState<SavedThread[]>([])
  const [loading, setLoading] = useState(true)
  // POST /api/bookmarks toggles — without a per-row guard a double-click
  // un-saves then re-saves while the row is already filtered out.
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/bookmarks")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { setItems(d?.bookmarks || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const unsave = async (item: SavedThread) => {
    if (busyId) return
    setBusyId(item.id)
    try {
      const res = await fetch("/api/bookmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: item.threadId }),
      })
      if (res.ok) setItems((prev) => prev.filter((i) => i.id !== item.id))
    } catch {
      /* network failure — row stays */
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="bg-card/80 rounded-2xl border border-border/70 p-6">
      <div className="flex items-center gap-2 mb-4">
        <Bookmark className="w-5 h-5 text-primary" />
        <h2 className="font-display text-lg font-semibold">Saved Threads</h2>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No saved threads. Use the Save button on any thread to keep it here.
        </p>
      ) : (
        <div className="divide-y divide-border max-h-80 overflow-y-auto">
          {items.map((t) => (
            <div key={t.id} className="py-3 flex items-center justify-between gap-3">
              <Link href={`/forum/thread/${t.slug}`} className="min-w-0 hover:text-primary transition-colors">
                <div className="font-medium text-sm truncate">{t.title}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <span>{t.category}</span>
                  <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{t.replies}</span>
                  <span>by {t.author}</span>
                </div>
              </Link>
              <button
                onClick={() => unsave(t)}
                disabled={busyId === t.id}
                className="text-xs text-muted-foreground hover:text-destructive transition-colors shrink-0 disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
