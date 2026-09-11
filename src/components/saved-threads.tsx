"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Bookmark, MessageSquare } from "lucide-react"

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

  useEffect(() => {
    fetch("/api/bookmarks")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { setItems(d?.bookmarks || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const unsave = async (item: SavedThread) => {
    const res = await fetch("/api/bookmarks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: item.threadId }),
    })
    if (res.ok) setItems(items.filter((i) => i.id !== item.id))
  }

  if (loading) return null

  return (
    <div className="h-fit self-start bg-card rounded-lg border border-border p-6">
      <div className="flex items-center gap-2 mb-4">
        <Bookmark className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">Saved Threads</h2>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No saved threads. Use the Save button on any thread to keep it here.
        </p>
      ) : (
        <div className="divide-y divide-border">
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
                className="text-xs text-muted-foreground hover:text-destructive transition-colors shrink-0"
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
