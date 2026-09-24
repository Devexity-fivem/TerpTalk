import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { signInHref } from "@/lib/callback-url"
import { requireStaff } from "@/lib/require-staff"
import { isAdmin } from "@/lib/security"
import { getOpsData } from "@/lib/ops-metrics"
import AdminRefresh from "@/components/admin-refresh"

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

function Alert({ label, count, href }: { label: string; count: number; href: string }) {
  const hot = count > 0
  return (
    <Link
      href={href}
      className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm transition-colors ${
        hot
          ? "border-warning/40 bg-warning/10 text-foreground hover:bg-warning/15"
          : "border-border/70 bg-card text-muted-foreground hover:bg-secondary/60"
      }`}
    >
      <span>{label}</span>
      <span className={`font-semibold tabular-nums ${hot ? "text-warning" : ""}`}>{count}</span>
    </Link>
  )
}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border/60 bg-card/40 p-4 md:p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

export default async function AdminOverviewPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) redirect(signInHref("/admin"))
  const staff = await requireStaff()
  if (!staff) notFound() // layout is the gate; this is belt-and-suspenders
  const admin = isAdmin(staff.role)

  const d = await getOpsData()
  const openReports = d.trust.reportsByStatus.PENDING ?? 0
  const reviewing = d.trust.reportsByStatus.REVIEWING ?? 0
  const newFeedback = Object.entries(d.feedback.byStatus).find(([s]) => s === "NEW")?.[1] ?? 0

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <AdminRefresh />
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold font-display">Overview</h1>
          <p className="text-sm text-muted-foreground">What is happening on TerpTalk right now — real counts, no projections.</p>
        </div>
        <div className="text-xs text-muted-foreground">
          Updated {d.generatedAt.toLocaleTimeString()} · refreshes every 90s
        </div>
      </div>

      {/* TOP — things that may need action right now */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Alert label="Open reports" count={openReports} href="/moderation" />
        <Alert label="Under review" count={reviewing} href="/moderation" />
        <Alert label="Abuse flags" count={d.trust.pendingFlags} href="/moderation" />
        {admin ? (
          <Alert label="New feedback" count={newFeedback} href="/admin/manage?tab=feedback" />
        ) : (
          <Alert label="Unanswered" count={d.unanswered.length} href="/admin/community" />
        )}
      </div>

      {/* Community snapshot — staff */}
      <Section
        title="Community — last 7 days"
        aside={<Link href="/admin/community" className="text-xs text-primary hover:underline">Community center →</Link>}
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Unique contributors" value={d.health.uniqueContributors7d} />
          <Stat label="New discussions" value={d.health.newThreads7d} />
          <Stat label="Replies" value={d.health.newReplies7d} />
          <Stat label="Diary updates" value={d.health.diaryUpdates7d} />
          <Stat label="Chat messages" value={d.health.chatMessages7d} />
          <Stat label="New members" value={d.health.newMembers7d} />
          <Stat label="Returning members" value={d.health.returningMembers7d} hint="seen this week, account >1d old" />
          <Stat label="Active public grows" value={d.grow.activePublicDiaries} />
        </div>
      </Section>

      {/* Growth snapshot — admin only */}
      {admin && (
        <Section
          title="Activation — last 7 days"
          aside={<Link href="/admin/growth" className="text-xs text-primary hover:underline">Growth center →</Link>}
        >
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <Stat label="Signed up" value={d.funnel7d.signups} />
            <Stat label="Onboarded" value={d.funnel7d.onboardingCompleted} />
            <Stat label="First contribution" value={d.funnel7d.activated} />
            <Stat label="Returned ≥24h" value={d.funnel7d.returned24h} />
            <Stat label="Referred signups" value={d.funnel7d.referredSignups} />
            <Stat label="Referred activated" value={d.funnel7d.referredActivated} />
          </div>
        </Section>
      )}

      {/* Unanswered — staff */}
      <Section title="Unanswered discussions" aside={<Link href="/admin/community" className="text-xs text-primary hover:underline">All unanswered →</Link>}>
        {d.unanswered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No unanswered discussions.</p>
        ) : (
          <ul className="divide-y divide-border/50">
            {d.unanswered.slice(0, 5).map((t) => (
              <li key={t.id} className="py-2 flex items-center gap-3 text-sm">
                <span className="text-muted-foreground tabular-nums w-10 shrink-0">{t.ageHours < 1 ? "<1h" : t.ageHours < 48 ? `${t.ageHours}h` : `${Math.floor(t.ageHours / 24)}d`}</span>
                <Link href={`/forum/thread/${t.slug}`} className="font-medium hover:text-primary truncate">{t.title}</Link>
                <span className="ml-auto text-xs text-muted-foreground shrink-0">{t.category} · {t.author}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Trust & safety — staff */}
      <Section title="Trust & safety" aside={<Link href="/moderation" className="text-xs text-primary hover:underline">Moderation queue →</Link>}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Reports pending" value={openReports} />
          <Stat label="Reports reviewing" value={reviewing} />
          <Stat label="Abuse flags open" value={d.trust.pendingFlags} />
          <Stat label="Mod actions (7d)" value={d.trust.moderationActions7d} />
          <Stat label="Banned accounts" value={d.trust.bannedUsers} />
          <Stat label="Suspended now" value={d.trust.suspendedNow} />
        </div>
      </Section>

      {/* Product usage + reliability — admin only */}
      {admin && (
        <>
          <Section title="Product usage — last 7 days">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="TerpBot commands" value={d.bot.commands7d} />
              <Stat label="Members assisted" value={d.bot.membersAssisted7d} />
              <Stat label="Experiments total" value={d.grow.experimentsTotal} />
              <Stat label="Experiment follow-ups" value={d.grow.experimentFollowUps7d} />
              <Stat label="Harvests (7d)" value={d.grow.harvested7d} hint={`${d.grow.harvestedTotal} all-time`} />
            </div>
          </Section>

          <Section title="Reliability" aside={<Link href="/admin/system" className="text-xs text-primary hover:underline">System center →</Link>}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Cron tasks done today" value={d.cron.tasksDone} />
              <Stat label="Cron tasks pending" value={d.cron.tasksPending.length} hint={d.cron.tasksPending.join(", ") || undefined} />
              <Stat label="Rate-limit hits (7d)" value={d.security.rateLimitTotal7d} />
              <Stat label="Security events (7d)" value={d.security.eventsByType7d.reduce((s, e) => s + e.count, 0)} />
            </div>
            <p className="text-[11px] text-muted-foreground mt-3">
              Last cron activity: {d.cron.lastRunDate ?? "never"} · Runtime errors: Vercel dashboard → terp-talk → Logs.
            </p>
          </Section>
        </>
      )}
    </main>
  )
}
