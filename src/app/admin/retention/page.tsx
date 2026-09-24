import { notFound } from "next/navigation"
import { requireAdmin } from "@/lib/require-staff"
import { getGrowthDetail } from "@/lib/ops-metrics"

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

function pct(part: number, whole: number) {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—"
}

// Retention center — admin only. Weekly cohorts, diary continuation, and
// cross-surface participation. Small samples are labeled, never smoothed.
export default async function AdminRetentionPage() {
  const admin = await requireAdmin()
  if (!admin) notFound()
  const g = await getGrowthDetail()

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold font-display">Retention</h1>
        <p className="text-sm text-muted-foreground">
          Did TerpTalk earn a second visit — and are members becoming growers, contributors, or both.
          Small cohorts are shown honestly; do not over-read n&lt;5.
        </p>
      </div>

      <section className="rounded-2xl border border-border/60 bg-card/40 p-4 md:p-5">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Weekly cohorts</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-2 font-medium">Cohort</th>
                <th className="py-2 text-right font-medium">Signed up</th>
                <th className="py-2 text-right font-medium">Onboarded</th>
                <th className="py-2 text-right font-medium">Activated</th>
                <th className="py-2 text-right font-medium">Returned ≥24h</th>
              </tr>
            </thead>
            <tbody>
              {g.cohorts.map((c) => (
                <tr key={c.label} className="border-t border-border/40">
                  <td className="py-2 text-muted-foreground">{c.label}</td>
                  <td className="py-2 text-right tabular-nums font-medium">{c.signups}</td>
                  <td className="py-2 text-right tabular-nums">{c.onboarded} <span className="text-muted-foreground text-xs">({pct(c.onboarded, c.signups)})</span></td>
                  <td className="py-2 text-right tabular-nums">{c.activated} <span className="text-muted-foreground text-xs">({pct(c.activated, c.signups)})</span></td>
                  <td className="py-2 text-right tabular-nums">{c.returned24h} <span className="text-muted-foreground text-xs">({pct(c.returned24h, c.signups)})</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-border/60 bg-card/40 p-4 md:p-5">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-1">Diary continuation</h2>
        <p className="text-xs text-muted-foreground mb-3">
          Updates recorded per diary (latest {g.diary.diaries} diaries). “No updates yet” is a fact, not an abandonment verdict.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Stat label="Diaries" value={g.diary.diaries} />
          <Stat label="No updates yet" value={g.diary.noUpdates} hint={pct(g.diary.noUpdates, g.diary.diaries)} />
          <Stat label="1 update" value={g.diary.oneUpdate} hint={pct(g.diary.oneUpdate, g.diary.diaries)} />
          <Stat label="2–4 updates" value={g.diary.fewUpdates} hint={pct(g.diary.fewUpdates, g.diary.diaries)} />
          <Stat label="5+ updates" value={g.diary.manyUpdates} hint={pct(g.diary.manyUpdates, g.diary.diaries)} />
          <Stat label="Harvested" value={g.diary.harvested} hint={pct(g.diary.harvested, g.diary.diaries)} />
        </div>
      </section>

      <section className="rounded-2xl border border-border/60 bg-card/40 p-4 md:p-5">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-1">Participation overlap — 30d signups</h2>
        <p className="text-xs text-muted-foreground mb-3">
          Among members who contributed at least once (n={g.firstAction30d.sampleSize} of {g.firstAction30d.signupsInWindow} signups).
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Diary + community" value={g.firstAction30d.diaryAndCommunity} hint="both surfaces" />
          <Stat label="Diary only" value={g.firstAction30d.diaryOnly} />
          <Stat label="Community only" value={g.firstAction30d.communityOnly} />
          <Stat label="Multi-surface" value={g.firstAction30d.multiSurfaceMembers} hint="≥2 contribution types" />
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <section className="rounded-2xl border border-border/60 bg-card/40 p-4 md:p-5">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Chat — last 7 days</h2>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Unique chatters" value={g.chat.uniqueChatters7d} />
            <Stat label="Multi-day chatters" value={g.chat.multiDayChatters7d} />
            <Stat label="Active rooms" value={g.chat.activeRooms7d} />
            <Stat label="Also contribute elsewhere" value={g.chat.chattersWhoContributeElsewhere7d} hint={pct(g.chat.chattersWhoContributeElsewhere7d, g.chat.uniqueChatters7d)} />
          </div>
        </section>
        <section className="rounded-2xl border border-border/60 bg-card/40 p-4 md:p-5">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">TerpBot — last 7 days</h2>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Unique users" value={g.bot.uniqueUsers7d} />
            <Stat label="Multi-day users" value={g.bot.multiDayUsers7d} />
            <Stat label="Subsequent contributors" value={g.bot.usersWhoAlsoContribute7d} hint={pct(g.bot.usersWhoAlsoContribute7d, g.bot.uniqueUsers7d)} />
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">
            “Also contribute” = any other contribution in the same window — correlation, not causation.
          </p>
        </section>
      </div>

      <p className="text-[11px] text-muted-foreground">Generated {g.generatedAt.toISOString()} · live aggregates, not sampled.</p>
    </main>
  )
}
