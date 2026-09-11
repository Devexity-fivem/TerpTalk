"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { MessageSquare, Loader2, Send } from "lucide-react"

export default function SetupComments({ setupId }: { setupId: string }) {
  const { data: session } = useSession()
  const router = useRouter()
  const [content, setContent] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const submit = async () => {
    if (!content.trim() || busy) return
    setBusy(true)
    setError("")
    try {
      const res = await fetch("/api/setups/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupId, content }),
      })
      if (res.ok) {
        setContent("")
        router.refresh()
      } else {
        const d = await res.json()
        setError(d.error || "Failed to post comment")
      }
    } finally { setBusy(false) }
  }

  if (!session) {
    return (
      <p className="text-sm text-muted-foreground">
        <a href="/auth/signin" className="text-primary hover:underline">Sign in</a> to comment.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <MessageSquare className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Nice setup! Ask about their gear, environment, or results..."
            aria-label="Comment"
            maxLength={2000}
            rows={2}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <button
          onClick={submit}
          aria-label="Post comment"
          disabled={busy || content.trim().length < 2}
          className="self-end px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
