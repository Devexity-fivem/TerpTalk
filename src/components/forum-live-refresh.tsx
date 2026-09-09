"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"

// Polls a cheap "latest content" endpoint and refreshes the page when new
// forum activity is detected. This keeps the forum list current without a
// manual browser reload.
export function ForumLiveRefresh({ latestThreadId }: { latestThreadId: string | null }) {
  const router = useRouter()
  const latest = useRef(latestThreadId)

  useEffect(() => {
    if (!latest.current) return

    const check = async () => {
      try {
        const res = await fetch("/api/forum/updates", { cache: "no-store" })
        if (!res.ok) return
        const data = await res.json()
        if (data.latestThreadId && data.latestThreadId !== latest.current) {
          latest.current = data.latestThreadId
          router.refresh()
        }
      } catch {
        // Ignore network hiccups
      }
    }

    const id = setInterval(check, 30_000)
    return () => clearInterval(id)
  }, [router])

  return null
}
