"use client"

// FeedList — renders a canonical feed page and continues it.
// Page 1 arrives server-rendered inside the page; "Load more" fetches
// /api/feed with the canonical keyset cursor and appends. No infinite
// scroll, no state library — the same pattern notifications already use.
import { useCallback, useRef, useState } from "react"
import { Loader2 } from "@/lib/icons"
import { FeedThreadCard, FeedUpdateCard, FeedHarvestCard } from "@/components/feed-cards"
import type { FeedItem, FeedKind, FeedMode } from "@/lib/feed"

export type FeedAppearance = "mixed" | "threads" | "updates" | "harvests"

interface FeedListProps {
  mode: FeedMode
  kinds: readonly FeedKind[]
  initialItems: FeedItem[]
  initialCursor: string | null
  initialUnreadThreadIds?: string[]
  appearance: FeedAppearance
  viewerId?: string | null
}

export default function FeedList({
  mode,
  kinds,
  initialItems,
  initialCursor,
  initialUnreadThreadIds,
  appearance,
  viewerId,
}: FeedListProps) {
  const [items, setItems] = useState<FeedItem[]>(initialItems)
  const [cursor, setCursor] = useState<string | null>(initialCursor)
  const [unread, setUnread] = useState<Set<string>>(() => new Set(initialUnreadThreadIds ?? []))
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  // Belt-and-braces dedupe — the cursor already guarantees disjoint
  // pages; this only guards a raced double-append.
  const seen = useRef(new Set(initialItems.map((i) => `${i.kind}:${i.id}`)))

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return
    setLoading(true)
    setFailed(false)
    try {
      const params = new URLSearchParams({ mode, kinds: kinds.join(","), cursor })
      const res = await fetch(`/api/feed?${params}`)
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as { items: FeedItem[]; nextCursor: string | null; unreadThreadIds?: string[] }
      const fresh = (data.items ?? []).filter((i) => {
        const key = `${i.kind}:${i.id}`
        if (seen.current.has(key)) return false
        seen.current.add(key)
        return true
      })
      setItems((prev) => [...prev, ...fresh])
      setCursor(data.nextCursor ?? null)
      if (data.unreadThreadIds?.length) {
        setUnread((prev) => new Set([...prev, ...data.unreadThreadIds!]))
      }
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [cursor, loading, mode, kinds])

  const grid = appearance === "harvests"

  return (
    <>
      <div className={grid ? "grid sm:grid-cols-2 gap-3 p-4" : "divide-y divide-border"}>
        {items.map((item) => {
          if (item.kind === "thread") {
            return (
              <FeedThreadCard
                key={`t-${item.id}`}
                thread={item.data}
                href={item.href}
                variant={appearance === "threads" ? "list" : "compact"}
                unread={unread.has(item.id)}
              />
            )
          }
          if (item.kind === "harvest") {
            return (
              <FeedHarvestCard
                key={`h-${item.id}`}
                diary={item.data}
                href={item.href}
                variant={grid ? "tile" : "compact"}
                viewerId={viewerId}
              />
            )
          }
          return (
            <FeedUpdateCard
              key={`u-${item.id}`}
              update={item.data}
              href={item.href}
              variant={appearance === "updates" ? "card" : "compact"}
            />
          )
        })}
      </div>
      {(cursor || loading || failed) && (
        <div className="p-4 border-t border-border text-center">
          {failed ? (
            <button
              type="button"
              onClick={loadMore}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Couldn&apos;t load more — try again
            </button>
          ) : (
            <button
              type="button"
              onClick={loadMore}
              disabled={loading || !cursor}
              className="min-h-11 inline-flex items-center gap-2 px-6 rounded-full bg-secondary text-sm font-semibold hover:bg-secondary/80 disabled:opacity-50"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Load more
            </button>
          )}
        </div>
      )}
    </>
  )
}
