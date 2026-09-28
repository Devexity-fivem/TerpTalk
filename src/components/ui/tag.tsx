import { cn } from "@/lib/utils"
import Link from "next/link"
import type { ReactNode } from "react"

interface TagProps {
  children: ReactNode
  /** Linkable tag (e.g. /forum/tags/[slug]); omit for a static chip */
  href?: string
  variant?: "default" | "primary" | "muted"
  className?: string
}

/**
 * Taxonomy/status chip — a tag is a *classification*, not decoration. Use for
 * thread tags, categories, status labels. For achievement/reputation chips
 * use the dedicated Badge/TierChip components instead.
 */
export default function Tag({ children, href, variant = "default", className }: TagProps) {
  const cls = cn(
    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap transition-colors",
    variant === "default" && "bg-secondary/70 text-secondary-foreground",
    variant === "primary" && "bg-primary/12 text-primary ring-1 ring-inset ring-primary/20",
    variant === "muted" && "bg-secondary/40 text-muted-foreground",
    href && "hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    className
  )
  return href ? (
    <Link href={href} className={cls}>
      {children}
    </Link>
  ) : (
    <span className={cls}>{children}</span>
  )
}
