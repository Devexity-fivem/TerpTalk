"use client"

import { cn } from "@/lib/utils"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type KeyboardEvent } from "react"

export interface TabItem {
  id: string
  label: ReactNode
  /** Renders the panel inactive but keeps the tab focusable-disabled */
  disabled?: boolean
}

interface TabsProps {
  items: TabItem[]
  /** Panels keyed by tab id */
  children: (activeId: string) => ReactNode
  /** Controlled active tab (omit for uncontrolled) */
  value?: string
  /** Initial tab for uncontrolled usage */
  defaultValue?: string
  onChange?: (id: string) => void
  /** Sync active tab to `?tab=` for deep-linking content-routing tab sets.
      Filters and view toggles should stay uncontrolled or use SegmentedControl. */
  syncWithUrl?: boolean
  ariaLabel: string
  className?: string
}

/**
 * Single accessible tab implementation (APG): arrow/Home/End keyboard
 * navigation, role=tablist/tab with aria-selected + aria-controls, visible
 * focus, overflow scroll on mobile. Use for content-switching tab sets —
 * inline list filters stay on SegmentedControl.
 */
export default function Tabs({
  items,
  children,
  value,
  defaultValue,
  onChange,
  syncWithUrl = false,
  ariaLabel,
  className,
}: TabsProps) {
  const uid = useId()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const listRef = useRef<HTMLDivElement>(null)

  const urlValue = syncWithUrl ? searchParams.get("tab") : null
  const [internal, setInternal] = useState(defaultValue ?? items[0]?.id)
  const activeId =
    value ??
    (urlValue && items.some((t) => t.id === urlValue) ? urlValue : internal) ??
    items[0]?.id

  const select = useCallback(
    (id: string, focus = true) => {
      if (!items.some((t) => t.id === id && !t.disabled)) return
      if (value === undefined && !syncWithUrl) setInternal(id)
      if (syncWithUrl) {
        const params = new URLSearchParams(searchParams.toString())
        params.set("tab", id)
        router.replace(`${pathname}?${params.toString()}`, { scroll: false })
      }
      onChange?.(id)
      if (focus) {
        listRef.current
          ?.querySelector<HTMLButtonElement>(`[data-tab-id="${CSS.escape(id)}"]`)
          ?.focus()
      }
    },
    [items, value, syncWithUrl, searchParams, router, pathname, onChange]
  )

  // Honor ?tab= on first paint for deep links — notify the parent so
  // consumers that lazy-load tab content activate the right section.
  useEffect(() => {
    if (syncWithUrl && urlValue && items.some((t) => t.id === urlValue)) onChange?.(urlValue)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onKeyDown = (e: KeyboardEvent) => {
    const enabled = items.filter((t) => !t.disabled)
    const idx = enabled.findIndex((t) => t.id === activeId)
    let next: number | null = null
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % enabled.length
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (idx - 1 + enabled.length) % enabled.length
    else if (e.key === "Home") next = 0
    else if (e.key === "End") next = enabled.length - 1
    if (next !== null) {
      e.preventDefault()
      select(enabled[next].id)
    }
  }

  return (
    <div className={className}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        className="flex gap-1.5 overflow-x-auto scrollbar-none pb-1"
      >
        {items.map((t) => {
          const selected = t.id === activeId
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              data-tab-id={t.id}
              id={`${uid}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={selected ? `${uid}-panel-${t.id}` : undefined}
              aria-disabled={t.disabled || undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(t.id, false)}
              className={cn(
                "rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground",
                t.disabled && "opacity-50 cursor-not-allowed"
              )}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      <div
        role="tabpanel"
        id={`${uid}-panel-${activeId}`}
        aria-labelledby={`${uid}-tab-${activeId}`}
        className="mt-4 focus-visible:outline-none"
        tabIndex={-1}
      >
        {children(activeId ?? "")}
      </div>
    </div>
  )
}
