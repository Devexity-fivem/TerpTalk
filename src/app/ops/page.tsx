import type { Metadata } from "next"
import { redirect, notFound } from "next/navigation"
import { getServerSession } from "next-auth"
import Link from "next/link"
import { authOptions } from "@/lib/auth"
import { signInHref } from "@/lib/callback-url"
import { requireStaff } from "@/lib/require-staff"
import { buildMetadata } from "@/lib/seo"
import { getOpsData, type FunnelWindow } from "@/lib/ops-metrics"

export const metadata: Metadata = buildMetadata({
  title: "Ops",
  description: "TerpTalk operational overview.",
  robots: { index: false, follow: false },
})

export const dynamic = "force-dynamic"

function fmtAge(hours: number) {
  if (hours < 1) return "<1h"
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/60 px-4 py-3">
      <div className="text-2xl font-semibold font-display tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
      {hint && <div className="text-[11px] text-muted-foreground/70 mt-0.5">{hint}</div>}
    </div>
  )
}

function FunnelTable({ funnel }: { funnel: FunnelWindow }) {
  const pct = (n: number) => (funnel.signups > 0 ? `${Math.round((n / funnel.signups) * 100)}%` : "—")
  const rows: [string, number][] = [
    ["Signed up", funnel.signups],
    ["Completed onboarding", funnel.onboardingCompleted],
    ["First contribution (activation)", funnel.activated],
    ["— started a grow diary", funnel.firstDiary],
    ["— started a discussion", funnel.firstThread],
    ["— sent a chat message", funnel.firstChatMessage],
    ["Returned ≥24h later", funnel.returned24h],
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

export default async function OpsPage() {
  // Server-side staff gate — fresh role check, and non-staff get a 404 so
  // the surface's existence isn't advertised. Guests get the sign-in page.
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) redirect(signInHref("/ops"))
  const staff = await requireStaff()
  if (!staff) notFound()

  const data = await getOpsData()
  const { funnel7d, funnel30d, health, trust, security, feedback, cron } = data

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold">Operations</h1>
          <p className="text-sm text-muted-foreground mt-1">
            What is happening on TerpTalk right now — real counts, no projections.
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link href="/moderation" className="px-3 py-1.5 rounded-lg bg-card border border-border hover:bg-secondary transition-colors">Moderation</Link>
          {staff.role === "ADMINISTRATOR" && (
            <Link href="/admin" className="px-3 py-1.5 rounded-lg bg-card border border-border hover:bg-secondary transition-colors">Admin</Link>
          )}
        </div>
      </div>

      {/* Activation funnel */}
      <section className="rounded-2xl border border-border/70 bg-card/80 p-5">
        <h2 className="font-display font-semibold mb-1">Activation funnel</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Activation = member made at least one real contribution (thread, reply, diary, update, setup, or chat message).
        </p>
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Last 7 days</h3>
            <FunnelTable funnel={funnel7d} />
          </div>
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Last 30 days</h3>
            <FunnelTable funnel={funnel30d} />
          </div>
        </div>
      </section>

      {/* Community health */}
      <section className="rounded-2xl border border-border/70 bg-card/80 p-5">
        <h2 className="font-display font-semibold mb-4">Community — last 7 days</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <Stat label="Unique contributors" value={health.uniqueContributors7d} />
          <Stat label="New discussions" value={health.newThreads7d} />
          <Stat label="Replies" value={health.newReplies7d} />
          <Stat label="Diary updates" value={health.diaryUpdates7d} />
          <Stat label="Chat messages" value={health.chatMessages7d} />
          <Stat label="New members" value={health.newMembers7d} />
          <Stat label="Returning members" value={health.returningMembers7d} hint="seen this week, account >1d old" />
          <Stat label="Open reports" value={health.openReports} />
        </div>
      </section>

      {/* Unanswered questions */}
      <section className="rounded-2xl border border-border/70 bg-card/80 p-5">
        <h2 className="font-display font-semibold mb-1">Unanswered discussions</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Public threads with zero replies, oldest first — where the community needs attention.
        </p>
        {data.unanswered.length === 0 ? (
          <p className="text-sm text-muted-foreground">Every discussion has at least one reply.</p>
        ) : (
          <ul className="divide-y divide-border/40">
            {data.unanswered.map((t) => (
              <li key={t.id} className="py-2.5 flex items-center gap-3 text-sm">
                <span className="tabular-nums text-muted-foreground w-10 shrink-0">{fmtAge(t.ageHours)}</span>
                <Link href={`/forum/thread/${t.slug}`} className="font-medium hover:text-primary transition-colors truncate">
                  {t.title}
                </Link>
                {t.isQuestionCategory && (
                  <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-warning/15 text-warning font-medium">question</span>
                )}
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{t.category} · {t.author}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Trust & safety */}
        <section className="rounded-2xl border border-border/70 bg-card/80 p-5">
          <h2 className="font-display font-semibold mb-4">Trust &amp; safety</h2>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Reports pending" value={trust.reportsByStatus.PENDING ?? 0} />
            <Stat label="Reports reviewing" value={(trust.reportsByStatus.REVIEWING ?? 0) + (trust.reportsByStatus.ESCALATED ?? 0)} />
            <Stat label="Abuse flags open" value={trust.pendingFlags} />
            <Stat label="Mod actions (7d)" value={trust.moderationActions7d} />
            <Stat label="Banned accounts" value={trust.bannedUsers} />
            <Stat label="Suspended now" value={trust.suspendedNow} />
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            <Link href="/moderation" className="text-primary hover:underline">Open the moderation queue →</Link>
          </p>
        </section>

        {/* Feedback inbox */}
        <section className="rounded-2xl border border-border/70 bg-card/80 p-5">
          <h2 className="font-display font-semibold mb-4">Feedback inbox</h2>
          <div className="flex flex-wrap gap-2 mb-3">
            {feedback.newByType.length === 0 && <span className="text-sm text-muted-foreground">No new feedback.</span>}
            {feedback.newByType.map((f) => (
              <span key={f.type} className="text-xs px-2 py-1 rounded-full bg-secondary border border-border">
                {f.type} · {f.count}
              </span>
            ))}
          </div>
          <ul className="space-y-1.5 text-sm">
            {feedback.recentTitles.map((f) => (
              <li key={f.id} className="flex gap-2 text-muted-foreground">
                <span className="text-[10px] mt-0.5 px-1.5 py-0.5 rounded bg-secondary shrink-0">{f.type}</span>
                <span className="truncate">{f.title}</span>
              </li>
            ))}
          </ul>
          {staff.role === "ADMINISTRATOR" && (
            <p className="text-xs text-muted-foreground mt-3">
              <Link href="/admin" className="text-primary hover:underline">Triage in Admin → Feedback →</Link>
            </p>
          )}
        </section>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Rate limits / security */}
        <section className="rounded-2xl border border-border/70 bg-card/80 p-5">
          <h2 className="font-display font-semibold mb-1">Rate limits &amp; security — 7 days</h2>
          <p className="text-xs text-muted-foreground mb-4">Aggregated endpoint counts only — no IPs, no identities.</p>
          {security.rateLimitHits7d.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rate-limit events this week.</p>
          ) : (
            <table className="w-full text-sm mb-4">
              <tbody>
                {security.rateLimitHits7d.map((r) => (
                  <tr key={r.endpoint} className="border-b border-border/40 last:border-0">
                    <td className="py-1.5 text-muted-foreground font-mono text-xs">{r.endpoint}</td>
                    <td className="py-1.5 text-right tabular-nums">{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="flex flex-wrap gap-2">
            {security.eventsByType7d.map((e) => (
              <span key={e.type} className="text-[11px] px-2 py-1 rounded-full bg-secondary border border-border text-muted-foreground">
                {e.type} · {e.count}
              </span>
            ))}
          </div>
        </section>

        {/* Reliability */}
        <section className="rounded-2xl border border-border/70 bg-card/80 p-5">
          <h2 className="font-display font-semibold mb-4">Reliability</h2>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Cron tasks done today" value={cron.tasksDone} hint={`UTC ${cron.date}`} />
            <Stat label="Cron tasks pending" value={cron.tasksPending.length} />
          </div>
          {cron.tasksPending.length > 0 && (
            <p className="text-xs text-warning mt-3 font-mono">{cron.tasksPending.join(", ")}</p>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            Last cron activity: {cron.lastRunDate ?? "never"} · Runtime errors: Vercel dashboard → terp-talk → Logs.
          </p>
        </section>
      </div>

      <p className="text-[11px] text-muted-foreground/60">
        Generated {data.generatedAt.toISOString()} · counts are live DB aggregates, not sampled.
      </p>
    </main>
  )
}
