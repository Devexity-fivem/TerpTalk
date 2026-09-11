"use client"

import { useEffect, useState } from "react"

interface Stats {
  members: number
  diaries: number
  discussions: number
}

// How often the client re-fetches live stats. Kept in sync with the server
// cache revalidation (60s) so we don't waste function invocations.
const REFRESH_INTERVAL_MS = 60 * 1000

export default function LiveStats({ initial }: { initial: Stats }) {
  const [stats, setStats] = useState<Stats>(initial)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null

    const fetchStats = async () => {
      if (document.hidden) return
      try {
        const res = await fetch("/api/stats", { cache: "no-store" })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setStats(data)
      } catch {
        // ignore transient errors
      }
    }

    const startPolling = () => {
      fetchStats()
      if (timer) clearInterval(timer)
      timer = setInterval(fetchStats, REFRESH_INTERVAL_MS)
    }

    const stopPolling = () => {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    }

    const onVisibilityChange = () => {
      if (document.hidden) {
        stopPolling()
      } else {
        startPolling()
      }
    }

    startPolling()
    document.addEventListener("visibilitychange", onVisibilityChange)

    return () => {
      cancelled = true
      stopPolling()
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [])

  return (
    <div className="grid grid-cols-3 gap-4 sm:gap-8">
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
