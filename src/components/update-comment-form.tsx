"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { MessageSquare, Loader2, Send } from "@/lib/icons"
import { signInHref } from "@/lib/callback-url"

// "Comment on this update" — a lightweight inline composer. The comment is
// an ordinary Post in the grow's canonical discussion thread, anchored to
// the update via diaryUpdateId. The thread is lazy-created through the
// existing idempotent discuss route; posting goes through the existing
// /api/forum/posts endpoint, which is the authorization boundary.
export default function UpdateCommentForm({
  diaryId,
  diaryHref,
  updateId,
  threadId,
  commentCount,
}: {
  diaryId: string
  diaryHref: string
  updateId: string
  threadId: string | null
  commentCount: number
}) {
  const { data: session } = useSession()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [content, setContent] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const toggle = () => {
    if (!session) {
      router.push(signInHref(`${diaryHref}#update-${updateId}`))
      return
    }
    setOpen((o) => !o)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const text = content.trim()
    if (text.length < 10) {
      setError("Comments need at least 10 characters.")
      return
    }
    setBusy(true)
    setError("")
    try {
      let tid = threadId
      if (!tid) {
        const res = await fetch(`/api/diaries/${diaryId}/discuss`, { method: "POST" })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.threadId) throw new Error(data.error || "Comments are unavailable for this grow")
        tid = data.threadId as string
      }
      const res = await fetch("/api/forum/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: tid, content: text, diaryUpdateId: updateId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Couldn't post your comment")
      }
      setContent("")
      setOpen(false)
      router.refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        data-update-comment={updateId}
        className="tap-target inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
      >
        <MessageSquare className="w-3.5 h-3.5" />
        <span>Comment{commentCount > 0 ? ` · ${commentCount}` : ""}</span>
      </button>
      {open && (
        <form onSubmit={submit} className="mt-2 space-y-2">
          <label htmlFor={`update-comment-${updateId}`} className="sr-only">
            Comment on this update
          </label>
          <textarea
            id={`update-comment-${updateId}`}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={10000}
            rows={2}
            placeholder="Comment on this update…"
            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg hover:bg-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Post comment
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
