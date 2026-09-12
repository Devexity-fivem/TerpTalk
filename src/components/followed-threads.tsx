"use client"

import { useState } from "react"
import Link from "next/link"
import { BellRing, BellOff, Loader2 } from "lucide-react"
import { useToast } from "@/components/ui/toast"
import { formatRelativeTime } from "@/lib/time"

export interface FollowedThreadItem {
  threadId: string
  slug: string
  title: string
  category: string
  lastActivityAt: string
  unread: boolean
}

export default function FollowedThreads({ items }: { items: FollowedThreadItem[] }) {
  const { toast } = useToast()
  const [list, setList] = useState(items)
  const [busyId, setBusyId] = useState<string | null>(null)

  if (list.length === 0) return null

  const unfollow = async (t: FollowedThreadItem) => {
    if (busyId) return
    setBusyId(t.threadId)
    try {
      const res = await fetch("/api/forum/threads/follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: t.threadId }),
      })
      if (res.ok) {
        setList((l) => l.filter((i) => i.threadId !== t.threadId))
        toast("Unfollowed thread")
      } else {
        toast("Could not unfollow. Try again.", "error")
      }
    } catch {
      toast("Network error — check your connection.", "error")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
        <BellRing className="w-4 h-4 text-primary" />
        Discussions You Follow
      </h3>
      <div className="space-y-2">
        {list.map((t) => (
          <div key={t.threadId} className="flex items-center gap-2">
            <Link
              href={`/forum/thread/${t.slug}`}
              className="min-w-0 flex-1 text-sm hover:text-primary transition-colors"
            >
              <span className="flex items-center gap-2">
                {t.unread && (
                  <span className="h-2 w-2 rounded-full bg-primary shrink-0" role="img" aria-label="Unread" title="New activity" />
                )}
                <span className="truncate">{t.title}</span>
              </span>
              <span className="block text-xs text-muted-foreground">
                {t.category} ·{" "}
                <time dateTime={t.lastActivityAt} title={new Date(t.lastActivityAt).toLocaleString()}>
                  {formatRelativeTime(t.lastActivityAt)}
                </time>
              </span>
            </Link>
            <button
              onClick={() => unfollow(t)}
              disabled={busyId === t.threadId}
              aria-label={`Unfollow "${t.title}"`}
              title="Unfollow"
              className="p-2 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 shrink-0"
            >
              {busyId === t.threadId ? <Loader2 className="w-4 h-4 animate-spin" /> : <BellOff className="w-4 h-4" />}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
