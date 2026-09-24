"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

// Bounded refresh for the command-center overview: re-runs the server
// components every 90s while the page is open. No sockets, no new
// subscriptions — a plain RSC refetch on an interval.
export default function AdminRefresh({ intervalMs = 90_000 }: { intervalMs?: number }) {
  const router = useRouter()
  useEffect(() => {
    const t = setInterval(() => router.refresh(), intervalMs)
    return () => clearInterval(t)
  }, [router, intervalMs])
  return null
}
