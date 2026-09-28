import { cn } from "@/lib/utils"
import Surface from "@/components/ui/surface"
import type { ReactNode } from "react"

interface SectionCardProps {
  /** Section heading — renders an h2 with an optional element anchor id */
  title?: ReactNode
  /** Optional supporting text under the heading */
  description?: ReactNode
  /** Right-aligned header actions */
  actions?: ReactNode
  /** id for the heading (aria-labelledby target + deep-link anchor) */
  id?: string
  children: ReactNode
  className?: string
  /** Looser padding for media-heavy sections */
  padded?: boolean
  /** Tighter padding — profile "compact" density preset */
  compact?: boolean
}

/**
 * Titled section surface — replaces the repeated
 * `bg-card/80 rounded-2xl border + h2` recipe used for profile/profile
 * panels, dashboard blocks, and page sections. Composes `Surface`; don't add
 * a second card visual language.
 */
export default function SectionCard({
  title,
  description,
  actions,
  id,
  children,
  className,
  padded = true,
  compact = false,
}: SectionCardProps) {
  const headingId = id ? `${id}-title` : undefined
  const padding = !padded ? "none" : compact ? "sm" : "md"
  return (
    <Surface
      as="section"
      padding={padding}
      className={className}
      labelledBy={headingId}
    >
      {(title || actions) && (
        <div className={cn("flex items-start justify-between gap-3", padded ? "mb-3" : "p-4 sm:p-5 pb-0", padded && !compact && "mb-4")}>
          <div className="min-w-0">
            {title && (
              <h2 id={headingId} className="font-display text-lg font-semibold break-words">
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </Surface>
  )
}
