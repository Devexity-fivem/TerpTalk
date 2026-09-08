"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { Heart, Flag, Pencil, Trash2, Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"

interface PostActionsProps {
  postId: string
  authorId: string
  initialContent: string
  initialLikeCount?: number
  initialLiked?: boolean
}

export default function PostActions({ postId, authorId, initialContent, initialLikeCount = 0, initialLiked = false }: PostActionsProps) {
  const { data: session } = useSession()
  const router = useRouter()
  const [liked, setLiked] = useState(initialLiked)
  const [count, setCount] = useState(initialLikeCount)
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState(initialContent)
  const [showReport, setShowReport] = useState(false)
  const [reportReason, setReportReason] = useState("SPAM")
  const [reportDesc, setReportDesc] = useState("")
  const [busy, setBusy] = useState(false)
  const [deleted, setDeleted] = useState(false)
  const [message, setMessage] = useState("")

  const isOwner = session?.user?.id === authorId
  const role = (session?.user as { role?: string })?.role
  const canModerate = role === "MODERATOR" || role === "ADMINISTRATOR"

  if (deleted) {
    return <p className="text-sm text-muted-foreground italic">This post was removed.</p>
  }

  const handleLike = async () => {
    if (!session || busy) return
    setBusy(true)
    try {
      const res = await fetch("/api/reactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "LIKE", postId }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.action === "added") { setLiked(true); setCount(c => c + 1) }
        else { setLiked(false); setCount(c => c - 1) }
      }
    } finally { setBusy(false) }
  }

  const handleEdit = async () => {
    if (content.trim().length < 10) { setMessage("Post must be at least 10 characters"); return }
    setBusy(true)
    try {
      const res = await fetch("/api/forum/posts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: postId, content }),
      })
      if (res.ok) { setEditing(false); router.refresh() }
      else { const d = await res.json(); setMessage(d.error || "Failed to save") }
    } finally { setBusy(false) }
  }

  const handleDelete = async () => {
    if (!confirm("Delete this post? This cannot be undone.")) return
    setBusy(true)
    try {
      const res = await fetch("/api/forum/posts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: postId }),
      })
      if (res.ok) { setDeleted(true); router.refresh() }
      else { const d = await res.json(); setMessage(d.error || "Failed to delete") }
    } finally { setBusy(false) }
  }

  const handleReport = async () => {
    setBusy(true)
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "POST", targetId: postId, reason: reportReason, description: reportDesc }),
      })
      const d = await res.json()
      setMessage(res.ok ? "Report submitted. Thank you." : (d.error || "Report failed"))
      if (res.ok) { setShowReport(false); setReportDesc("") }
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-3">
      {editing ? (
        <div className="space-y-2">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm min-h-[100px]"
            maxLength={10000}
          />
          <div className="flex gap-2">
            <button onClick={handleEdit} disabled={busy} className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
            </button>
            <button onClick={() => { setEditing(false); setContent(initialContent) }} className="px-3 py-1.5 text-sm bg-secondary rounded-lg">
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-4">
        <button
          onClick={handleLike}
          disabled={!session || busy}
          className={`flex items-center gap-1 text-sm transition-colors ${liked ? "text-red-500" : "text-muted-foreground hover:text-foreground"} disabled:opacity-50`}
        >
          <Heart className={`w-4 h-4 ${liked ? "fill-current" : ""}`} />
          {count > 0 ? count : "Like"}
        </button>
        {isOwner && !editing && (
          <>
            <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <Pencil className="w-4 h-4" /> Edit
            </button>
            <button onClick={handleDelete} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-destructive transition-colors">
              <Trash2 className="w-4 h-4" /> Delete
            </button>
          </>
        )}
        {session && !isOwner && (
          <button onClick={() => setShowReport(!showReport)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <Flag className="w-4 h-4" /> Report
          </button>
        )}
        {canModerate && !isOwner && (
          <button onClick={handleDelete} className="flex items-center gap-1 text-sm text-amber-500 hover:text-amber-600 transition-colors">
            <Trash2 className="w-4 h-4" /> Remove (mod)
          </button>
        )}
      </div>

      {showReport && (
        <div className="p-3 bg-secondary/50 rounded-lg space-y-2">
          <select
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          >
            <option value="SPAM">Spam</option>
            <option value="HARASSMENT">Harassment</option>
            <option value="THREATS">Threats</option>
            <option value="ILLEGAL_CONTENT">Illegal content</option>
            <option value="SCAM">Scam / phishing</option>
            <option value="MALICIOUS_LINKS">Malicious links</option>
            <option value="OTHER">Other</option>
          </select>
          <textarea
            value={reportDesc}
            onChange={(e) => setReportDesc(e.target.value)}
            placeholder="Optional details for moderators..."
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            maxLength={1000}
          />
          <button onClick={handleReport} disabled={busy} className="px-3 py-1.5 text-sm bg-destructive text-destructive-foreground rounded-lg disabled:opacity-50">
            Submit report
          </button>
        </div>
      )}

      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  )
}
