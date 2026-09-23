import Link from "next/link"
import { cn } from "@/lib/utils"
import { Avatar } from "@/components/ui/avatar"
import Badge from "@/components/ui/tt-badge"
import type { ReactNode } from "react"

interface ContentCardProps {
  /** Link destination */
  href: string
  /** Card style — compact for text-heavy lists, media for image-forward */
  variant?: "compact" | "media"
  /** Cover image URL for media variant */
  image?: string | null
  /** Image alt text */
  imageAlt?: string
  /** Primary heading */
  title: string
  /** Author name */
  author?: string
  /** Author avatar */
  authorAvatar?: string | null
  /** Optional nameplate class for the author */
  authorNameplate?: string
  /** Category or type label */
  category?: string
  /** Category badge variant */
  categoryVariant?: "primary" | "success" | "warning" | "spectrum" | "default"
  /** Metadata line — date, views, reply count */
  meta?: ReactNode
  /** Preview text */
  preview?: string
  /** Badges/chips rendered below the title */
  badges?: ReactNode
  /** Whether this is unread/new */
  unread?: boolean
  className?: string
}

/**
 * Multi-purpose content card used across feeds, discover, search results,
 * and cross-link sections. Supports compact (text) and media (image) modes.
 * Replaces the various inline card recipes on forum, diary, and strain pages.
 */
export default function ContentCard({
  href,
  variant = "compact",
  image,
  imageAlt,
  title,
  author,
  authorAvatar,
  authorNameplate,
  category,
  categoryVariant = "primary",
  meta,
  preview,
  badges,
  unread = false,
  className,
}: ContentCardProps) {
  if (variant === "media") {
    return (
      <Link href={href} className={cn("group block", className)}>
        <div className="bg-card/80 overflow-hidden rounded-2xl border border-border/70 tt-lift tt-edge-card">
          {image ? (
            <div className="relative aspect-[16/10] overflow-hidden bg-secondary">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image}
                alt={imageAlt || title}
                className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                loading="lazy"
              />
              {category && (
                <div className="absolute bottom-2 left-2">
                  <Badge variant={categoryVariant} size="sm">{category}</Badge>
                </div>
              )}
            </div>
          ) : (
            category && (
              <div className="px-4 pt-3">
                <Badge variant={categoryVariant} size="sm">{category}</Badge>
              </div>
            )
          )}
          <div className="p-4">
            <h3 className="font-display text-sm font-semibold leading-snug line-clamp-2 group-hover:text-primary">
              {title}
            </h3>
            {preview && (
              <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">{preview}</p>
            )}
            {badges && <div className="mt-2 flex flex-wrap items-center gap-1.5">{badges}</div>}
            <div className="mt-3 flex items-center gap-2">
              {authorAvatar !== undefined && (
                <Avatar src={authorAvatar} size="sm" alt={author} />
              )}
              {author && (
                <span className={cn("text-xs font-medium truncate", authorNameplate)}>
                  {author}
                </span>
              )}
              {meta && (
                <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                  {meta}
                </span>
              )}
            </div>
          </div>
        </div>
      </Link>
    )
  }

  // Compact variant
  return (
    <Link
      href={href}
      className={cn(
        "group flex items-start gap-3 rounded-xl border border-border/70 bg-card/80 p-3 transition-colors hover:border-primary/40 tt-edge-card",
        unread && "border-l-primary/60",
        className
      )}
    >
      {authorAvatar !== undefined && (
        <Avatar src={authorAvatar} size="sm" alt={author} className="mt-0.5 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {unread && (
            <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="New" />
          )}
          <h3 className="text-sm font-medium line-clamp-1 group-hover:text-primary">{title}</h3>
        </div>
        {preview && (
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{preview}</p>
        )}
        <div className="mt-1.5 flex items-center flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {category && <span className="text-primary font-medium">{category}</span>}
          {author && <span className={authorNameplate}>{author}</span>}
          {meta}
        </div>
        {badges && <div className="mt-1.5 flex flex-wrap items-center gap-1">{badges}</div>}
      </div>
      {image && (
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-secondary">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt={imageAlt || title} className="h-full w-full object-cover" loading="lazy" />
        </div>
      )}
    </Link>
  )
}
