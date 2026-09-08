"use client"

import { useCallback, useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import {
  ShieldCheck, Loader2, Users as UsersIcon,
  Megaphone, ShieldAlert, Ban, UserCheck, Search,
} from "lucide-react"
import Link from "next/link"

interface Stats {
  users: number; activeUsers: number; bannedUsers: number; threads: number
  posts: number; openReports: number; totalReports: number
  moderationActions: number
  securityEvents24h: number
}
interface AdminUser {
  id: string; username: string; role: string; banned: boolean
  bannedReason: string | null; joined: string; lastSeen: string | null
  reputation: number; referrals: number
  stats: { posts: number; threadCreator: number; diaryCreator: number; reports: number }
}
interface SecEvent {
  id: string; type: string; user: string; metadata: string | null; createdAt: string
}

const TABS = [
  { id: "overview", label: "Overview", icon: ShieldCheck },
  { id: "users", label: "Users", icon: UsersIcon },
  { id: "announce", label: "Announce", icon: Megaphone },
  { id: "security", label: "Security", icon: ShieldAlert },
] as const

export default function AdminPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const role = (session?.user as { role?: string })?.role

  const [tab, setTab] = useState<string>("overview")
  const [stats, setStats] = useState<Stats | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [events, setEvents] = useState<SecEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  // Users tab
  const [userQuery, setUserQuery] = useState("")
  const [userFilter, setUserFilter] = useState("all")

  // Announce tab
  const [announce, setAnnounce] = useState({ title: "", content: "", link: "" })
  const [sending, setSending] = useState(false)

  const load = useCallback(() => {
    fetch("/api/admin/stats").then(async (res) => {
      if (!res.ok) { setDenied(true); setLoading(false); return }
      const d = await res.json(); setStats(d.stats)
      setLoading(false)
    }).catch(() => { setDenied(true); setLoading(false) })
  }, [])

  const loadUsers = useCallback(() => {
    fetch(`/api/admin/users?q=${encodeURIComponent(userQuery)}&filter=${userFilter}`)
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((d) => setUsers(d.users || []))
      .catch(() => {})
  }, [userQuery, userFilter])

  const loadSecurity = useCallback(() => {
    fetch("/api/admin/security")
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((d) => setEvents(d.events || []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (status === "unauthenticated") router.push("/auth/signin")
    else if (status === "authenticated") load()
  }, [status, router, load])

  useEffect(() => {
    if (tab === "users") loadUsers()
    if (tab === "security") loadSecurity()
  }, [tab, loadUsers, loadSecurity])

  const flash = (msg: string) => { setNotice(msg); setTimeout(() => setNotice(""), 3000) }

  const setUserRole = async (userId: string, newRole: string) => {
    if (!confirm(`Change this user's role to ${newRole}?`)) return
    setBusy(userId)
    setError("")
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role: newRole }),
      })
      if (res.ok) { loadUsers(); flash("Role updated") }
      else { const d = await res.json(); setError(d.error || "Failed") }
    } finally { setBusy(null) }
  }

  const banUser = async (userId: string, unban: boolean) => {
    const reason = unban ? "Ban lifted" : prompt("Ban reason:")?.trim()
    if (!unban && !reason) return
    setBusy(userId)
    setError("")
    try {
      const res = await fetch("/api/moderation/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionType: unban ? "UNBAN" : "PERMANENT_BAN",
          targetUserId: userId,
          reason: reason || "Ban lifted",
        }),
      })
      if (res.ok) { loadUsers(); flash(unban ? "User unbanned" : "User banned") }
      else { const d = await res.json(); setError(d.error || "Failed") }
    } finally { setBusy(null) }
  }

  const sendAnnouncement = async () => {
    if (!announce.title.trim() || !announce.content.trim()) { setError("Title and content required"); return }
    if (!confirm(`Send announcement to all users?`)) return
    setSending(true)
    setError("")
    try {
      const res = await fetch("/api/admin/announce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(announce),
      })
      if (res.ok) {
        const d = await res.json()
        setAnnounce({ title: "", content: "", link: "" })
        flash(`Sent to ${d.recipients} users`)
      } else { const d = await res.json(); setError(d.error || "Failed") }
    } finally { setSending(false) }
  }

  if (status === "loading" || loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
  }

  if (denied || role !== "ADMINISTRATOR") {
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
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-8 h-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">Admin Panel</h1>
              <p className="text-muted-foreground text-sm">Full site controls</p>
            </div>
          </div>
          <Link href="/moderation" className="text-sm text-primary hover:underline flex items-center gap-1">
            <ShieldAlert className="w-4 h-4" /> Moderation queue
          </Link>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                tab === id ? "bg-primary text-primary-foreground" : "bg-card border border-border hover:bg-secondary"
              }`}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>

        {error && <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-lg text-sm mb-4">{error}</div>}
        {notice && <div className="bg-primary/10 text-primary px-4 py-2 rounded-lg text-sm mb-4">{notice}</div>}

        {/* OVERVIEW */}
        {tab === "overview" && stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Total Users", value: stats.users },
              { label: "Active (7d)", value: stats.activeUsers },
              { label: "Banned", value: stats.bannedUsers },
              { label: "Threads", value: stats.threads },
              { label: "Posts", value: stats.posts },
              { label: "Open Reports", value: stats.openReports },
              { label: "Mod Actions", value: stats.moderationActions },
              { label: "Security Events (24h)", value: stats.securityEvents24h },
            ].map((s) => (
              <div key={s.label} className="bg-card rounded-xl border border-border p-4">
                <div className="text-2xl font-bold text-primary tabular-nums">{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* USERS */}
        {tab === "users" && (
          <div className="bg-card rounded-xl border border-border">
            <div className="p-4 border-b border-border flex gap-3 flex-wrap">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && loadUsers()}
                  placeholder="Search username..."
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <select
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
                className="px-3 py-2 rounded-lg border border-border bg-background text-sm"
              >
                <option value="all">All users</option>
                <option value="staff">Staff</option>
                <option value="banned">Banned</option>
              </select>
              <button onClick={loadUsers} className="px-4 py-2 bg-secondary rounded-lg text-sm hover:bg-secondary/80">Search</button>
            </div>
            <div className="divide-y divide-border">
              {users.length === 0 && <p className="p-4 text-sm text-muted-foreground">No users found.</p>}
              {users.map((u) => (
                <div key={u.id} className="p-4 flex items-center justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/u/${u.username}`} className="font-medium hover:text-primary">@{u.username}</Link>
                      {u.role === "ADMINISTRATOR" && <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/15 text-amber-500 rounded font-semibold">ADMIN</span>}
                      {u.role === "MODERATOR" && <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/15 text-blue-500 rounded font-semibold">MOD</span>}
                      {u.role === "VERIFIED_MEMBER" && <span className="text-[10px] px-1.5 py-0.5 bg-primary/15 text-primary rounded font-semibold">VERIFIED</span>}
                      {u.banned && <span className="text-[10px] px-1.5 py-0.5 bg-destructive/15 text-destructive rounded font-semibold">BANNED</span>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {u.stats.posts} posts · {u.stats.threadCreator} threads · {u.stats.diaryCreator} diaries · rep {u.reputation} · {u.referrals} referrals · joined {new Date(u.joined).toLocaleDateString()}
                    </div>
                    {u.bannedReason && <div className="text-xs text-destructive mt-0.5">Reason: {u.bannedReason}</div>}
                  </div>
                  {u.role !== "ADMINISTRATOR" && (
                    <div className="flex gap-2 flex-wrap shrink-0">
                      {u.role !== "MODERATOR" ? (
                        <button onClick={() => setUserRole(u.id, "MODERATOR")} disabled={busy === u.id}
                          className="px-2.5 py-1.5 text-xs bg-blue-500/10 text-blue-500 rounded-lg hover:bg-blue-500/20 disabled:opacity-50">
                          Make Mod
                        </button>
                      ) : (
                        <button onClick={() => setUserRole(u.id, "MEMBER")} disabled={busy === u.id}
                          className="px-2.5 py-1.5 text-xs bg-secondary rounded-lg hover:bg-secondary/80 disabled:opacity-50">
                          Remove Mod
                        </button>
                      )}
                      {u.role === "MEMBER" && (
                        <button onClick={() => setUserRole(u.id, "VERIFIED_MEMBER")} disabled={busy === u.id}
                          className="px-2.5 py-1.5 text-xs bg-primary/10 text-primary rounded-lg hover:bg-primary/20 disabled:opacity-50 flex items-center gap-1">
                          <UserCheck className="w-3 h-3" /> Verify
                        </button>
                      )}
                      {u.banned ? (
                        <button onClick={() => banUser(u.id, true)} disabled={busy === u.id}
                          className="px-2.5 py-1.5 text-xs bg-primary/10 text-primary rounded-lg hover:bg-primary/20 disabled:opacity-50">
                          Unban
                        </button>
                      ) : (
                        <button onClick={() => banUser(u.id, false)} disabled={busy === u.id}
                          className="px-2.5 py-1.5 text-xs bg-destructive/10 text-destructive rounded-lg hover:bg-destructive/20 disabled:opacity-50 flex items-center gap-1">
                          <Ban className="w-3 h-3" /> Ban
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ANNOUNCE */}
        {tab === "announce" && (
          <div className="bg-card rounded-xl border border-border p-6 max-w-2xl">
            <h2 className="font-semibold mb-1">Broadcast Announcement</h2>
            <p className="text-sm text-muted-foreground mb-4">Sends a notification to every active user.</p>
            <div className="space-y-4">
              <input
                value={announce.title}
                onChange={(e) => setAnnounce({ ...announce, title: e.target.value })}
                placeholder="Announcement title"
                maxLength={120}
                className="w-full px-4 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <textarea
                value={announce.content}
                onChange={(e) => setAnnounce({ ...announce, content: e.target.value })}
                placeholder="Message content..."
                rows={4}
                maxLength={1000}
                className="w-full px-4 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              />
              <input
                value={announce.link}
                onChange={(e) => setAnnounce({ ...announce, link: e.target.value })}
                placeholder="Optional link (e.g. /forum)"
                className="w-full px-4 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <button
                onClick={sendAnnouncement}
                disabled={sending}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Megaphone className="w-4 h-4" />}
                Send to all users
              </button>
            </div>
          </div>
        )}

        {/* SECURITY */}
        {tab === "security" && (
          <div className="bg-card rounded-xl border border-border">
            <div className="p-4 border-b border-border">
              <h2 className="font-semibold">Security Events</h2>
              <p className="text-xs text-muted-foreground">Latest 50 — logins, registrations, rate limits, auth failures</p>
            </div>
            <div className="divide-y divide-border max-h-[32rem] overflow-y-auto">
              {events.length === 0 && <p className="p-4 text-sm text-muted-foreground">No events recorded.</p>}
              {events.map((e) => (
                <div key={e.id} className="p-3 text-sm flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${
                      e.type.includes("FAILURE") || e.type.includes("EXCEEDED") || e.type.includes("SUSPICIOUS")
                        ? "bg-destructive/15 text-destructive"
                        : "bg-primary/15 text-primary"
                    }`}>{e.type}</span>
                    <span className="text-muted-foreground truncate">@{e.user}</span>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{new Date(e.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
