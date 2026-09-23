import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

interface BadgeProps {
  children: ReactNode
  variant?: "default" | "primary" | "success" | "warning" | "destructive" | "spectrum" | "muted"
  size?: "sm" | "md"
  className?: string
  /** Optional dot indicator before the text */
  dot?: boolean
}

const variantStyles = {
  default: "bg-secondary text-secondary-foreground",
  primary: "bg-primary/12 text-primary ring-1 ring-inset ring-primary/20",
  success: "bg-emerald-500/12 text-success ring-1 ring-inset ring-emerald-500/20",
  warning: "bg-amber-500/12 text-warning ring-1 ring-inset ring-amber-500/20",
  destructive: "bg-destructive/12 text-destructive ring-1 ring-inset ring-destructive/20",
  spectrum: "bg-spectrum/12 text-spectrum ring-1 ring-inset ring-spectrum/20",
  muted: "bg-muted text-muted-foreground",
}

const dotColors = {
  default: "bg-secondary-foreground",
  primary: "bg-primary",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  destructive: "bg-destructive",
  spectrum: "bg-spectrum",
  muted: "bg-muted-foreground",
}

const sizeStyles = {
  sm: "px-1.5 py-0.5 text-[10px] gap-1",
  md: "px-2 py-0.5 text-xs gap-1.5",
}

/**
 * Inline badge / chip for metadata, status, and category indicators.
 * Replaces the many inline `rounded-full bg-primary/10 text-primary text-xs`
 * recipes. Supports dot indicators for live/status contexts.
 */
export default function Badge({
  children,
  variant = "default",
  size = "md",
  className,
  dot = false,
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-semibold whitespace-nowrap",
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
    >
      {dot && (
        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotColors[variant])} />
      )}
      {children}
    </span>
  )
}
