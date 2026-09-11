"use client"

import { useEffect, useState, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { ShieldCheck, Loader2, Search, ScrollText } from "lucide-react"

interface AuditEvent {
  id: string
  kind: "moderation" | "security"
  type: string
  reason: string
  actor: string
  targetId: string | null
  duration?: number | null
  metadata?: string | null
  createdAt: string
}

export default function AdminAuditPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const role = (session?.user as { role?: string })?.role

  const [events, setEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  const load = useCallback(() => {
    const params = new URLSearchParams()
    if (q) params.set("q", q)
    if (from) params.set("from", from)
    if (to) params.set("to", to)
    setLoading(true)
    fetch(`/api/admin/audit?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) return { events: [] }
        return res.json()
      })
      .then((d) => setEvents(d.events || []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false))
  }, [q, from, to])

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/signin")
    } else if (status === "authenticated") {
      const t = setTimeout(() => load(), 0)
      return () => clearTimeout(t)
    }
  }, [status, router, load])

  if (status === "loading" || loading && events.length === 0) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
  }

  if (role !== "ADMINISTRATOR") {
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
        <div className="flex items-center gap-3 mb-6">
          <ScrollText className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Audit Log</h1>
            <p className="text-muted-foreground text-sm">Moderation actions and security events</p>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border p-4 mb-6 flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load()}
              placeholder="Search action, actor, or reason..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="px-3 py-2 rounded-lg border border-border bg-background text-sm"
          />
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="px-3 py-2 rounded-lg border border-border bg-background text-sm"
          />
          <button onClick={load} className="px-4 py-2 bg-secondary rounded-lg text-sm hover:bg-secondary/80">Search</button>
        </div>

        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="divide-y divide-border">
            {events.length === 0 && <p className="p-6 text-sm text-muted-foreground">No audit events found.</p>}
            {events.map((e) => (
              <div key={e.id} className="p-4 flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${e.kind === "security" ? "bg-amber-500/15 text-amber-500" : "bg-primary/15 text-primary"}`}>
                      {e.kind}
                    </span>
                    <span className="text-sm font-medium">{e.type.replace(/_/g, " ")}</span>
                    <span className="text-xs text-muted-foreground">by @{e.actor}</span>
                  </div>
                  {e.reason && <p className="text-sm text-muted-foreground">{e.reason}</p>}
                  {e.metadata && <p className="text-xs text-muted-foreground mt-0.5 truncate">{e.metadata}</p>}
                </div>
                <span className="text-xs text-muted-foreground shrink-0">{new Date(e.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
