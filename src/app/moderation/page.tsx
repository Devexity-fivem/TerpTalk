"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Shield, Flag, Loader2, CheckCircle, XCircle, Trash2, Ban, AlertTriangle, Search, UserCheck, ScrollText, ListChecks, Layers } from "lucide-react"
import Link from "next/link"

interface LookupUser {
  id: string
  username: string
  role: string
  banned: boolean
  bannedReason: string | null
  joined: string
  lastSeen: string | null
  reputation: number
  stats: { posts: number; threadCreator: number; chatMessages: number }
  openReports: number
}
interface LookupHistory {
  id: string; type: string; reason: string; moderator: string; createdAt: string
}

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
  const [tab, setTab] = useState<"queue" | "lookup" | "log" | "bulk">("queue")
  const [lookupName, setLookupName] = useState("")
  const [lookupUser, setLookupUser] = useState<LookupUser | null>(null)
  const [lookupHistory, setLookupHistory] = useState<LookupHistory[]>([])
  const [lookupLoading, setLookupLoading] = useState(false)
  const [bulkIds, setBulkIds] = useState("")
  const [bulkAction, setBulkAction] = useState("lock")
  const [bulkReason, setBulkReason] = useState("")
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkResult, setBulkResult] = useState<string | null>(null)
  const [queueFilter, setQueueFilter] = useState<"ALL" | "PENDING" | "REVIEWING">("ALL")
  const [queueSort, setQueueSort] = useState<"newest" | "oldest">("oldest")
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

  const lookup = async () => {
    if (!lookupName.trim()) return
    setLookupLoading(true)
    setError("")
    setLookupUser(null)
    try {
      const res = await fetch(`/api/moderation/user?username=${encodeURIComponent(lookupName.trim())}`)
      const d = await res.json()
      if (!res.ok) setError(d.error || "Not found")
      else { setLookupUser(d.user); setLookupHistory(d.history || []) }
    } finally { setLookupLoading(false) }
  }

  // Warn / ban / unban directly on a user id (from lookup or report)
  const actOnUser = async (userId: string, actionType: string, reasonDefault: string) => {
    const reason = prompt(reasonDefault)?.trim()
    if (!reason) return
    setBusy(userId)
    setError("")
    try {
      const res = await fetch("/api/moderation/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionType, targetUserId: userId, reason }),
      })
      if (res.ok) { if (lookupUser) lookup() }
      else { const d = await res.json(); setError(d.error || "Action failed") }
    } finally { setBusy(null) }
  }

  const pending = reports.filter((r) => r.status === "PENDING" || r.status === "REVIEWING")
  const resolved = reports.filter((r) => r.status === "RESOLVED" || r.status === "DISMISSED")
  const queueReports = pending
    .filter((r) => queueFilter === "ALL" || r.status === queueFilter)
    .sort((a, b) => {
      const ta = new Date(a.createdAt).getTime()
      const tb = new Date(b.createdAt).getTime()
      return queueSort === "oldest" ? ta - tb : tb - ta
    })

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Shield className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Moderation</h1>
            <p className="text-muted-foreground text-sm">{pending.length} open report{pending.length !== 1 ? "s" : ""}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {([
            { id: "queue", label: "Report Queue", icon: ListChecks },
            { id: "lookup", label: "User Lookup", icon: Search },
            { id: "log", label: "Mod Log", icon: ScrollText },
            { id: "bulk", label: "Bulk Threads", icon: Layers },
          ] as const).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === id ? "bg-primary text-primary-foreground" : "bg-card border border-border hover:bg-secondary"
              }`}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>

        {error && <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-lg text-sm mb-4">{error}</div>}

        {/* BULK THREAD ACTIONS */}
        {tab === "bulk" && isMod && (
          <div className="space-y-4 mb-10">
            <div className="bg-card rounded-lg border border-border p-4 space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Thread IDs (one per line or comma-separated)</label>
                <textarea
                  value={bulkIds}
                  onChange={(e) => setBulkIds(e.target.value)}
                  rows={4}
                  placeholder="Thread IDs from /api/forum/threads or the database"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Action</label>
                  <select
                    value={bulkAction}
                    onChange={(e) => setBulkAction(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="lock">Lock</option>
                    <option value="unlock">Unlock</option>
                    <option value="pin">Pin</option>
                    <option value="unpin">Unpin</option>
                    <option value="delete">Delete</option>
                    <option value="restore">Restore</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Reason</label>
                  <input
                    type="text"
                    value={bulkReason}
                    onChange={(e) => setBulkReason(e.target.value)}
                    placeholder="Bulk action reason"
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>
              <button
                disabled={bulkLoading || !bulkIds.trim()}
                onClick={async () => {
                  const ids = bulkIds.split(/[\n,]+/).map((id) => id.trim()).filter(Boolean)
                  if (ids.length === 0) return
                  setBulkLoading(true)
                  setBulkResult(null)
                  setError("")
                  try {
                    const res = await fetch("/api/moderation/bulk", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ ids, action: bulkAction, reason: bulkReason }),
                    })
                    const d = await res.json()
                    if (res.ok) {
                      setBulkResult(`Updated ${d.updated} threads`)
                    } else {
                      setError(d.error || "Bulk action failed")
                    }
                  } finally { setBulkLoading(false) }
                }}
                className="w-full bg-primary text-primary-foreground py-2 rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {bulkLoading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Run Bulk Action"}
              </button>
              {bulkResult && <p className="text-sm text-green-600">{bulkResult}</p>}
            </div>
          </div>
        )}

        {/* USER LOOKUP */}
        {tab === "lookup" && (
          <div className="space-y-4 mb-10">
            <div className="bg-card rounded-lg border border-border p-4 flex gap-3">
              <input
                value={lookupName}
                onChange={(e) => setLookupName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && lookup()}
                placeholder="Search username..."
                className="flex-1 px-4 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <button onClick={lookup} disabled={lookupLoading}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2">
                {lookupLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Look up
              </button>
            </div>

            {lookupUser && (
              <div className="bg-card rounded-lg border border-border p-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Link href={`/u/${lookupUser.username}`} className="font-semibold text-lg hover:text-primary">
                        @{lookupUser.username}
                      </Link>
                      {lookupUser.role !== "MEMBER" && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/15 text-blue-500 rounded font-semibold">{lookupUser.role}</span>
                      )}
                      {lookupUser.banned && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-destructive/15 text-destructive rounded font-semibold">BANNED</span>
                      )}
                      {lookupUser.openReports > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/15 text-amber-500 rounded font-semibold">
                          {lookupUser.openReports} open report{lookupUser.openReports !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {lookupUser.stats.posts} posts · {lookupUser.stats.threadCreator} threads · {lookupUser.stats.chatMessages} chat msgs · rep {lookupUser.reputation} · joined {new Date(lookupUser.joined).toLocaleDateString()}
                    </div>
                    {lookupUser.bannedReason && (
                      <div className="text-xs text-destructive mt-1">Ban reason: {lookupUser.bannedReason}</div>
                    )}
                  </div>
                  {lookupUser.role !== "ADMINISTRATOR" && (
                    <div className="flex gap-2 flex-wrap">
                      <button onClick={() => actOnUser(lookupUser.id, "WARNING", "Warning reason:")} disabled={busy === lookupUser.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-amber-500/10 text-amber-500 rounded-lg hover:bg-amber-500/20 disabled:opacity-50">
                        <AlertTriangle className="w-4 h-4" /> Warn
                      </button>
                      {isAdminUser && !lookupUser.banned && (
                        <button onClick={() => actOnUser(lookupUser.id, "PERMANENT_BAN", "Ban reason:")} disabled={busy === lookupUser.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 disabled:opacity-50">
                          <Ban className="w-4 h-4" /> Ban
                        </button>
                      )}
                      {isAdminUser && lookupUser.banned && (
                        <button onClick={() => actOnUser(lookupUser.id, "UNBAN", "Unban note:")} disabled={busy === lookupUser.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary/10 text-primary rounded-lg hover:bg-primary/20 disabled:opacity-50">
                          <UserCheck className="w-4 h-4" /> Unban
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {lookupHistory.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-border">
                    <div className="text-xs font-medium text-muted-foreground mb-2">Action history</div>
                    <div className="space-y-1">
                      {lookupHistory.map((h) => (
                        <div key={h.id} className="text-xs flex items-center justify-between gap-2">
                          <span><span className="font-medium">{h.type.replace(/_/g, " ")}</span> by @{h.moderator} — {h.reason}</span>
                          <span className="text-muted-foreground shrink-0">{new Date(h.createdAt).toLocaleDateString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* QUEUE */}
        {tab === "queue" && (<>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            {(["ALL", "PENDING", "REVIEWING"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setQueueFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  queueFilter === s ? "bg-primary text-primary-foreground" : "bg-card border border-border hover:bg-secondary"
                }`}
              >
                {s === "ALL" ? "All open" : s.toLowerCase()}
                <span className="ml-1.5 text-xs opacity-80">{s === "ALL" ? pending.length : pending.filter((p) => p.status === s).length}</span>
              </button>
            ))}
          </div>
          <select
            value={queueSort}
            onChange={(e) => setQueueSort(e.target.value as "newest" | "oldest")}
            className="px-3 py-1.5 rounded-lg border border-border bg-card text-sm"
          >
            <option value="oldest">Oldest first</option>
            <option value="newest">Newest first</option>
          </select>
        </div>
        <div className="space-y-4 mb-10">
          {queueReports.length === 0 && (
            <div className="bg-card rounded-lg border border-border p-8 text-center text-muted-foreground">
              <CheckCircle className="w-10 h-10 mx-auto mb-2 text-primary" />
              Queue is clear. No pending reports.
            </div>
          )}
          {queueReports.map((r) => (
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
                  <button
                    onClick={() => actOnUser(r.reportedUserId, "WARNING", "Warning reason:")}
                    disabled={busy === r.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-amber-500/10 text-amber-500 rounded-lg hover:bg-amber-500/20 disabled:opacity-50"
                  >
                    <AlertTriangle className="w-4 h-4" /> Warn user
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
        </>)}

        {/* MOD LOG */}
        {tab === "log" && (
        <div className="bg-card rounded-lg border border-border divide-y divide-border">
          {actions.length === 0 && <p className="p-4 text-sm text-muted-foreground">No moderation actions recorded.</p>}
          {actions.map((a) => (
            <div key={a.id} className="p-3 text-sm flex items-center justify-between flex-wrap gap-2">
              <span><span className="font-medium">@{a.moderator}</span> — {a.type.replace(/_/g, " ")}: {a.reason}</span>
              <span className="text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
        )}
      </div>
    </div>
  )
}
