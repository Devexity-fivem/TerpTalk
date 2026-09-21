"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { Flag, Loader2 } from "lucide-react"
import Tooltip from "@/components/ui/tooltip"

// Generic report control for content types without a dedicated action bar
// (threads, diaries, setups). Posts and profiles have their own flows.
export default function ReportButton({
  type,
  targetId,
  authorId,
  label,
}: {
  type: "THREAD" | "DIARY" | "SETUP" | "STRAIN"
  targetId: string
  authorId?: string
  label?: string
}) {
  const { data: session } = useSession()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("SPAM")
  const [desc, setDesc] = useState("")
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState("")

  if (!session || (authorId && session.user?.id === authorId)) return null
  if (done) {
    return <span className="text-xs text-muted-foreground">Reported — thank you.</span>
  }

  const submit = async () => {
    setBusy(true)
    setError("")
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, targetId, reason, description: desc }),
      })
      const d = await res.json()
      if (res.ok) {
        setDone(true)
        setOpen(false)
      } else {
        setError(d.error || d.message || "Report failed")
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative">
      <Tooltip content="Report this to moderators" align="end">
        <button
          onClick={() => setOpen(!open)}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg hover:bg-secondary transition-colors"
        >
          <Flag className="w-3.5 h-3.5" /> {label ?? "Report"}
        </button>
      </Tooltip>
      {open && (
        <div role="dialog" aria-label="Report to moderators" className="absolute right-0 mt-1 w-72 p-3 bg-card/80 border border-border/70 rounded-2xl shadow-lg z-20 space-y-2">
          <p className="text-xs text-muted-foreground">Why are you reporting this?</p>
          <select
            aria-label="Report reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full px-2 py-1.5 rounded-xl border border-border/70 bg-background text-xs"
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
            aria-label="Report details"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Optional details for moderators..."
            className="w-full px-2 py-1.5 rounded-xl border border-border/70 bg-background text-xs"
            maxLength={1000}
            rows={3}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <button
            onClick={submit}
            disabled={busy}
            className="w-full px-3 py-1.5 text-xs bg-destructive text-destructive-foreground rounded-lg disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" /> : "Submit report"}
          </button>
        </div>
      )}
    </div>
  )
}
