"use client"

// MomentComments — the conversation under a post. Client-side list + form
// so posting/removing updates in place; the server re-checks visibility,
// bans and link trust on every mutation. Deletion is allowed for the
// comment's author or the post's author (they curate their thread).
import { useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { usePathname } from "next/navigation"
import { MessageSquare, Loader2, Send, Trash2 } from "@/lib/icons"
import TimeAgo from "@/components/ui/time-ago"
import RoleBadge from "@/components/role-badge"
import MomentText from "@/components/moment-text"
import ReportButton from "@/components/report-button"
import ConfirmDialog from "@/components/ui/confirm-dialog"
import { useToast } from "@/components/ui/toast"
import { signInHref } from "@/lib/callback-url"
import { MOMENT_COMMENT_MAX } from "@/lib/moment-shared"

export interface MomentCommentItem {
  id: string
  content: string
  createdAt: string | Date
  authorId: string
  author: {
    id: string
    name: string | null
    image: string | null
    role: string
    profile?: { username: string | null; xp?: number | null; publicMilestoneOptOut?: boolean | null } | null
  }
}

export default function MomentComments({
  momentId,
  momentAuthorId,
  initialComments,
}: {
  momentId: string
  momentAuthorId: string
  initialComments: MomentCommentItem[]
}) {
  const { data: session } = useSession()
  const pathname = usePathname()
  const { toast } = useToast()
  const [comments, setComments] = useState(initialComments)
  const [content, setContent] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  const viewerId = session?.user?.id

  const submit = async () => {
    if (!content.trim() || busy) return
    setBusy(true)
    setError("")
    try {
      const res = await fetch(`/api/moments/${momentId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d.error || "Failed to post comment")
        return
      }
      setComments((c) => [...c, d.comment])
      setContent("")
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setPendingDelete(null)
    const res = await fetch(`/api/moments/comments/${id}`, { method: "DELETE" })
    if (!res.ok) {
      toast("Couldn't delete this comment", "error")
      return
    }
    setComments((c) => c.filter((x) => x.id !== id))
  }

  return (
    <div id="comments" className="space-y-4">
      <div className="space-y-4">
        {comments.map((c) => {
          const canDelete = !!viewerId && (viewerId === c.authorId || viewerId === momentAuthorId)
          return (
            <div key={c.id} id={`comment-${c.id}`} className="flex gap-3 scroll-mt-20">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-primary text-xs font-bold">
                {(c.author.profile?.username || c.author.name || "?")[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <Link href={`/u/${c.author.profile?.username || c.author.name}`} className="font-medium hover:text-primary">
                    {c.author.profile?.username || c.author.name}
                  </Link>
                  <RoleBadge role={c.author.role} />
                  <span className="text-xs text-muted-foreground">
                    <TimeAgo value={c.createdAt} />
                  </span>
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => setPendingDelete(c.id)}
                      aria-label="Delete comment"
                      className="p-1.5 -m-1 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <ReportButton type="MOMENT_COMMENT" targetId={c.id} authorId={c.authorId} />
                </div>
                <MomentText text={c.content} className="text-sm text-muted-foreground whitespace-pre-wrap wrap-break-word" />
              </div>
            </div>
          )
        })}
        {comments.length === 0 && (
          <p className="text-sm text-muted-foreground">No comments yet — start the conversation.</p>
        )}
      </div>

      {session ? (
        <div className="space-y-2 pt-2 border-t border-border/60">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <MessageSquare className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Add to the conversation..."
                aria-label="Comment"
                maxLength={MOMENT_COMMENT_MAX}
                rows={2}
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-border/70 bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <button
              onClick={submit}
              aria-label="Post comment"
              disabled={busy || content.trim().length < 2}
              className="self-end px-4 py-2 bg-primary text-primary-foreground rounded-full hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground pt-2 border-t border-border/60">
          <Link href={signInHref(pathname)} className="text-primary hover:underline">Sign in</Link> to comment.
        </p>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this comment?"
        description="This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => { if (pendingDelete) await remove(pendingDelete) }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}
