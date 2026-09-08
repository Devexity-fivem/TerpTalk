"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Shield, Flag, Loader2, CheckCircle, XCircle, Trash2, Ban } from "lucide-react"
import Link from "next/link"

interface ReportTarget {
  id?: string
  title?: string
  slug?: string
  content?: string
  username?: string
  deleted?: boolean
  thread?: { slug: string }
}

interface Report {
  id: string
  type: string
  reason: string
  description: string | null
  status: string
  createdAt: string
  reporter: string
  reportedUserId: string
  targetId?: string | null
  target: ReportTarget | null
}

interface ModAction {
  id: string
  type: string
  reason: string
  targetUserId: string
  moderator: string
  createdAt: string
}

export default function ModerationPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [reports, setReports] = useState<Report[]>([])
  const [actions, setActions] = useState<ModAction[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState("")
  const role = (session?.user as { role?: string })?.role
  const isMod = role === "MODERATOR" || role === "ADMINISTRATOR"
  const isAdminUser = role === "ADMINISTRATOR"

  const load = () => {
    fetch("/api/moderation/reports")
      .then(async (res) => {
        if (!res.ok) { setError("Access denied"); setLoading(false); return }
        const d = await res.json()
        setReports(d.reports || [])
        setLoading(false)
      })
      .catch(() => { setError("Failed to load reports"); setLoading(false) })

    fetch("/api/moderation/actions")
      .then((res) => res.ok ? res.json() : { actions: [] })
      .then((d) => setActions(d.actions || []))
      .catch(() => {})
  }

  useEffect(() => {
    if (status === "unauthenticated") router.push("/auth/signin")
    else if (status === "authenticated") load()
  }, [status, router])

  if (status === "loading" || loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
  }

  if (!isMod) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Shield className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Access denied</h1>
          <p className="text-muted-foreground">Moderator access required.</p>
        </div>
      </div>
    )
  }

  const updateReport = async (reportId: string, status: string) => {
    setBusy(reportId)
    try {
      const res = await fetch("/api/moderation/reports", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId, status }),
      })
      if (res.ok) load()
      else setError("Action failed")
    } finally { setBusy(null) }
  }

  const deleteContent = async (report: Report) => {
    if (!report.targetId && !report.target?.id) return
    if (!confirm("Delete this content?")) return
    setBusy(report.id)
    try {
      const res = await fetch("/api/moderation/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionType: "CONTENT_DELETION",
          targetType: report.type,
          targetId: report.targetId || report.target?.id,
          targetUserId: report.reportedUserId,
          reason: `Reported for ${report.reason.toLowerCase()}`,
        }),
      })
      if (res.ok) { await updateReport(report.id, "RESOLVED") }
      else setError("Failed to remove content")
    } finally { setBusy(null) }
  }

  const banUser = async (report: Report, permanent: boolean) => {
    if (!confirm(`${permanent ? "Permanently ban" : "Ban"} this user?`)) return
    setBusy(report.id)
    try {
      const res = await fetch("/api/moderation/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionType: permanent ? "PERMANENT_BAN" : "TEMPORARY_BAN",
          targetUserId: report.reportedUserId,
          reason: `Reported for ${report.reason.toLowerCase()}`,
        }),
      })
      if (res.ok) { await updateReport(report.id, "RESOLVED") }
      else { const d = await res.json(); setError(d.error || "Action failed") }
    } finally { setBusy(null) }
  }

  const pending = reports.filter((r) => r.status === "PENDING" || r.status === "REVIEWING")
  const resolved = reports.filter((r) => r.status === "RESOLVED" || r.status === "DISMISSED")

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-8">
          <Shield className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Moderation Queue</h1>
            <p className="text-muted-foreground text-sm">{pending.length} open report{pending.length !== 1 ? "s" : ""}</p>
          </div>
        </div>

        {error && <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-lg text-sm mb-4">{error}</div>}

        <div className="space-y-4 mb-10">
          {pending.length === 0 && (
            <div className="bg-card rounded-lg border border-border p-8 text-center text-muted-foreground">
              <CheckCircle className="w-10 h-10 mx-auto mb-2 text-primary" />
              Queue is clear. No pending reports.
            </div>
          )}
          {pending.map((r) => (
            <div key={r.id} className="bg-card rounded-lg border border-border p-5">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <Flag className="w-4 h-4 text-amber-500" />
                    <span className="font-medium">{r.type.replace(/_/g, " ")}</span>
                    <span className="text-xs px-2 py-0.5 bg-destructive/10 text-destructive rounded">{r.reason.replace(/_/g, " ")}</span>
                    <span className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mb-1">Reported by @{r.reporter}</p>
                  {r.description && <p className="text-sm mb-2 break-words">&ldquo;{r.description}&rdquo;</p>}
                  {r.target && (
                    <div className="text-sm bg-secondary/50 rounded p-2 mt-2 break-words">
                      {r.type === "THREAD" && <span>Thread: <Link className="text-primary hover:underline" href={`/forum/thread/${r.target.slug}`}>{r.target.title}</Link></span>}
                      {r.type === "POST" && <span>Post: {r.target.content?.slice(0, 200)}</span>}
                      {r.type === "CHAT_MESSAGE" && <span>Message: {r.target.content?.slice(0, 200)}</span>}
                      {r.type === "PROFILE" && <span>Profile: @{r.target.username}</span>}
                      {r.type === "DIARY" && <span>Diary: {r.target.title}</span>}
                      {r.type === "SETUP" && <span>Setup: {r.target.title}</span>}
                      {r.target.deleted && <span className="ml-2 text-xs text-destructive">(already removed)</span>}
                    </div>
                  )}
                  {!r.target && r.type !== "PROFILE" && (
                    <p className="text-xs text-muted-foreground mt-1">Target content unavailable (may be deleted).</p>
                  )}
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <button
                    onClick={() => deleteContent(r)}
                    disabled={busy === r.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-destructive/10 text-destructive rounded-lg hover:bg-destructive/20 disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4" /> Remove content
                  </button>
                  {isAdminUser && (
                    <button
                      onClick={() => banUser(r, true)}
                      disabled={busy === r.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 disabled:opacity-50"
                    >
                      <Ban className="w-4 h-4" /> Ban user
                    </button>
                  )}
                  <button
                    onClick={() => updateReport(r.id, "RESOLVED")}
                    disabled={busy === r.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary/10 text-primary rounded-lg hover:bg-primary/20 disabled:opacity-50"
                  >
                    <CheckCircle className="w-4 h-4" /> Resolve
                  </button>
                  <button
                    onClick={() => updateReport(r.id, "DISMISSED")}
                    disabled={busy === r.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-secondary rounded-lg hover:bg-secondary/80 disabled:opacity-50"
                  >
                    <XCircle className="w-4 h-4" /> Dismiss
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {resolved.length > 0 && (
          <>
            <h2 className="text-lg font-semibold mb-4">Recently Resolved</h2>
            <div className="space-y-2 mb-10">
              {resolved.slice(0, 10).map((r) => (
                <div key={r.id} className="bg-card/50 rounded-lg border border-border p-3 text-sm flex items-center justify-between">
                  <span>{r.type} — {r.reason.replace(/_/g, " ")}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${r.status === "RESOLVED" ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"}`}>
                    {r.status}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        <h2 className="text-lg font-semibold mb-4">Moderation Log</h2>
        <div className="bg-card rounded-lg border border-border divide-y divide-border">
          {actions.length === 0 && <p className="p-4 text-sm text-muted-foreground">No moderation actions recorded.</p>}
          {actions.slice(0, 20).map((a) => (
            <div key={a.id} className="p-3 text-sm flex items-center justify-between flex-wrap gap-2">
              <span><span className="font-medium">@{a.moderator}</span> — {a.type.replace(/_/g, " ")}: {a.reason}</span>
              <span className="text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
