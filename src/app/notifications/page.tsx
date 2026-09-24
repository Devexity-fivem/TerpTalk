"use client"

import { signInHref } from "@/lib/callback-url"

import { useCallback, useEffect, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import {
  Bell, BellRing, Loader2, CheckCheck, Check, UserPlus, Heart, MessageSquare, AtSign,
  MessageCircle, Leaf, Mail, CheckCircle2, Award, TrendingUp, Users, Shield, Settings, Bot, Trash2, Target,
} from "lucide-react"
import Link from "next/link"
import EmptyState from "@/components/ui/empty-state"
import Tooltip from "@/components/ui/tooltip"
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
  metadata?: { kind?: string } | null
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
  BOT_ASSIST: Bot,
  FOLLOWED_CONTENT: UserPlus,
}

function typeIcon(type: string, kind?: string) {
  // Progression notifications share the REPUTATION type — the metadata
  // kind distinguishes quest/challenge/milestone icons.
  if (type === "REPUTATION" && kind === "quest") return Target
  if (type === "REPUTATION" && kind === "challenge") return Target
  return TYPE_ICONS[type] ?? Bell
}

// Human labels for the avatar type badge — same keys as TYPE_ICONS, with
// the same quest/challenge split for REPUTATION.
const TYPE_LABELS: Record<string, string> = {
  FOLLOW: "Follow",
  REACTION: "Reaction",
  REPLY: "Reply",
  THREAD_ACTIVITY: "Thread activity",
  MENTION: "Mention",
  COMMENT: "Comment",
  DIARY_UPDATE: "Diary update",
  DIRECT_MESSAGE: "Message",
  ACCEPTED_ANSWER: "Accepted answer",
  BADGE: "Badge",
  REPUTATION: "Reputation",
  REFERRAL: "Referral",
  MODERATOR_ANNOUNCEMENT: "Announcement",
  BOT_ASSIST: "Bot assist",
  FOLLOWED_CONTENT: "Follow",
}

function typeLabel(type: string, kind?: string) {
  if (type === "REPUTATION" && kind === "quest") return "Quest"
  if (type === "REPUTATION" && kind === "challenge") return "Challenge"
  return TYPE_LABELS[type] ?? "Notification"
}

// ── Notification grouping ──────────────────────────────────────────
type NotifGroup = "all" | "social" | "grows" | "progress" | "system"

const SOCIAL_TYPES = new Set(["FOLLOW", "REACTION", "REPLY", "MENTION", "THREAD_ACTIVITY", "COMMENT", "DIRECT_MESSAGE", "FOLLOWED_CONTENT"])
const GROW_TYPES = new Set(["DIARY_UPDATE", "BOT_ASSIST"])
const PROGRESS_TYPES = new Set(["BADGE", "REPUTATION", "REFERRAL"])
const SYSTEM_TYPES = new Set(["MODERATOR_ANNOUNCEMENT", "ACCEPTED_ANSWER"])

function notifGroup(type: string): NotifGroup {
  if (SOCIAL_TYPES.has(type)) return "social"
  if (GROW_TYPES.has(type)) return "grows"
  if (PROGRESS_TYPES.has(type)) return "progress"
  if (SYSTEM_TYPES.has(type)) return "system"
  return "social"
}

const GROUP_LABELS: { key: NotifGroup; label: string; icon: typeof Bell }[] = [
  { key: "all", label: "All", icon: Bell },
  { key: "social", label: "Social", icon: MessageSquare },
  { key: "grows", label: "Grows", icon: Leaf },
  { key: "progress", label: "Progress", icon: TrendingUp },
  { key: "system", label: "System", icon: Shield },
]

export default function NotificationsPage() {
  const { status } = useSession()
  const router = useRouter()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(false)
  const [marking, setMarking] = useState(false)
  const [activeGroup, setActiveGroup] = useState<NotifGroup>("all")
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

  const deleteNotification = async (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id))
    await fetch("/api/notifications", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id] }),
    }).catch(() => {})
    window.dispatchEvent(new CustomEvent("tt-notifications-read"))
  }

  const clearAll = async () => {
    if (!confirm("Clear all notifications? This can't be undone.")) return
    setNotifications([])
    await fetch("/api/notifications", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    }).catch(() => {})
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
  const filteredNotifications = activeGroup === "all"
    ? notifications
    : notifications.filter((n) => notifGroup(n.type) === activeGroup)

  // Per-group unread counts for tab badges
  const groupUnread = (g: NotifGroup) =>
    g === "all" ? unread : notifications.filter((n) => !n.read && notifGroup(n.type) === g).length

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bell className="h-6 w-6 text-primary" />
            <h1 className="font-display text-2xl font-bold tracking-tight">Notifications</h1>
            {unread > 0 && (
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary" aria-live="polite">
                {unread} new
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
          <Tooltip content="Notification settings">
            <Link
              href="/settings/notifications"
              aria-label="Notification settings"
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Settings className="h-4 w-4" />
            </Link>
          </Tooltip>
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
          {notifications.length > 0 && (
            <Tooltip content="Clear all notifications">
              <button
                onClick={clearAll}
                aria-label="Clear all notifications"
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </Tooltip>
          )}
          </div>
        </div>

        {/* Notification group tabs */}
        <div className="mb-4 flex gap-1 overflow-x-auto scrollbar-none rounded-xl bg-secondary/40 p-1" role="tablist" aria-label="Notification categories">
          {GROUP_LABELS.map(({ key, label, icon: GIcon }) => {
            const count = groupUnread(key)
            return (
              <button
                key={key}
                role="tab"
                aria-selected={activeGroup === key}
                onClick={() => setActiveGroup(key)}
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  activeGroup === key
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-card/50"
                )}
              >
                <GIcon className="h-3.5 w-3.5" />
                {label}
                {count > 0 && (
                  <span className="ml-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary tabular-nums">
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <ul className="divide-y divide-border/60 rounded-2xl border border-border/70 bg-card/80" aria-label="Notifications">
          {filteredNotifications.length === 0 && (
            <li className="list-none">
              <EmptyState
                icon={activeGroup === "all" ? Bell : GROUP_LABELS.find((g) => g.key === activeGroup)?.icon ?? Bell}
                title={activeGroup === "all" ? "No notifications yet" : `No ${activeGroup} notifications`}
                description={
                  activeGroup === "all"
                    ? "Replies, mentions, reactions, and follows will show up here."
                    : activeGroup === "social"
                      ? "Replies, mentions, follows, and reactions will appear here."
                      : activeGroup === "grows"
                        ? "Updates from followed diaries and TerpBot insights will appear here."
                        : activeGroup === "progress"
                          ? "Badge unlocks, reputation changes, and quest progress will appear here."
                          : "System and moderation notices will appear here."
                }
              />
            </li>
          )}
          {filteredNotifications.map((n) => {
            const Icon = typeIcon(n.type, n.metadata?.kind)
            // Derive link destination context for the notification
            const linkContext = n.link
              ? n.link.startsWith("/diaries/") ? "View grow"
                : n.link.startsWith("/forum/") ? "View discussion"
                : n.link.startsWith("/u/") ? "View profile"
                : n.link.startsWith("/messages") ? "Open message"
                : n.link.startsWith("/progress") ? "View progress"
                : n.link.startsWith("/achievements") ? "View achievement"
                : "View"
              : null

            const row = (
              <div className="flex items-start gap-3">
                <div className="relative shrink-0 pt-0.5">
                  <Avatar src={n.actor?.image} alt={n.actor?.name ?? "TerpTalk"} size="md" />
                  <Tooltip content={typeLabel(n.type, n.metadata?.kind)} className="absolute -bottom-1 -right-1">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-card bg-secondary text-muted-foreground">
                      <Icon className="h-3 w-3" aria-hidden="true" />
                    </span>
                  </Tooltip>
                </div>
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm break-words", !n.read ? "font-semibold" : "text-muted-foreground")}>
                    {n.title}
                  </p>
                  <p className="text-sm text-muted-foreground break-words line-clamp-2">{n.content}</p>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <Tooltip content={new Date(n.createdAt).toLocaleString()} align="start">
                      <time dateTime={n.createdAt}>
                        {formatRelativeTime(n.createdAt)}
                      </time>
                    </Tooltip>
                    {linkContext && (
                      <span className="text-primary/70 font-medium">{linkContext} →</span>
                    )}
                  </div>
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
                  "group relative flex items-start gap-1 transition-colors",
                  !n.read && "bg-primary/[0.04]"
                )}
              >
                {n.link ? (
                  <Link
                    href={n.link}
                    onClick={() => { if (!n.read) markRead([n.id]) }}
                    className="tt-spotlight min-w-0 flex-1 p-4 hover:bg-secondary/50 rounded-l-lg"
                  >
                    {row}
                  </Link>
                ) : (
                  <div className="min-w-0 flex-1 p-4">{row}</div>
                )}
                {/* Actions — stack vertically on touch so two 44px targets
                    don't crowd the row; side-by-side on desktop. */}
                <div className="flex shrink-0 flex-col items-center sm:flex-row">
                  {!n.read && (
                    <Tooltip content="Mark as read" className="sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100">
                      <button
                        onClick={() => markRead([n.id])}
                        className="mr-1 mt-1.5 flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:mt-3"
                        aria-label="Mark as read"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                    </Tooltip>
                  )}
                  <Tooltip content="Delete notification" className="sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100">
                    <button
                      onClick={() => deleteNotification(n.id)}
                      className="mr-1 mt-1.5 flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive sm:mt-3"
                      aria-label="Delete notification"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </Tooltip>
                </div>
              </li>
            )
          })}
        </ul>

        {nextCursor && (
          <div className="mt-4 text-center">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
            >
              {loadingMore ? <Loader2 className="inline h-4 w-4 animate-spin" /> : "Load older notifications"}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
