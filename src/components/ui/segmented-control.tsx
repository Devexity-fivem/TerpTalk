"use client"

import { cn } from "@/lib/utils"

interface SegmentOption<T extends string> {
  value: T
  label: string
  /** Optional count badge */
  count?: number
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  size?: "sm" | "md"
  className?: string
}

/**
 * Tab-like segmented control for switching between modes (feed tabs,
 * filter modes, view toggles). A single shared pattern replaces the
 * various inline tab bars across feed, discover, forum, and profile.
 */
export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-xl bg-secondary/60 p-1",
        className
      )}
      role="tablist"
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          role="tab"
          aria-selected={opt.value === value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-lg font-medium transition-all whitespace-nowrap",
            size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
            opt.value === value
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {opt.label}
          {typeof opt.count === "number" && (
            <span
              className={cn(
                "ml-1.5 inline-flex items-center justify-center rounded-full tabular-nums",
                size === "sm" ? "h-4 min-w-4 px-1 text-[9px]" : "h-[18px] min-w-[18px] px-1 text-[10px]",
                opt.value === value
                  ? "bg-primary/12 text-primary"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {opt.count > 99 ? "99+" : opt.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
