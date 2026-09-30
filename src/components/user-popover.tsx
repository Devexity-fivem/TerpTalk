"use client"

import { useState, useRef, useEffect, useCallback, type ReactNode } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { Loader2, Sprout } from "@/lib/icons"
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
  bio: string | null
  joinDate: string
  statusHidden: boolean
  xp: number | null
  rank: { name: string; icon: string; color: string; bg: string } | null
  trustStanding: { name: string; icon: string; color: string; bg: string } | null
  badges: { name: string; icon: string }[]
  harvestedGrows: number
  totalGrows: number
  /** P4 — deterministic path-XP identity ("Grow Mentor"…); ≥50 path XP. */
  buildTitle?: string | null
  /** P4 — viewer-visible unharvested diary exists → the grow-dot. */
  hasActiveGrow?: boolean
  /** P4 — the member's own shownStats pick, resolved viewer-scoped. */
  selectedStat?: { id: string; label: string; value: string } | null
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
 *
 * The dialog portals to <body> with fixed positioning so ProfileCard can
 * live inside content links (thread/diary rows) without nested anchors.
 */
export default function UserPopover({ username, children }: { username: string | null | undefined; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [card, setCard] = useState<UserCard | null | undefined>(undefined)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const rootRef = useRef<HTMLSpanElement>(null)
  const dialogRef = useRef<HTMLSpanElement>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(() => {
    if (!username || card !== undefined) return
    fetchCard(username).then(setCard)
  }, [username, card])

  const updatePos = useCallback(() => {
    const el = rootRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const cardH = 240 // generous — the dialog never exceeds ~15rem
    const fitsBelow = window.innerHeight - r.bottom >= cardH + 8 || r.top < cardH
    setPos({
      top: fitsBelow ? r.bottom + 6 : Math.max(8, r.top - cardH - 6),
      left: Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - 272)),
    })
  }, [])

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

  // Position + close/reposition on outside tap, Escape, scroll, resize.
  useEffect(() => {
    if (!open) return
    updatePos()
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (rootRef.current?.contains(t) || dialogRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    const onScroll = () => updatePos()
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKey)
    window.addEventListener("scroll", onScroll, true)
    window.addEventListener("resize", onScroll)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKey)
      window.removeEventListener("scroll", onScroll, true)
      window.removeEventListener("resize", onScroll)
    }
  }, [open, updatePos])

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
      {open &&
        pos &&
        createPortal(
          <span
            ref={dialogRef}
            role="dialog"
            aria-label={`${username} profile preview`}
            style={{ top: pos.top, left: pos.left }}
            className="fixed z-50 block w-64 rounded-2xl border border-border/70 bg-card p-3 text-left shadow-lg normal-case tracking-normal"
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
                    {card.buildTitle && (
                      <span className="block truncate text-[11px] text-muted-foreground">{card.buildTitle}</span>
                    )}
                  </span>
                  {card.hasActiveGrow && (
                    <Tooltip content="Documenting a live grow right now">
                      <span className="mt-0.5 ml-auto inline-flex shrink-0 items-center gap-1 self-start rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                        <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" /> growing
                      </span>
                    </Tooltip>
                  )}
                </span>
                <span className="mb-2 flex flex-wrap items-center gap-1">
                  <RoleBadge role={card.role} />
                  {!card.statusHidden && card.rank && <TierChip xp={card.xp ?? 0} />}
                </span>
                {!card.statusHidden && (
                  <span className="mb-2 block text-xs text-muted-foreground">
                    {card.xp} XP
                    {card.trustStanding && (
                      <Tooltip content="Community standing — grows with peer-validated contributions">
                        <> · {card.trustStanding.icon} {card.trustStanding.name}</>
                      </Tooltip>
                    )}
                    {card.totalGrows > 0 && <> · {card.harvestedGrows}/{card.totalGrows} grows harvested</>}
                  </span>
                )}
                {card.selectedStat && (
                  <span className="mb-2 block text-xs text-muted-foreground">
                    {card.selectedStat.label}: <span className="font-medium text-foreground">{card.selectedStat.value}</span>
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
          </span>,
          document.body
        )}
    </span>
  )
}
