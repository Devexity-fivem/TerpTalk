import { notFound } from "next/navigation"
import { requireAdmin } from "@/lib/require-staff"
import { getOpsData, type FunnelWindow } from "@/lib/ops-metrics"

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

// Growth center — administrator only. The activation funnel plus referral
// attribution, all as aggregate counts. No per-user surveillance.
export default async function AdminGrowthPage() {
  const admin = await requireAdmin()
  if (!admin) notFound()
  const d = await getOpsData()

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold font-display">Growth</h1>
        <p className="text-sm text-muted-foreground">
          Acquisition → activation → return. Activation = member made at least one real contribution
          (thread, reply, diary, diary update, setup, or chat message).
        </p>
      </div>

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
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Referrals</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-xl border border-border/70 bg-card px-4 py-3">
            <div className="text-2xl font-semibold tabular-nums">{d.funnel30d.referredSignups}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Referred signups (30d)</div>
          </div>
          <div className="rounded-xl border border-border/70 bg-card px-4 py-3">
            <div className="text-2xl font-semibold tabular-nums">{d.funnel30d.referredActivated}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Referred &amp; activated (30d)</div>
          </div>
          <div className="rounded-xl border border-border/70 bg-card px-4 py-3">
            <div className="text-2xl font-semibold tabular-nums">
              {d.funnel30d.referredSignups > 0 ? `${Math.round((d.funnel30d.referredActivated / d.funnel30d.referredSignups) * 100)}%` : "—"}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">Referral activation rate</div>
          </div>
          <div className="rounded-xl border border-border/70 bg-card px-4 py-3">
            <div className="text-2xl font-semibold tabular-nums">{d.funnel7d.referredSignups}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Referred signups (7d)</div>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">
          Payout reconciliation lives under Manage → overview (referral pipeline card). Counts are
          aggregate; individual referral chains are only inspected for fraud handling.
        </p>
      </section>

      <p className="text-[11px] text-muted-foreground">Generated {d.generatedAt.toISOString()} · live aggregates, not sampled.</p>
    </main>
  )
}
