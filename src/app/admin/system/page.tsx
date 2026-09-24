import { notFound } from "next/navigation"
import Link from "next/link"
import { requireAdmin } from "@/lib/require-staff"
import { getOpsData } from "@/lib/ops-metrics"

export const dynamic = "force-dynamic"

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card px-4 py-3">
      <div className="text-2xl font-semibold font-display tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
      {hint && <div className="text-[11px] text-muted-foreground/70 mt-0.5">{hint}</div>}
    </div>
  )
}

// System center — administrator only. Cron health, aggregate rate-limit and
// security-event counters, TerpBot operational state. Aggregates only: no
// IPs, no hashes, no message bodies.
export default async function AdminSystemPage() {
  const admin = await requireAdmin()
  if (!admin) notFound()
  const d = await getOpsData()

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold font-display">System</h1>
        <p className="text-sm text-muted-foreground">Is anything broken right now — cron, rate limits, security events, TerpBot.</p>
      </div>

      <section className="rounded-2xl border border-border/60 bg-card/40 p-4 md:p-5">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Reliability</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Cron tasks done today" value={d.cron.tasksDone} />
          <Stat
            label="Cron tasks pending"
            value={d.cron.tasksPending.length}
            hint={d.cron.tasksPending.join(", ") || undefined}
          />
          <Stat label="Last cron activity" value={d.cron.lastRunDate ?? "never"} />
          <Stat label="Rate-limit hits (7d)" value={d.security.rateLimitTotal7d} />
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">
          Runtime errors and request logs: Vercel dashboard → terp-talk → Logs.
          Upload failures and realtime issues surface as member feedback + runtime logs.
        </p>
      </section>

      <section className="rounded-2xl border border-border/60 bg-card/40 p-4 md:p-5">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-1">Rate limits &amp; security — 7 days</h2>
        <p className="text-xs text-muted-foreground mb-3">Aggregated endpoint counts only — no IPs, no identities.</p>
        {d.security.rateLimitHits7d.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rate-limit events in the window.</p>
        ) : (
          <table className="w-full text-sm mb-4">
            <tbody>
              {d.security.rateLimitHits7d.map((r) => (
                <tr key={r.endpoint} className="border-b border-border/40 last:border-0">
                  <td className="py-1.5 font-mono text-xs">{r.endpoint}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="flex gap-2 flex-wrap">
          {d.security.eventsByType7d.map((e) => (
            <span key={e.type} className="text-[11px] px-2 py-1 rounded-lg bg-secondary text-muted-foreground">
              {e.type} · <span className="font-semibold text-foreground tabular-nums">{e.count}</span>
            </span>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border/60 bg-card/40 p-4 md:p-5">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          TerpBot — last 7 days
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <Stat label="Commands served" value={d.bot.commands7d} />
          <Stat label="Members assisted" value={d.bot.membersAssisted7d} />
          <Stat label="Announcements" value={d.bot.announcements7d} />
          <Stat label="Days active" value={d.bot.daysActive7d} hint={d.bot.lastEventAt ? `last event ${d.bot.lastEventAt.toLocaleString()}` : "no events"} />
        </div>
        {d.bot.byCommand7d.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {d.bot.byCommand7d.map((c) => (
              <span key={c.command} className="text-[11px] px-2 py-1 rounded-lg bg-secondary text-muted-foreground">
                /{c.command} · <span className="font-semibold text-foreground tabular-nums">{c.count}</span>
              </span>
            ))}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground mt-3">
          Full registry + self-checks: <Link href="/admin/manage?tab=terpbot" className="text-primary hover:underline">Manage → TerpBot</Link>
        </p>
      </section>

      <p className="text-[11px] text-muted-foreground">Generated {d.generatedAt.toISOString()} · live aggregates, not sampled.</p>
    </main>
  )
}
