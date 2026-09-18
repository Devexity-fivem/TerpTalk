"use client"

import { signInHref } from "@/lib/callback-url"

import { useEffect, useRef, useState, useCallback, Suspense } from "react"
import { useSession } from "next-auth/react"
import { useSearchParams, useRouter } from "next/navigation"
import { Mail, Send, Loader2, MessageCircle, User } from "lucide-react"
import Link from "next/link"
import EmptyState from "@/components/ui/empty-state"
import Tooltip from "@/components/ui/tooltip"

interface Convo {
  partner: { id: string; name: string | null; role: string; profile: { username: string | null } | null }
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
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const [hasOlder, setHasOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const topRef = useRef<HTMLDivElement>(null)

  const loadConvos = useCallback(() => {
    fetch("/api/messages")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { setConvos(d?.conversations || []); setLoading(false) })
      .catch(() => setLoading(false))
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
      if (!d || activeWithRef.current !== uid) return // stale response — conversation changed mid-flight
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
        .catch(() => {})
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

  if (status === "loading" || loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
          <Mail className="w-6 h-6 text-primary" /> Messages
        </h1>

        <div className="grid md:grid-cols-3 gap-4 h-[70dvh] min-h-[320px]">
          {/* Conversation list */}
          <div className="bg-card border border-border rounded-xl overflow-y-auto">
            {convos.length === 0 ? (
              <EmptyState
                icon={MessageCircle}
                title="No conversations yet"
                description="Visit a member's profile and hit Message to start one."
              />
            ) : (
              <div className="divide-y divide-border">
                {convos.map((c) => (
                  <div
                    key={c.partner.id}
                    className={`p-3 hover:bg-secondary/60 transition-colors ${withId === c.partner.id ? "bg-secondary" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Link
                          href={`/messages?with=${c.partner.id}`}
                          className="font-medium text-sm truncate hover:underline"
                        >
                          {nameOf(c.partner)}
                        </Link>
                        <Tooltip content="View profile">
                          <Link
                            href={`/u/${encodeURIComponent(nameOf(c.partner))}`}
                            aria-label={`View ${nameOf(c.partner)}'s profile`}
                            className="text-muted-foreground hover:text-primary shrink-0"
                          >
                            <User className="w-3.5 h-3.5" />
                          </Link>
                        </Tooltip>
                      </div>
                      <Link href={`/messages?with=${c.partner.id}`} className="flex items-center gap-2 shrink-0">
                        {c.unread > 0 && (
                          <span className="bg-primary text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                            {c.unread}
                          </span>
                        )}
                      </Link>
                    </div>
                    <Link href={`/messages?with=${c.partner.id}`} className="block">
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{c.lastMessage}</p>
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Thread view */}
          <div className="md:col-span-2 bg-card border border-border rounded-xl flex flex-col overflow-hidden">
            {!withId ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                Select a conversation
              </div>
            ) : (
              <>
                <div className="p-3 border-b border-border font-semibold text-sm">
                  {active ? (
                    <Link href={`/u/${encodeURIComponent(nameOf(active))}`} className="hover:text-primary hover:underline">
                      {nameOf(active)}
                    </Link>
                  ) : (
                    "Conversation"
                  )}
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {hasOlder && (
                    <div className="flex justify-center">
                      <button
                        onClick={loadOlder}
                        disabled={loadingOlder}
                        className="text-xs text-muted-foreground hover:text-foreground px-3 py-1 rounded-full border border-border hover:bg-secondary/60 transition-colors disabled:opacity-50"
                      >
                        {loadingOlder ? "Loading..." : "Load earlier messages"}
                      </button>
                    </div>
                  )}
                  <div ref={topRef} />
                  {messages.map((m) => {
                    const mine = m.senderId === session?.user?.id
                    return (
                      <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[75%] px-3 py-2 rounded-xl text-sm ${
                          mine ? "bg-primary text-primary-foreground" : "bg-secondary"
                        }`}>
                          <p className="whitespace-pre-wrap break-words">{m.content}</p>
                          <p className={`text-[10px] mt-1 ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                            {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                  <div ref={bottomRef} />
                </div>
                <div className="p-3 border-t border-border">
                  {error && <p className="text-xs text-destructive mb-2">{error}</p>}
                  <div className="flex gap-2">
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
                      placeholder="Type a message..."
                      maxLength={2000}
                      className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <Tooltip content="Send message">
                      <button
                        onClick={send}
                        disabled={sending || !draft.trim()}
                        aria-label="Send message"
                        className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      </button>
                    </Tooltip>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
