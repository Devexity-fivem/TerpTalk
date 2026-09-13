"use client"

import { signInHref } from "@/lib/callback-url"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import {
  Shield, Flag, TrendingUp, Loader2, CheckCircle, XCircle,
  AlertTriangle, UserCheck, Ban, ArrowLeft, Trash2,
} from "lucide-react"
import Link from "next/link"

interface SubjectContext {
  missing?: boolean
  userId?: string
  username?: string
  role?: string
  banned?: boolean
  bannedReason?: string | null
  suspendedUntil?: string | null
  joined?: string
  lastSeen?: string | null
  reputation?: number
  openReports?: number
  openFlags?: number
  recentReputation?: { id: string; type: string; amount: number; reason: string; reversedAt: string | null; createdAt: string }[]
  recentActions?: { id: string; type: string; reason: string; duration: number | null; moderator: string; createdAt: string }[]
}

interface CaseItem {
  id: string
  status: string
  priority: string
  resolution: string | null
  createdAt: string
  assignedTo: string | null
  resolvedBy: string | null
  resolvedAt: string | null
  // report
  type?: string
  reason?: string
  description?: string | null
  reporter?: string | null
  ownReport?: boolean
  reportedUserId?: string
  targetId?: string | null
  target?: { title?: string | null; content?: string; deleted?: boolean; href?: string | null } | null
  // flag
  signal?: string
  signalLabel?: string
  evidence?: Record<string, unknown> | null
  userId?: string
  counterpartyId?: string | null
}

interface RelatedItem {
  kind: "REPORT" | "FLAG"
  id: string
  type?: string
  reason?: string
  signal?: string
  signalLabel?: string
  status: string
  priority: string
  createdAt: string
}

interface Activity {
  id: string
  type: string
  reason: string
  moderator: string
  createdAt: string
}

interface StaffOption { id: string; username: string; role: string }

const PRIORITY_STYLES: Record<string, string> = {
  URGENT: "bg-destructive/15 text-destructive",
  HIGH: "bg-amber-500/15 text-amber-500",
  NORMAL: "bg-secondary text-muted-foreground",
  LOW: "bg-secondary/60 text-muted-foreground/70",
}
const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-secondary text-muted-foreground",
  REVIEWING: "bg-blue-500/15 text-blue-500",
  ESCALATED: "bg-amber-500/15 text-amber-500",
  RESOLVED: "bg-primary/10 text-primary",
  DISMISSED: "bg-secondary text-muted-foreground",
}

export default function CasePage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const id = params.id as string
  const kind = searchParams.get("kind") === "FLAG" ? "FLAG" : "REPORT"

  const role = (session?.user as { role?: string })?.role
  const isStaff = role === "SUPPORT" || role === "MODERATOR" || role === "ADMINISTRATOR"
  const isSupportOnly = role === "SUPPORT"
  const canAct = role === "MODERATOR" || role === "ADMINISTRATOR"
  const isAdminUser = role === "ADMINISTRATOR"

  const [item, setItem] = useState<CaseItem | null>(null)
  const [subject, setSubject] = useState<SubjectContext | null>(null)
  const [counterparty, setCounterparty] = useState<SubjectContext | null>(null)
  const [related, setRelated] = useState<RelatedItem[]>([])
  const [activity, setActivity] = useState<Activity[]>([])
  const [staffList, setStaffList] = useState<StaffOption[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [note, setNote] = useState("")

  const load = () => {
    fetch(`/api/moderation/queue/${id}?kind=${kind}`)
      .then(async (res) => {
        if (!res.ok) { setError(res.status === 404 ? "Case not found" : "Access denied"); setLoading(false); return }
        const d = await res.json()
        setItem(d.item)
        setSubject(d.subject || null)
        setCounterparty(d.counterparty || null)
        setRelated(d.related || [])
        setActivity(d.activity || [])
        setLoading(false)
      })
      .catch(() => { setError("Failed to load case"); setLoading(false) })
  }

  useEffect(() => {
    if (status === "unauthenticated") router.push(signInHref(window.location.pathname + window.location.search))
    else if (status === "authenticated") load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, router, id, kind])

  const act = async (body: Record<string, unknown>) => {
    setBusy(true)
    setError("")
    try {
      const res = await fetch("/api/moderation/queue", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id, ...body }),
      })
      if (res.ok) { setNote(""); load() }
      else { const d = await res.json(); setError(d.error || "Action failed") }
    } finally { setBusy(false) }
  }

  const enforce = async (actionType: string, reasonDefault: string) => {
    const userId = item?.reportedUserId ?? item?.userId
    if (!userId) return
    const reason = prompt(reasonDefault)?.trim()
    if (!reason) return
    setBusy(true)
    setError("")
    try {
      const res = await fetch("/api/moderation/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionType, targetUserId: userId, reason }),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error || "Action failed") }
      else load()
    } finally { setBusy(false) }
  }

  const removeContent = async () => {
    if (!item?.targetId || !item.type || !item.reportedUserId) return
    if (!confirm("Delete this content?")) return
    setBusy(true)
    try {
      const res = await fetch("/api/moderation/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionType: "CONTENT_DELETION",
          targetType: item.type,
          targetId: item.targetId,
          targetUserId: item.reportedUserId,
          reason: `Reported for ${item.reason?.toLowerCase()}`,
        }),
      })
      if (!res.ok) setError("Failed to remove content")
      else load()
    } finally { setBusy(false) }
  }

  if (status === "loading" || loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
  }

  if (!isStaff) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Shield className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Access denied</h1>
          <p className="text-muted-foreground">Staff access required.</p>
        </div>
      </div>
    )
  }

  if (!item) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Flag className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">{error || "Case not found"}</h1>
          <Link href="/moderation" className="text-primary hover:underline text-sm">Back to queue</Link>
        </div>
      </div>
    )
  }

  const terminal = item.status === "RESOLVED" || item.status === "DISMISSED"

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <Link href="/moderation" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to queue
        </Link>

        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <span className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center">
            {kind === "FLAG" ? <TrendingUp className="w-5 h-5 text-amber-500" /> : <Flag className="w-5 h-5 text-amber-500" />}
          </span>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold">
                {kind === "FLAG" ? item.signalLabel : `${item.type?.replace(/_/g, " ")} report`}
              </h1>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${PRIORITY_STYLES[item.priority] ?? ""}`}>{item.priority}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${STATUS_STYLES[item.status] ?? ""}`}>{item.status}</span>
            </div>
            <p className="text-muted-foreground text-sm">
              Opened {new Date(item.createdAt).toLocaleString()}
              {item.assignedTo && ` · assigned to @${item.assignedTo}`}
              {item.resolvedBy && ` · closed by @${item.resolvedBy}`}
            </p>
          </div>
        </div>

        {error && <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-lg text-sm mb-4">{error}</div>}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* Evidence */}
          <div className="md:col-span-2 bg-card rounded-xl border border-border p-5 space-y-4">
            <h2 className="font-semibold text-sm">Evidence</h2>

            {kind === "REPORT" && (
              <>
                <div className="text-sm space-y-1">
                  <p><span className="text-muted-foreground">Reason:</span> <span className="font-medium">{item.reason?.replace(/_/g, " ")}</span></p>
                  <p><span className="text-muted-foreground">Reported user:</span>{" "}
                    {subject?.username ? <Link href={`/u/${subject.username}`} className="text-primary hover:underline">@{subject.username}</Link> : "unknown"}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Reported by:</span>{" "}
                    {item.reporter ? `@${item.reporter}` : <span className="italic">confidential</span>}
                  </p>
                </div>
                {item.description && (
                  <div className="bg-secondary/50 rounded p-3 text-sm break-words">&ldquo;{item.description}&rdquo;</div>
                )}
                {item.target ? (
                  <div className="bg-secondary/50 rounded p-3 text-sm break-words">
                    {item.target.title && <p className="font-medium mb-1">{item.target.title}</p>}
                    {item.target.content && <p className="whitespace-pre-wrap">{item.target.content}</p>}
                    <span className="flex items-center gap-2 mt-2">
                      {item.target.href && (
                        <Link href={item.target.href} className="text-primary hover:underline text-xs">View target</Link>
                      )}
                      {item.target.deleted && <span className="text-xs text-destructive">(content already removed)</span>}
                    </span>
                  </div>
                ) : (
                  item.type !== "PROFILE" && <p className="text-xs text-muted-foreground">Target content unavailable (may be deleted).</p>
                )}
              </>
            )}

            {kind === "FLAG" && (
              <div className="text-sm space-y-2">
                <p><span className="text-muted-foreground">Signal:</span> <span className="font-medium">{item.signalLabel}</span></p>
                <p><span className="text-muted-foreground">Subject:</span>{" "}
                  {subject?.username ? <Link href={`/u/${subject.username}`} className="text-primary hover:underline">@{subject.username}</Link> : "unknown"}
                </p>
                {counterparty?.username && (
                  <p><span className="text-muted-foreground">Counterparty:</span>{" "}
                    <Link href={`/u/${counterparty.username}`} className="text-primary hover:underline">@{counterparty.username}</Link>
                  </p>
                )}
                {item.evidence && (
                  <div className="bg-secondary/50 rounded p-3">
                    {Object.entries(item.evidence).map(([k, v]) => (
                      <p key={k} className="text-xs"><span className="text-muted-foreground">{k}:</span> {String(v)}</p>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground italic">
                  Signals are evidence for review, not proof of wrongdoing. Enforcement decisions remain with staff.
                </p>
              </div>
            )}

            {item.resolution && (
              <div className="border-t border-border pt-3 text-sm">
                <span className="text-muted-foreground">Resolution:</span> {item.resolution}
              </div>
            )}
          </div>

          {/* Subject context */}
          <div className="bg-card rounded-xl border border-border p-5">
            <h2 className="font-semibold text-sm mb-3">Subject</h2>
            {subject?.missing ? (
              <p className="text-sm text-muted-foreground">Account unavailable.</p>
            ) : subject && (
              <div className="space-y-3 text-sm">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/u/${subject.username}`} className="font-semibold hover:text-primary">@{subject.username}</Link>
                    {subject.role !== "MEMBER" && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/15 text-blue-500 rounded font-semibold">{subject.role}</span>
                    )}
                    {subject.banned && <span className="text-[10px] px-1.5 py-0.5 bg-destructive/15 text-destructive rounded font-semibold">BANNED</span>}
                    {subject.suspendedUntil && new Date(subject.suspendedUntil) > new Date() && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/15 text-amber-500 rounded font-semibold">
                        SUSPENDED until {new Date(subject.suspendedUntil).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    rep {subject.reputation} · joined {subject.joined ? new Date(subject.joined).toLocaleDateString() : "?"}
                    {subject.lastSeen && ` · seen ${new Date(subject.lastSeen).toLocaleDateString()}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {subject.openReports} open report{subject.openReports !== 1 ? "s" : ""}
                    {subject.openFlags !== undefined && ` · ${subject.openFlags} open signal${subject.openFlags !== 1 ? "s" : ""}`}
                  </p>
                  {subject.bannedReason && <p className="text-xs text-destructive mt-1">Ban reason: {subject.bannedReason}</p>}
                </div>

                {subject.recentReputation && subject.recentReputation.length > 0 && (
                  <div className="border-t border-border pt-3">
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">Recent reputation</p>
                    {subject.recentReputation.map((e) => (
                      <p key={e.id} className={`text-xs ${e.reversedAt ? "line-through opacity-60" : ""}`}>
                        <span className={`font-medium ${e.amount >= 0 ? "text-primary" : "text-destructive"}`}>{e.amount >= 0 ? "+" : ""}{e.amount}</span>
                        {" "}{e.type.replace(/_/g, " ")}
                      </p>
                    ))}
                  </div>
                )}

                {subject.recentActions && subject.recentActions.length > 0 && (
                  <div className="border-t border-border pt-3">
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">Moderation history</p>
                    {subject.recentActions.map((a) => (
                      <p key={a.id} className="text-xs">
                        <span className="font-medium">{a.type.replace(/_/g, " ")}</span> by @{a.moderator}
                        {a.duration ? ` · ${a.duration}d` : ""}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        {!terminal && (
          <div className="bg-card rounded-xl border border-border p-5 mb-6 space-y-3">
            <h2 className="font-semibold text-sm">Actions</h2>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Resolution note (optional, staff-visible)"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
            <div className="flex flex-wrap gap-2">
              {item.status === "PENDING" && (
                <button onClick={() => act({ action: "status", status: "REVIEWING" })} disabled={busy}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-500/10 text-blue-500 rounded-lg hover:bg-blue-500/20 disabled:opacity-50">
                  <UserCheck className="w-4 h-4" /> Start review
                </button>
              )}
              <button onClick={() => act({ action: "status", status: "ESCALATED", resolution: note || undefined })} disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-amber-500/10 text-amber-500 rounded-lg hover:bg-amber-500/20 disabled:opacity-50">
                <AlertTriangle className="w-4 h-4" /> Escalate
              </button>
              {canAct && (
                <>
                  <button onClick={() => act({ action: "status", status: "RESOLVED", resolution: note || undefined })} disabled={busy || item.ownReport}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary/10 text-primary rounded-lg hover:bg-primary/20 disabled:opacity-50">
                    <CheckCircle className="w-4 h-4" /> Resolve
                  </button>
                  <button onClick={() => act({ action: "status", status: "DISMISSED", resolution: note || undefined })} disabled={busy || item.ownReport}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-secondary rounded-lg hover:bg-secondary/80 disabled:opacity-50">
                    <XCircle className="w-4 h-4" /> Dismiss
                  </button>
                  <select
                    value={item.assignedTo ? "__keep" : ""}
                    onChange={async (e) => {
                      if (e.target.value === "__unassign") return act({ action: "assign", assignTo: null })
                      if (e.target.value && e.target.value !== "__keep") return act({ action: "assign", assignTo: e.target.value })
                    }}
                    onFocus={async () => {
                      if (staffList.length === 0) {
                        const res = await fetch("/api/moderation/queue/staff")
                        if (res.ok) setStaffList((await res.json()).staff || [])
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg border border-border bg-card text-sm"
                  >
                    <option value="">{item.assignedTo ? `@${item.assignedTo}` : "Assign to…"}</option>
                    {item.assignedTo && <option value="__keep">@{item.assignedTo}</option>}
                    {item.assignedTo && <option value="__unassign">Unassign</option>}
                    {staffList.map((s) => (
                      <option key={s.id} value={s.id}>@{s.username} ({s.role.toLowerCase()})</option>
                    ))}
                  </select>
                  <select
                    value={item.priority}
                    onChange={(e) => act({ action: "priority", priority: e.target.value })}
                    className="px-3 py-1.5 rounded-lg border border-border bg-card text-sm"
                  >
                    {["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => <option key={p} value={p}>{p.toLowerCase()} priority</option>)}
                  </select>
                </>
              )}
            </div>

            {/* Enforcement — existing moderation routes, never bulk, never auto */}
            {canAct && kind === "REPORT" && !item.ownReport && (
              <div className="flex flex-wrap gap-2 pt-3 border-t border-border">
                {item.type !== "PROFILE" && item.targetId && !item.target?.deleted && (
                  <button onClick={removeContent} disabled={busy}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-destructive/10 text-destructive rounded-lg hover:bg-destructive/20 disabled:opacity-50">
                    <Trash2 className="w-4 h-4" /> Remove content
                  </button>
                )}
                <button onClick={() => enforce("WARNING", "Warning reason:")} disabled={busy}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-amber-500/10 text-amber-500 rounded-lg hover:bg-amber-500/20 disabled:opacity-50">
                  <AlertTriangle className="w-4 h-4" /> Warn user
                </button>
                {isAdminUser && (
                  <button onClick={() => enforce("PERMANENT_BAN", "Ban reason:")} disabled={busy}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 disabled:opacity-50">
                    <Ban className="w-4 h-4" /> Ban user
                  </button>
                )}
              </div>
            )}
            {item.ownReport && <p className="text-xs text-muted-foreground italic">You filed this report — another staff member must adjudicate it.</p>}
            {isSupportOnly && <p className="text-xs text-muted-foreground italic">Support can review and escalate; resolution requires a moderator.</p>}
          </div>
        )}

        {/* Related + activity */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-card rounded-xl border border-border p-5">
            <h2 className="font-semibold text-sm mb-3">Related open cases</h2>
            {related.length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
            <div className="space-y-2">
              {related.map((r) => (
                <Link key={`${r.kind}:${r.id}`} href={`/moderation/cases/${r.id}?kind=${r.kind}`}
                  className="flex items-center justify-between gap-2 text-sm hover:bg-secondary/50 rounded p-1.5 -m-1.5">
                  <span className="truncate">
                    {r.kind === "FLAG" ? r.signalLabel : `${r.type} — ${r.reason?.replace(/_/g, " ")}`}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${STATUS_STYLES[r.status] ?? ""}`}>{r.status}</span>
                </Link>
              ))}
            </div>
          </div>
          <div className="bg-card rounded-xl border border-border p-5">
            <h2 className="font-semibold text-sm mb-3">Case activity</h2>
            {activity.length === 0 && <p className="text-sm text-muted-foreground">No staff actions yet.</p>}
            <div className="space-y-2">
              {activity.map((a) => (
                <div key={a.id} className="text-xs flex items-center justify-between gap-2">
                  <span><span className="font-medium">{a.type.replace(/_/g, " ")}</span> by @{a.moderator} — {a.reason}</span>
                  <span className="text-muted-foreground shrink-0">{new Date(a.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
