"use client"

import { useEffect, useRef, useState } from "react"

interface Stats {
  members: number
  diaries: number
  discussions: number
}

// How often the client re-fetches live stats. Kept in sync with the server
// cache revalidation (60s) so we don't waste function invocations.
const REFRESH_INTERVAL_MS = 60 * 1000

// Eases a number toward its target on mount — honors reduced motion.
function useCountUp(target: number, durationMs = 900) {
  const [value, setValue] = useState(0)
  const animated = useRef(false)
  useEffect(() => {
    // Animate once on mount; subsequent poll updates snap to the new value
    // so the strip doesn't re-ease every 60s.
    if (animated.current) {
      setValue(target)
      return
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      animated.current = true
      setValue(target)
      return
    }
    animated.current = true
    const start = performance.now()
    let raf = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / durationMs)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(Math.round(target * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(raf)
  }, [target, durationMs])
  return value
}

export default function LiveStats({ initial }: { initial: Stats }) {
  const [stats, setStats] = useState<Stats>(initial)
  const members = useCountUp(stats.members)
  const diaries = useCountUp(stats.diaries)
  const discussions = useCountUp(stats.discussions)

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
        <div className={num}>{members.toLocaleString()}</div>
        <div className={label}>Members</div>
      </div>
      <div className="text-center">
        <div className={num}>{diaries.toLocaleString()}</div>
        <div className={label}>Grow Diaries</div>
      </div>
      <div className="text-center">
        <div className={num}>{discussions.toLocaleString()}</div>
        <div className={label}>Discussions</div>
      </div>
    </div>
  )
}
