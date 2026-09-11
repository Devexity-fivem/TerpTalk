"use client"

import { useState, useEffect, useRef } from "react"
import { useSession } from "next-auth/react"
import {
  MessageCircle, Send, X, Loader2, Smile, RefreshCw, MoreVertical,
  Trash2, AlertTriangle, Clock, Shield, User as UserIcon,
} from "lucide-react"
import RoleBadge from "@/components/role-badge"
import { useToast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import dynamic from "next/dynamic"
import { Theme, EmojiStyle } from "emoji-picker-react"

// Full emoji picker — lazy-loaded so it doesn't bloat the initial bundle
const EmojiPicker = dynamic(() => import("emoji-picker-react"), { ssr: false })

interface Room {
  id: string
  name: string
  slug: string
  description: string
  _count: { messages: number }
}

interface Message {
  id: string
  content: string
  createdAt: string
  author: {
    id: string
    name: string
    username?: string | null
    role?: string | null
    image?: string | null
  }
}

export default function ChatSidebar() {
  const { data: session } = useSession()
  const { toast } = useToast()
  const myRole = (session?.user as { role?: string } | undefined)?.role
  const isStaff = myRole === "MODERATOR" || myRole === "ADMINISTRATOR"
  const isAdmin = myRole === "ADMINISTRATOR"
  const [isOpen, setIsOpen] = useState(false)
  const [showEmoji, setShowEmoji] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [room, setRoom] = useState<Room | null>(null)
  const [onlineCount, setOnlineCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const [sending, setSending] = useState(false)
  const [activeMenu, setActiveMenu] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const scrollToBottom = () => {
    const container = messagesContainerRef.current
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" })
    }
  }

  useEffect(() => {
    if (isOpen && messages.length > 0) {
      scrollToBottom()
    }
  }, [messages, isOpen])

  useEffect(() => {
    const onOpen = () => setIsOpen(true)
    const onClose = () => setIsOpen(false)
    window.addEventListener("tt-open-chat", onOpen)
    window.addEventListener("tt-close-chat", onClose)
    return () => {
      window.removeEventListener("tt-open-chat", onOpen)
      window.removeEventListener("tt-close-chat", onClose)
    }
  }, [])

  // Load the general room (single community chat)
  useEffect(() => {
    if (!session || !isOpen) return

    let cancelled = false

    fetch("/api/chat/rooms")
      .then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || `HTTP ${res.status}`)
        }
        return res.json()
      })
      .then(data => {
        if (cancelled) return
        const all: Room[] = data.rooms || []
        setRoom(all.find(r => r.slug === "general") || all[0] || null)
        setOnlineCount(data.onlineCount || 0)
        setFetchError(null)
      })
      .catch(err => {
        if (cancelled) return
        const message = err?.message || "Failed to load chat"
        console.error("Failed to load chat room:", err)
        setFetchError(message)
        toast(message, "error")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [session, isOpen, retryCount, toast])

  // Load messages: realtime via Pusher when configured, otherwise poll.
  // Polls are incremental (?after=) so idle polls are near-empty.
  const lastTsRef = useRef<string | null>(null)
  useEffect(() => {
    if (!session || !room || !isOpen) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let cleanupPusher: (() => void) | null = null

    const mergeFresh = (fresh: Message[]) => {
      if (fresh.length === 0) return false
      lastTsRef.current = fresh[fresh.length - 1].createdAt
      let changed = false
      setMessages(prev => {
        const seen = new Set(prev.map(m => m.id))
        const added = fresh.filter(m => !seen.has(m.id))
        if (!added.length) return prev
        changed = true
        return [...prev, ...added].slice(-100)
      })
      return changed
    }

    const load = async () => {
      if (cancelled || document.hidden) return
      try {
        const url = lastTsRef.current
          ? `/api/chat/messages?roomId=${room.id}&after=${encodeURIComponent(lastTsRef.current)}`
          : `/api/chat/messages?roomId=${room.id}`
        const res = await fetch(url)
        if (!res.ok) return
        const data = await res.json()
        mergeFresh(data.messages || [])
      } catch { /* ignore transient errors */ }
    }

    const pusherKey = process.env.NEXT_PUBLIC_PUSHER_KEY
    const pusherCluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER
    const realtime = !!(pusherKey && pusherCluster)

    const tick = async () => {
      await load()
      if (cancelled) return
      // With realtime push, a slow 30s poll is just a missed-message safety net.
      // Without Pusher, poll every 10s to keep function invocations sane on the free tier.
      timer = setTimeout(tick, realtime ? 30000 : 10000)
    }

    const subscribe = async () => {
      if (!realtime) return
      try {
        const { default: Pusher } = await import("pusher-js")
        const p = new Pusher(pusherKey!, {
          cluster: pusherCluster!,
          authEndpoint: "/api/pusher/auth", // private channels need a session
        })
        const channel = p.subscribe(`private-chat-${room.id}`)
        channel.bind("new-message", (m: Message) => {
          if (!cancelled) mergeFresh([m])
        })
        cleanupPusher = () => { p.unsubscribe(`private-chat-${room.id}`); p.disconnect() }
      } catch { /* stay on polling */ }
    }

    const onVisible = () => { if (!document.hidden) load() }
    document.addEventListener("visibilitychange", onVisible)

    lastTsRef.current = null
    subscribe()
    tick()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      cleanupPusher?.()
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [session, room, isOpen])

  const insertEmoji = (emoji: string) => {
    const el = inputRef.current
    if (!el) {
      return
    }
    const value = el.value
    const start = el.selectionStart ?? value.length
    const end = el.selectionEnd ?? value.length
    const next = value.slice(0, start) + emoji + value.slice(end)
    el.value = next
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + emoji.length, start + emoji.length)
    })
  }

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    const content = inputRef.current?.value.trim() ?? ""
    if (!content) return
    if (!session) {
      toast("Sign in to chat", "error")
      return
    }
    if (!room) {
      toast("Chat room is loading. Try again in a second.", "error")
      return
    }
    if (sending) return

    setSending(true)
    try {
      const response = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, roomId: room.id }),
      })

      if (response.ok) {
        const data = await response.json()
        setMessages(prev => [...prev, data.message])
        if (inputRef.current) inputRef.current.value = ""
        setShowEmoji(false)
      } else {
        let message = "Message failed to send"
        try {
          const body = await response.json()
          if (body?.error) message = body.error
        } catch {}
        toast(message, "error")
      }
    } catch (error) {
      console.error("Failed to send message:", error)
      toast("Message failed to send", "error")
    } finally {
      setSending(false)
    }
  }

  const takeModerationAction = async (
    actionType: string,
    targetUserId: string,
    opts?: { targetType?: string; targetId?: string; durationDays?: number }
  ) => {
    const reason = window.prompt(`Reason for ${actionType.replace(/_/g, " ").toLowerCase()}:`)
    if (!reason || !reason.trim()) return
    try {
      const res = await fetch("/api/moderation/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionType,
          targetUserId,
          reason: reason.trim().slice(0, 500),
          ...(opts?.targetType && { targetType: opts.targetType }),
          ...(opts?.targetId && { targetId: opts.targetId }),
          ...(opts?.durationDays && { durationDays: opts.durationDays }),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      toast("Moderation action applied", "success")
      if (actionType === "CONTENT_DELETION" && opts?.targetId) {
        setMessages(prev => prev.map(m => m.id === opts.targetId ? { ...m, content: "[deleted]" } : m))
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Moderation action failed"
      toast(message, "error")
    } finally {
      setActiveMenu(null)
    }
  }

  if (!session) {
    return null
  }

  return (
    <>
      {/* Floating toggle button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          fixed z-50 inline-flex items-center gap-2 rounded-full
          bg-primary text-primary-foreground shadow-lg shadow-primary/20
          px-3.5 py-2.5 text-sm font-medium
          hover:bg-primary/90 transition-colors
          bottom-20 left-4 lg:bottom-6 lg:right-6 lg:left-auto
        `}
        aria-label={isOpen ? "Close chat" : "Open community chat"}
        aria-expanded={isOpen}
      >
        <MessageCircle className="w-4 h-4" />
        <span className="hidden sm:inline">Chat</span>
        {onlineCount > 0 && (
          <span className="ml-0.5 flex h-2 w-2 rounded-full bg-green-400" aria-hidden="true" />
        )}
      </button>

      {/* Floating chat panel */}
      <aside
        className={`
          fixed bottom-[calc(8rem+env(safe-area-inset-bottom))] right-4 z-50 lg:bottom-20
          w-[calc(100vw-2rem)] sm:w-96
          h-[70vh] max-h-[600px]
          bg-card border border-border rounded-xl shadow-2xl
          flex flex-col overflow-hidden
          transition-all duration-200
          ${isOpen ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"}
        `}
      >
        {/* Header */}
        <div className="p-3 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 shrink-0">
              <MessageCircle className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-sm leading-tight">General Chat</h2>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="flex h-1.5 w-1.5 rounded-full bg-green-400" aria-hidden="true" />
                {room ? (
                  <span className="truncate">{onlineCount} growers online</span>
                ) : (
                  <span>Community live chat</span>
                )}
              </div>
            </div>
          </div>
          {(!room || fetchError) && (
            <button
              onClick={() => setRetryCount(c => c + 1)}
              disabled={loading}
              className="p-1.5 hover:bg-secondary rounded-lg transition-colors disabled:opacity-50 mr-1"
              aria-label="Retry loading chat"
              title="Retry loading chat"
            >
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            </button>
          )}
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 hover:bg-secondary rounded-lg transition-colors"
            aria-label="Close chat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 flex flex-col min-h-0">
          <div
            ref={messagesContainerRef}
            className="flex-1 overflow-y-auto p-3 space-y-2"
          >
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
              </div>
            ) : messages.length === 0 ? (
              <div className="text-center py-8">
                <MessageCircle className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="font-medium text-sm">No messages yet</p>
                <p className="text-xs text-muted-foreground">Start the conversation with the TerpTalk community.</p>
              </div>
            ) : (
              messages.map((msg) => {
                const isMenuOpen = activeMenu === msg.id
                const canManage = isStaff && msg.author.id !== (session?.user as { id?: string } | undefined)?.id
                const isDeleted = msg.content === "[deleted]"
                return (
                  <div key={msg.id} className="group relative">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="font-semibold text-xs">
                        {msg.author.username || msg.author.name}
                      </span>
                      <RoleBadge role={msg.author.role} />
                      <span className="text-[10px] text-muted-foreground opacity-70 group-hover:opacity-100 transition-opacity">
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {canManage && (
                        <button
                          onClick={() => setActiveMenu(isMenuOpen ? null : msg.id)}
                          className="ml-auto p-1 rounded hover:bg-secondary text-muted-foreground"
                          aria-label="Moderate message"
                          title="Moderate message"
                        >
                          <MoreVertical className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <p className="text-sm pl-0.5">{isDeleted ? <span className="italic text-muted-foreground">{msg.content}</span> : msg.content}</p>

                    {isMenuOpen && canManage && (
                      <div className="mt-1 rounded-lg border border-border bg-card shadow-lg p-1.5 space-y-1 z-10">
                        <button
                          onClick={() => takeModerationAction("CONTENT_DELETION", msg.author.id, { targetType: "CHAT_MESSAGE", targetId: msg.id })}
                          className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs text-left hover:bg-secondary text-foreground"
                        >
                          <Trash2 className="w-3 h-3 text-destructive" /> Delete message
                        </button>
                        <button
                          onClick={() => takeModerationAction("WARNING", msg.author.id)}
                          className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs text-left hover:bg-secondary text-foreground"
                        >
                          <AlertTriangle className="w-3 h-3 text-amber-500" /> Warn user
                        </button>
                        {isAdmin && (
                          <>
                            <button
                              onClick={() => takeModerationAction("TEMPORARY_BAN", msg.author.id, { durationDays: 1 })}
                              className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs text-left hover:bg-secondary text-foreground"
                            >
                              <Clock className="w-3 h-3 text-blue-400" /> 1-day timeout
                            </button>
                            <button
                              onClick={() => takeModerationAction("TEMPORARY_BAN", msg.author.id, { durationDays: 7 })}
                              className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs text-left hover:bg-secondary text-foreground"
                            >
                              <Clock className="w-3 h-3 text-blue-400" /> 7-day timeout
                            </button>
                            <button
                              onClick={() => takeModerationAction("PERMANENT_BAN", msg.author.id)}
                              className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs text-left hover:bg-secondary text-foreground"
                            >
                              <Shield className="w-3 h-3 text-destructive" /> Ban user
                            </button>
                          </>
                        )}
                        <a
                          href={`/u/${msg.author.username || msg.author.name}`}
                          onClick={() => setIsOpen(false)}
                          className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs text-left hover:bg-secondary text-foreground"
                        >
                          <UserIcon className="w-3 h-3 text-primary" /> View profile
                        </a>
                      </div>
                    )}
                  </div>
                )
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Emoji picker — full emoji set with search */}
          {showEmoji && (
            <div className="border-t border-border shrink-0">
              <EmojiPicker
                onEmojiClick={(emoji) => insertEmoji(emoji.emoji)}
                theme={"dark" as Theme}
                emojiStyle={"native" as EmojiStyle}
                height={320}
                width="100%"
                searchPlaceholder="Search emojis..."
                previewConfig={{ showPreview: false }}
                skinTonesDisabled
              />
            </div>
          )}

          {/* Message Input */}
          <form onSubmit={handleSendMessage} className="p-2 border-t border-border shrink-0">
            <div className="flex gap-1.5 items-center">
              <button
                type="button"
                onClick={() => setShowEmoji(!showEmoji)}
                className={`p-2 rounded-lg transition-colors ${showEmoji ? "bg-primary/10 text-primary" : "hover:bg-secondary text-muted-foreground"}`}
                aria-label="Open emoji picker"
              >
                <Smile className="w-5 h-5" />
              </button>
              <input
                ref={inputRef}
                type="text"
                maxLength={1000}
                title="Maximum 1000 characters"
                placeholder={room ? "Message General Chat..." : "Loading chat room..."}
                className="flex-1 px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                disabled={!room || sending}
              />
              <button
                type="submit"
                disabled={!room || sending}
                aria-label="Send message"
                className="bg-primary text-primary-foreground p-2 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>
          </form>
        </div>
      </aside>
    </>
  )
}
