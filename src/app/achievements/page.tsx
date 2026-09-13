"use client"

import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { signInHref } from "@/lib/callback-url"
import { Award, Loader2, Pin, PinOff } from "lucide-react"
import AchievementBadge from "@/components/achievement-badge"
import { useToast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"

interface Achievement {
  name: string
  description: string
  requirement: string
  rarity: string
  category: string
  icon: string
  earned: boolean
  earnedAt: string | null
  pinned: boolean
  badgeId: string | null
  progress: { current: number; target: number; direction: "gte" | "lte" } | null
}

type Filter = "all" | "earned" | "in-progress" | "locked"

export default function AchievementsPage() {
  const { status } = useSession()
  const router = useRouter()
  const { toast } = useToast()
  const [achievements, setAchievements] = useState<Achievement[] | null>(null)
  const [categories, setCategories] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState<Filter>("all")
  const [pinBusy, setPinBusy] = useState<string | null>(null)

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push(signInHref("/achievements"))
    }
  }, [status, router])

  useEffect(() => {
    if (status !== "authenticated") return
    fetch("/api/achievements", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setAchievements(d?.achievements ?? [])
        setCategories(d?.categories ?? {})
      })
      .catch(() => setAchievements([]))
  }, [status])

  const filtered = useMemo(() => {
    if (!achievements) return []
    return achievements.filter((a) => {
      if (filter === "earned") return a.earned
      if (filter === "locked") {
        // lte specs never show a fill bar — "locked" means you're past the cutoff.
        if (a.progress?.direction === "lte") return a.progress.current > a.progress.target
        return !a.earned && (!a.progress || a.progress.current === 0)
      }
      if (filter === "in-progress") {
        if (a.progress?.direction === "lte") return !a.earned && a.progress.current > 0 && a.progress.current <= a.progress.target
        return !a.earned && a.progress && a.progress.current > 0
      }
      return true
    })
  }, [achievements, filter])

  const grouped = useMemo(() => {
    const map = new Map<string, Achievement[]>()
    for (const a of filtered) {
      const list = map.get(a.category) ?? []
      list.push(a)
      map.set(a.category, list)
    }
    return [...map.entries()]
  }, [filtered])

  const earnedCount = achievements?.filter((a) => a.earned).length ?? 0

  async function togglePin(a: Achievement) {
    if (!a.badgeId) return
    const next = a.pinned
      ? achievements!.filter((x) => x.pinned && x.name !== a.name)
      : [...achievements!.filter((x) => x.pinned), a]
    setPinBusy(a.name)
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinnedBadges: next.map((x) => x.badgeId).filter(Boolean) }),
    })
    setPinBusy(null)
    if (res.ok) {
      setAchievements((prev) =>
        prev ? prev.map((x) => (x.name === a.name ? { ...x, pinned: !a.pinned } : x)) : prev
      )
      toast(a.pinned ? "Removed from showcase" : "Pinned to your profile")
    } else {
      const d = await res.json().catch(() => ({}))
      toast(d.error || "Could not update showcase", "error")
    }
  }

  if (status === "loading" || achievements === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <Award className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold">Achievements</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {earnedCount} of {achievements.length} earned. Pin your favorites to showcase them on your profile.
          </p>
        </div>

        <div className="flex gap-2 mb-6 flex-wrap">
          {(["all", "earned", "in-progress", "locked"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                filter === f
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {f === "all" ? "All" : f === "earned" ? `Earned (${earnedCount})` : f === "in-progress" ? "In progress" : "Locked"}
            </button>
          ))}
        </div>

        {grouped.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing in this view yet — keep growing.</p>
        )}

        {grouped.map(([cat, list]) => (
          <div key={cat} className="mb-8">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              {categories[cat] ?? cat}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {list.map((a) => (
                <div
                  key={a.name}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border border-border bg-card p-3",
                    !a.earned && "opacity-80"
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <AchievementBadge name={a.name} earned={a.earned} mode="profile" />
                    <p className="text-xs text-muted-foreground mt-1.5">{a.requirement}</p>
                    {a.progress && !a.earned && a.progress.direction === "lte" ? (
                      <p className="text-[10px] text-muted-foreground mt-1.5">
                        {a.progress.current <= a.progress.target
                          ? `You're member #${a.progress.current.toLocaleString()} — eligible`
                          : `You're member #${a.progress.current.toLocaleString()} — the first ${a.progress.target.toLocaleString()} window has passed`}
                      </p>
                    ) : a.progress && !a.earned ? (
                      <div className="flex items-center gap-2 mt-1.5">
                        <div className="h-1.5 flex-1 max-w-32 bg-secondary rounded-full overflow-hidden">
                          <div
                            className="h-full bg-amber-500 transition-all"
                            style={{ width: `${Math.round((a.progress.current / a.progress.target) * 100)}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-muted-foreground">
                          {a.progress.current.toLocaleString()}/{a.progress.target.toLocaleString()}
                        </span>
                      </div>
                    ) : null}
                    {a.earned && a.earnedAt && (
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Earned {new Date(a.earnedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  {a.earned && (
                    <button
                      onClick={() => togglePin(a)}
                      disabled={pinBusy === a.name}
                      title={a.pinned ? "Remove from profile showcase" : "Pin to profile showcase"}
                      className={cn(
                        "shrink-0 p-1.5 rounded-lg transition-colors",
                        a.pinned ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                      )}
                    >
                      {a.pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
