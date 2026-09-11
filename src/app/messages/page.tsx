"use client"

import { useEffect, useRef, useState, useCallback, Suspense } from "react"
import { useSession } from "next-auth/react"
import { useSearchParams, useRouter } from "next/navigation"
import { Mail, Send, Loader2, MessageCircle } from "lucide-react"
import Link from "next/link"
import EmptyState from "@/components/ui/empty-state"

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
  const bottomRef = useRef<HTMLDivElement>(null)

  const loadConvos = useCallback(() => {
    fetch("/api/messages")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { setConvos(d?.conversations || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const messagesRef = useRef<Msg[]>([])
  useEffect(() => { messagesRef.current = messages }, [messages])

  const loadThread = useCallback((uid: string) => {
    // Incremental poll — only fetch messages newer than the newest we hold
    const latest = messagesRef.current[messagesRef.current.length - 1]
    const qs = latest?.createdAt
      ? `&after=${encodeURIComponent(latest.createdAt)}`
      : ""
    fetch(`/api/messages?with=${uid}${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        if (d.incremental) {
          if (d.messages?.length) {
            setMessages((prev) => [...prev, ...d.messages])
            setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50)
          }
        } else {
          setMessages(d.messages || [])
          setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50)
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (status === "unauthenticated") router.push("/auth/signin")
    if (status === "authenticated") loadConvos()
  }, [status, router, loadConvos])

  useEffect(() => {
    if (!withId || !session) return
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
                  <Link
                    key={c.partner.id}
                    href={`/messages?with=${c.partner.id}`}
                    className={`block p-3 hover:bg-secondary/60 transition-colors ${withId === c.partner.id ? "bg-secondary" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm truncate">{nameOf(c.partner)}</span>
                      {c.unread > 0 && (
                        <span className="bg-primary text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0">
                          {c.unread}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{c.lastMessage}</p>
                  </Link>
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
                  {active ? nameOf(active) : "Conversation"}
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
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
                    <button
                      onClick={send}
                      disabled={sending || !draft.trim()}
                      className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
                    >
                      {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </button>
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
