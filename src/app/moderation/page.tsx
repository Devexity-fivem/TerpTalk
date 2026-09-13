"use client"

import { signInHref } from "@/lib/callback-url"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Shield, Flag, Loader2, CheckCircle, XCircle, Ban, AlertTriangle, Search, UserCheck, ScrollText, ListChecks, Layers, TrendingUp, ChevronRight } from "lucide-react"
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
interface LookupRep {
  id: string; type: string; amount: number; reason: string; reversedAt: string | null; createdAt: string
}

interface QueueItem {
  kind: "REPORT" | "FLAG"
  id: string
  status: string
  priority: string
  createdAt: string
  assignedTo: string | null
  // reports
  type?: string
  reason?: string
  subject?: string
  subjectId?: string
  reporter?: string | null
  targetLabel?: string | null
  targetDeleted?: boolean
  // abuse flags
  signal?: string
  signalLabel?: string
  counterparty?: string | null
  evidence?: Record<string, unknown> | null
}

interface StaffOption {
  id: string
  username: string
  role: string
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
  const [items, setItems] = useState<QueueItem[]>([])
  const [closed, setClosed] = useState<QueueItem[]>([])
  const [counts, setCounts] = useState({ open: 0, mine: 0, escalated: 0 })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [staffList, setStaffList] = useState<StaffOption[]>([])
  const [actions, setActions] = useState<ModAction[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [tab, setTab] = useState<"queue" | "lookup" | "log" | "bulk">("queue")
  const [lookupName, setLookupName] = useState("")
  const [lookupUser, setLookupUser] = useState<LookupUser | null>(null)
  const [lookupHistory, setLookupHistory] = useState<LookupHistory[]>([])
  const [lookupRep, setLookupRep] = useState<LookupRep[]>([])
  const [lookupLoading, setLookupLoading] = useState(false)
  const [bulkIds, setBulkIds] = useState("")
  const [bulkAction, setBulkAction] = useState("lock")
  const [bulkReason, setBulkReason] = useState("")
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkResult, setBulkResult] = useState<string | null>(null)
  const [queueFilter, setQueueFilter] = useState<"OPEN" | "PENDING" | "REVIEWING" | "ESCALATED" | "MINE">("OPEN")
  const [kindFilter, setKindFilter] = useState<"ALL" | "REPORT" | "FLAG">("ALL")
  const role = (session?.user as { role?: string })?.role
  const isMod = role === "SUPPORT" || role === "MODERATOR" || role === "ADMINISTRATOR"
  const isAdminUser = role === "ADMINISTRATOR"
  // SUPPORT is view-only — every mutating endpoint requires MODERATOR+.
  const canAct = role === "MODERATOR" || role === "ADMINISTRATOR"

  const load = () => {
    const params = new URLSearchParams()
    if (queueFilter === "MINE") { params.set("status", "OPEN"); params.set("mine", "1") }
    else params.set("status", queueFilter)
    params.set("kind", kindFilter)
    fetch(`/api/moderation/queue?${params}`)
      .then(async (res) => {
        if (!res.ok) { setError("Access denied"); setLoading(false); return }
        const d = await res.json()
        setItems(d.items || [])
        setCounts(d.counts || { open: 0, mine: 0, escalated: 0 })
        setLoading(false)
      })
      .catch(() => { setError("Failed to load queue"); setLoading(false) })

    fetch("/api/moderation/queue?status=RESOLVED&limit=10")
      .then((res) => res.ok ? res.json() : { items: [] })
      .then((d) => setClosed(d.items || []))
      .catch(() => {})

    fetch("/api/moderation/actions")
      .then((res) => res.ok ? res.json() : { actions: [] })
      .then((d) => setActions(d.actions || []))
      .catch(() => {})
  }

  useEffect(() => {
    if (status === "unauthenticated") router.push(signInHref(window.location.pathname + window.location.search))
    else if (status === "authenticated") load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, router, queueFilter, kindFilter])

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

  const queueAction = async (item: QueueItem, body: Record<string, unknown>) => {
    setBusy(item.id)
    setError("")
    try {
      const res = await fetch("/api/moderation/queue", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: item.kind, id: item.id, ...body }),
      })
      if (res.ok) load()
      else { const d = await res.json(); setError(d.error || "Action failed") }
    } finally { setBusy(null) }
  }

  const loadStaff = async () => {
    if (staffList.length > 0) return
    const res = await fetch("/api/moderation/queue/staff")
    if (res.ok) setStaffList((await res.json()).staff || [])
  }

  const runBulkQueue = async (action: "resolve" | "dismiss" | "assign", assignTo?: string) => {
    if (selected.size === 0) return
    if (!confirm(`${action === "assign" ? "Assign" : action === "resolve" ? "Resolve" : "Dismiss"} ${selected.size} case(s)?`)) return
    setBusy("bulk")
    setError("")
    try {
      const res = await fetch("/api/moderation/queue/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.filter((i) => selected.has(i.id)).map((i) => ({ kind: i.kind, id: i.id })),
          action,
          assignTo,
        }),
      })
      const d = await res.json()
      if (res.ok) { setSelected(new Set()); load() }
      else setError(d.error || "Bulk action failed")
      if (d.failed?.length) setError(`${d.failed.length} item(s) failed`)
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
      else { setLookupUser(d.user); setLookupHistory(d.history || []); setLookupRep(d.reputation || []) }
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

  // Reverse a single reputation award from the lookup card.
  const reverseRep = async (eventId: string) => {
    const reason = prompt("Reason for reversing this award:")?.trim()
    if (!reason) return
    setBusy(eventId)
    setError("")
    try {
      const res = await fetch("/api/moderation/reputation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, reason }),
      })
      if (res.ok) lookup()
      else { const d = await res.json(); setError(d.error || "Reversal failed") }
    } finally { setBusy(null) }
  }

  const priorityChip = (p: string) => {
    const styles: Record<string, string> = {
      URGENT: "bg-destructive/15 text-destructive",
      HIGH: "bg-amber-500/15 text-amber-500",
      NORMAL: "bg-secondary text-muted-foreground",
      LOW: "bg-secondary/60 text-muted-foreground/70",
    }
    return (
      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${styles[p] ?? styles.NORMAL}`}>{p}</span>
    )
  }

  const statusChip = (s: string) => {
    const styles: Record<string, string> = {
      PENDING: "bg-secondary text-muted-foreground",
      REVIEWING: "bg-blue-500/15 text-blue-500",
      ESCALATED: "bg-amber-500/15 text-amber-500",
      RESOLVED: "bg-primary/10 text-primary",
      DISMISSED: "bg-secondary text-muted-foreground",
    }
    return (
      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${styles[s] ?? ""}`}>{s}</span>
    )
  }

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Shield className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Moderation</h1>
            <p className="text-muted-foreground text-sm">{counts.open} open case{counts.open !== 1 ? "s" : ""}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {([
            { id: "queue", label: "Queue", icon: ListChecks },
            { id: "lookup", label: "User Lookup", icon: Search },
            ...(canAct ? [
              { id: "log", label: "Mod Log", icon: ScrollText },
              { id: "bulk", label: "Bulk Threads", icon: Layers },
            ] : []),
          ] as const).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id as typeof tab)}
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
        {tab === "bulk" && canAct && (
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
                  {lookupUser.role !== "ADMINISTRATOR" && canAct && (
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
                {lookupRep.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-border">
                    <div className="text-xs font-medium text-muted-foreground mb-2">Recent reputation</div>
                    <div className="space-y-1">
                      {lookupRep.map((e) => (
                        <div key={e.id} className="text-xs flex items-center justify-between gap-2">
                          <span className={e.reversedAt ? "line-through opacity-60" : ""}>
                            <span className={`font-medium ${e.amount >= 0 ? "text-primary" : "text-destructive"}`}>{e.amount >= 0 ? "+" : ""}{e.amount}</span>
                            {" "}{e.type.replace(/_/g, " ")} — {e.reason}
                          </span>
                          <span className="flex items-center gap-2 shrink-0">
                            <span className="text-muted-foreground">{new Date(e.createdAt).toLocaleDateString()}</span>
                            {!e.reversedAt && e.type !== "REVERSAL" && e.type !== "REINSTATE" && e.type !== "LEGACY_MIGRATION" && canAct && lookupUser.role !== "ADMINISTRATOR" && (
                              <button onClick={() => reverseRep(e.id)} disabled={busy === e.id}
                                className="px-1.5 py-0.5 text-[10px] bg-destructive/10 text-destructive rounded hover:bg-destructive/20 disabled:opacity-50">
                                Reverse
                              </button>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* UNIFIED QUEUE */}
        {tab === "queue" && (<>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            {([
              { id: "OPEN", label: "Open", count: counts.open },
              { id: "MINE", label: "Mine", count: counts.mine },
              { id: "ESCALATED", label: "Escalated", count: counts.escalated },
              { id: "PENDING", label: "Pending", count: null },
              { id: "REVIEWING", label: "Reviewing", count: null },
            ] as const).map(({ id, label, count }) => (
              <button
                key={id}
                onClick={() => { setQueueFilter(id); setSelected(new Set()) }}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  queueFilter === id ? "bg-primary text-primary-foreground" : "bg-card border border-border hover:bg-secondary"
                }`}
              >
                {label}
                {count !== null && <span className="ml-1.5 text-xs opacity-80">{count}</span>}
              </button>
            ))}
          </div>
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)}
            className="px-3 py-1.5 rounded-lg border border-border bg-card text-sm"
          >
            <option value="ALL">All types</option>
            <option value="REPORT">Reports</option>
            <option value="FLAG">Abuse signals</option>
          </select>
        </div>

        {/* Bulk bar — lifecycle actions only; enforcement is never bulkable */}
        {canAct && selected.size > 0 && (
          <div className="bg-card border border-border rounded-lg p-3 flex items-center gap-3 mb-4 flex-wrap">
            <span className="text-sm font-medium">{selected.size} selected</span>
            <button onClick={() => runBulkQueue("resolve")} disabled={busy === "bulk"}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary/10 text-primary rounded-lg hover:bg-primary/20 disabled:opacity-50">
              <CheckCircle className="w-4 h-4" /> Resolve
            </button>
            <button onClick={() => runBulkQueue("dismiss")} disabled={busy === "bulk"}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-secondary rounded-lg hover:bg-secondary/80 disabled:opacity-50">
              <XCircle className="w-4 h-4" /> Dismiss
            </button>
            <select
              defaultValue=""
              onChange={(e) => { if (e.target.value) { runBulkQueue("assign", e.target.value); e.target.value = "" } }}
              onFocus={loadStaff}
              className="px-3 py-1.5 rounded-lg border border-border bg-card text-sm"
            >
              <option value="" disabled>Assign to…</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>@{s.username} ({s.role.toLowerCase()})</option>
              ))}
            </select>
            <button onClick={() => setSelected(new Set())} className="text-sm text-muted-foreground hover:underline ml-auto">
              Clear
            </button>
          </div>
        )}

        <div className="bg-card rounded-xl border border-border divide-y divide-border mb-6">
          {items.length === 0 && (
            <div className="p-8 text-center text-muted-foreground">
              <CheckCircle className="w-10 h-10 mx-auto mb-2 text-primary" />
              Queue is clear. No cases match these filters.
            </div>
          )}
          {items.map((it) => {
            const terminal = it.status === "RESOLVED" || it.status === "DISMISSED"
            return (
              <div key={`${it.kind}:${it.id}`} className="p-4 flex items-center gap-3 hover:bg-secondary/50 transition-colors">
                {canAct && !terminal && (
                  <input
                    type="checkbox"
                    checked={selected.has(it.id)}
                    onChange={() => toggleSelect(it.id)}
                    className="h-4 w-4 rounded border-border accent-primary shrink-0"
                  />
                )}
                <Link href={`/moderation/cases/${it.id}?kind=${it.kind}`} className="flex items-center gap-3 min-w-0 flex-1">
                  <span className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                    {it.kind === "FLAG" ? <TrendingUp className="w-4 h-4 text-amber-500" /> : <Flag className="w-4 h-4 text-amber-500" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">
                        {it.kind === "FLAG" ? it.signalLabel : `${(it.type ?? "").replace(/_/g, " ")} report`}
                      </span>
                      {it.kind === "REPORT" && it.reason && (
                        <span className="text-xs px-2 py-0.5 bg-destructive/10 text-destructive rounded">{it.reason.replace(/_/g, " ")}</span>
                      )}
                      {priorityChip(it.priority)}
                      {statusChip(it.status)}
                    </span>
                    <span className="block text-xs text-muted-foreground truncate mt-0.5">
                      {it.kind === "FLAG"
                        ? `@${it.subject}${it.counterparty ? ` ↔ @${it.counterparty}` : ""}`
                        : `@${it.subject}${it.reporter ? ` — reported by @${it.reporter}` : ""}${it.targetLabel ? ` — ${it.targetLabel}` : ""}`}
                      {it.targetDeleted && " (content removed)"}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0 hidden sm:block" title={new Date(it.createdAt).toLocaleString()}>
                    {new Date(it.createdAt).toLocaleDateString()}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0 w-24 truncate text-right hidden md:block">
                    {it.assignedTo ? `@${it.assignedTo}` : <span className="italic">unassigned</span>}
                  </span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </Link>
                {canAct && !terminal && (
                  <span className="flex gap-1.5 shrink-0" onClick={(e) => e.preventDefault()}>
                    <button onClick={() => queueAction(it, { action: "status", status: "RESOLVED" })} disabled={busy === it.id}
                      title="Resolve"
                      className="p-1.5 bg-primary/10 text-primary rounded-lg hover:bg-primary/20 disabled:opacity-50">
                      <CheckCircle className="w-4 h-4" />
                    </button>
                    <button onClick={() => queueAction(it, { action: "status", status: "DISMISSED" })} disabled={busy === it.id}
                      title="Dismiss"
                      className="p-1.5 bg-secondary rounded-lg hover:bg-secondary/80 disabled:opacity-50">
                      <XCircle className="w-4 h-4" />
                    </button>
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {closed.length > 0 && (
          <>
            <h2 className="text-lg font-semibold mb-4">Recently Resolved</h2>
            <div className="bg-card/50 rounded-xl border border-border divide-y divide-border mb-10">
              {closed.map((r) => (
                <Link key={`${r.kind}:${r.id}`} href={`/moderation/cases/${r.id}?kind=${r.kind}`}
                  className="p-3 text-sm flex items-center justify-between hover:bg-secondary/40 transition-colors">
                  <span>{r.kind === "FLAG" ? r.signalLabel : `${r.type} — ${r.reason?.replace(/_/g, " ")}`}</span>
                  {statusChip(r.status)}
                </Link>
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
