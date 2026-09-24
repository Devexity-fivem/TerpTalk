import { notFound } from "next/navigation"
import Link from "next/link"
import { requireAdmin } from "@/lib/require-staff"
import { getOpsData, getGrowthDetail, type FunnelWindow } from "@/lib/ops-metrics"

export const dynamic = "force-dynamic"

function FunnelTable({ funnel }: { funnel: FunnelWindow }) {
  const pct = (n: number) => (funnel.signups > 0 ? `${Math.round((n / funnel.signups) * 100)}%` : "—")
  const rows: [string, number][] = [
    ["Signed up", funnel.signups],
    ["Completed onboarding", funnel.onboardingCompleted],
    ["First contribution (activation)", funnel.activated],
    ["— started a grow diary", funnel.firstDiary],
    ["— started a discussion", funnel.firstThread],
    ["— replied", funnel.firstReply],
    ["— published a setup", funnel.firstSetup],
    ["— sent a chat message", funnel.firstChatMessage],
    ["Returned ≥24h later", funnel.returned24h],
    ["Returned ≥7d later", funnel.returned7d],
  ]
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map(([label, n]) => (
          <tr key={label} className="border-b border-border/40 last:border-0">
            <td className="py-2 text-muted-foreground">{label}</td>
            <td className="py-2 text-right tabular-nums font-medium">{n}</td>
            <td className="py-2 text-right tabular-nums text-muted-foreground w-16">{pct(n)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Card({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card px-4 py-3">
      <div className="text-2xl font-semibold font-display tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
      {hint && <div className="text-[11px] text-muted-foreground/70 mt-0.5">{hint}</div>}
    </div>
  )
}

// Growth center — administrator only. Funnel + first-action analysis +
// referral attribution + feedback signals. Aggregate counts only; factual
// observations are listed with their sample sizes, never as instructions.
export default async function AdminGrowthPage() {
  const admin = await requireAdmin()
  if (!admin) notFound()
  const [d, g] = await Promise.all([getOpsData(), getGrowthDetail()])
  const fa = g.firstAction30d

  // Factual observations — each carries its sample; suppressed below n=5.
  const observations: string[] = []
  const topFirst = fa.byFirstAction[0]
  if (topFirst && fa.sampleSize >= 5)
    observations.push(`Most common first contribution (30d): ${topFirst.type} — ${topFirst.count} of ${fa.sampleSize} contributing members.`)
  for (const r of fa.byFirstAction)
    if (r.returnedPct !== null)
      observations.push(`Members whose first recorded contribution was ${r.type}: ${r.returnedPct}% returned ≥24h later (n=${r.count}).`)
  if (d.funnel30d.referredSignups >= 5)
    observations.push(`Referred members are ${d.funnel30d.referredSignups} of ${d.funnel30d.signups} signups (30d); ${d.funnel30d.referredActivated} contributed.`)
  if (g.feedback.oldestOpenDays !== null && g.feedback.oldestOpenDays >= 3)
    observations.push(`Oldest open feedback is ${g.feedback.oldestOpenDays} days old.`)
  if (!observations.length)
    observations.push("Not enough data yet for factual observations — every number here shows its n.")

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold font-display">Growth</h1>
        <p className="text-sm text-muted-foreground">
          Acquisition → activation → return. Activation = member made at least one real contribution.
          Observations are facts with sample sizes — the decision is yours.
        </p>
      </div>

      <section className="rounded-2xl border border-border/60 bg-card/40 p-4 md:p-5">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">Observations</h2>
        <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-5">
          {observations.map((o) => <li key={o}>{o}</li>)}
        </ul>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <section className="rounded-2xl border border-border/60 bg-card/40 p-4 md:p-5">
          <h2 className="font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Last 7 days</h2>
          <FunnelTable funnel={d.funnel7d} />
        </section>
        <section className="rounded-2xl border border-border/60 bg-card/40 p-4 md:p-5">
          <h2 className="font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Last 30 days</h2>
          <FunnelTable funnel={d.funnel30d} />
        </section>
      </div>

      <section className="rounded-2xl border border-border/60 bg-card/40 p-4 md:p-5">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-1">
          First contribution — 30d signups
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          Earliest recorded contribution per member (n={fa.sampleSize} of {fa.signupsInWindow} signups contributed).
          Return rates are shown only when n≥5 — correlation, not causation.
        </p>
        {fa.byFirstAction.length === 0 ? (
          <p className="text-sm text-muted-foreground">No contributions yet in this window.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1.5 font-medium">First action</th>
                <th className="py-1.5 text-right font-medium">Members</th>
                <th className="py-1.5 text-right font-medium">Returned ≥24h</th>
              </tr>
            </thead>
            <tbody>
              {fa.byFirstAction.map((r) => (
                <tr key={r.type} className="border-t border-border/40">
                  <td className="py-1.5">{r.type}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.count}</td>
                  <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                    {r.returnedPct !== null ? `${r.returnedPct}%` : `n=${r.count} — too small`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {fa.paths.length > 0 && (
        <section className="rounded-2xl border border-border/60 bg-card/40 p-4 md:p-5">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-1">Common next steps</h2>
          <p className="text-xs text-muted-foreground mb-3">
            First contribution → second contribution (aggregate approximation — ordered by earliest recorded event per surface).
          </p>
          <div className="flex gap-2 flex-wrap">
            {fa.paths.map((p) => (
              <span key={`${p.first}${p.then}`} className="text-xs px-2.5 py-1.5 rounded-lg bg-secondary text-muted-foreground">
                {p.first} → {p.then} · <span className="font-semibold text-foreground tabular-nums">{p.count}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-border/60 bg-card/40 p-4 md:p-5">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Referrals</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card label="Referred signups (30d)" value={d.funnel30d.referredSignups} />
          <Card label="Referred & activated (30d)" value={d.funnel30d.referredActivated} />
          <Card
            label="Referral activation rate"
            value={d.funnel30d.referredSignups > 0 ? `${Math.round((d.funnel30d.referredActivated / d.funnel30d.referredSignups) * 100)}%` : "—"}
          />
          <Card label="Referred signups (7d)" value={d.funnel7d.referredSignups} />
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">
          Payout reconciliation lives under Manage → overview (referral pipeline card). Counts are
          aggregate; individual referral chains are only inspected for fraud handling.
        </p>
      </section>

      <section className="rounded-2xl border border-border/60 bg-card/40 p-4 md:p-5">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-1">
          Feedback signals
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          {g.feedback.total} items, {g.feedback.open} open
          {g.feedback.oldestOpenDays !== null ? `, oldest open ${g.feedback.oldestOpenDays}d` : ""}.
          Most-reported surfaces are facts, not verdicts.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground mb-1.5">Most reported surfaces</h3>
            {g.feedback.topRoutes.length === 0
              ? <p className="text-xs text-muted-foreground">No route data yet.</p>
              : g.feedback.topRoutes.slice(0, 6).map((r) => (
                <div key={r.route} className="flex justify-between text-xs py-1">
                  <span className="font-mono truncate mr-2">{r.route}</span>
                  <span className="tabular-nums font-medium">{r.count}</span>
                </div>
              ))}
          </div>
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground mb-1.5">By type</h3>
            {g.feedback.byType.map((t) => (
              <div key={t.type} className="flex justify-between text-xs py-1">
                <span>{t.type}</span><span className="tabular-nums font-medium">{t.count}</span>
              </div>
            ))}
          </div>
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground mb-1.5">By device class</h3>
            {g.feedback.byDevice.map((t) => (
              <div key={t.device} className="flex justify-between text-xs py-1">
                <span>{t.device}</span><span className="tabular-nums font-medium">{t.count}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">
          Full workflow: <Link href="/admin/manage?tab=feedback" className="text-primary hover:underline">Manage → Feedback</Link>
        </p>
      </section>

      <p className="text-[11px] text-muted-foreground">Generated {g.generatedAt.toISOString()} · live aggregates, not sampled.</p>
    </main>
  )
}
