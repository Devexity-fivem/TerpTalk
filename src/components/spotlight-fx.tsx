"use client"

import { useEffect } from "react"

/**
 * Global pointer-spotlight driver. Elements opt in with `.tt-spotlight` —
 * this single delegated listener writes --mx/--my CSS vars on the hovered
 * element, so every spotlight surface works without its own JS boundary.
 * Disabled for reduced-motion users and non-pointer devices.
 */
export default function SpotlightFX() {
  useEffect(() => {
    if (typeof window === "undefined") return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    if (window.matchMedia("(hover: none), (pointer: coarse)").matches) return

    let raf = 0
    const onMove = (e: PointerEvent) => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const el = (e.target as Element | null)?.closest?.(".tt-spotlight")
        if (!(el instanceof HTMLElement)) return
        const rect = el.getBoundingClientRect()
        el.style.setProperty("--mx", `${e.clientX - rect.left}px`)
        el.style.setProperty("--my", `${e.clientY - rect.top}px`)
      })
    }

    window.addEventListener("pointermove", onMove, { passive: true })
    return () => {
      window.removeEventListener("pointermove", onMove)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return null
}
