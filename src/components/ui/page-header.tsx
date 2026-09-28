import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

interface PageHeaderProps {
  /** Page title — renders the page's h1 */
  title: ReactNode
  /** Optional supporting line under the title */
  description?: ReactNode
  /** Right-aligned action area (buttons, links, filters) */
  actions?: ReactNode
  /** Breadcrumb/context slot rendered above the title */
  context?: ReactNode
  /** Use a compact header for nested/in-app pages */
  size?: "md" | "lg"
  className?: string
}

/**
 * Standard page header — replaces the repeated
 * `font-display text-3xl … mt-1.5 mb-2` h1 recipe across pages. Actions wrap
 * under the title on small screens; nothing truncates the h1.
 */
export default function PageHeader({
  title,
  description,
  actions,
  context,
  size = "lg",
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("mb-5 sm:mb-6", className)}>
      {context && <div className="mb-2 text-sm text-muted-foreground">{context}</div>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1
            className={cn(
              "font-display font-bold tracking-tight break-words",
              size === "lg" ? "text-3xl sm:text-4xl" : "text-2xl"
            )}
          >
            {title}
          </h1>
          {description && (
            <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}
