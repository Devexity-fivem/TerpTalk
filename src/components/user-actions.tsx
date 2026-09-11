"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { Flag, Ban, Check, Loader2, UserPlus, UserCheck, Mail } from "lucide-react"
import Link from "next/link"

export default function UserActions({ userId, username, initiallyBlocked, initiallyFollowing }: { userId: string; username: string; initiallyBlocked: boolean; initiallyFollowing?: boolean }) {
  const { data: session } = useSession()
  const [blocked, setBlocked] = useState(initiallyBlocked)
  const [following, setFollowing] = useState(!!initiallyFollowing)
  const [showReport, setShowReport] = useState(false)
  const [reason, setReason] = useState("HARASSMENT")
  const [desc, setDesc] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")

  if (!session || session.user?.id === userId) return null

  const toggleBlock = async () => {
    if (busy) return
    if (!blocked && !confirm(`Block @${username}? They won't be able to interact with you.`)) return
    setBusy(true)
    try {
      const res = await fetch("/api/blocks", {
        method: blocked ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      })
      if (res.ok) {
        setBlocked(!blocked)
        setMessage(blocked ? `@${username} unblocked.` : `@${username} blocked.`)
      } else {
        const d = await res.json()
        setMessage(d.error || "Action failed")
      }
    } finally { setBusy(false) }
  }

  const submitReport = async () => {
    setBusy(true)
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "PROFILE", targetId: userId, reason, description: desc }),
      })
      const d = await res.json()
      setMessage(res.ok ? "Report submitted. Thank you." : (d.error || "Report failed"))
      if (res.ok) { setShowReport(false); setDesc("") }
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={async () => {
            if (busy) return
            setBusy(true)
            try {
              const res = await fetch("/api/follows", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId }),
              })
              if (res.ok) {
                const d = await res.json()
                setFollowing(d.following)
                setMessage(d.following ? `Following @${username}` : `Unfollowed @${username}`)
              } else {
                const d = await res.json()
                setMessage(d.error || "Failed")
              }
            } finally { setBusy(false) }
          }}
          disabled={busy || blocked}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium transition-colors disabled:opacity-50 ${
            following
              ? "bg-primary/10 text-primary border border-primary/30"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
          }`}
        >
          {following ? <UserCheck className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
          {following ? "Following" : "Follow"}
        </button>
        <Link
          href={`/messages?with=${userId}`}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-secondary transition-colors"
        >
          <Mail className="w-4 h-4" /> Message
        </Link>
        <button
          onClick={toggleBlock}
          disabled={busy}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors disabled:opacity-50 ${
            blocked
              ? "border-border bg-secondary hover:bg-secondary/80"
              : "border-destructive/30 text-destructive hover:bg-destructive/10"
          }`}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : blocked ? <Check className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
          {blocked ? "Unblock" : "Block"}
        </button>
        <button
          onClick={() => setShowReport(!showReport)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-secondary transition-colors"
        >
          <Flag className="w-4 h-4" /> Report
        </button>
      </div>

      {showReport && (
        <div className="p-3 bg-secondary/50 rounded-lg space-y-2 max-w-sm">
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          >
            <option value="HARASSMENT">Harassment</option>
            <option value="SPAM">Spam</option>
            <option value="THREATS">Threats</option>
            <option value="ILLEGAL_CONTENT">Illegal content</option>
            <option value="SCAM">Scam / phishing</option>
            <option value="MALICIOUS_LINKS">Malicious links</option>
            <option value="OTHER">Other</option>
          </select>
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Optional details for moderators..."
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            maxLength={1000}
          />
          <button
            onClick={submitReport}
            disabled={busy}
            className="px-3 py-1.5 text-sm bg-destructive text-destructive-foreground rounded-lg disabled:opacity-50"
          >
            Submit report
          </button>
        </div>
      )}

      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  )
}
