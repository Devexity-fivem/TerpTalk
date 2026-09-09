"use client"

import { useEffect, useState } from "react"

interface Stats {
  members: number
  diaries: number
  discussions: number
}

export default function LiveStats({ initial }: { initial: Stats }) {
  const [stats, setStats] = useState<Stats>(initial)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null

    const fetchStats = async () => {
      try {
        const res = await fetch("/api/stats", { cache: "no-store" })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setStats(data)
      } catch {
        // ignore transient errors
      }
    }

    // Refresh on mount and then every 10 seconds
    fetchStats()
    timer = setInterval(fetchStats, 10000)

    // Refresh when the tab becomes visible again
    const onVisible = () => { if (!document.hidden) fetchStats() }
    document.addEventListener("visibilitychange", onVisible)

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [])

  return (
    <div className="grid grid-cols-3 gap-8">
      <div className="text-center">
        <div className="text-3xl sm:text-4xl font-bold text-primary mb-1 tabular-nums">
          {stats.members.toLocaleString()}
        </div>
        <div className="text-sm text-muted-foreground uppercase tracking-wide">Members</div>
      </div>
      <div className="text-center">
        <div className="text-3xl sm:text-4xl font-bold text-primary mb-1 tabular-nums">
          {stats.diaries.toLocaleString()}
        </div>
        <div className="text-sm text-muted-foreground uppercase tracking-wide">Grow Diaries</div>
      </div>
      <div className="text-center">
        <div className="text-3xl sm:text-4xl font-bold text-primary mb-1 tabular-nums">
          {stats.discussions.toLocaleString()}
        </div>
        <div className="text-sm text-muted-foreground uppercase tracking-wide">Discussions</div>
      </div>
    </div>
  )
}
