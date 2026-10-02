"use client"

// /progress — the member's progression hub. One consolidated fetch to
// /api/progression powers every section: level/XP, trust standing, today's
// quests, weekly challenges, near-earned badges, next unlock, recent wins.
// Refetches on milestone notifications so the page always matches the
// celebration the member just saw. Owner-only data — redirects to sign-in.

import { useEffect, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Sprout, Lock, ChevronRight, Award, Loader2, ShieldCheck, Zap, CalendarCheck, Trophy, Flame, Check, Sparkles,
} from "@/lib/icons"
import { cn } from "@/lib/utils"
import PageHeader from "@/components/ui/page-header"
import SectionCard from "@/components/ui/section-card"
import { signInHref } from "@/lib/callback-url"
import { REP_RANKS, RANK_DISPLAY, UNLOCKS } from "@/lib/progression-config"

interface ProgressionData {
  xp: number
  nextAction: { icon: string; text: string; href: string; cta: string } | null
  journey: {
    slug: string
    name: string
    description: string
    doneCount: number
    complete: boolean
    reward: number
    paid: boolean
    steps: { key: string; title: string; description: string; icon: string; done: boolean; href: string; cta: string }[]
  } | null
  level: number
  maxLevel: number
  stage: { name: string; index: number; count: number }
  rank: { name: string; icon: string; color: string; bg: string; benefit: string | null }
  stageProgress: { current: number; next: number; percent: number; remaining: number }
  tierProgress: { current: number; next: number; percent: number }
  nextRank: { name: string; icon: string; threshold: number; benefit: string | null } | null
  nextUnlock: { id: string; name: string; rank: string; xpNeeded: number } | null
  upcoming: { rung: number; label: string; rank: string }[]
  trust: {
    score: number
    standing: { name: string; icon: string; color: string; bg: string }
    next: { name: string; min: number } | null
  } | null
  challenges: {
    week: string
    endsAt: string
    items: { slug: string; title: string; icon: string; reward: number; target: number; progress: number; done: boolean; paid: boolean }[]
  }
  quests: {
    day: string
    items: { slug: string; title: string; description: string; icon: string; reward: number; target: number; progress: number; done: boolean; paid: boolean }[]
  } | null
  streak: { days: number; next: { days: number } | null } | null
  nearBadges: { name: string; icon: string; rarity: string; current: number; target: number; percent: number }[]
  badgeCount: number
  recentBadges: { name: string; icon: string | null; earnedAt: string }[]
}

export default function ProgressPage() {
  const { status } = useSession()
  const router = useRouter()
  const [data, setData] = useState<ProgressionData | null>(null)
  const [failed, setFailed] = useState(false)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (status === "unauthenticated") router.push(signInHref("/progress"))
  }, [status, router])

  useEffect(() => {
    if (status !== "authenticated") return
    let cancelled = false
    const load = () =>
      fetch("/api/progression", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (cancelled) return
          if (d) setData(d)
          else setFailed(true)
        })
        .catch(() => !cancelled && setFailed(true))
    load()
    const onNotify = (e: Event) => {
      const n = (e as CustomEvent).detail as { type?: string } | undefined
      if (n?.type !== "REPUTATION" && n?.type !== "BADGE") return
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      refreshTimer.current = setTimeout(load, 800)
    }
    window.addEventListener("tt-new-notification", onNotify)
    return () => {
      cancelled = true
      window.removeEventListener("tt-new-notification", onNotify)
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
    }
  }, [status])

  if (status === "loading" || (status === "authenticated" && !data && !failed)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }
  if (failed || !data) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-2xl mx-auto px-4 py-16 text-center">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load your progress — try refreshing.</p>
        </div>
      </div>
    )
  }

  const questsDone = data.quests?.items.filter((q) => q.done || q.paid).length ?? 0
  const challengesDone = data.challenges.items.filter((c) => c.done).length

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <PageHeader
          size="md"
          title={
            <span className="flex items-center gap-2">
              <Sprout className="w-6 h-6 text-primary" /> My progress
            </span>
          }
          description="Your garden, your goals, and what you can unlock next."
        />

        {/* Level card */}
        <section aria-label="Level" className="bg-card/80 rounded-2xl border border-border/70 p-4 mb-4">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-2xl font-bold">Grow Level {data.level}</span>
            <span className="text-sm text-muted-foreground">
              of {data.maxLevel} · {data.stage.name} stage
            </span>
            <span className={cn("ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium", data.rank.bg, data.rank.color)}>
              <span aria-hidden="true">{data.rank.icon}</span> {data.rank.name}
            </span>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>{data.xp.toLocaleString()} XP</span>
            {data.stageProgress.remaining > 0 ? (
              <span>{data.stageProgress.remaining.toLocaleString()} to level {data.level + 1}</span>
            ) : (
              <span>Max level</span>
            )}
          </div>
          <div
            className="h-2.5 rounded-full bg-secondary overflow-hidden"
            role="progressbar"
            aria-valuenow={data.stageProgress.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${data.stage.name} stage progress`}
          >
            <div
              className="h-full bg-primary rounded-full transition-[width] duration-500"
              style={{ width: `${data.stageProgress.percent}%` }}
            />
          </div>
          {data.nextRank && (
            <div className="mt-3">
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>
                  Next tier: {data.nextRank.icon} {data.nextRank.name}
                </span>
                <span>{data.tierProgress.percent}%</span>
              </div>
              <div
                className="h-1.5 rounded-full bg-secondary overflow-hidden"
                role="progressbar"
                aria-valuenow={data.tierProgress.percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Progress to ${data.nextRank.name}`}
              >
                <div
                  className="h-full bg-primary/60 rounded-full transition-[width] duration-500"
                  style={{ width: `${data.tierProgress.percent}%` }}
                />
              </div>
            </div>
          )}
          {data.nextUnlock && (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/15 px-3 py-2">
              <Lock className="w-3.5 h-3.5 text-primary shrink-0" aria-hidden="true" />
              <p className="text-xs">
                <span className="font-medium">Next unlock: {data.nextUnlock.name}</span>{" "}
                <span className="text-muted-foreground">
                  at {data.nextUnlock.rank} rank — {data.nextUnlock.xpNeeded.toLocaleString()} XP (
                  {(data.nextUnlock.xpNeeded - data.xp).toLocaleString()} to go)
                </span>
              </p>
            </div>
          )}
          {data.upcoming.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {data.upcoming.map((u) => (
                <span key={u.rung}>
                  {u.label} <span className="text-foreground/70">@ {u.rung.toLocaleString()}</span>
                </span>
              ))}
            </div>
          )}
        </section>

        {/* Garden streak — consecutive daily check-ins pay once-ever
            milestone bonuses. Missed days just restart the count. */}
        <SectionCard
          compact
          className="mb-4"
          id="garden-streak"
          title={
            <span className="flex items-center gap-2">
              <Flame className={cn("w-4 h-4", (data.streak?.days ?? 0) > 0 ? "text-warning" : "text-muted-foreground")} />
              Garden streak
            </span>
          }
          actions={
            <span className="text-xs text-muted-foreground">
              {data.streak && data.streak.days > 0 ? `${data.streak.days} day${data.streak.days === 1 ? "" : "s"}` : "not started"}
            </span>
          }
        >
          {data.streak && data.streak.days > 0 ? (
            <p className="text-xs text-muted-foreground">
              {data.streak.next ? (
                <>
                  <span className="text-foreground font-medium">{data.streak.next.days - data.streak.days} day{data.streak.next.days - data.streak.days === 1 ? "" : "s"}</span> to the {data.streak.next.days}-day milestone.
                  Check in daily to keep it alive.
                </>
              ) : (
                "Every streak milestone claimed — a year of showing up. Legendary."
              )}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Check in daily to grow your streak — milestones mark your run, and long streaks open perk shortcuts (60 days pins a harvest, 100 puts your grow in the Spotlight).
            </p>
          )}
        </SectionCard>

        {/* The Path — every rank on the road to Master Gardener */}
        <SectionCard
          compact
          className="mb-4"
          id="path-to-mastery"
          title={
            <span className="flex items-center gap-2">
              <Trophy className="w-4 h-4 text-primary" /> The Path to Master Cultivator
            </span>
          }
          actions={
            <span className="text-xs text-muted-foreground">{data.rank.name} · rank {REP_RANKS.findIndex((t) => t.name === data.rank.name) + 1} of {REP_RANKS.length}</span>
          }
        >
          <ol className="space-y-1">
            {REP_RANKS.map((t, i) => {
              const display = RANK_DISPLAY[t.name] ?? RANK_DISPLAY.Seed
              const prevNameplate = i > 0 ? (RANK_DISPLAY[REP_RANKS[i - 1].name]?.nameplate ?? null) : null
              const newNameplate = display.nameplate && display.nameplate !== prevNameplate ? display.nameplate : null
              const reached = data.xp >= t.threshold
              const current = data.rank.name === t.name
              return (
                <li key={t.name} className="flex items-start gap-3">
                  {/* Rail node + connector line */}
                  <div className="flex flex-col items-center self-stretch">
                    <span
                      className={cn(
                        "w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 border",
                        current
                          ? "bg-primary text-primary-foreground border-primary shadow-[0_0_10px_-2px_var(--primary)]"
                          : reached
                            ? "bg-primary/15 text-primary border-primary/30"
                            : "bg-secondary text-muted-foreground border-border"
                      )}
                      aria-hidden="true"
                    >
                      {reached ? <Check className="w-3 h-3" /> : <Lock className="w-2.5 h-2.5" />}
                    </span>
                    {i < REP_RANKS.length - 1 && (
                      <span className={cn("w-px flex-1 min-h-3", reached ? "bg-primary/40" : "bg-border")} aria-hidden="true" />
                    )}
                  </div>
                  <div className={cn("pb-2 min-w-0", !reached && "opacity-60")}>
                    <div className="flex items-center gap-2 text-sm flex-wrap">
                      <span aria-hidden="true">{display.icon}</span>
                      <span className={cn("font-semibold", current && "text-primary")}>{t.name}</span>
                      <span className="text-[11px] text-muted-foreground">{t.threshold.toLocaleString()} XP</span>
                      {current && <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">you are here</span>}
                      {newNameplate && (
                        <span className={cn("text-[11px] border border-border/60 rounded px-1.5 py-px bg-secondary/50", newNameplate)} title="Your nameplate changes everywhere at this rank">
                          Your name
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{display.benefit}</p>
                  </div>
                </li>
              )
            })}
          </ol>
        </SectionCard>

        {/* Future unlocks — roadmap only. Everything here is still
            planned; it is deliberately kept out of the earned-reward
            language above so a member never thinks they "got" a feature
            that doesn't exist yet. */}
        <section aria-label="Future unlocks" className="rounded-2xl border border-dashed border-border/70 p-4 mb-4">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-display text-sm font-semibold text-muted-foreground">Future unlocks</h2>
            <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">planned</span>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Roadmap features still being built — not live yet, so they are not rewards today.
          </p>
          <ul className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
            {UNLOCKS.filter((u) => u.status === "future").map((u) => (
              <li key={u.id} className="flex items-start gap-2 text-xs" title={u.blurb ?? u.name}>
                <span className="mt-1.5 w-1 h-1 rounded-full bg-border shrink-0" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="font-medium text-foreground/80">{u.name}</span>
                  <span className="text-muted-foreground">
                    {" · "}{u.rank ? `${u.rank} tier` : u.mastery ? `${u.mastery.path.toLowerCase()} mastery` : "roadmap"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Next Best Action */}
        {data.nextAction && (
          <section aria-label="Next best action" className="bg-primary/5 rounded-lg border border-primary/20 p-4 mb-4">
            <div className="flex items-center gap-3">
              <span className="text-xl" aria-hidden="true">{data.nextAction.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-primary mb-0.5">Next best action</p>
                <p className="text-sm">{data.nextAction.text}</p>
              </div>
              <Link
                href={data.nextAction.href}
                className="shrink-0 inline-flex items-center gap-1 text-xs font-medium bg-primary text-primary-foreground px-3 py-2 rounded-md hover:bg-primary/90"
              >
                {data.nextAction.cta} <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </section>
        )}

        {/* Getting Rooted journey */}
        {data.journey && !data.journey.complete && (
          <SectionCard
            compact
            className="mb-4"
            id="journey"
            title={
              <span className="flex items-center gap-2">
                <Sprout className="w-4 h-4 text-primary" /> {data.journey.name}
              </span>
            }
            description={data.journey.description}
            actions={
              <span className="text-xs text-muted-foreground">
                {data.journey.doneCount}/{data.journey.steps.length} · +{data.journey.reward} XP
              </span>
            }
          >
            <ol className="space-y-2">
              {data.journey.steps.map((s, i) => (
                <li key={s.key} className="flex items-center gap-2.5">
                  <span
                    className={cn(
                      "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
                      s.done ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
                    )}
                    aria-hidden="true"
                  >
                    {s.done ? "✓" : i + 1}
                  </span>
                  <span className={cn("flex-1 text-sm min-w-0", s.done && "text-muted-foreground line-through")}>
                    <span aria-hidden="true">{s.icon}</span> {s.title}
                  </span>
                  {!s.done && (
                    <Link href={s.href} className="shrink-0 text-xs text-primary hover:underline">
                      {s.cta}
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          </SectionCard>
        )}

        {/* Trust standing */}
        {data.trust && (
          <SectionCard
            compact
            className="mb-4"
            id="community-trust"
            title={
              <span className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-primary" /> Community standing
              </span>
            }
            actions={
              <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium", data.trust.standing.bg, data.trust.standing.color)}>
                <span aria-hidden="true">{data.trust.standing.icon}</span> {data.trust.standing.name}
              </span>
            }
          >
            <p className="text-xs text-muted-foreground">
              Standing grows when other members value your contributions — accepted answers,
              likes received, and referrals count. Posting alone doesn&apos;t raise it.
            </p>
            {data.trust.next && (
              <p className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border">
                Next: <span className="font-medium text-foreground">{data.trust.next.name}</span> at{" "}
                {data.trust.next.min.toLocaleString()} trust ({data.trust.score.toLocaleString()} now)
              </p>
            )}
          </SectionCard>
        )}

        {/* Today's quests */}
        {data.quests && data.quests.items.length > 0 && (
          <SectionCard
            compact
            className="mb-4"
            id="daily-quests"
            title={
              <span className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" /> Today&apos;s quests
              </span>
            }
            actions={
              <span className="text-xs text-muted-foreground">
                {questsDone}/{data.quests.items.length} · resets daily
              </span>
            }
          >
            <p className="text-[11px] text-muted-foreground mb-3">
              Small optional goals. Miss them freely — tomorrow brings a new mix.
            </p>
            <div className="space-y-2">
              {data.quests.items.map((q) => (
                <div key={q.slug} className="flex items-center gap-3 text-sm">
                  <span className="text-base" aria-hidden="true">{q.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className={cn("font-medium", (q.done || q.paid) && "text-muted-foreground")}>
                      {q.title}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{q.description}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="w-16 h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div
                        className={cn("h-full rounded-full", q.done || q.paid ? "bg-primary" : "bg-primary/50")}
                        style={{ width: `${Math.min(100, (q.progress / q.target) * 100)}%` }}
                      />
                    </div>
                    <span className={cn("text-xs font-medium w-10 text-right", q.done || q.paid ? "text-primary" : "text-muted-foreground")}>
                      {q.paid ? `+${q.reward} ✓` : `+${q.reward}`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* Weekly challenges */}
        <SectionCard
          compact
          className="mb-4"
          id="weekly-challenges"
          title={
            <span className="flex items-center gap-2">
              <CalendarCheck className="w-4 h-4 text-primary" /> This week
            </span>
          }
          actions={
            <span className="text-xs text-muted-foreground">
              {challengesDone}/{data.challenges.items.length} · resets{" "}
              {new Date(data.challenges.endsAt).toLocaleDateString([], { weekday: "short" })}
            </span>
          }
        >
          <div className="space-y-2 mt-3">
            {data.challenges.items.map((c) => (
              <div key={c.slug} className="flex items-center gap-3 text-sm">
                <span className="text-base" aria-hidden="true">{c.icon}</span>
                <div className={cn("min-w-0 flex-1 font-medium", c.done && "text-muted-foreground")}>
                  {c.title}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="w-16 h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div
                      className={cn("h-full rounded-full", c.done ? "bg-primary" : "bg-primary/50")}
                      style={{ width: `${Math.min(100, (c.progress / c.target) * 100)}%` }}
                    />
                  </div>
                  <span className={cn("text-xs font-medium w-10 text-right", c.done ? "text-primary" : "text-muted-foreground")}>
                    {c.done ? `+${c.reward} ✓` : `+${c.reward}`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* Almost earned */}
        {data.nearBadges.length > 0 && (
          <SectionCard
            compact
            className="mb-4"
            id="almost-earned"
            title={
              <span className="flex items-center gap-2">
                <Trophy className="w-4 h-4 text-primary" /> Almost earned
              </span>
            }
            actions={
              <Link href="/achievements" className="text-xs text-primary hover:underline inline-flex items-center gap-0.5">
                All achievements <ChevronRight className="w-3 h-3" aria-hidden="true" />
              </Link>
            }
          >
            <div className="space-y-2">
              {data.nearBadges.map((b) => (
                <div key={b.name} className="flex items-center gap-3 text-sm">
                  <span className="text-base" aria-hidden="true">{b.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{b.name}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className="h-1.5 flex-1 max-w-40 bg-secondary rounded-full overflow-hidden">
                        <div className="h-full bg-amber-500" style={{ width: `${b.percent}%` }} />
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        {b.current.toLocaleString()}/{b.target.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* Recent wins + links */}
        <SectionCard
          compact
          id="recent-accomplishments"
          title={
            <span className="flex items-center gap-2">
              <Award className="w-4 h-4 text-primary" /> Recent accomplishments
            </span>
          }
          actions={
            <span className="text-xs text-muted-foreground">{data.badgeCount} badges total</span>
          }
        >
          {data.recentBadges.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {data.recentBadges.map((b) => (
                <span key={b.name} className="inline-flex items-center gap-1 text-xs bg-secondary/60 rounded-full px-2 py-0.5">
                  <span aria-hidden="true">{b.icon ?? "🏅"}</span>
                  {b.name}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No badges yet — complete a quest or reply in the forums to earn your first.
            </p>
          )}
          <div className="mt-3 pt-3 border-t border-border flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <Link href="/achievements" className="text-primary hover:underline">Achievements</Link>
            <Link href="/reputation" className="text-primary hover:underline">How progression works</Link>
            <Link href="/leaderboard" className="text-primary hover:underline">Leaderboard</Link>
            <Link href="/profile#rewards" className="text-primary hover:underline">Rewards</Link>
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
