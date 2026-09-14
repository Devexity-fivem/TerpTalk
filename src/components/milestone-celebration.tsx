"use client"

// Global milestone celebrations — listens for the `tt-new-notification`
// browser event (dispatched by navigation.tsx when a Pusher notification
// arrives) and renders a celebratory card when the notification carries
// progression metadata.
//
// Kinds: "tier" (major — large card, longest dwell), "stage" (level-up —
// compact card), "badge" (achievement unlock), "challenge" (weekly reward),
// "quest" (daily reward — quietest dwell).
// Plain reputation notifications carry no metadata and stay silent, so
// ordinary +2 rep events never produce a popup.
//
// Accessibility: role="status" announces via a polite live region, Escape
// and the dismiss button close a card, no focus is stolen, and all motion
// is CSS-only so the global prefers-reduced-motion rule neutralises it.

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Sprout, Trophy, X, Target } from "lucide-react"
import { cn } from "@/lib/utils"

interface MilestoneMeta {
  kind?: string
  level?: number
  stageName?: string
  rep?: number
  tier?: { name: string; icon: string; color: string; bg: string }
  unlocks?: { kind: string; key: string; name: string }[]
  nextUnlock?: { kind: string; key: string; name: string; unlockedAt: number } | null
  badges?: { name: string; rarity: string; icon: string }[]
  titles?: string[]
  reward?: number
}

interface Item {
  id: string
  title: string
  content: string
  link: string | null
  meta: MilestoneMeta
}

const MAX_VISIBLE = 3

export default function MilestoneCelebration() {
  const [items, setItems] = useState<Item[]>([])
  const seen = useRef(new Set<string>())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: string) => {
    const t = timers.current.get(id)
    if (t) clearTimeout(t)
    timers.current.delete(id)
    setItems((prev) => prev.filter((i) => i.id !== id))
  }, [])

  useEffect(() => {
    const onNotify = (e: Event) => {
      const n = (e as CustomEvent).detail as {
        id?: string
        title?: string
        content?: string
        link?: string | null
        metadata?: MilestoneMeta | null
      }
      const kind = n?.metadata?.kind
      if (!n?.id || !kind || !["tier", "stage", "badge", "challenge", "quest"].includes(kind)) return
      const id = n.id
      if (seen.current.has(id)) return
      seen.current.add(id)

      const item: Item = {
        id,
        title: n.title ?? "",
        content: n.content ?? "",
        link: n.link ?? null,
        meta: n.metadata ?? {},
      }
      setItems((prev) => [...prev.slice(-(MAX_VISIBLE - 1)), item])

      const dwell = kind === "tier" ? 12_000 : kind === "badge" ? 8_000 : kind === "quest" ? 5_000 : 6_000
      timers.current.set(id, setTimeout(() => dismiss(id), dwell))
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setItems((prev) => {
          const last = prev[prev.length - 1]
          if (last) dismiss(last.id)
          return prev
        })
      }
    }

    const pending = timers.current
    window.addEventListener("tt-new-notification", onNotify)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("tt-new-notification", onNotify)
      window.removeEventListener("keydown", onKey)
      pending.forEach((t) => clearTimeout(t))
    }
  }, [dismiss])

  if (items.length === 0) return null

  return (
    <div className="fixed z-[60] pointer-events-none inset-x-4 top-16 sm:inset-x-auto sm:right-6 sm:top-auto sm:bottom-6 sm:w-96 flex flex-col gap-3 items-stretch">
      {items.map((item) => (
        <CelebrationCard key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
      ))}
    </div>
  )
}

function CelebrationCard({ item, onDismiss }: { item: Item; onDismiss: () => void }) {
  const { meta } = item
  const isTier = meta.kind === "tier"
  const isBadge = meta.kind === "badge"
  const Icon =
    isTier || isBadge ? Trophy : meta.kind === "challenge" || meta.kind === "quest" ? Target : Sprout

  return (
    <div
      role="status"
      className={cn(
        "pointer-events-auto rounded-xl border bg-card shadow-2xl overflow-hidden",
        "animate-in slide-in-from-bottom-4 fade-in duration-300",
        isTier ? "border-primary/60" : "border-border"
      )}
    >
      <div className={cn("h-1", isTier ? "bg-primary" : "bg-primary/40")} />
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "shrink-0 rounded-full flex items-center justify-center",
              isTier ? "w-12 h-12 bg-primary/15" : "w-10 h-10 bg-primary/10"
            )}
            aria-hidden="true"
          >
            {meta.tier?.icon ? (
              <span className={isTier ? "text-2xl" : "text-xl"}>{meta.tier.icon}</span>
            ) : (
              <Icon className={cn("text-primary", isTier ? "w-6 h-6" : "w-5 h-5")} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary mb-0.5">
              {isTier
                ? "Tier up"
                : isBadge
                  ? "Achievement unlocked"
                  : meta.kind === "challenge"
                    ? "Challenge complete"
                    : meta.kind === "quest"
                      ? "Quest complete"
                      : "Your garden is growing"}
            </p>
            <p className={cn("font-semibold leading-tight", isTier ? "text-base" : "text-sm")}>
              {item.title}
            </p>
            {isBadge && meta.badges && meta.badges.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {meta.badges.map((b) => (
                  <span
                    key={b.name}
                    className="inline-flex items-center gap-1 text-xs bg-secondary rounded-full px-2 py-0.5"
                  >
                    <span aria-hidden="true">{b.icon}</span>
                    {b.name}
                  </span>
                ))}
              </div>
            )}
            {isTier && meta.unlocks && meta.unlocks.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {meta.unlocks.map((u) => (
                  <span
                    key={u.key}
                    className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary rounded-full px-2 py-0.5"
                  >
                    Unlocked: {u.name}
                  </span>
                ))}
              </div>
            )}
            {item.content && (
              <p className="text-xs text-muted-foreground mt-1.5 leading-snug line-clamp-3">
                {item.content}
              </p>
            )}
            {item.link && (
              <Link
                href={item.link}
                className="inline-block text-xs font-medium text-primary hover:underline mt-2"
              >
                {isTier ? "See your rewards →" : "View progress →"}
              </Link>
            )}
          </div>
          <button
            onClick={onDismiss}
            className="shrink-0 p-1.5 -m-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            aria-label="Dismiss celebration"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
