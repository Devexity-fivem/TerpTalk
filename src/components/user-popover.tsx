"use client"

import { useState, useRef, useEffect, useCallback, type ReactNode } from "react"
import Link from "next/link"
import { Loader2, Sprout } from "lucide-react"
import { Avatar } from "@/components/ui/avatar"
import RoleBadge from "@/components/role-badge"
import TierChip from "@/components/tier-chip"
import Tooltip from "@/components/ui/tooltip"
import { getBadgeByName } from "@/lib/badge-registry"

interface UserCard {
  username: string
  name: string | null
  isBot: boolean
  role: string
  image: string | null
  avatarFrame: string | null
  customTitle: string | null
  bio: string | null
  joinDate: string
  statusHidden: boolean
  reputation: number | null
  tier: { name: string; icon: string; color: string; bg: string } | null
  trustStanding: { name: string; icon: string; color: string; bg: string } | null
  badges: { name: string; icon: string }[]
  harvestedGrows: number
  totalGrows: number
}

// Module-level cache — a card fetched once is reused for the session.
const cardCache = new Map<string, UserCard | null>()

async function fetchCard(username: string): Promise<UserCard | null> {
  if (cardCache.has(username)) return cardCache.get(username) ?? null
  try {
    const res = await fetch(`/api/users/${encodeURIComponent(username)}/card`)
    const card = res.ok ? ((await res.json()) as UserCard) : null
    cardCache.set(username, card)
    return card
  } catch {
    cardCache.set(username, null)
    return null
  }
}

/**
 * Wraps an author name/avatar element with a tap-or-hover social card.
 * Desktop opens on hover/focus after a short delay; touch devices treat the
 * first tap as "open card" (navigation is suppressed until the card's own
 * "View profile" link is used). Escape or an outside tap closes it.
 */
export default function UserPopover({ username, children }: { username: string | null | undefined; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [card, setCard] = useState<UserCard | null | undefined>(undefined)
  const rootRef = useRef<HTMLSpanElement>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(() => {
    if (!username || card !== undefined) return
    setCard(undefined)
    fetchCard(username).then(setCard)
  }, [username, card])

  const show = useCallback(() => {
    setOpen(true)
    load()
  }, [load])

  const scheduleShow = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(show, 250)
  }, [show])

  const scheduleHide = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => setOpen(false), 200)
  }, [])

  // Close on outside tap / Escape.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  // On touch devices (no hover), the first tap opens the card instead of
  // following the wrapped profile link.
  const onClickCapture = useCallback(
    (e: React.MouseEvent) => {
      if (typeof window !== "undefined" && window.matchMedia("(hover: none)").matches && !open) {
        e.preventDefault()
        e.stopPropagation()
        show()
      }
    },
    [open, show]
  )

  if (!username) return <>{children}</>

  return (
    <span
      ref={rootRef}
      className="relative inline-flex items-center"
      onMouseEnter={scheduleShow}
      onMouseLeave={scheduleHide}
      onFocus={scheduleShow}
      onBlur={scheduleHide}
      onClickCapture={onClickCapture}
    >
      {children}
      {open && (
        <span
          role="dialog"
          aria-label={`${username} profile preview`}
          className="absolute left-0 top-full z-50 mt-1 block w-64 rounded-lg border border-border bg-card p-3 text-left shadow-lg normal-case tracking-normal"
        >
          {card === undefined ? (
            <span className="flex items-center justify-center py-4 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </span>
          ) : card === null ? (
            <span className="block text-xs text-muted-foreground">Member</span>
          ) : (
            <span className="block">
              <span className="mb-2 flex items-center gap-2">
                <Avatar src={card.image ?? undefined} size="sm" alt={card.username} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-foreground">{card.username}</span>
                  {card.customTitle && <span className="block truncate text-xs text-muted-foreground">{card.customTitle}</span>}
                </span>
              </span>
              <span className="mb-2 flex flex-wrap items-center gap-1">
                <RoleBadge role={card.role} />
                {!card.statusHidden && card.tier && (
                  <TierChip reputation={card.reputation ?? 0} />
                )}
              </span>
              {!card.statusHidden && (
                <span className="mb-2 block text-xs text-muted-foreground">
                  {card.reputation} rep
                  {card.trustStanding && (
                    <Tooltip content="Community trust standing — grows with positive contributions">
                      <> · {card.trustStanding.icon} {card.trustStanding.name}</>
                    </Tooltip>
                  )}
                  {card.totalGrows > 0 && <> · {card.harvestedGrows}/{card.totalGrows} grows harvested</>}
                </span>
              )}
              {card.badges.length > 0 && (
                <span className="mb-2 flex flex-wrap gap-1">
                  {card.badges.map((b) => (
                    <Tooltip key={b.name} content={getBadgeByName(b.name)?.description ?? b.name}>
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground">
                        {b.icon} {b.name}
                      </span>
                    </Tooltip>
                  ))}
                </span>
              )}
              {card.bio && <span className="mb-2 block line-clamp-2 text-xs text-muted-foreground">{card.bio}</span>}
              <Link
                href={`/u/${card.username}`}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <Sprout className="h-3 w-3" /> View profile
              </Link>
            </span>
          )}
        </span>
      )}
    </span>
  )
}
