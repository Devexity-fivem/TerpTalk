"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"

// Generic live-refresh tickle — polls a cheap fingerprint endpoint and
// calls router.refresh() when the value changes, so server-rendered
// surfaces (thread pages, diary pages, feeds) update without a manual
// reload. Also resyncs when a sleeping tab regains focus. Read-only,
// cache-busted, silently ignores network failures.
//
// `fingerprint` is the value the page was rendered with. Pass null to
// adopt the endpoint's first response as the baseline without refreshing
// (the page was just rendered fresh — the first poll can't be stale).
export function LiveRefresh({
  endpoint,
  fingerprint = null,
  intervalMs = 30_000,
}: {
  endpoint: string
  fingerprint?: string | number | null
  intervalMs?: number
}) {
  const router = useRouter()
  const latest = useRef(fingerprint)
  const primed = useRef(fingerprint != null)

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const res = await fetch(endpoint, { cache: "no-store" })
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (data.fingerprint == null) return
        if (!primed.current) {
          latest.current = data.fingerprint
          primed.current = true
          return
        }
        if (data.fingerprint !== latest.current) {
          latest.current = data.fingerprint
          router.refresh()
        }
      } catch {
        // Ignore network hiccups
      }
    }
    const id = setInterval(check, intervalMs)
    const onVisible = () => {
      if (document.visibilityState === "visible") check()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      cancelled = true
      clearInterval(id)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [endpoint, intervalMs, router])

  return null
}
