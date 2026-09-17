"use client"

import { useSyncExternalStore } from "react"

function dayPart(): string {
  const h = new Date().getHours()
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"
}

// Time-of-day greeting — computed from the member's clock, not the
// server's timezone. useSyncExternalStore gives a client-only value with
// a stable server snapshot ("Welcome"), so no hydration mismatch.
export default function MemberGreeting({ name }: { name: string }) {
  const part = useSyncExternalStore(
    () => () => {},
    dayPart,
    () => "Welcome"
  )
  return (
    <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
      {part}, {name}
    </h1>
  )
}
