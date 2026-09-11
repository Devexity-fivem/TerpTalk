"use client"

import { useState, useEffect, useRef } from "react"
import { useSession } from "next-auth/react"
import { MessageCircle, Send, X, Loader2, Smile } from "lucide-react"
import RoleBadge from "@/components/role-badge"
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
    name: string
    role?: string
    profile: { username: string }
  }
}

export default function ChatSidebar() {
  const { data: session } = useSession()
  const [isOpen, setIsOpen] = useState(false)
  const [showEmoji, setShowEmoji] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [room, setRoom] = useState<Room | null>(null)
  const [onlineCount, setOnlineCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
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
    if (!session) return

    fetch("/api/chat/rooms")
      .then(res => res.json())
      .then(data => {
        const all: Room[] = data.rooms || []
        setRoom(all.find(r => r.slug === "general") || all[0] || null)
        setOnlineCount(data.onlineCount || 0)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [session])

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
    if (!content || !session || sending || !room) return

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
      }
    } catch (error) {
      console.error("Failed to send message:", error)
    } finally {
      setSending(false)
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
              messages.map((msg) => (
                <div key={msg.id} className="group">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="font-semibold text-xs">
                      {msg.author.profile?.username || msg.author.name}
                    </span>
                    <RoleBadge role={msg.author.role} />
                    <span className="text-[10px] text-muted-foreground opacity-70 group-hover:opacity-100 transition-opacity">
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-sm pl-0.5">{msg.content}</p>
                </div>
              ))
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
                placeholder="Message General Chat..."
                className="flex-1 px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                disabled={sending}
              />
              <button
                type="submit"
                disabled={sending}
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
