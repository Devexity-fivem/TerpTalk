"use client"

import { signInHref } from "@/lib/callback-url"

import { useCallback, useEffect, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import {
  Bell, BellRing, Loader2, CheckCheck, Check, UserPlus, Heart, MessageSquare, AtSign,
  MessageCircle, Leaf, Mail, CheckCircle2, Award, TrendingUp, Users, Shield,
} from "lucide-react"
import Link from "next/link"
import EmptyState from "@/components/ui/empty-state"
import { Avatar } from "@/components/ui/avatar"
import { formatRelativeTime } from "@/lib/time"
import { cn } from "@/lib/utils"

interface NotificationActor {
  name: string
  username: string | null
  image: string | null
}

interface Notification {
  id: string
  type: string
  title: string
  content: string
  link: string | null
  read: boolean
  createdAt: string
  actor: NotificationActor | null
}

const TYPE_ICONS: Record<string, typeof Bell> = {
  FOLLOW: UserPlus,
  REACTION: Heart,
  REPLY: MessageSquare,
  THREAD_ACTIVITY: BellRing,
  MENTION: AtSign,
  COMMENT: MessageCircle,
  DIARY_UPDATE: Leaf,
  DIRECT_MESSAGE: Mail,
  ACCEPTED_ANSWER: CheckCircle2,
  BADGE: Award,
  REPUTATION: TrendingUp,
  REFERRAL: Users,
  MODERATOR_ANNOUNCEMENT: Shield,
}

function typeIcon(type: string) {
  return TYPE_ICONS[type] ?? Bell
}

export default function NotificationsPage() {
  const { status } = useSession()
  const router = useRouter()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(false)
  const [marking, setMarking] = useState(false)
  const seen = useRef(new Set<string>())

  const load = useCallback(async (cursor?: string) => {
    const res = await fetch(`/api/notifications${cursor ? `?cursor=${cursor}` : ""}`)
    if (!res.ok) throw new Error("Failed to load")
    const d = await res.json()
    const list: Notification[] = d.notifications || []
    for (const n of list) seen.current.add(n.id)
    return { list, nextCursor: d.nextCursor as string | null }
  }, [])

  useEffect(() => {
    if (status === "unauthenticated") router.push(signInHref(window.location.pathname + window.location.search))
    else if (status === "authenticated") {
      load()
        .then(({ list, nextCursor }) => {
          setNotifications(list)
          setNextCursor(nextCursor)
          setLoading(false)
        })
        .catch(() => { setError(true); setLoading(false) })
    }
  }, [status, router, load])

  // Live-prepend notifications pushed over Pusher. Bulk fan-outs
  // (notifyMany, admin announcements) push without a row id — refetch
  // the first page for those instead of prepending.
  useEffect(() => {
    const onNew = (e: Event) => {
      const n = (e as CustomEvent).detail as Notification | undefined
      if (!n?.id) {
        load()
          .then(({ list, nextCursor }) => {
            setNotifications(list)
            setNextCursor(nextCursor)
          })
          .catch(() => {})
        return
      }
      if (seen.current.has(n.id)) return
      seen.current.add(n.id)
      setNotifications((prev) => [{ ...n, createdAt: n.createdAt }, ...prev])
    }
    window.addEventListener("tt-new-notification", onNew)
    return () => window.removeEventListener("tt-new-notification", onNew)
  }, [load])

  const markRead = async (ids: string[]) => {
    setNotifications((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n)))
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }).catch(() => {})
    window.dispatchEvent(new CustomEvent("tt-notifications-read"))
  }

  const markAllRead = async () => {
    setMarking(true)
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    }).catch(() => {})
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    setMarking(false)
    window.dispatchEvent(new CustomEvent("tt-notifications-read"))
  }

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const { list, nextCursor: next } = await load(nextCursor)
      setNotifications((prev) => [...prev, ...list])
      setNextCursor(next)
    } catch {
      // leave state; user can retry
    }
    setLoadingMore(false)
  }

  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-2xl px-4 py-8">
          <div className="mb-6 h-8 w-48 animate-pulse rounded-lg bg-secondary" />
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-lg bg-card" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-2xl px-4 py-16 text-center">
          <p className="text-muted-foreground">Couldn&apos;t load notifications.</p>
          <button
            onClick={() => { setError(false); setLoading(true); load().then(({ list, nextCursor: next }) => { setNotifications(list); setNextCursor(next); setLoading(false) }).catch(() => { setError(true); setLoading(false) }) }}
            className="mt-4 text-primary hover:underline"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  const unread = notifications.filter((n) => !n.read).length

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bell className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">Notifications</h1>
            {unread > 0 && (
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary" aria-live="polite">
                {unread} new
              </span>
            )}
          </div>
          {unread > 0 && (
            <button
              onClick={markAllRead}
              disabled={marking}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
            >
              {marking ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
              Mark all read
            </button>
          )}
        </div>

        <ul className="divide-y divide-border rounded-lg border border-border bg-card" aria-label="Notifications">
          {notifications.length === 0 && (
            <li className="list-none">
              <EmptyState
                icon={Bell}
                title="No notifications yet"
                description="Replies, mentions, reactions, and follows will show up here."
              />
            </li>
          )}
          {notifications.map((n) => {
            const Icon = typeIcon(n.type)
            const row = (
              <div className="flex items-start gap-3">
                <div className="relative shrink-0 pt-0.5">
                  <Avatar src={n.actor?.image} alt={n.actor?.name ?? "TerpTalk"} size="md" />
                  <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-card bg-secondary text-muted-foreground">
                    <Icon className="h-3 w-3" aria-hidden="true" />
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm break-words", !n.read ? "font-semibold" : "text-muted-foreground")}>
                    {n.title}
                  </p>
                  <p className="text-sm text-muted-foreground break-words line-clamp-2">{n.content}</p>
                  <time
                    className="mt-1 block text-xs text-muted-foreground"
                    dateTime={n.createdAt}
                    title={new Date(n.createdAt).toLocaleString()}
                  >
                    {formatRelativeTime(n.createdAt)}
                  </time>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {!n.read && (
                    <span className="h-2 w-2 rounded-full bg-primary" aria-label="Unread" />
                  )}
                </div>
              </div>
            )
            return (
              <li
                key={n.id}
                className={cn(
                  "group relative flex items-start gap-2 transition-colors",
                  !n.read && "bg-primary/[0.04]"
                )}
              >
                {n.link ? (
                  <Link
                    href={n.link}
                    onClick={() => { if (!n.read) markRead([n.id]) }}
                    className="min-w-0 flex-1 p-4 hover:bg-secondary/50 rounded-l-lg"
                  >
                    {row}
                  </Link>
                ) : (
                  <div className="min-w-0 flex-1 p-4">{row}</div>
                )}
                {!n.read && (
                  <button
                    onClick={() => markRead([n.id])}
                    className="mr-1 mt-3 flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                    aria-label="Mark as read"
                    title="Mark as read"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                )}
              </li>
            )
          })}
        </ul>

        {nextCursor && (
          <div className="mt-4 text-center">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
            >
              {loadingMore ? <Loader2 className="inline h-4 w-4 animate-spin" /> : "Load older notifications"}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
