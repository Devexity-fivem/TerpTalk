"use client"

import { signInHref } from "@/lib/callback-url"

import { Fragment, useEffect, useRef, useState, useCallback, Suspense } from "react"
import { useSession } from "next-auth/react"
import { useSearchParams, useRouter } from "next/navigation"
import { Mail, Send, Loader2, MessageCircle, User, ChevronLeft } from "@/lib/icons"
import Link from "next/link"
import EmptyState from "@/components/ui/empty-state"
import Tooltip from "@/components/ui/tooltip"
import UserPopover from "@/components/user-popover"
import PageHeader from "@/components/ui/page-header"
import { Avatar } from "@/components/ui/avatar"
import TimeAgo from "@/components/ui/time-ago"
import { cn } from "@/lib/utils"

interface Convo {
  partner: { id: string; name: string | null; image: string | null; role: string; profile: { username: string | null } | null }
  lastMessage: string
  lastAt: string
  unread: number
}
interface Msg {
  id: string
  content: string
  senderId: string
  createdAt: string
  sender: { profile: { username: string | null } | null; name: string | null }
}

// Day separators in the thread — same labels the chat log uses.
function sameDay(a: string, b: string): boolean {
  const da = new Date(a)
  const db = new Date(b)
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  )
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const now = new Date()
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86_400_000)
  if (diffDays === 0) return "Today"
  if (diffDays === 1) return "Yesterday"
  return d.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" as const } : {}),
  })
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}>
      <MessagesInner />
    </Suspense>
  )
}

function MessagesInner() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const withId = searchParams.get("with")

  const [convos, setConvos] = useState<Convo[]>([])
  const [messages, setMessages] = useState<Msg[]>([])
  const [draft, setDraft] = useState("")
  const [loading, setLoading] = useState(true)
  const [convoError, setConvoError] = useState(false)
  // First page of the ACTIVE thread has landed — gates the thread spinner
  // so the 10s poll never flickers it back on.
  const [threadReady, setThreadReady] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const [hasOlder, setHasOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const topRef = useRef<HTMLDivElement>(null)

  const loadConvos = useCallback(() => {
    fetch("/api/messages")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        setConvos(d?.conversations || [])
        setConvoError(false)
        setLoading(false)
      })
      .catch(() => {
        setLoading(false)
        setConvoError(true)
      })
  }, [])

  const messagesRef = useRef<Msg[]>([])
  useEffect(() => { messagesRef.current = messages }, [messages])
  // Which conversation the current message state belongs to, and its tail
  // cursor — both reset on every conversation switch so a stale poll can
  // never bleed one thread into another or reuse the wrong incremental tail.
  const activeWithRef = useRef<string | null>(null)
  const cursorRef = useRef<{ ts: string; id: string } | null>(null)

  const markRead = useCallback((uid: string) => {
    setConvos((prev) => prev.map((c) => (c.partner.id === uid ? { ...c, unread: 0 } : c)))
  }, [])

  const loadThread = useCallback((uid: string) => {
    const applyPage = (d: { messages?: Msg[]; incremental?: boolean; hasMore?: boolean } | null) => {
      if (activeWithRef.current !== uid) return // stale response — conversation changed mid-flight
      setThreadReady(true)
      if (!d) return
      if (d.incremental) {
        const fresh: Msg[] = d.messages || []
        if (fresh.length) {
          const last = fresh[fresh.length - 1]
          cursorRef.current = { ts: last.createdAt, id: last.id }
          setMessages((prev) => {
            const seen = new Set(prev.map((m) => m.id))
            return [...prev, ...fresh.filter((m) => !seen.has(m.id))]
          })
          setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50)
        }
      } else {
        const list: Msg[] = d.messages || []
        const last = list[list.length - 1]
        cursorRef.current = last ? { ts: last.createdAt, id: last.id } : null
        setMessages(list)
        setHasOlder(!!d.hasMore)
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50)
      }
      markRead(uid)
    }
    // One page fetch; when more fresh history than a page remains, the next
    // page is chained so the tail is fully drained before the next poll.
    const fetchPage = (): void => {
      const cursor = activeWithRef.current === uid ? cursorRef.current : null
      const qs = cursor
        ? `&after=${encodeURIComponent(cursor.ts)}&afterId=${encodeURIComponent(cursor.id)}`
        : ""
      fetch(`/api/messages?with=${uid}${qs}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          applyPage(d)
          if (d?.incremental && d?.hasMore && activeWithRef.current === uid) fetchPage()
        })
        .catch(() => { if (activeWithRef.current === uid) setThreadReady(true) })
    }
    fetchPage()
  }, [markRead])

  const loadOlder = useCallback(() => {
    const uid = activeWithRef.current
    const earliest = messagesRef.current[0]
    if (!uid || !earliest || loadingOlder) return
    setLoadingOlder(true)
    fetch(`/api/messages?with=${uid}&before=${encodeURIComponent(earliest.createdAt)}&beforeId=${encodeURIComponent(earliest.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || activeWithRef.current !== uid) return
        const older: Msg[] = d.messages || []
        if (older.length) {
          setMessages((prev) => {
            const seen = new Set(prev.map((m) => m.id))
            return [...older.filter((m) => !seen.has(m.id)), ...prev]
          })
          setTimeout(() => topRef.current?.scrollIntoView({ behavior: "instant" }), 50)
        }
        setHasOlder(!!d.hasMore)
      })
      .catch(() => {})
      .finally(() => setLoadingOlder(false))
  }, [loadingOlder])

  useEffect(() => {
    if (status === "unauthenticated") router.push(signInHref(window.location.pathname + window.location.search))
    if (status === "authenticated") loadConvos()
  }, [status, router, loadConvos])

  useEffect(() => {
    if (!withId || !session) return
    // Conversation switch (or first open): drop the previous thread's
    // messages and cursor so nothing from conversation A leaks into B.
    if (activeWithRef.current !== withId) {
      activeWithRef.current = withId
      cursorRef.current = null
      setMessages([])
      setHasOlder(false)
      setError("")
      setThreadReady(false)
    }
    loadThread(withId)
    const poll = () => {
      if (document.hidden) return
      loadThread(withId)
    }
    const t = setInterval(poll, 10000)
    const onVisibility = () => { if (!document.hidden) loadThread(withId) }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      clearInterval(t)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [withId, session, loadThread])

  const send = async () => {
    if (!draft.trim() || !withId || sending) return
    setSending(true)
    setError("")
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: withId, content: draft }),
      })
      if (res.ok) {
        setDraft("")
        loadThread(withId)
        loadConvos()
      } else {
        const d = await res.json()
        setError(d.error || "Failed to send")
      }
    } finally { setSending(false) }
  }

  const nameOf = (u: Convo["partner"]) => u.profile?.username || u.name || "Member"
  const active = convos.find((c) => c.partner.id === withId)?.partner
  const totalUnread = convos.reduce((n, c) => n + c.unread, 0)
  const partnerName = active ? nameOf(active) : "them"

  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-5xl px-4 py-8">
          <div className="mb-6 h-9 w-52 animate-pulse rounded-lg bg-secondary" />
          <div className="grid gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
            <div className="h-[70dvh] min-h-80 animate-pulse rounded-2xl border border-border/70 bg-card/60" />
            <div className="hidden h-[70dvh] min-h-80 animate-pulse rounded-2xl border border-border/70 bg-card/60 md:block" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-3 py-5 sm:px-4 sm:py-8">
        <PageHeader
          context={<span className="tt-eyebrow">Direct messages</span>}
          title={
            <span className="flex items-center gap-3">
              <Mail className="h-6 w-6 text-primary" aria-hidden="true" />
              Messages
              {totalUnread > 0 && (
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary tabular-nums" aria-live="polite">
                  {totalUnread} unread
                </span>
              )}
            </span>
          }
          description="Private conversations with members — replies also land in your notifications."
        />

        <div className="grid gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
          {/* Conversation list — full pane on mobile until a thread opens;
              always visible beside the thread on md+. */}
          <section
            aria-label="Conversations"
            className={cn(
              "tt-spotlight flex h-[70dvh] min-h-80 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/80",
              withId ? "hidden md:flex" : "flex"
            )}
          >
            <div className="flex items-center justify-between border-b border-border/70 px-4 py-2.5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Inbox</h2>
              {totalUnread > 0 && (
                <span className="text-xs font-medium text-primary tabular-nums">{totalUnread} new</span>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {convoError ? (
                <EmptyState
                  icon={Mail}
                  title="Couldn't load conversations"
                  description="Check your connection and try again."
                >
                  <button
                    onClick={() => { setLoading(true); setConvoError(false); loadConvos() }}
                    className="tt-cta mt-4 inline-flex items-center rounded-full px-4 py-2 text-xs font-semibold text-primary-foreground transition-all"
                  >
                    Try again
                  </button>
                </EmptyState>
              ) : convos.length === 0 ? (
                <EmptyState
                  icon={MessageCircle}
                  title="No conversations yet"
                  description="Visit a member's profile and hit Message to start one."
                  action={{ label: "Discover growers", href: "/discover" }}
                />
              ) : (
                <ul className="divide-y divide-border/60">
                  {convos.map((c) => {
                    const isActive = withId === c.partner.id
                    return (
                      <li key={c.partner.id}>
                        <div
                          className={cn(
                            "flex items-center gap-1 pr-1.5 transition-colors",
                            isActive ? "bg-primary/[0.08]" : "hover:bg-secondary/60"
                          )}
                        >
                          <Link
                            href={`/messages?with=${c.partner.id}`}
                            aria-current={isActive ? "true" : undefined}
                            className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-3.5"
                          >
                            <span className="relative shrink-0">
                              <Avatar src={c.partner.image} alt="" size="sm" />
                              {c.unread > 0 && (
                                <span
                                  className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-card"
                                  role="status"
                                  aria-label={`${c.unread} unread messages`}
                                />
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-baseline justify-between gap-2">
                                <span className={cn("truncate text-sm", c.unread > 0 ? "font-semibold text-foreground" : "font-medium text-foreground")}>
                                  {nameOf(c.partner)}
                                </span>
                                <TimeAgo value={c.lastAt} className="shrink-0 text-[11px] text-muted-foreground" />
                              </span>
                              <span className="mt-0.5 flex items-center justify-between gap-2">
                                <span className={cn("truncate text-xs", c.unread > 0 ? "font-medium text-foreground/80" : "text-muted-foreground")}>
                                  {c.lastMessage}
                                </span>
                                {c.unread > 0 && (
                                  <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground tabular-nums">
                                    {c.unread > 99 ? "99+" : c.unread}
                                  </span>
                                )}
                              </span>
                            </span>
                          </Link>
                          <Tooltip content="View profile">
                            <Link
                              href={`/u/${encodeURIComponent(nameOf(c.partner))}`}
                              aria-label={`View ${nameOf(c.partner)}'s profile`}
                              className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-primary"
                            >
                              <User className="h-3.5 w-3.5" />
                            </Link>
                          </Tooltip>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </section>

          {/* Thread view */}
          <section
            aria-label="Conversation"
            className={cn(
              "tt-spotlight flex h-[70dvh] min-h-80 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/80",
              !withId ? "hidden md:flex" : "flex"
            )}
          >
            {!withId ? (
              <div className="flex flex-1 items-center justify-center p-6">
                <EmptyState
                  icon={Mail}
                  title="Select a conversation"
                  description="Pick a conversation on the left — or start one from a member's profile."
                />
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2.5 sm:px-4">
                  <Link
                    href="/messages"
                    aria-label="Back to conversations"
                    className="-ml-1 shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground md:hidden"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </Link>
                  <Avatar src={active?.image} alt="" size="sm" />
                  <div className="min-w-0 flex-1">
                    {active ? (
                      <UserPopover username={active.profile?.username}>
                        <Link
                          href={`/u/${encodeURIComponent(nameOf(active))}`}
                          className="block truncate text-sm font-semibold hover:text-primary hover:underline"
                        >
                          {nameOf(active)}
                        </Link>
                      </UserPopover>
                    ) : (
                      <span className="block truncate text-sm font-semibold text-foreground">Conversation</span>
                    )}
                    <p className="text-[11px] text-muted-foreground">Direct message</p>
                  </div>
                  {active && (
                    <Tooltip content="View profile">
                      <Link
                        href={`/u/${encodeURIComponent(nameOf(active))}`}
                        aria-label={`View ${nameOf(active)}'s profile`}
                        className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-primary"
                      >
                        <User className="h-4 w-4" />
                      </Link>
                    </Tooltip>
                  )}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5">
                  {hasOlder && (
                    <div className="mb-3 flex justify-center">
                      <button
                        onClick={loadOlder}
                        disabled={loadingOlder}
                        className="rounded-full border border-border/70 px-3.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
                      >
                        {loadingOlder ? "Loading..." : "Load earlier messages"}
                      </button>
                    </div>
                  )}
                  <div ref={topRef} />
                  {!threadReady && messages.length === 0 ? (
                    <div className="flex h-full items-center justify-center">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex h-full items-center justify-center p-6">
                      <EmptyState
                        compact
                        icon={MessageCircle}
                        title="No messages yet"
                        description={`Say hello to ${partnerName} — keep it friendly.`}
                      />
                    </div>
                  ) : (
                    <div className="flex flex-col">
                      {messages.map((m, i) => {
                        const mine = m.senderId === session?.user?.id
                        const prev = messages[i - 1]
                        const next = messages[i + 1]
                        const dayBreak = !prev || !sameDay(prev.createdAt, m.createdAt)
                        const continues =
                          !!prev &&
                          !dayBreak &&
                          prev.senderId === m.senderId
                        const lastOfRun =
                          !next || next.senderId !== m.senderId || !sameDay(next.createdAt, m.createdAt)
                        return (
                          <Fragment key={m.id}>
                            {dayBreak && (
                              <div className="my-3 flex items-center gap-2" role="separator" aria-label={dayLabel(m.createdAt)}>
                                <span className="h-px flex-1 bg-border/60" />
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                  {dayLabel(m.createdAt)}
                                </span>
                                <span className="h-px flex-1 bg-border/60" />
                              </div>
                            )}
                            <div className={cn("flex", mine ? "justify-end" : "justify-start", continues ? "mt-1" : "mt-3")}>
                              <div
                                className={cn(
                                  "max-w-[78%] px-3.5 py-2 text-sm leading-relaxed wrap-break-word sm:max-w-[65%]",
                                  mine
                                    ? cn("rounded-2xl bg-primary text-primary-foreground", lastOfRun && "rounded-br-md")
                                    : cn("rounded-2xl bg-secondary text-secondary-foreground", lastOfRun && "rounded-bl-md")
                                )}
                              >
                                <p className="whitespace-pre-wrap wrap-break-word">{m.content}</p>
                              </div>
                            </div>
                            {lastOfRun && (
                              <p className={cn("mt-1 text-[10px] text-muted-foreground", mine && "text-right")}>
                                <time dateTime={m.createdAt}>
                                  {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                </time>
                              </p>
                            )}
                          </Fragment>
                        )
                      })}
                      <div ref={bottomRef} />
                    </div>
                  )}
                </div>

                <div className="border-t border-border/70 p-3">
                  {error && <p role="alert" className="mb-2 text-xs text-destructive">{error}</p>}
                  <div className="flex items-center gap-2">
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
                      placeholder={`Message ${partnerName}...`}
                      maxLength={2000}
                      aria-label="Message"
                      className="flex-1 rounded-full border border-border/70 bg-background px-4 py-2.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/60 focus:border-primary/50"
                    />
                    <Tooltip content="Send message">
                      <button
                        onClick={send}
                        disabled={sending || !draft.trim()}
                        aria-label="Send message"
                        className="tt-cta shrink-0 rounded-full p-2.5 text-primary-foreground transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      </button>
                    </Tooltip>
                  </div>
                  {draft.length > 1800 && (
                    <p className="mt-1 text-right text-[10px] tabular-nums text-muted-foreground">
                      {draft.length}/2000
                    </p>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
