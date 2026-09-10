"use client"

import { useEffect, useRef } from "react"

export default function ViewTracker({ threadId }: { threadId: string }) {
  const tracked = useRef(false)

  useEffect(() => {
    if (!threadId || tracked.current) return
    tracked.current = true

    const controller = new AbortController()
    fetch("/api/forum/threads/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId }),
      signal: controller.signal,
    }).catch(() => {
      // Non-fatal: a missed view is better than an error loop.
    })
  }, [threadId])

  return null
}
