import { notFound } from "next/navigation"
import Link from "next/link"
import { requireAdmin } from "@/lib/require-staff"
import { getOpsData, getGrowthDetail, type FunnelWindow } from "@/lib/ops-metrics"
import { activationReport } from "@/lib/activation"
import type { SourceCount } from "@/lib/product-events"

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
    ["— posted a moment", funnel.firstMoment],
    ["— commented on a moment", funnel.firstMomentComment],
    ["Returned ≥24h later", funnel.returned24h],
    ["Returned ≥7d later", funnel.returned7d],
  ]
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-95">
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
    </div>
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

// Small-sample convention: percentages are only shown at n≥5 — the same
// suppression rule the first-action table already uses.
function PctCell({ num, den, pct }: { num: number; den: number; pct: number | null }) {
  if (den === 0) return <span className="text-muted-foreground">—</span>
  if (den < 5) return <span className="text-muted-foreground">n={den} — too small</span>
  return <span>{pct !== null ? `${pct}%` : "—"} ({num}/{den})</span>
}

function SourceChips({ rows }: { rows: SourceCount[] }) {
  if (!rows.length) return <span className="text-muted-foreground">none yet</span>
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {rows.map((r) => (
        <span key={r.source} className="text-xs px-2 py-0.5 rounded-md bg-secondary text-muted-foreground">
          {r.source} <span className="font-semibold text-foreground tabular-nums">{r.count}</span>
        </span>
      ))}
    </span>
  )
}

// Conversion endpoints are milestone keys — label them from the step
// ladder where one exists, else a purpose-written description.
const CONV_LABELS: Record<string, string> = {
  signup: "signed up",
  onboarding: "completed onboarding",
  firstGrow: "started a grow",
  firstContributionBeyondGrow: "contributed beyond the grow",
  firstContribution: "made a first contribution",
  firstReturn: "came back ≥24h later",
  secondAction: "contributed after returning",
  firstHarvest: "recorded a harvest",
  responseCapable: "published reply-able content",
  firstResponseReceived: "received a response",
}
const convLabel = (k: string) => CONV_LABELS[k] ?? k

type ActivationReportShape = Awaited<ReturnType<typeof activationReport>>

// Push stages labelled by the exact underlying event — permission, send
// attempt, and click are deliberately not conflated.
const PUSH_STAGES: [string, keyof ActivationReportShape["push"]][] = [
  ["Prompt shown", "promptShown"],
  ["Permission granted", "granted"],
  ["Permission denied", "denied"],
  ["Notifications sent", "sent"],
  ["Deliveries failed", "failed"],
  ["Notifications clicked", "clicked"],
  ["Subscriptions removed", "removed"],
]

// Growth center — administrator only. Funnel + first-action analysis +
// referral attribution + feedback signals. Aggregate counts only; factual
// observations are listed with their sample sizes, never as instructions.
export default async function AdminGrowthPage() {
  const admin = await requireAdmin()
  if (!admin) notFound()
  const [d, g, act] = await Promise.all([getOpsData(), getGrowthDetail(), activationReport(30)])
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-110">
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
          </div>
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

      {/* ── Activation report — durable-state milestone model ─────── */}
      <section className="rounded-2xl border border-border/60 bg-card/40 p-4 md:p-5">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-1">
          Milestone ladder — {act.windowDays}d signup cohort
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          Derived from durable state for the {act.cohort} members who signed up in the window
          {act.truncated ? " (cohort truncated at the analysis cap — earlier signups in the window are not included)" : ""}.
          Each milestone counts a member once, at its earliest qualifying timestamp.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-95">
            <tbody>
              {act.steps.map((s) => (
                <tr key={s.key} className="border-b border-border/40 last:border-0">
                  <td className="py-1.5 text-muted-foreground">{s.label}</td>
                  <td className="py-1.5 text-right tabular-nums font-medium">{s.count}</td>
                  <td className="py-1.5 text-right tabular-nums text-muted-foreground w-16">
                    {act.cohort > 0 ? `${s.pctOfSignups}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-border/60 bg-card/40 p-4 md:p-5">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-1">
          Step conversions
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          Each row is a share of the members eligible for that step — not a share of signups.
          Rates hide below n=5.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-110">
            <tbody>
              {act.conversions.map((c) => (
                <tr key={`${c.from}-${c.to}`} className="border-b border-border/40 last:border-0">
                  <td className="py-1.5 text-muted-foreground">
                    {convLabel(c.from)} → {convLabel(c.to)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    <PctCell num={c.numerator} den={c.denominator} pct={c.pct} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <section className="rounded-2xl border border-border/60 bg-card/40 p-4 md:p-5">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Return by first contribution
          </h2>
          <p className="text-xs text-muted-foreground mb-3">
            Grouped by the kind of a member&apos;s earliest contribution. Association only —
            the contribution type may not have caused the return.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1.5 font-medium">First contribution</th>
                <th className="py-1.5 text-right font-medium">Members</th>
                <th className="py-1.5 text-right font-medium">Returned ≥24h</th>
              </tr>
            </thead>
            <tbody>
              {act.returnByFirstAction.map((r) => (
                <tr key={r.kind} className="border-t border-border/40">
                  <td className="py-1.5">{r.kind === "none" ? "no contribution yet" : r.kind}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.members}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    <PctCell num={r.returned} den={r.members} pct={r.pct} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="rounded-2xl border border-border/60 bg-card/40 p-4 md:p-5">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Return by push status
          </h2>
          <p className="text-xs text-muted-foreground mb-3">
            Push-enabled = live subscription or a recorded permission grant.
            Association only — members who enable push may already be more engaged.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1.5 font-medium">Push</th>
                <th className="py-1.5 text-right font-medium">Members</th>
                <th className="py-1.5 text-right font-medium">Returned ≥24h</th>
              </tr>
            </thead>
            <tbody>
              {act.returnByPush.map((r) => (
                <tr key={String(r.pushEnabled)} className="border-t border-border/40">
                  <td className="py-1.5">{r.pushEnabled ? "enabled" : "not enabled"}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.members}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    <PctCell num={r.returned} den={r.members} pct={r.pct} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="rounded-2xl border border-border/60 bg-card/40 p-4 md:p-5">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-1">
          Push lifecycle — {act.windowDays}d events
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          Event counts per stage, not a strict funnel. &quot;Sent&quot; means handed to the push
          service — not confirmed delivered on-device; &quot;clicked&quot; is the only verified
          delivery evidence.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {PUSH_STAGES.map(([label, key]) => (
            <Card key={key} label={label} value={act.push[key]} />
          ))}
        </div>
      </section>

      {/* ── Social loop — ProductEvent telemetry, not the signup cohort ── */}
      <section className="rounded-2xl border border-border/60 bg-card/40 p-4 md:p-5">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-1">
          Social loop — {act.social.windowDays}d telemetry window
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          Event-attributed surface metrics (which surface a follow or interaction came from) —
          a different basis than the signup-cohort milestones above. &quot;unknown&quot; means the
          action carried no surface attribution. Moment telemetry exists only since Moments
          instrumentation shipped; earlier activity is not visible here.
          {act.social.truncated ? " Some inputs hit the analysis cap — treat as a lower bound." : ""}
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <Card label="Follows created" value={act.social.follows} />
          <Card label="First follows (any kind)" value={act.social.firstFollowsAnyKind} />
          <Card label="First grower follows" value={act.social.firstGrowerFollows} />
          <Card label="Followed-content viewers" value={act.social.followedContentViewers} hint="distinct members" />
          <Card label="Digest viewers" value={act.social.digestViewers} hint="distinct members" />
          <Card label="Interactions posted" value={act.social.interactions} hint="replies, comments, moments, reactions" />
          <Card
            label="Interacted on followed grower"
            value={act.social.followedInteractors}
            hint="distinct members — follow state is current, not at-interaction"
          />
          <Card
            label="Grower-follower interaction rate"
            value={
              act.social.firstGrowerFollows < 5
                ? act.social.firstGrowerFollows === 0 ? "—" : `n=${act.social.firstGrowerFollows}`
                : act.social.growerFollowerInteractionRate !== null
                  ? `${act.social.growerFollowerInteractionRate}%`
                  : "—"
            }
            hint="of this window's first-grower-follow cohort"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground mb-1.5">Follows by surface</h3>
            <SourceChips rows={act.social.followsBySource} />
            <h3 className="text-xs font-semibold text-muted-foreground mt-3 mb-1.5">First follow (any kind) by surface</h3>
            <SourceChips rows={act.social.firstFollowAnyKindBySource} />
            <h3 className="text-xs font-semibold text-muted-foreground mt-3 mb-1.5">First grower follow by surface</h3>
            <SourceChips rows={act.social.firstGrowerFollowBySource} />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground mb-1.5">Interactions by surface</h3>
            <SourceChips rows={act.social.interactionsBySource} />
            <h3 className="text-xs font-semibold text-muted-foreground mt-3 mb-1.5">Followed-content views by surface</h3>
            <SourceChips rows={act.social.followedContentViewsBySource} />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mt-4">
          Median signup → first grower follow:{" "}
          {act.social.medianHoursSignupToFirstGrowerFollow !== null ? `${act.social.medianHoursSignupToFirstGrowerFollow}h` : "no data"} ·
          first grower follow → interaction:{" "}
          {act.social.medianHoursFirstGrowerFollowToInteraction !== null ? `${act.social.medianHoursFirstGrowerFollowToInteraction}h` : "no data"} ·
          encounter → interaction:{" "}
          {act.social.medianHoursEncounterToInteraction !== null ? `${act.social.medianHoursEncounterToInteraction}h` : "no data"}
        </p>
      </section>

      {/* ── Activation panel — CTA attempts + dismissals; completions
          live in the milestone ladder above, never duplicated here ── */}
      <section className="rounded-2xl border border-border/60 bg-card/40 p-4 md:p-5">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-1">
          Activation panel — {act.windowDays}d window
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          CTA clicks are attempts, deduped per member·milestone·day. Completions
          are the milestone-ladder steps above — never derived from clicks.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Card label="CTA clicks" value={act.panel.ctaClicks} hint="attempts, not completions" />
          <Card label="Panel dismissals" value={act.panel.dismissals} />
          <Card label="Milestones clicked" value={act.panel.ctaByMilestone.length} />
        </div>
        {act.panel.ctaByMilestone.length > 0 && (
          <div className="mt-3">
            <SourceChips rows={act.panel.ctaByMilestone.map((r) => ({ source: r.milestone, count: r.clicks }))} />
          </div>
        )}
      </section>

      <p className="text-[11px] text-muted-foreground">
        Generated {g.generatedAt.toISOString()} · activation report {act.generatedAt} · live aggregates, not sampled.
      </p>
    </main>
  )
}
