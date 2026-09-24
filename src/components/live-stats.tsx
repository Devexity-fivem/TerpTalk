"use client"

import { useEffect, useState } from "react"
import CountUp from "@/components/count-up"

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

  const num = "font-display text-3xl sm:text-4xl font-bold mb-1 tabular-nums tt-gradient-text bg-gradient-to-br from-primary to-spectrum"
  const label = "text-xs sm:text-sm font-medium text-muted-foreground uppercase tracking-wider"

  return (
    <div className="grid grid-cols-3 gap-4 sm:gap-8">
      <div className="text-center">
        <div className={num}><CountUp value={stats.members} /></div>
        <div className={label}>Members</div>
      </div>
      <div className="text-center">
        <div className={num}><CountUp value={stats.diaries} /></div>
        <div className={label}>Grow Diaries</div>
      </div>
      <div className="text-center">
        <div className={num}><CountUp value={stats.discussions} /></div>
        <div className={label}>Discussions</div>
      </div>
    </div>
  )
}
