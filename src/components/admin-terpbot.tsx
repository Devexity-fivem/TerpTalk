"use client"

import { useEffect, useState } from "react"
import { Loader2, Bot, CheckCircle2, XCircle } from "lucide-react"

interface BotStats {
  commands: number
  mentions: number
  membersAssisted: number
  entityLinks: number
  welcomes: number
  announcements: number
  daysActive: number
  unknownCommands: number
  fallbacks: number
  refusals: number
  helps: number
  assists: number
  byCommand: Record<string, number>
  byAnnouncement: Record<string, number>
  byAssist: Record<string, number>
}

interface TerpbotData {
  stats: BotStats
  checks: { name: string; ok: boolean; detail: string }[]
  registry: { public: number; mentionable: number }
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-3">
      <div className="text-lg font-bold leading-tight">{value}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{label}</div>
    </div>
  )
}

function Breakdown({ title, rows }: { title: string; rows: Record<string, number> }) {
  const entries = Object.entries(rows).sort((a, b) => b[1] - a[1])
  if (!entries.length) return null
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      <div className="space-y-1">
        {entries.slice(0, 10).map(([k, v]) => (
          <div key={k} className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground truncate mr-2">/{k}</span>
            <span className="font-medium shrink-0">{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function AdminTerpBot() {
  const [data, setData] = useState<TerpbotData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/admin/terpbot")
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text())
        return r.json()
      })
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
  }
  if (error || !data) {
    return <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg text-sm">Failed to load TerpBot stats.</div>
  }

  const { stats, checks, registry } = data
  const failedChecks = checks.filter((c) => !c.ok)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Bot className="w-4 h-4 text-primary" />
        Deterministic community engine — {registry.public} public commands, {registry.mentionable} reachable via @terpbot.
      </div>

      {/* Health */}
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="text-sm font-semibold mb-3">
          Health {failedChecks.length === 0
            ? <span className="text-primary font-normal">— all checks pass</span>
            : <span className="text-destructive font-normal">— {failedChecks.length} failing</span>}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {checks.map((c) => (
            <div key={c.name} className="flex items-start gap-2 text-sm">
              {c.ok
                ? <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                : <XCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />}
              <div>
                <div className="font-medium leading-tight">{c.name}</div>
                <div className="text-xs text-muted-foreground">{c.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Usage */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Usage</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <Stat label="Commands answered" value={stats.commands} />
          <Stat label="Via @terpbot" value={stats.mentions} />
          <Stat label="Members assisted" value={stats.membersAssisted} />
          <Stat label="Knowledge links surfaced" value={stats.entityLinks} />
          <Stat label="Days active" value={stats.daysActive} />
        </div>
      </div>

      {/* Reliability */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Reliability</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <Stat label="Unknown commands" value={stats.unknownCommands} />
          <Stat label="Mention fallbacks" value={stats.fallbacks} />
          <Stat label="Refusals" value={stats.refusals} />
          <Stat label="Help hints" value={stats.helps} />
          <Stat label="Assists delivered" value={stats.assists} />
        </div>
      </div>

      {/* Activity */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Activity</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <Stat label="Announcements" value={stats.announcements} />
          <Stat label="Welcomes" value={stats.welcomes} />
          <Stat label="Assists" value={stats.assists} />
        </div>
      </div>

      {/* Breakdowns */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Breakdown title="Top commands" rows={stats.byCommand} />
        <Breakdown title="Announcements" rows={stats.byAnnouncement} />
        <Breakdown title="Assists" rows={stats.byAssist} />
      </div>
    </div>
  )
}
