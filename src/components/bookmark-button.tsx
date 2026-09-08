"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { Bookmark, BookmarkCheck, Loader2 } from "lucide-react"

export default function BookmarkButton({ threadId, initiallySaved }: { threadId: string; initiallySaved: boolean }) {
  const { data: session } = useSession()
  const [saved, setSaved] = useState(initiallySaved)
  const [busy, setBusy] = useState(false)

  if (!session) return null

  return (
    <button
      onClick={async () => {
        if (busy) return
        setBusy(true)
        try {
          const res = await fetch("/api/bookmarks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ threadId }),
          })
          if (res.ok) {
            const d = await res.json()
            setSaved(d.bookmarked)
          }
        } finally { setBusy(false) }
      }}
      disabled={busy}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors disabled:opacity-50 ${
        saved ? "bg-primary/10 text-primary" : "bg-secondary hover:bg-secondary/80"
      }`}
      title={saved ? "Remove bookmark" : "Save thread"}
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <BookmarkCheck className="w-3.5 h-3.5" /> : <Bookmark className="w-3.5 h-3.5" />}
      {saved ? "Saved" : "Save"}
    </button>
  )
}
