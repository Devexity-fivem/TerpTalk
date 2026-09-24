import { notFound } from "next/navigation"
import Link from "next/link"
import { requireStaff } from "@/lib/require-staff"
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

// Community health — raw counts over the last 7 days plus the unanswered
// queue. Staff-level: nothing here is private; counts only.
export default async function AdminCommunityPage() {
  const staff = await requireStaff()
  if (!staff) notFound()
  const d = await getOpsData()

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold font-display">Community</h1>
        <p className="text-sm text-muted-foreground">Contribution and grow activity — raw facts, 7-day window unless noted.</p>
      </div>

      <section className="rounded-2xl border border-border/60 bg-card/40 p-4 md:p-5">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Activity — last 7 days</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Unique contributors" value={d.health.uniqueContributors7d} />
          <Stat label="New discussions" value={d.health.newThreads7d} />
          <Stat label="Replies" value={d.health.newReplies7d} />
          <Stat label="Diary updates" value={d.health.diaryUpdates7d} />
          <Stat label="Chat messages" value={d.health.chatMessages7d} />
          <Stat label="New members" value={d.health.newMembers7d} />
          <Stat label="Returning members" value={d.health.returningMembers7d} hint="seen this week, account >1d old" />
          <Stat label="Open reports" value={d.health.openReports} />
        </div>
      </section>

      <section className="rounded-2xl border border-border/60 bg-card/40 p-4 md:p-5">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Grow documentation</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Active public grows" value={d.grow.activePublicDiaries} />
          <Stat label="Harvests all-time" value={d.grow.harvestedTotal} hint={`${d.grow.harvested7d} in last 7d`} />
          <Stat label="Experiments total" value={d.grow.experimentsTotal} />
          <Stat label="Experiment follow-ups (7d)" value={d.grow.experimentFollowUps7d} />
        </div>
        {Object.keys(d.grow.experimentsByStatus).length > 0 && (
          <div className="flex gap-4 mt-3 text-xs text-muted-foreground flex-wrap">
            {Object.entries(d.grow.experimentsByStatus).map(([s, n]) => (
              <span key={s}><span className="font-medium text-foreground tabular-nums">{n}</span> {s.toLowerCase()}</span>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border/60 bg-card/40 p-4 md:p-5">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-1">Unanswered discussions</h2>
        <p className="text-xs text-muted-foreground mb-3">Public threads with zero replies, oldest first — where the community needs attention.</p>
        {d.unanswered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No unanswered discussions.</p>
        ) : (
          <ul className="divide-y divide-border/50">
            {d.unanswered.map((t) => (
              <li key={t.id} className="py-2.5 flex items-center gap-3 text-sm">
                <span className="text-muted-foreground tabular-nums w-12 shrink-0">
                  {t.ageHours < 1 ? "<1h" : t.ageHours < 48 ? `${t.ageHours}h` : `${Math.floor(t.ageHours / 24)}d`}
                </span>
                <div className="min-w-0">
                  <Link href={`/forum/thread/${t.slug}`} className="font-medium hover:text-primary">{t.title}</Link>
                  <span className="text-xs text-muted-foreground ml-2">{t.category} · {t.author}</span>
                </div>
                {t.isQuestionCategory && (
                  <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold shrink-0">QUESTION</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-[11px] text-muted-foreground">Generated {d.generatedAt.toISOString()} · counts are live DB aggregates, not sampled.</p>
    </main>
  )
}
