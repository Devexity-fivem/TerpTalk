"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import {
  LayoutDashboard, Users, Sprout, ShieldAlert, TrendingUp,
  MessageSquarePlus, Bot, Activity, Wrench, Flag, Repeat2, FlaskConical,
} from "@/lib/icons"
import type { LucideIcon } from "@/lib/icons"

// Component references can't cross the server→client boundary, so the
// layout passes icon *names* and this map resolves them client-side.
const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, Users, Sprout, ShieldAlert, TrendingUp,
  MessageSquarePlus, Bot, Activity, Wrench, Flag, Repeat2, FlaskConical,
}

export type AdminNavItem = {
  href: string
  label: string
  icon: keyof typeof ICONS
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

  const cls = (active: boolean, extra = "") =>
    "relative flex items-center gap-2 rounded-xl text-[13px] font-medium transition-colors " +
    (active
      ? "bg-secondary text-foreground shadow-sm"
      : "text-muted-foreground hover:text-foreground hover:bg-secondary/60") + extra

  const indicator = (active: boolean, vertical: boolean) =>
    active && (
      <span
        className={
          vertical
            ? "absolute left-0 inset-y-2 w-0.5 rounded-full tt-spectrum-bar"
            : "tt-spectrum-bar absolute inset-x-3 -bottom-[9px] h-0.5 rounded-full"
        }
      />
    )

  const render = (vertical: boolean) => (
    <nav
      className={
        vertical
          ? "hidden md:flex md:flex-col md:gap-0.5 md:py-2"
          : "flex md:hidden gap-1 overflow-x-auto pb-2 -mx-1 px-1"
      }
      aria-label="Admin sections"
    >
      {items.map(({ href, label, icon }) => {
        const active = isActive(href)
        const Icon = ICONS[icon]
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cls(active, vertical ? " pl-3 pr-3 py-2" : " px-3 py-1.5 whitespace-nowrap")}
          >
            {indicator(active, vertical)}
            <Icon className={active ? (vertical ? "w-4 h-4 text-primary" : "w-3.5 h-3.5 text-primary") : vertical ? "w-4 h-4" : "w-3.5 h-3.5"} />
            {label}
          </Link>
        )
      })}
    </nav>
  )

  return (
    <>
      {render(true)}
      {render(false)}
    </>
  )
}
