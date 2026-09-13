"use client"

// "Your Garden" — the personalized progression dashboard at the top of
// /reputation. Keeps the page itself statically renderable: this client
// widget fetches the member's consolidated progression state, renders
// nothing for logged-out visitors beyond a sign-in prompt, and refetches
// when a milestone notification arrives so the panel always reflects the
// celebration the member just saw.

import { useEffect, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import Link from "next/link"
import { Sprout, Lock, Target, ChevronRight, Award } from "lucide-react"
import { cn } from "@/lib/utils"
import { signInHref } from "@/lib/callback-url"

interface ProgressionData {
  reputation: number
  level: number
  maxLevel: number
  stage: { name: string; index: number; count: number }
  tier: { name: string; icon: string; color: string; bg: string; benefit: string | null }
  stageProgress: { current: number; next: number; percent: number; remaining: number }
  tierProgress: { current: number; next: number; percent: number }
  nextTier: { name: string; icon: string; threshold: number; benefit: string | null } | null
  nextUnlock: { kind: string; name: string; unlockedAt: number } | null
  upcoming: { rung: number; level: number; tier: string }[]
  cosmetics: { equipped: Record<string, string | null>; unlockedCount: number }
  challenges: {
    week: string
    endsAt: string
    items: { slug: string; title: string; icon: string; reward: number; target: number; progress: number; done: boolean; paid: boolean }[]
  }
  recentBadges: { name: string; icon: string | null; earnedAt: string }[]
}

export default function ProgressionPanel() {
  const { data: session, status } = useSession()
  const [data, setData] = useState<ProgressionData | null>(null)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (status !== "authenticated") return
    let cancelled = false
    const load = () =>
      fetch("/api/progression")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!cancelled && d) setData(d)
        })
        .catch(() => {})
    load()
    const onNotify = (e: Event) => {
      const n = (e as CustomEvent).detail as { type?: string } | undefined
      if (n?.type !== "REPUTATION" && n?.type !== "BADGE") return
      // Debounce: several milestone notifications can arrive together.
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

  if (status === "unauthenticated") {
    return (
      <div className="bg-card rounded-lg border border-border p-4 mb-4 text-center">
        <p className="text-sm text-muted-foreground">
          <Link href={signInHref("/reputation")} className="text-primary font-medium hover:underline">Sign in</Link>{" "}
          to see your grow level, next unlock, and weekly challenges.
        </p>
      </div>
    )
  }
  if (!session?.user || !data) return null

  const stagePct = data.stageProgress.percent
  const completedChallenges = data.challenges.items.filter((c) => c.done).length

  return (
    <section aria-label="Your progression" className="bg-card rounded-lg border border-border p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Sprout className="w-4 h-4 text-primary" />
        <h2 className="text-lg font-semibold">Your garden</h2>
        <span className={cn("ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium", data.tier.bg, data.tier.color)}>
          <span aria-hidden="true">{data.tier.icon}</span> {data.tier.name}
        </span>
      </div>

      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-2xl font-bold">Grow Level {data.level}</span>
        <span className="text-sm text-muted-foreground">of {data.maxLevel} · {data.stage.name} stage</span>
        <span className="ml-auto text-sm font-medium text-primary">{data.reputation.toLocaleString()} rep</span>
      </div>

      {/* Stage progress — the bar that moves weekly */}
      <div className="mt-3">
        <div className="flex justify-between text-xs text-muted-foreground mb-1">
          <span>{data.stage.name} stage</span>
          {data.stageProgress.remaining > 0 ? (
            <span>{data.stageProgress.remaining.toLocaleString()} rep to level {data.level + 1}</span>
          ) : (
            <span>Max level</span>
          )}
        </div>
        <div className="h-2 rounded-full bg-secondary overflow-hidden" role="progressbar" aria-valuenow={stagePct} aria-valuemin={0} aria-valuemax={100} aria-label={`${data.stage.name} stage progress`}>
          <div className="h-full bg-primary rounded-full transition-[width] duration-500" style={{ width: `${stagePct}%` }} />
        </div>
      </div>

      {/* Tier progress — the long arc */}
      {data.nextTier && (
        <div className="mt-3">
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Next tier: {data.nextTier.icon} {data.nextTier.name}</span>
            <span>{data.tierProgress.percent}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-secondary overflow-hidden" role="progressbar" aria-valuenow={data.tierProgress.percent} aria-valuemin={0} aria-valuemax={100} aria-label={`Progress to ${data.nextTier.name}`}>
            <div className="h-full bg-primary/60 rounded-full transition-[width] duration-500" style={{ width: `${data.tierProgress.percent}%` }} />
          </div>
        </div>
      )}

      {/* Next unlock */}
      {data.nextUnlock && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/15 px-3 py-2">
          <Lock className="w-3.5 h-3.5 text-primary shrink-0" aria-hidden="true" />
          <p className="text-xs">
            <span className="font-medium">Next unlock: {data.nextUnlock.name}</span>{" "}
            <span className="text-muted-foreground">
              at {data.nextUnlock.unlockedAt.toLocaleString()} rep
              ({(data.nextUnlock.unlockedAt - data.reputation).toLocaleString()} to go)
            </span>
          </p>
        </div>
      )}

      {/* Upcoming milestones */}
      {data.upcoming.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {data.upcoming.map((u) => (
            <span key={u.rung}>
              Lv {u.level} <span className="text-foreground/70">@ {u.rung.toLocaleString()}</span>
            </span>
          ))}
        </div>
      )}

      {/* Weekly challenges strip */}
      <div className="mt-3 pt-3 border-t border-border">
        <div className="flex items-center gap-1.5 text-xs font-medium mb-2">
          <Target className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
          Weekly grow — {completedChallenges}/{data.challenges.items.length} complete
          <span className="ml-auto text-muted-foreground">resets {new Date(data.challenges.endsAt).toLocaleDateString([], { weekday: "short" })}</span>
        </div>
        <div className="space-y-1.5">
          {data.challenges.items.map((c) => (
            <div key={c.slug} className="flex items-center gap-2 text-xs">
              <span aria-hidden="true">{c.icon}</span>
              <span className={cn("min-w-0 truncate", c.done && "text-muted-foreground")}>{c.title}</span>
              <div className="ml-auto flex items-center gap-2 shrink-0">
                <div className="w-16 h-1 rounded-full bg-secondary overflow-hidden">
                  <div
                    className={cn("h-full rounded-full", c.done ? "bg-primary" : "bg-primary/50")}
                    style={{ width: `${Math.min(100, (c.progress / c.target) * 100)}%` }}
                  />
                </div>
                <span className={cn("font-medium w-10 text-right", c.done ? "text-primary" : "text-muted-foreground")}>
                  {c.done ? `+${c.reward} ✓` : `+${c.reward}`}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent achievements + links */}
      <div className="mt-3 pt-3 border-t border-border flex items-center gap-2 flex-wrap">
        {data.recentBadges.length > 0 && (
          <>
            <Award className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
            {data.recentBadges.map((b) => (
              <span key={b.name} className="inline-flex items-center gap-1 text-xs bg-secondary/60 rounded-full px-2 py-0.5">
                <span aria-hidden="true">{b.icon ?? "🏅"}</span>{b.name}
              </span>
            ))}
          </>
        )}
        <span className="ml-auto flex gap-3 text-xs">
          <Link href="/achievements" className="text-primary hover:underline inline-flex items-center gap-0.5">
            Achievements <ChevronRight className="w-3 h-3" aria-hidden="true" />
          </Link>
          <Link href="/profile#rewards" className="text-primary hover:underline inline-flex items-center gap-0.5">
            Rewards <ChevronRight className="w-3 h-3" aria-hidden="true" />
          </Link>
        </span>
      </div>
    </section>
  )
}
