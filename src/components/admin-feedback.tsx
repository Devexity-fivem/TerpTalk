"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, ExternalLink, Plus, X } from "lucide-react"
import { cn } from "@/lib/utils"

interface FeedbackItem {
  id: string
  type: string
  status: string
  priority: string
  source: string
  title: string
  message: string
  pagePath: string | null
  deviceType: string | null
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
  author: { id: string; name: string | null; profile: { username: string } | null } | null
}

interface FeedbackDetail extends FeedbackItem {
  adminNotes: string | null
  resolvedById: string | null
}

const STATUSES = ["NEW", "REVIEWING", "PLANNED", "IN_PROGRESS", "RESOLVED", "DECLINED"] as const
const TYPES = ["BUG", "UX", "FEATURE", "CONTENT", "OTHER"] as const
const PRIORITIES = ["LOW", "NORMAL", "HIGH"] as const

const STATUS_LABEL: Record<string, string> = {
  NEW: "New", REVIEWING: "Reviewing", PLANNED: "Planned",
  IN_PROGRESS: "In Progress", RESOLVED: "Resolved", DECLINED: "Declined",
}
const TYPE_LABEL: Record<string, string> = {
  BUG: "Bug", UX: "UX", FEATURE: "Feature", CONTENT: "Content", OTHER: "Other",
}

const TYPE_CLS: Record<string, string> = {
  BUG: "bg-destructive/10 text-destructive",
  UX: "bg-blue-500/10 text-blue-500",
  FEATURE: "bg-purple-500/10 text-purple-500",
  CONTENT: "bg-amber-500/10 text-warning",
  OTHER: "bg-secondary text-muted-foreground",
}
const STATUS_CLS: Record<string, string> = {
  NEW: "bg-primary/10 text-primary",
  REVIEWING: "bg-blue-500/10 text-blue-500",
  PLANNED: "bg-purple-500/10 text-purple-500",
  IN_PROGRESS: "bg-amber-500/10 text-warning",
  RESOLVED: "bg-green-500/10 text-success",
  DECLINED: "bg-secondary text-muted-foreground",
}

const selectCls = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
const inputCls = "w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"

function Pill({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap", cls)}>
      {label}
    </span>
  )
}

export default function AdminFeedback() {
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState("")

  const [fStatus, setFStatus] = useState("")
  const [fType, setFType] = useState("")
  const [fPriority, setFPriority] = useState("")
  const [fSource, setFSource] = useState("")

  const [detail, setDetail] = useState<FeedbackDetail | null>(null)
  const [detailBusy, setDetailBusy] = useState(false)
  const [editState, setEditState] = useState({ type: "", priority: "", status: "", adminNotes: "" })

  const [showObs, setShowObs] = useState(false)
  const [obsForm, setObsForm] = useState({ type: "UX", title: "", message: "", pagePath: "", priority: "NORMAL" })
  const [obsBusy, setObsBusy] = useState(false)

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 3000) }

  const load = useCallback((p: number) => {
    const q = new URLSearchParams()
    if (fStatus) q.set("status", fStatus)
    if (fType) q.set("type", fType)
    if (fPriority) q.set("priority", fPriority)
    if (fSource) q.set("source", fSource)
    q.set("page", String(p))
    fetch(`/api/admin/feedback?${q}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        setItems(d.items || [])
        setCounts(d.counts || {})
        setTotal(d.total || 0)
        setTotalPages(d.totalPages || 1)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [fStatus, fType, fPriority, fSource])

  useEffect(() => { load(page) }, [load, page])

  // Filter changes reset to page 1 in the handlers below — no effect needed.
  const applyStatus = (s: string) => { setFStatus(s); setPage(1) }
  const applyType = (v: string) => { setFType(v); setPage(1) }
  const applyPriority = (v: string) => { setFPriority(v); setPage(1) }
  const applySource = (v: string) => { setFSource(v); setPage(1) }

  const openDetail = (id: string) => {
    fetch(`/api/admin/feedback/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.item) return
        setDetail(d.item)
        setEditState({
          type: d.item.type, priority: d.item.priority,
          status: d.item.status, adminNotes: d.item.adminNotes || "",
        })
      })
      .catch(() => {})
  }

  const saveDetail = async () => {
    if (!detail || detailBusy) return
    setDetailBusy(true)
    const res = await fetch(`/api/admin/feedback/${detail.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editState),
    })
    setDetailBusy(false)
    if (!res.ok) { flash("Save failed"); return }
    flash("Saved")
    setDetail(null)
    load(page)
  }

  const submitObservation = async (e: React.FormEvent) => {
    e.preventDefault()
    if (obsBusy) return
    setObsBusy(true)
    const res = await fetch("/api/admin/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(obsForm),
    })
    setObsBusy(false)
    if (!res.ok) { flash("Could not save observation"); return }
    flash("Observation recorded")
    setObsForm({ type: "UX", title: "", message: "", pagePath: "", priority: "NORMAL" })
    setShowObs(false)
    load(page)
  }

  if (loading && items.length === 0) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
  }

  return (
    <div className="space-y-4">
      {/* Header + counts */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => applyStatus("")}
            className={cn("px-2.5 py-1 rounded-lg text-xs font-medium transition-colors", !fStatus ? "bg-primary text-primary-foreground" : "bg-card border border-border hover:bg-secondary")}
          >
            All
          </button>
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => applyStatus(fStatus === s ? "" : s)}
              className={cn("px-2.5 py-1 rounded-lg text-xs font-medium transition-colors", fStatus === s ? "bg-primary text-primary-foreground" : "bg-card border border-border hover:bg-secondary")}
            >
              {STATUS_LABEL[s]} <span className="opacity-70">{counts[s] ?? 0}</span>
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowObs(!showObs)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Observation
        </button>
      </div>

      {/* Add observation form */}
      {showObs && (
        <form onSubmit={submitObservation} className="bg-card/80 rounded-2xl border border-border/70 p-4 space-y-3">
          <h3 className="font-display text-sm font-semibold">Record an observation</h3>
          <div className="flex flex-wrap gap-3">
            <select value={obsForm.type} onChange={(e) => setObsForm({ ...obsForm, type: e.target.value })} className={selectCls} aria-label="Type">
              {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
            <select value={obsForm.priority} onChange={(e) => setObsForm({ ...obsForm, priority: e.target.value })} className={selectCls} aria-label="Priority">
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <input
            required maxLength={150} value={obsForm.title}
            onChange={(e) => setObsForm({ ...obsForm, title: e.target.value })}
            placeholder="Homepage feels crowded below the hero"
            className={inputCls}
          />
          <textarea
            required maxLength={5000} rows={3} value={obsForm.message}
            onChange={(e) => setObsForm({ ...obsForm, message: e.target.value })}
            placeholder="What you observed, where, and why it matters."
            className={cn(inputCls, "resize-y min-h-[72px]")}
          />
          <input
            maxLength={300} value={obsForm.pagePath}
            onChange={(e) => setObsForm({ ...obsForm, pagePath: e.target.value })}
            placeholder="Page path (optional) — e.g. /diaries"
            className={inputCls}
          />
          <div className="flex gap-2">
            <button type="submit" disabled={obsBusy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
              {obsBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save observation
            </button>
            <button type="button" onClick={() => setShowObs(false)} className="px-3 py-1.5 rounded-lg bg-secondary text-sm hover:bg-secondary/70">Cancel</button>
          </div>
        </form>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={fType} onChange={(e) => applyType(e.target.value)} className={selectCls} aria-label="Filter by type">
          <option value="">All types</option>
          {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
        <select value={fPriority} onChange={(e) => applyPriority(e.target.value)} className={selectCls} aria-label="Filter by priority">
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={fSource} onChange={(e) => applySource(e.target.value)} className={selectCls} aria-label="Filter by source">
          <option value="">All sources</option>
          <option value="USER">User</option>
          <option value="ADMIN_OBSERVATION">Admin Observation</option>
        </select>
        <span className="text-xs text-muted-foreground ml-auto">{total} item{total === 1 ? "" : "s"}</span>
      </div>

      {msg && <p className="text-sm text-primary">{msg}</p>}

      {/* List */}
      <div className="bg-card/80 rounded-2xl border border-border/70 overflow-hidden">
        {items.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">No feedback matches these filters.</div>
        )}
        <div className="divide-y divide-border">
          {items.map((f) => (
            <button
              key={f.id}
              onClick={() => openDetail(f.id)}
              className="w-full flex items-start gap-3 p-4 text-left hover:bg-secondary/50 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                  <Pill label={TYPE_LABEL[f.type] ?? f.type} cls={TYPE_CLS[f.type] ?? TYPE_CLS.OTHER} />
                  <Pill label={STATUS_LABEL[f.status] ?? f.status} cls={STATUS_CLS[f.status] ?? STATUS_CLS.NEW} />
                  {f.priority !== "NORMAL" && (
                    <Pill label={f.priority} cls={f.priority === "HIGH" ? "bg-destructive/10 text-destructive" : "bg-secondary text-muted-foreground"} />
                  )}
                  {f.source === "ADMIN_OBSERVATION" && (
                    <Pill label="Observation" cls="bg-amber-500/10 text-warning" />
                  )}
                </div>
                <div className="font-medium text-sm break-words">{f.title}</div>
                <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3">
                  <span>@{f.author?.profile?.username || f.author?.name || "deleted"}</span>
                  {f.deviceType && <span className="px-1.5 py-px rounded bg-secondary">{f.deviceType}</span>}
                  {f.pagePath && <span className="font-mono">{f.pagePath}</span>}
                  <span>{new Date(f.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 rounded-lg bg-card border border-border text-sm hover:bg-secondary disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1.5 rounded-lg bg-card border border-border text-sm hover:bg-secondary disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}

      {/* Detail modal */}
      {detail && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setDetail(null)}>
          <div
            role="dialog" aria-modal="true" aria-labelledby="fb-detail-title"
            className="bg-card/80 border border-border/70 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                  <Pill label={TYPE_LABEL[detail.type] ?? detail.type} cls={TYPE_CLS[detail.type] ?? TYPE_CLS.OTHER} />
                  <Pill label={STATUS_LABEL[detail.status] ?? detail.status} cls={STATUS_CLS[detail.status] ?? STATUS_CLS.NEW} />
                  {detail.source === "ADMIN_OBSERVATION" && <Pill label="Observation" cls="bg-amber-500/10 text-warning" />}
                </div>
                <h2 id="fb-detail-title" className="font-display text-lg font-semibold break-words">{detail.title}</h2>
                <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3">
                  <span>by @{detail.author?.profile?.username || detail.author?.name || "deleted"}</span>
                  {detail.deviceType && <span className="px-1.5 py-px rounded bg-secondary">{detail.deviceType}</span>}
                  {detail.pagePath && (
                    <a href={detail.pagePath} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-primary hover:underline">
                      {detail.pagePath} <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  <span>created {new Date(detail.createdAt).toLocaleString()}</span>
                  <span>updated {new Date(detail.updatedAt).toLocaleString()}</span>
                </div>
              </div>
              <button onClick={() => setDetail(null)} aria-label="Close" className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-secondary/40 rounded-lg p-3 mb-4">
              <p className="text-sm whitespace-pre-wrap break-words">{detail.message}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Type</label>
                <select value={editState.type} onChange={(e) => setEditState({ ...editState, type: e.target.value })} className={cn(selectCls, "w-full")}>
                  {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Priority</label>
                <select value={editState.priority} onChange={(e) => setEditState({ ...editState, priority: e.target.value })} className={cn(selectCls, "w-full")}>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Status</label>
                <select value={editState.status} onChange={(e) => setEditState({ ...editState, status: e.target.value })} className={cn(selectCls, "w-full")}>
                  {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Internal notes <span className="font-normal">(never shown to members)</span>
              </label>
              <textarea
                rows={3} maxLength={5000}
                value={editState.adminNotes}
                onChange={(e) => setEditState({ ...editState, adminNotes: e.target.value })}
                placeholder="Confirmed on iPhone 15. Reproduces at 390px. / Fixed in b354c06."
                className={cn(inputCls, "resize-y min-h-[72px]")}
              />
            </div>

            {detail.resolvedAt && (
              <p className="text-xs text-muted-foreground mb-3">
                Resolved {new Date(detail.resolvedAt).toLocaleString()}
              </p>
            )}

            <div className="flex gap-2">
              <button
                onClick={saveDetail}
                disabled={detailBusy}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {detailBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save changes
              </button>
              <button onClick={() => setDetail(null)} className="px-4 py-2 rounded-lg bg-secondary text-sm hover:bg-secondary/70">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
