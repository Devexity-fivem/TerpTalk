"use client"

import { useEffect, useRef, useState } from "react"
import { STAGE_LABELS } from "@/lib/diary-weeks"
import { cn } from "@/lib/utils"

interface WeekNavigatorProps {
  /** Grow weeks in order — from the server's groupUpdatesByWeek() output.
   *  Only week numbers + stage labels ship to the client. */
  weeks: { week: number; stage: string }[]
  /** The diary's current week — shown when the observer hasn't fired yet. */
  currentWeek: number
}

/**
 * Sticky week-jump rail for the diary timeline. Anchor links scroll to the
 * server-rendered `#week-N` sections; an IntersectionObserver tracks which
 * week is on screen and marks it current. No week math happens here — the
 * numbers come from the same grouping that rendered the timeline.
 */
export default function WeekNavigator({ weeks, currentWeek }: WeekNavigatorProps) {
  const [active, setActive] = useState<number>(currentWeek)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const sections = weeks
      .map((w) => document.getElementById(`week-${w.week}`))
      .filter((el): el is HTMLElement => !!el)
    if (sections.length === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const n = Number(e.target.id.replace("week-", ""))
            if (Number.isFinite(n)) setActive(n)
          }
        }
      },
      // A week counts as "current" when its section occupies the reading
      // band — roughly the middle third of the viewport.
      { rootMargin: "-35% 0px -60% 0px", threshold: 0 }
    )
    sections.forEach((s) => observer.observe(s))
    return () => observer.disconnect()
  }, [weeks])

  // Keep the active pill inside the horizontal scroll window.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-week="${active}"]`)
    el?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [active])

  if (weeks.length <= 1) return null

  return (
    <nav
      aria-label="Jump to week"
      className="tt-glass sticky top-[4.75rem] z-30 -mx-1 rounded-full border border-border/60 px-2 py-1.5 shadow-md shadow-black/5"
    >
      <div
        ref={listRef}
        className="flex gap-1 overflow-x-auto overscroll-x-contain scrollbar-none"
        role="list"
      >
        {weeks.map((w) => (
          <a
            key={w.week}
            href={`#week-${w.week}`}
            data-week={w.week}
            aria-current={active === w.week ? "true" : undefined}
            title={`Week ${w.week} — ${(STAGE_LABELS[w.stage] ?? w.stage).toLowerCase()}`}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors min-h-8 inline-flex items-center",
              active === w.week
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
          >
            W{w.week}
          </a>
        ))}
      </div>
    </nav>
  )
}
