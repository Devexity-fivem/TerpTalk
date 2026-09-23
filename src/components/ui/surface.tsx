import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

interface SurfaceProps {
  children: ReactNode
  className?: string
  /** Visual variant */
  variant?: "card" | "inset" | "elevated" | "ghost"
  /** Optional padding preset */
  padding?: "none" | "sm" | "md" | "lg"
  /** Add the tt-edge-card spectrum accent on hover */
  edge?: boolean
  /** Add the tt-lift hover animation */
  lift?: boolean
  as?: "div" | "section" | "article" | "aside"
}

const variantStyles = {
  card: "bg-card/80 border border-border/70 rounded-2xl",
  inset: "bg-secondary/40 rounded-xl",
  elevated: "bg-card/90 border border-border/60 rounded-2xl shadow-md",
  ghost: "rounded-xl",
}

const paddingStyles = {
  none: "",
  sm: "p-3 sm:p-4",
  md: "p-4 sm:p-5",
  lg: "p-5 sm:p-6 lg:p-8",
}

/**
 * Consistent surface container — the base building block for cards, panels,
 * sections, and inset areas. Replaces the dozens of inline
 * `bg-card/80 rounded-2xl border border-border/70` recipes throughout the app.
 */
export default function Surface({
  children,
  className,
  variant = "card",
  padding = "md",
  edge = false,
  lift = false,
  as: Component = "div",
}: SurfaceProps) {
  return (
    <Component
      className={cn(
        variantStyles[variant],
        paddingStyles[padding],
        edge && "tt-edge-card",
        lift && "tt-lift",
        className
      )}
    >
      {children}
    </Component>
  )
}
