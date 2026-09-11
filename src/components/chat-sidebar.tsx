"use client"

import { useState, useEffect, useRef, useMemo } from "react"
import { useSession } from "next-auth/react"
import {
  MessageCircle, Send, X, Loader2, Smile, RefreshCw, MoreVertical,
  Trash2, AlertTriangle, Clock, Shield, User as UserIcon, MessageSquare,
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
  slowModeSeconds: number
  locked: boolean
  _count: { messages: number }
}

interface Author {
  id: string
  name: string
  username?: string | null
  role?: string | null
  image?: string | null
}

interface Message {
  id: string
  content: string
  createdAt: string
  author: Author
  replyTo: { id: string; content: string; author: Author } | null
}

export default function ChatSidebar() {
  const { data: session } = useSession()
  const { toast } = useToast()
  const myRole = (session?.user as { role?: string } | undefined)?.role
  const isStaff = myRole === "SUPPORT" || myRole === "MODERATOR" || myRole === "ADMINISTRATOR"
  const isModerator = myRole === "MODERATOR" || myRole === "ADMINISTRATOR"
  const isAdmin = myRole === "ADMINISTRATOR"
  const [isOpen, setIsOpen] = useState(
    typeof window !== "undefined" ? window.innerWidth >= 1024 : true
  )
  const [showEmoji, setShowEmoji] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [room, setRoom] = useState<Room | null>(null)
  const [onlineCount, setOnlineCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const [sending, setSending] = useState(false)
  const [activeMenu, setActiveMenu] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState("")
  const [cursor, setCursor] = useState(0)
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [mentionQuery, setMentionQuery] = useState("")
  const [slashQuery, setSlashQuery] = useState("")
  const [showMentions, setShowMentions] = useState(false)
  const [showCommands, setShowCommands] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)

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
    const onClose = () => {
      if (typeof window !== "undefined" && window.innerWidth < 1024) {
        setIsOpen(false)
      }
    }
    window.addEventListener("tt-open-chat", onOpen)
    window.addEventListener("tt-close-chat", onClose)
    return () => {
      window.removeEventListener("tt-open-chat", onOpen)
      window.removeEventListener("tt-close-chat", onClose)
    }
  }, [])

  useEffect(() => {
    const m = window.matchMedia("(min-width: 1024px)")
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setIsOpen(true)
    }
    m.addEventListener("change", onChange)
    return () => m.removeEventListener("change", onChange)
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

  const mentionUsers = useMemo(() => {
    const seen = new Map<string, Author>()
    messages.forEach(m => {
      if (!seen.has(m.author.id)) {
        seen.set(m.author.id, m.author)
      }
    })
    return Array.from(seen.values())
  }, [messages])

  const mentionSuggestions = mentionQuery
    ? mentionUsers.filter(a =>
        (a.username || a.name).toLowerCase().includes(mentionQuery)
      ).slice(0, 5)
    : []

  const commandList = useMemo(() => {
    const list: { name: string; desc: string }[] = [
      { name: "help", desc: "Show chat commands" },
      { name: "me", desc: "Roleplay an action" },
    ]
    if (isStaff) {
      list.push(
        { name: "slowmode", desc: "Set slow mode (0-300s)" },
        { name: "lock", desc: "Lock the chat" },
        { name: "unlock", desc: "Unlock the chat" },
        { name: "announce", desc: "Post an announcement" }
      )
    }
    if (isModerator) {
      list.push(
        { name: "clear", desc: "Clear all messages" },
        { name: "warn", desc: "Warn a user" }
      )
    }
    if (isAdmin) {
      list.push(
        { name: "mute", desc: "Temporarily suspend a user" },
        { name: "ban", desc: "Permanently ban a user" },
        { name: "unban", desc: "Lift a permanent ban" }
      )
    }
    return list
  }, [isStaff, isModerator, isAdmin])

  const commandSuggestions = slashQuery
    ? commandList.filter(c => c.name.startsWith(slashQuery)).slice(0, 6)
    : commandList.slice(0, 6)

  const renderContent = (text: string) => {
    const parts = text.split(/(@[a-zA-Z0-9_-]+)/gi)
    return (
      <>
        {parts.map((part, i) => {
          if (part.startsWith("@")) {
            return (
              <span key={i} className="font-medium text-primary hover:underline cursor-pointer">
                {part}
              </span>
            )
          }
          const lines = part.split("\n")
          return (
            <span key={i}>
              {lines.map((line, j) => (
                <span key={j}>
                  {line}
                  {j < lines.length - 1 && <br />}
                </span>
              ))}
            </span>
          )
        })}
      </>
    )
  }

  const onMentionSelect = (username: string) => {
    const before = inputValue.slice(0, cursor)
    const at = before.lastIndexOf("@")
    if (at >= 0) {
      const next = inputValue.slice(0, at) + "@" + username + " " + inputValue.slice(cursor)
      setInputValue(next)
      setCursor(at + username.length + 2)
      setMentionQuery("")
      setShowMentions(false)
      setShowCommands(false)
    }
  }

  const onCommandSelect = (name: string) => {
    const next = `/${name} `
    setInputValue(next)
    setCursor(next.length)
    setSlashQuery("")
    setShowCommands(false)
    setMentionQuery("")
  }

  const insertEmoji = (emoji: string) => {
    const start = cursor
    const end = cursor
    const next = inputValue.slice(0, start) + emoji + inputValue.slice(end)
    setInputValue(next)
    setCursor(start + emoji.length)
    setShowMentions(false)
    setShowCommands(false)
  }

  const handleInputChange = (value: string, newCursor = value.length) => {
    setInputValue(value)
    setCursor(newCursor)
    setShowMentions(false)
    setShowCommands(false)
    setMentionQuery("")
    setSlashQuery("")

    if (value.startsWith("/") && !value.includes(" ")) {
      setSlashQuery(value.slice(1).toLowerCase())
      setShowCommands(true)
      return
    }

    const before = value.slice(0, cursor)
    const at = before.lastIndexOf("@")
    if (at >= 0) {
      const query = before.slice(at + 1)
      if (!query.includes(" ")) {
        setMentionQuery(query.toLowerCase())
        setShowMentions(true)
      }
    }
  }

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    const content = inputValue.trim()
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
      if (content.startsWith("/")) {
        const response = await fetch("/api/chat/commands", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomId: room.id, content }),
        })

        if (!response.ok) {
          const body = await response.json().catch(() => ({}))
          toast(body.error || "Command failed", "error")
        } else {
          const data = await response.json()
          if (data.room) {
            setRoom(prev => prev ? { ...prev, ...data.room } : prev)
          }
          if (data.cleared !== undefined) {
            setMessages([])
            toast(`Cleared ${data.cleared} messages`, "success")
          }
          if (data.message && data.message.author) {
            setMessages(prev => [...prev, data.message])
          }
        }
      } else {
        const response = await fetch("/api/chat/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content,
            roomId: room.id,
            ...(replyingTo ? { replyToId: replyingTo.id } : {}),
          }),
        })

        if (response.ok) {
          const data = await response.json()
          setMessages(prev => [...prev, data.message])
        } else {
          let message = "Message failed to send"
          try {
            const body = await response.json()
            if (body?.error) message = body.error
          } catch {}
          toast(message, "error")
        }
      }
      setInputValue("")
      setReplyingTo(null)
      setShowEmoji(false)
      setShowMentions(false)
      setShowCommands(false)
    } catch (error) {
      console.error("Failed to send message:", error)
      toast("Failed to send", "error")
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
          fixed z-50 inline-flex items-center gap-2 rounded-full lg:hidden
          bg-primary text-primary-foreground shadow-lg shadow-primary/20
          px-3.5 py-2.5 text-sm font-medium
          hover:bg-primary/90 transition-colors
          bottom-20 left-4
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

      {isOpen && (
      <aside
        className={`
          fixed z-50
          lg:sticky lg:top-16 lg:left-auto lg:right-auto lg:bottom-auto
          lg:w-80
          lg:max-h-none lg:rounded-none lg:rounded-l-xl lg:border-0 lg:border-l lg:shadow-none
          left-4 right-4 bottom-[calc(6rem+env(safe-area-inset-bottom))]
          sm:left-auto sm:w-96 sm:right-4
          h-[70vh] max-h-[600px] lg:h-[calc(100vh-4rem)]
          bg-card border border-border rounded-xl lg:rounded-l-xl
          shadow-2xl lg:shadow-none
          flex flex-col overflow-hidden
          transition-all duration-200
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
            className="p-1.5 hover:bg-secondary rounded-lg transition-colors lg:hidden"
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
                      <button
                        onClick={() => setActiveMenu(isMenuOpen ? null : msg.id)}
                        className="ml-auto p-1 rounded hover:bg-secondary text-muted-foreground"
                        aria-label="Message options"
                        title="Message options"
                      >
                        <MoreVertical className="w-3 h-3" />
                      </button>
                    </div>

                    {msg.replyTo && (
                      <div className="mb-1 pl-2 border-l-2 border-primary/30 text-xs text-muted-foreground line-clamp-1">
                        <MessageSquare className="w-3 h-3 inline mr-1" />
                        <span className="font-medium">{msg.replyTo.author.username || msg.replyTo.author.name}:</span>{" "}
                        {msg.replyTo.content}
                      </div>
                    )}

                    <p className="text-sm pl-0.5">
                      {isDeleted ? <span className="italic text-muted-foreground">{msg.content}</span> : renderContent(msg.content)}
                    </p>

                    {isMenuOpen && (
                      <div className="mt-1 rounded-lg border border-border bg-card shadow-lg p-1.5 space-y-1 z-10">
                        <button
                          onClick={() => {
                            setReplyingTo(msg)
                            setActiveMenu(null)
                          }}
                          className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs text-left hover:bg-secondary text-foreground"
                        >
                          <MessageSquare className="w-3 h-3 text-primary" /> Reply
                        </button>
                        <a
                          href={`/u/${msg.author.username || msg.author.name}`}
                          onClick={() => {
                            if (typeof window !== "undefined" && window.innerWidth < 1024) {
                              setIsOpen(false)
                            }
                          }}
                          className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs text-left hover:bg-secondary text-foreground"
                        >
                          <UserIcon className="w-3 h-3 text-primary" /> View profile
                        </a>
                        {canManage && (
                          <>
                            <div className="border-t border-border my-1" />
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
                          </>
                        )}
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
          <form onSubmit={handleSendMessage} className="p-2 border-t border-border shrink-0 relative">
            {replyingTo && (
              <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <MessageSquare className="w-3 h-3" />
                <span className="flex-1 truncate">
                  Replying to {replyingTo.author.username || replyingTo.author.name}
                </span>
                <button
                  type="button"
                  onClick={() => setReplyingTo(null)}
                  className="p-1 hover:bg-secondary rounded"
                  aria-label="Cancel reply"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {(showMentions || showCommands) && (
              <div className="mb-1.5 rounded-lg border border-border bg-card shadow-lg max-h-40 overflow-y-auto">
                {showMentions && mentionSuggestions.length > 0 && (
                  mentionSuggestions.map((u, i) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => onMentionSelect(u.username || u.name)}
                      className={cn(
                        "w-full text-left px-2 py-1.5 text-xs flex items-center gap-2 hover:bg-secondary",
                        i === 0 && "bg-secondary/50"
                      )}
                    >
                      <span className="font-medium">@{u.username || u.name}</span>
                    </button>
                  ))
                )}
                {showCommands && (
                  commandSuggestions.map((c, i) => (
                    <button
                      key={c.name}
                      type="button"
                      onClick={() => onCommandSelect(c.name)}
                      className={cn(
                        "w-full text-left px-2 py-1.5 text-xs flex items-center justify-between hover:bg-secondary",
                        i === 0 && "bg-secondary/50"
                      )}
                    >
                      <span className="font-medium">/{c.name}</span>
                      <span className="text-muted-foreground">{c.desc}</span>
                    </button>
                  ))
                )}
              </div>
            )}

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
                type="text"
                maxLength={1000}
                title="Maximum 1000 characters"
                placeholder={
                  !room
                    ? "Loading chat room..."
                    : room.locked && !isStaff
                    ? "Chat is locked"
                    : replyingTo
                    ? `Reply to ${replyingTo.author.username || replyingTo.author.name}...`
                    : "Message General Chat..."
                }
                className="flex-1 px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                disabled={!room || sending || (room?.locked && !isStaff)}
                value={inputValue}
                onChange={(e) => handleInputChange(e.target.value, e.target.selectionStart ?? undefined)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    handleSendMessage(e)
                  }
                }}
              />
              <button
                type="submit"
                disabled={!room || sending || (room?.locked && !isStaff)}
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
      )}
    </>
  )
}
