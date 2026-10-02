"use client"

import Link from "next/link"
import { cn } from "@/lib/utils"
import Tooltip from "@/components/ui/tooltip"
import { useRef, type KeyboardEvent, type ReactNode } from "react"

export interface LinkTabItem {
  id: string
  label: ReactNode
  href: string
  /** Optional tooltip for the pill */
  tip?: string
}

interface LinkTabsProps {
  items: LinkTabItem[]
  /** Currently selected tab id */
  value: string
  ariaLabel: string
  className?: string
}

/**
 * Link-based tab bar for URL-driven tab sets on server pages — the same
 * canonical pill styling and APG keyboard model as `Tabs`, but each tab is a
 * real link so hrefs, prefetch, and deep-linking are preserved. Arrow keys
 * move focus (manual activation — Enter follows the link); Home/End jump to
 * the ends. Use `Tabs` for local-state tab sets instead.
 */
export default function LinkTabs({ items, value, ariaLabel, className }: LinkTabsProps) {
  const listRef = useRef<HTMLDivElement>(null)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const tabs = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[data-tab-id]") ?? []
    )
    const idx = tabs.indexOf(document.activeElement as HTMLElement)
    if (idx === -1) return
    let next: number | null = null
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % tabs.length
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (idx - 1 + tabs.length) % tabs.length
    else if (e.key === "Home") next = 0
    else if (e.key === "End") next = tabs.length - 1
    if (next !== null) {
      e.preventDefault()
      tabs[next].focus()
    }
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn("flex gap-1.5 overflow-x-auto scrollbar-none pb-1", className)}
    >
      {items.map((t) => {
        const selected = t.id === value
        const pill = (
          <Link
            key={t.id}
            href={t.href}
            role="tab"
            data-tab-id={t.id}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={cn(
              "rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors inline-flex items-center gap-1.5",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "bg-primary text-primary-foreground"
                : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
          >
            {t.label}
          </Link>
        )
        return t.tip ? (
          <Tooltip key={t.id} content={t.tip} side="bottom">
            {pill}
          </Tooltip>
        ) : (
          pill
        )
      })}
    </div>
  )
}
