"use client"

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

/**
 * Eases a number toward its target on mount (ease-out cubic), then snaps
 * to later values so periodic refreshes don't re-animate. Reduced-motion
 * users get the final value immediately.
 */
export default function CountUp({
  value,
  durationMs = 900,
  className,
}: {
  value: number
  durationMs?: number
  className?: string
}) {
  const [display, setDisplay] = useState(0)
  const animated = useRef(false)

  useEffect(() => {
    if (animated.current) {
      setDisplay(value)
      return
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      animated.current = true
      setDisplay(value)
      return
    }
    animated.current = true
    const start = performance.now()
    let raf = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / durationMs)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(Math.round(value * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(raf)
  }, [value, durationMs])

  return <span className={cn("tabular-nums", className)}>{display.toLocaleString()}</span>
}
