import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: { label: string; href: string }
  /** Compact variant for in-card empties (member-home, sidebars) — no large
      icon tile or standalone padding, just guidance text and an optional CTA. */
  compact?: boolean
  className?: string
  children?: ReactNode
}

/**
 * Consistent placeholder for lists with no content. Prefer this over ad-hoc
 * "No results" paragraphs so empty screens still guide the user somewhere.
 * Use `compact` inside cards/panels; the default fills a section.
 */
export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
  className,
  children,
}: EmptyStateProps) {
  if (compact) {
    return (
      <div className={cn("rounded-xl bg-secondary/40 px-4 py-5 text-center", className)}>
        <p className="text-sm text-muted-foreground">{title}</p>
        {description && <p className="mt-1 text-xs text-muted-foreground/80">{description}</p>}
        {children}
        {action && (
          <Link
            href={action.href}
            className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            {action.label}
          </Link>
        )}
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {Icon && (
        <div className="mb-4 rounded-2xl bg-primary/10 p-3.5 ring-1 ring-primary/20">
          <Icon className="h-7 w-7 text-primary" aria-hidden="true" />
        </div>
      )}
      <h3 className="font-display text-base font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && (
        <Link
          href={action.href}
          className="tt-cta mt-5 inline-flex h-10 items-center rounded-full px-4 text-sm font-semibold text-primary-foreground transition-all"
        >
          {action.label}
        </Link>
      )}
    </div>
  )
}
