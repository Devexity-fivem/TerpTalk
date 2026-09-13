"use client"

import { useEffect, useState, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useRouter, useParams } from "next/navigation"
import { ShieldCheck, Loader2, User, Ban, Clock, AlertTriangle, TrendingUp } from "lucide-react"
import Link from "next/link"
import { signInHref } from "@/lib/callback-url"

interface UserDetail {
  id: string
  name: string | null
  role: string
  banned: boolean
  bannedReason: string | null
  suspendedUntil: string | null
  createdAt: string
  lastSeenAt: string | null
  profile: {
    username: string
    bio: string | null
    location: string | null
    avatarUrl: string | null
    reputation: number
  } | null
  _count: {
    posts: number
    threadCreator: number
    diaryCreator: number
    setupCreator: number
    reports: number
    chatMessages: number
  }
  moderationHistory: { id: string; type: string; reason: string; duration: number | null; moderator: string; createdAt: string }[]
  reportsAgainst: number
  reportsBy: number
  badges: string[]
}

export default function AdminUserDetailPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const params = useParams()
  const role = (session?.user as { role?: string })?.role

  const [user, setUser] = useState<UserDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [duration, setDuration] = useState(7)
  const [ledger, setLedger] = useState<{ ledgerSum: number; drift: number; events: { id: string; type: string; amount: number; reason: string; actor: string | null; reversedAt: string | null; createdAt: string }[] } | null>(null)
  const [repDelta, setRepDelta] = useState("")
  const [repReason, setRepReason] = useState("")

  const userId = params.id as string

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/users/${userId}`)
    if (!res.ok) { setLoading(false); return }
    const d = await res.json()
    setUser(d.user)
    setLoading(false)
    if (d.user?.profile?.username) {
      const rep = await fetch(`/api/moderation/reputation?username=${encodeURIComponent(d.user.profile.username)}`)
      if (rep.ok) setLedger(await rep.json())
    }
  }, [userId])

  useEffect(() => {
    if (status === "unauthenticated") router.push(signInHref(window.location.pathname + window.location.search))
    else if (status === "authenticated") { const t = setTimeout(load, 0); return () => clearTimeout(t) }
  }, [status, router, load])

  const act = async (actionType: string) => {
    const reason = prompt("Reason for this action:")
    if (!reason) return
    setBusy(true)
    setError("")
    setNotice("")
    try {
      const res = await fetch("/api/moderation/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionType,
          targetUserId: userId,
          reason,
          durationDays: actionType === "TEMPORARY_BAN" ? duration : undefined,
        }),
      })
      const d = await res.json()
      if (res.ok) { setNotice(`${actionType.replace(/_/g, " ")} applied`); load() }
      else { setError(d.error || "Action failed") }
    } finally { setBusy(false) }
  }

  const toggleBadge = async (badge: string, grant: boolean) => {
    if (!confirm(`${grant ? "Grant" : "Revoke"} the "${badge}" badge?`)) return
    setBusy(true)
    setError("")
    setNotice("")
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, badge, grant }),
      })
      const d = await res.json()
      if (res.ok) { setNotice(`Badge ${grant ? "granted" : "revoked"}`); load() }
      else { setError(d.error || "Badge action failed") }
    } finally { setBusy(false) }
  }

  const adjustRep = async () => {
    const delta = parseInt(repDelta, 10)
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 500) { setError("Delta must be a non-zero integer within ±500"); return }
    if (!repReason.trim()) { setError("Reason required"); return }
    if (!confirm(`Adjust reputation by ${delta > 0 ? "+" : ""}${delta} for @${user?.profile?.username}?`)) return
    setBusy(true)
    setError("")
    setNotice("")
    try {
      const res = await fetch("/api/admin/reputation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user?.profile?.username, delta, reason: repReason.trim() }),
      })
      const d = await res.json()
      if (res.ok) { setNotice(`Reputation adjusted → ${d.newRep}`); setRepDelta(""); setRepReason(""); load() }
      else { setError(d.error || "Adjustment failed") }
    } finally { setBusy(false) }
  }

  if (status === "loading" || (loading && !user)) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
  }

  if (role !== "ADMINISTRATOR" || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <ShieldCheck className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Access denied</h1>
          <p className="text-muted-foreground">Administrator access required.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <Link href="/admin" className="text-sm text-primary hover:underline mb-4 inline-block">&larr; Back to admin</Link>
        <div className="flex items-center gap-3 mb-6">
          <User className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">@{user.profile?.username ?? user.name}</h1>
            <p className="text-muted-foreground text-sm">{user._count.posts} posts · {user._count.threadCreator} threads · rep {user.profile?.reputation ?? 0}</p>
          </div>
        </div>

        {error && <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-lg text-sm mb-4">{error}</div>}
        {notice && <div className="bg-primary/10 text-primary px-4 py-2 rounded-lg text-sm mb-4">{notice}</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {[
            { label: "Role", value: user.role },
            { label: "Joined", value: new Date(user.createdAt).toLocaleDateString() },
            { label: "Last seen", value: user.lastSeenAt ? new Date(user.lastSeenAt).toLocaleString() : "Never" },
            { label: "Reports against", value: user.reportsAgainst },
            { label: "Reports filed", value: user.reportsBy },
            { label: "Diaries", value: user._count.diaryCreator },
            { label: "Setups", value: user._count.setupCreator },
            { label: "Chat messages", value: user._count.chatMessages },
          ].map((s) => (
            <div key={s.label} className="bg-card rounded-xl border border-border p-4">
              <div className="text-lg font-bold tabular-nums">{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="bg-card rounded-xl border border-border p-4 mb-6">
          <h2 className="font-semibold mb-3">Restrictions</h2>
          <div className="flex items-center gap-2 mb-3">
            {user.banned ? <Ban className="w-4 h-4 text-destructive" /> : <Clock className="w-4 h-4 text-muted-foreground" />}
            <span className="text-sm">{user.banned ? `Permanently banned${user.bannedReason ? `: ${user.bannedReason}` : ""}` : user.suspendedUntil ? `Suspended until ${new Date(user.suspendedUntil).toLocaleString()}` : "No active restrictions"}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => act("WARNING")} disabled={busy} className="px-3 py-1.5 text-sm bg-amber-500/10 text-amber-500 rounded-lg hover:bg-amber-500/20 disabled:opacity-50 flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Warn</button>
            <div className="flex items-center gap-2">
              <input type="number" min={1} max={365} value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="w-16 px-2 py-1.5 rounded-lg border border-border bg-background text-sm" />
              <button onClick={() => act("TEMPORARY_BAN")} disabled={busy} className="px-3 py-1.5 text-sm bg-amber-500/10 text-amber-500 rounded-lg hover:bg-amber-500/20 disabled:opacity-50">Suspend</button>
            </div>
            <button onClick={() => act("PERMANENT_BAN")} disabled={busy} className="px-3 py-1.5 text-sm bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 disabled:opacity-50">Ban</button>
            <button onClick={() => act("UNBAN")} disabled={busy} className="px-3 py-1.5 text-sm bg-primary/10 text-primary rounded-lg hover:bg-primary/20 disabled:opacity-50">Unban / Unsuspend</button>
            {user.badges?.includes("Trusted Member") ? (
              <button onClick={() => toggleBadge("Trusted Member", false)} disabled={busy}
                className="px-3 py-1.5 text-sm bg-secondary rounded-lg hover:bg-secondary/80 disabled:opacity-50">
                Revoke Trusted Member
              </button>
            ) : (
              <button onClick={() => toggleBadge("Trusted Member", true)} disabled={busy}
                className="px-3 py-1.5 text-sm bg-emerald-500/10 text-emerald-500 rounded-lg hover:bg-emerald-500/20 disabled:opacity-50">
                Grant Trusted Member
              </button>
            )}
          </div>
        </div>

        {user.role !== "ADMINISTRATOR" && (
          <div className="bg-card rounded-xl border border-border p-4 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-primary" />
              <h2 className="font-semibold">Reputation</h2>
              {ledger && (
                <span className={`text-xs ml-auto ${ledger.drift !== 0 ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                  ledger {ledger.ledgerSum}{ledger.drift !== 0 ? ` · drift ${ledger.drift > 0 ? "+" : ""}${ledger.drift}` : ""}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <input
                type="number" value={repDelta} onChange={(e) => setRepDelta(e.target.value)}
                placeholder="±amount" min={-500} max={500}
                className="w-24 px-2 py-1.5 rounded-lg border border-border bg-background text-sm"
              />
              <input
                type="text" value={repReason} onChange={(e) => setRepReason(e.target.value)}
                placeholder="Reason (required)" maxLength={500}
                className="flex-1 min-w-40 px-2 py-1.5 rounded-lg border border-border bg-background text-sm"
              />
              <button onClick={adjustRep} disabled={busy}
                className="px-3 py-1.5 text-sm bg-primary/10 text-primary rounded-lg hover:bg-primary/20 disabled:opacity-50">
                Adjust
              </button>
            </div>
            {ledger && (
              <div className="divide-y divide-border">
                {ledger.events.slice(0, 12).map((e) => (
                  <div key={e.id} className={`py-1.5 text-xs flex items-center justify-between gap-2 ${e.reversedAt ? "opacity-50" : ""}`}>
                    <span className={`min-w-0 truncate ${e.reversedAt ? "line-through" : ""}`}>
                      <span className={`font-medium ${e.amount >= 0 ? "text-primary" : "text-destructive"}`}>{e.amount >= 0 ? "+" : ""}{e.amount}</span>
                      {" "}{e.type.replace(/_/g, " ")}
                      {e.actor && <span className="text-muted-foreground"> by @{e.actor}</span>}
                      <span className="text-muted-foreground"> — {e.reason}</span>
                    </span>
                    <span className="text-muted-foreground shrink-0">{new Date(e.createdAt).toLocaleDateString()}</span>
                  </div>
                ))}
                {ledger.events.length === 0 && <p className="py-2 text-sm text-muted-foreground">No reputation events.</p>}
              </div>
            )}
          </div>
        )}

        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="p-4 border-b border-border font-semibold">Moderation history</div>
          <div className="divide-y divide-border">
            {user.moderationHistory.length === 0 && <p className="p-4 text-sm text-muted-foreground">No moderation actions recorded.</p>}
            {user.moderationHistory.map((h) => (
              <div key={h.id} className="p-3 text-sm flex items-center justify-between gap-3">
                <div>
                  <span className="font-medium">{h.type.replace(/_/g, " ")}</span>
                  <span className="text-muted-foreground"> by @{h.moderator}</span>
                  {h.duration && <span className="text-xs text-muted-foreground ml-2">{h.duration} day(s)</span>}
                  <p className="text-xs text-muted-foreground">{h.reason}</p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">{new Date(h.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
