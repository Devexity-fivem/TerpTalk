"use client"

import { useEffect, useRef } from "react"

// Fires one product-event beacon on mount — the same non-fatal pattern
// as ViewTracker. Only allowlisted types reach the server; daily and
// per-object dedupe lives in the event key server-side, so remounts,
// retries, and React strict-mode double effects can't inflate counts.
export default function EventBeacon({
  type,
  source,
  objectType,
  objectId,
}: {
  type: "DIGEST_VIEWED" | "FOLLOWED_CONTENT_VIEWED"
  source?: string | null
  objectType?: string
  objectId?: string
}) {
  const sent = useRef(false)

  useEffect(() => {
    if (sent.current) return
    sent.current = true
    fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, source, objectType, objectId }),
    }).catch(() => {
      // Non-fatal: a missed beacon is better than an error loop.
    })
  }, [type, source, objectType, objectId])

  return null
}
