import Link from "next/link"
import { cn } from "@/lib/utils"
import { Avatar } from "@/components/ui/avatar"
import type { ReactNode } from "react"

interface ActivityItemProps {
  /** Avatar image URL */
  avatar?: string | null
  /** Avatar alt text */
  avatarAlt?: string
  /** Link destination for the whole item */
  href: string
  /** Primary text — e.g. "Dakota posted a new discussion" */
  title: ReactNode
  /** Secondary text — subtitle or preview */
  subtitle?: ReactNode
  /** Metadata line — timestamp, category, counts */
  meta?: ReactNode
  /** Right-side slot — badge, image thumbnail, action */
  trailing?: ReactNode
  /** Unread indicator */
  unread?: boolean
  /** Optional avatar frame class */
  avatarFrameClass?: string
  className?: string
}

/**
 * Unified activity row used across feeds, notifications, profiles, and
 * the member-home "since last visit" section. Gives all activity types
 * a shared visual rhythm: avatar · text block · trailing content.
 */
export default function ActivityItem({
  avatar,
  avatarAlt,
  href,
  title,
  subtitle,
  meta,
  trailing,
  unread = false,
  avatarFrameClass,
  className,
}: ActivityItemProps) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-secondary/60",
        unread && "bg-primary/5",
        className
      )}
    >
      <div className={cn("relative shrink-0 mt-0.5", avatarFrameClass)}>
        <Avatar src={avatar} size="sm" alt={avatarAlt} />
        {unread && (
          <span
            className="absolute -left-1 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-primary"
            aria-label="Unread"
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug line-clamp-1 group-hover:text-primary">
          {title}
        </p>
        {subtitle && (
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
            {subtitle}
          </p>
        )}
        {meta && (
          <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            {meta}
          </p>
        )}
      </div>
      {trailing && <div className="shrink-0">{trailing}</div>}
    </Link>
  )
}
