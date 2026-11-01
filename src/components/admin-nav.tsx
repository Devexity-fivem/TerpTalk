"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import type { ComponentType } from "react"

export type AdminNavItem = {
  href: string
  label: string
  icon: ComponentType<{ className?: string }>
}

// Active-state aware section nav for the command-center shell. The layout
// is a server component (session/role gate), so pathname/searchParams
// live here. Tab-qualified items match on path + their tab param; plain
// items match on path only when no sibling tab item on the same path is
// the active one (so /admin/manage doesn't double-highlight next to
// /admin/manage?tab=feedback).
export default function AdminNav({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const tabValue = (href: string) => {
    const q = href.split("?")[1]
    return q ? new URLSearchParams(q).get("tab") : null
  }

  const isActive = (href: string) => {
    const path = href.split("?")[0]
    if (pathname !== path) return false
    const tab = tabValue(href)
    if (tab) return searchParams.get("tab") === tab
    // Plain item: not active when a tab sibling on the same path is active.
    return !items.some(
      (i) => i.href !== href && i.href.split("?")[0] === path && tabValue(i.href) === searchParams.get("tab")
    )
  }

  return (
    <nav className="flex gap-1 overflow-x-auto pb-2 -mx-1 px-1" aria-label="Admin sections">
      {items.map(({ href, label, icon: Icon }) => {
        const active = isActive(href)
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={
              "relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium whitespace-nowrap transition-colors " +
              (active
                ? "text-foreground bg-secondary"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/70")
            }
          >
            <Icon className={active ? "w-3.5 h-3.5 text-primary" : "w-3.5 h-3.5"} />
            {label}
            {active && (
              <span className="tt-spectrum-bar absolute inset-x-3 -bottom-[9px] h-0.5 rounded-full" />
            )}
          </Link>
        )
      })}
    </nav>
  )
}
