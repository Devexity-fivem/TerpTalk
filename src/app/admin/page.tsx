"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { ShieldCheck, Loader2, Plus, Copy, Check } from "lucide-react"

interface Stats {
  users: number
  activeUsers: number
  bannedUsers: number
  threads: number
  posts: number
  openReports: number
  totalReports: number
  moderationActions: number
  invites: number
  usedInvites: number
  securityEvents24h: number
}

interface Invite {
  id: string
  code: string
  note: string | null
  usedById: string | null
  usedAt: string | null
  createdAt: string
}

export default function AdminPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [stats, setStats] = useState<Stats | null>(null)
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const role = (session?.user as { role?: string })?.role

  const load = () => {
    fetch("/api/admin/stats")
      .then(async (res) => {
        if (!res.ok) { setDenied(true); setLoading(false); return }
        const d = await res.json()
        setStats(d.stats)
      })
      .catch(() => setDenied(true))

    fetch("/api/admin/invites")
      .then(async (res) => {
        if (res.ok) {
          const d = await res.json()
          setInvites(d.invites || [])
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }

  useEffect(() => {
    if (status === "unauthenticated") router.push("/auth/signin")
    else if (status === "authenticated") load()
  }, [status, router])

  const createInvite = async () => {
    setCreating(true)
    try {
      const res = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 1 }),
      })
      if (res.ok) load()
    } finally { setCreating(false) }
  }

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code)
    setCopied(code)
    setTimeout(() => setCopied(null), 2000)
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
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-8">
          <ShieldCheck className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Admin Dashboard</h1>
            <p className="text-muted-foreground text-sm">Invite-only beta controls</p>
          </div>
        </div>

        {/* Stats Grid */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
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
              <div key={s.label} className="bg-card rounded-lg border border-border p-4">
                <div className="text-2xl font-bold text-primary">{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Invite Management */}
        <div className="bg-card rounded-lg border border-border p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Beta Invites</h2>
              <p className="text-sm text-muted-foreground">
                {stats ? `${stats.usedInvites}/${stats.invites} used` : ""}
              </p>
            </div>
            <button
              onClick={createInvite}
              disabled={creating}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 text-sm"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Generate invite
            </button>
          </div>
          <div className="divide-y divide-border max-h-96 overflow-y-auto">
            {invites.length === 0 && <p className="py-4 text-sm text-muted-foreground">No invites yet. Generate one to let users register.</p>}
            {invites.map((inv) => (
              <div key={inv.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <code className="text-sm font-mono">{inv.code}</code>
                  {inv.note && <span className="text-xs text-muted-foreground ml-2">{inv.note}</span>}
                  <div className="text-xs text-muted-foreground">
                    {inv.usedById ? `Used ${new Date(inv.usedAt!).toLocaleDateString()}` : "Available"}
                  </div>
                </div>
                {!inv.usedById && (
                  <button
                    onClick={() => copyCode(inv.code)}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-secondary rounded hover:bg-secondary/80 shrink-0"
                  >
                    {copied === inv.code ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    Copy
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
