"use client"

import { useState, useEffect, useRef, useMemo, memo, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useSearchParams } from "next/navigation"
import {
  MessageCircle, Send, X, Loader2, Smile, RefreshCw, MoreVertical,
  Trash2, AlertTriangle, Clock, Shield, User as UserIcon, MessageSquare,
  Lock, Timer, Hash, Bot,
} from "lucide-react"
import Link from "next/link"
import RoleBadge from "@/components/role-badge"
import { Avatar } from "@/components/ui/avatar"
import { listCommandsForRole } from "@/lib/chat-commands"
import { useToast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import dynamic from "next/dynamic"
import type { Theme, EmojiStyle } from "emoji-picker-react"

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

const BOT_USERNAME = "terpbot"
const BOT_AVATAR = "/terpbot.svg"

// One shared Pusher connection across room switches — subscribing to a new
// channel reuses the socket instead of re-handshaking.
let sharedPusher: import("pusher-js").default | null = null
async function getSharedPusher() {
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER
  if (!key || !cluster) return null
  if (!sharedPusher) {
    const { default: Pusher } = await import("pusher-js")
    sharedPusher = new Pusher(key, { cluster, authEndpoint: "/api/pusher/auth" })
  }
  return sharedPusher
}

// Internal paths emitted by TerpBot (and users) render as real links.
// Allowlisted prefixes only — no arbitrary scheme or external URL is
// ever turned into an anchor here.
const INTERNAL_LINK_RE = /^\/(forum|guides|strains|diaries|u|search|leaderboard|contest|profile|setups|chat)(\/[a-zA-Z0-9\-_/?=&%#.]*)?$/

function renderContent(text: string) {
  const parts = text.split(/(@[a-zA-Z0-9_-]+|\/[a-zA-Z][a-zA-Z0-9\-_/?=&%#.]*)/gi)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("@")) {
          return (
            <Link key={i} href={`/u/${part.slice(1)}`} className="font-medium text-primary hover:underline">
              {part}
            </Link>
          )
        }
        if (INTERNAL_LINK_RE.test(part)) {
          return (
            <Link key={i} href={part} className="font-medium text-primary hover:underline">
              {part}
            </Link>
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

interface MessageRowProps {
  msg: Message
  isMenuOpen: boolean
  canManage: boolean
  isAdmin: boolean
  onToggleMenu: (id: string) => void
  onReply: (msg: Message) => void
  onModerate: (actionType: string, targetUserId: string, opts?: { targetType?: string; targetId?: string; durationDays?: number }) => void
}

// Memoized — a 100-message room re-renders only the row whose menu toggled.
const MessageRow = memo(function MessageRow({
  msg, isMenuOpen, canManage, isAdmin, onToggleMenu, onReply, onModerate,
}: MessageRowProps) {
  const isDeleted = msg.content === "[deleted]"
  const isBot = msg.author.username === BOT_USERNAME
  const isAction = !isBot && !isDeleted && /^\*.+\*$/.test(msg.content)
  const displayName = msg.author.username || msg.author.name

  return (
    <div className="group relative flex gap-2.5">
      <Link
        href={`/u/${encodeURIComponent(displayName)}`}
        className="mt-0.5 shrink-0"
        aria-label={`${displayName}'s profile`}
        tabIndex={-1}
      >
        <Avatar
          src={isBot ? BOT_AVATAR : msg.author.image}
          alt={`${displayName} avatar`}
          size="sm"
          className={isBot ? "bg-primary/15" : undefined}
          fallback={isBot ? <Bot className="w-4 h-4 text-primary" /> : undefined}
        />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 mb-0.5">
          <Link
            href={`/u/${encodeURIComponent(displayName)}`}
            className="font-semibold text-xs hover:underline truncate"
          >
            {displayName}
          </Link>
          {isBot && (
            <span className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider bg-primary/15 text-primary px-1 py-px rounded">
              <Bot className="w-2.5 h-2.5" /> Bot
            </span>
          )}
          <RoleBadge role={msg.author.role} />
          <time
            dateTime={msg.createdAt}
            className="text-[10px] text-muted-foreground opacity-70 group-hover:opacity-100 transition-opacity"
          >
            {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </time>
          <button
            onClick={() => onToggleMenu(msg.id)}
            className="ml-auto p-1 rounded hover:bg-secondary text-muted-foreground"
            aria-label="Message options"
            aria-expanded={isMenuOpen}
            aria-haspopup="menu"
            title="Message options"
          >
            <MoreVertical className="w-3 h-3" />
          </button>
        </div>

        {msg.replyTo && (
          <div className="mb-1 pl-2 border-l-2 border-primary/30 text-xs text-muted-foreground line-clamp-1">
            <MessageSquare className="w-3 h-3 inline mr-1" aria-hidden="true" />
            <span className="font-medium">{msg.replyTo.author.username || msg.replyTo.author.name}:</span>{" "}
            {msg.replyTo.content}
          </div>
        )}

        {isBot ? (
          <div className="rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-2 text-xs leading-relaxed">
            {renderContent(msg.content)}
          </div>
        ) : isAction ? (
          <p className="text-sm pl-0.5 italic text-muted-foreground">
            {renderContent(msg.content.slice(1, -1))}
          </p>
        ) : (
          <p className="text-sm pl-0.5 break-words">
            {isDeleted ? <span className="italic text-muted-foreground">{msg.content}</span> : renderContent(msg.content)}
          </p>
        )}

        {isMenuOpen && (
          <div role="menu" className="mt-1 rounded-lg border border-border bg-card shadow-lg p-1.5 space-y-1 relative z-20">
            <button
              role="menuitem"
              onClick={() => onReply(msg)}
              className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs text-left hover:bg-secondary text-foreground"
            >
              <MessageSquare className="w-3 h-3 text-primary" /> Reply
            </button>
            <Link
              role="menuitem"
              href={`/u/${encodeURIComponent(displayName)}`}
              onClick={() => onToggleMenu(msg.id)}
              className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs text-left hover:bg-secondary text-foreground"
            >
              <UserIcon className="w-3 h-3 text-primary" /> View profile
            </Link>
            {canManage && (
              <>
                <div className="border-t border-border my-1" />
                <button
                  role="menuitem"
                  onClick={() => onModerate("CONTENT_DELETION", msg.author.id, { targetType: "CHAT_MESSAGE", targetId: msg.id })}
                  className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs text-left hover:bg-secondary text-foreground"
                >
                  <Trash2 className="w-3 h-3 text-destructive" /> Delete message
                </button>
                <button
                  role="menuitem"
                  onClick={() => onModerate("WARNING", msg.author.id)}
                  className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs text-left hover:bg-secondary text-foreground"
                >
                  <AlertTriangle className="w-3 h-3 text-amber-500" /> Warn user
                </button>
                {isAdmin && (
                  <>
                    <button
                      role="menuitem"
                      onClick={() => onModerate("TEMPORARY_BAN", msg.author.id, { durationDays: 1 })}
                      className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs text-left hover:bg-secondary text-foreground"
                    >
                      <Clock className="w-3 h-3 text-blue-400" /> 1-day timeout
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => onModerate("TEMPORARY_BAN", msg.author.id, { durationDays: 7 })}
                      className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs text-left hover:bg-secondary text-foreground"
                    >
                      <Clock className="w-3 h-3 text-blue-400" /> 7-day timeout
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => onModerate("PERMANENT_BAN", msg.author.id)}
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
    </div>
  )
})

export default function ChatRoom() {
  const { data: session } = useSession()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const myRole = (session?.user as { role?: string } | undefined)?.role
  const isStaff = myRole === "SUPPORT" || myRole === "MODERATOR" || myRole === "ADMINISTRATOR"
  const isModerator = myRole === "MODERATOR" || myRole === "ADMINISTRATOR"
  const isAdmin = myRole === "ADMINISTRATOR"
  const myId = (session?.user as { id?: string } | undefined)?.id

  const [rooms, setRooms] = useState<Room[]>([])
  const [room, setRoom] = useState<Room | null>(null)
  const [onlineCount, setOnlineCount] = useState(0)
  const [messages, setMessages] = useState<Message[]>([])
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
  const [showEmoji, setShowEmoji] = useState(false)
  const [suggestIndex, setSuggestIndex] = useState(0)

  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastTsRef = useRef<string | null>(null)
  const nearBottomRef = useRef(true)

  // Theme-aware emoji picker: data-theme wins, else follow the OS.
  const emojiTheme: Theme = useMemo(() => {
    if (typeof document === "undefined") return "dark" as Theme
    const t = document.documentElement.getAttribute("data-theme")
    if (t === "dark" || t === "light") return t as Theme
    return (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") as Theme
  }, [showEmoji]) // eslint-disable-line react-hooks/exhaustive-deps -- re-resolve each time the picker opens

  // Keep newest messages in view — but only when the reader is already near
  // the bottom, so scrolling up to read history isn't yanked away.
  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current
    if (!el) return
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }, [])

  useEffect(() => {
    const el = messagesContainerRef.current
    if (el && nearBottomRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: "instant" as ScrollBehavior })
    }
  }, [messages])

  // Load the room list once — all public rooms, ordered server-side.
  useEffect(() => {
    if (!session) return
    let cancelled = false
    fetch("/api/chat/rooms")
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || `HTTP ${res.status}`)
        }
        return res.json()
      })
      .then((data) => {
        if (cancelled) return
        const all: Room[] = data.rooms || []
        setRooms(all)
        const wanted = searchParams.get("room")
        setRoom(
          all.find((r) => r.slug === wanted) ||
            all.find((r) => r.slug === "general") ||
            all[0] ||
            null
        )
        setOnlineCount(data.onlineCount || 0)
        setFetchError(null)
      })
      .catch((err) => {
        if (cancelled) return
        const message = err?.message || "Failed to load chat"
        console.error("Failed to load chat rooms:", err)
        setFetchError(message)
        toast(message, "error")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- searchParams read once on mount
  }, [session, retryCount, toast])

  const switchRoom = (slug: string) => {
    const next = rooms.find((r) => r.slug === slug)
    if (!next || next.id === room?.id) return
    setRoom(next)
    setMessages([])
    setActiveMenu(null)
    setReplyingTo(null)
    nearBottomRef.current = true
    window.history.replaceState(null, "", `/chat?room=${slug}`)
  }

  // Load messages: realtime via Pusher when configured, otherwise poll.
  // Polls are incremental (?after=) so idle polls are near-empty.
  useEffect(() => {
    if (!session || !room) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let subscribedChannel: string | null = null

    const mergeFresh = (fresh: Message[]) => {
      if (fresh.length === 0) return false
      lastTsRef.current = fresh[fresh.length - 1].createdAt
      let changed = false
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id))
        const added = fresh.filter((m) => !seen.has(m.id))
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
        const p = await getSharedPusher()
        // Effect may have cleaned up before the import resolved.
        if (cancelled || !p) return
        const channelName = `private-chat-${room.id}`
        const channel = p.subscribe(channelName)
        subscribedChannel = channelName
        channel.bind("new-message", (m: Message) => {
          if (!cancelled) mergeFresh([m])
        })
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
      if (subscribedChannel && sharedPusher) {
        sharedPusher.unsubscribe(subscribedChannel)
      }
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [session, room?.id]) // eslint-disable-line react-hooks/exhaustive-deps -- room identity, not the object

  // Focus the composer when the room is ready — chat is the point of this page.
  useEffect(() => {
    if (room && !room.locked) inputRef.current?.focus()
  }, [room?.id, room?.locked]) // eslint-disable-line react-hooks/exhaustive-deps

  const mentionUsers = useMemo(() => {
    const seen = new Map<string, Author>()
    messages.forEach((m) => {
      if (!seen.has(m.author.id)) seen.set(m.author.id, m.author)
    })
    return Array.from(seen.values())
  }, [messages])

  const mentionSuggestions = mentionQuery
    ? mentionUsers.filter((a) => (a.username || a.name).toLowerCase().includes(mentionQuery)).slice(0, 5)
    : []

  // Autocomplete derives from the shared command registry — the same source
  // of truth as the API — so the list can never drift from what's allowed.
  const commandList = useMemo(() => {
    return listCommandsForRole(myRole)
      .filter((c) => c.surfaces.includes("slash"))
      .map((c) => ({ name: c.name, desc: c.description }))
  }, [myRole])

  const commandSuggestions = slashQuery
    ? commandList.filter((c) => c.name.startsWith(slashQuery)).slice(0, 6)
    : commandList.slice(0, 6)

  const suggestionCount = showMentions ? mentionSuggestions.length : showCommands ? commandSuggestions.length : 0

  // Restore focus/caret after the state update has painted.
  const focusComposerAt = useCallback((pos: number) => {
    requestAnimationFrame(() => {
      const el = inputRef.current
      el?.focus()
      el?.setSelectionRange(pos, pos)
    })
  }, [])

  const onMentionSelect = useCallback((username: string) => {
    const before = inputValue.slice(0, cursor)
    const at = before.lastIndexOf("@")
    if (at >= 0) {
      const next = inputValue.slice(0, at) + "@" + username + " " + inputValue.slice(cursor)
      setInputValue(next)
      setCursor(at + username.length + 2)
    }
    setMentionQuery("")
    setShowMentions(false)
    setShowCommands(false)
  }, [inputValue, cursor])

  const onCommandSelect = useCallback((name: string) => {
    setInputValue(`/${name} `)
    setCursor(name.length + 2)
    setSlashQuery("")
    setShowCommands(false)
    setMentionQuery("")
    focusComposerAt(name.length + 2)
  }, [focusComposerAt])

  const insertEmoji = useCallback((emoji: string) => {
    const next = inputValue.slice(0, cursor) + emoji + inputValue.slice(cursor)
    setInputValue(next)
    setCursor(cursor + emoji.length)
    focusComposerAt(cursor + emoji.length)
    setShowMentions(false)
    setShowCommands(false)
  }, [inputValue, cursor, focusComposerAt])

  const handleInputChange = (value: string, newCursor = value.length) => {
    setInputValue(value)
    setCursor(newCursor)
    setShowMentions(false)
    setShowCommands(false)
    setMentionQuery("")
    setSlashQuery("")
    setSuggestIndex(0)

    if (value.startsWith("/") && !value.includes(" ")) {
      setSlashQuery(value.slice(1).toLowerCase())
      setShowCommands(true)
      return
    }

    const before = value.slice(0, newCursor)
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
            setRoom((prev) => (prev ? { ...prev, ...data.room } : prev))
            setRooms((prev) => prev.map((r) => (r.id === room.id ? { ...r, ...data.room } : r)))
          }
          if (data.cleared !== undefined) {
            setMessages([])
            toast(`Cleared ${data.cleared} messages`, "success")
          }
          if (data.message && data.message.author) {
            setMessages((prev) => [...prev, data.message])
            nearBottomRef.current = true
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
          setMessages((prev) => [...prev, data.message])
          nearBottomRef.current = true
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
        setMessages((prev) => prev.map((m) => (m.id === opts.targetId ? { ...m, content: "[deleted]" } : m)))
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Moderation action failed"
      toast(message, "error")
    } finally {
      setActiveMenu(null)
    }
  }

  const toggleMenu = useCallback((id: string) => {
    setActiveMenu((prev) => (prev === id ? null : id))
  }, [])

  const startReply = useCallback((msg: Message) => {
    setReplyingTo(msg)
    setActiveMenu(null)
    inputRef.current?.focus()
  }, [])

  const listboxId = "chat-suggestions"

  if (!session) {
    return null
  }

  return (
    <div className="flex h-full min-h-0 gap-4">
      {/* Room rail — desktop */}
      <nav aria-label="Chat rooms" className="hidden lg:flex w-52 shrink-0 flex-col rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-3 py-2.5 border-b border-border text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Rooms
        </div>
        <ul className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
          {rooms.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => switchRoom(r.slug)}
                aria-current={room?.id === r.id ? "true" : undefined}
                className={cn(
                  "w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                  room?.id === r.id
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                <Hash className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{r.name}</span>
                {r.locked && <Lock className="w-3 h-3 ml-auto shrink-0" aria-label="Locked" />}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Main chat card */}
      <div className="flex-1 min-w-0 flex flex-col rounded-xl border border-border bg-card overflow-hidden">
        {/* Header */}
        <div className="p-3 border-b border-border flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 shrink-0">
              <MessageCircle className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="font-semibold text-sm leading-tight truncate flex items-center gap-1.5">
                {room?.name ?? "Community Chat"}
                {room?.locked && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-500">
                    <Lock className="w-3 h-3" /> Locked
                  </span>
                )}
                {room && room.slowModeSeconds > 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                    <Timer className="w-3 h-3" /> {room.slowModeSeconds}s slow mode
                  </span>
                )}
              </h1>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="flex h-1.5 w-1.5 rounded-full bg-green-400" aria-hidden="true" />
                <span className="truncate">
                  {room ? `${onlineCount} growers online${room.description ? ` · ${room.description}` : ""}` : "Community live chat"}
                </span>
              </div>
            </div>
          </div>
          {(!room || fetchError) && (
            <button
              onClick={() => setRetryCount((c) => c + 1)}
              disabled={loading}
              className="p-1.5 hover:bg-secondary rounded-lg transition-colors disabled:opacity-50"
              aria-label="Retry loading chat"
              title="Retry loading chat"
            >
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            </button>
          )}
        </div>

        {/* Room chips — mobile/tablet */}
        <div
          role="tablist"
          aria-label="Chat rooms"
          className="lg:hidden flex gap-1.5 overflow-x-auto px-3 py-2 border-b border-border shrink-0"
        >
          {rooms.map((r) => (
            <button
              key={r.id}
              role="tab"
              aria-selected={room?.id === r.id}
              onClick={() => switchRoom(r.slug)}
              className={cn(
                "shrink-0 inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                room?.id === r.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              )}
            >
              {r.locked && <Lock className="w-3 h-3" aria-hidden="true" />}
              {r.name}
            </button>
          ))}
        </div>

        {/* Messages */}
        <div className="flex-1 flex flex-col min-h-0">
          <div
            ref={messagesContainerRef}
            onScroll={handleScroll}
            role="log"
            aria-live="polite"
            aria-label={`${room?.name ?? "Chat"} messages`}
            className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3"
          >
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
              </div>
            ) : messages.length === 0 ? (
              <div className="text-center py-10">
                <MessageCircle className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="font-medium text-sm">No messages yet</p>
                <p className="text-xs text-muted-foreground">
                  Start the conversation — or ask <span className="text-primary font-medium">@terpbot</span> for help.
                </p>
              </div>
            ) : (
              messages.map((msg) => (
                <MessageRow
                  key={msg.id}
                  msg={msg}
                  isMenuOpen={activeMenu === msg.id}
                  canManage={isModerator && msg.author.id !== myId}
                  isAdmin={isAdmin}
                  onToggleMenu={toggleMenu}
                  onReply={startReply}
                  onModerate={takeModerationAction}
                />
              ))
            )}
          </div>

          {/* Emoji picker — full emoji set with search */}
          {showEmoji && (
            <div className="border-t border-border shrink-0">
              <EmojiPicker
                onEmojiClick={(emoji) => insertEmoji(emoji.emoji)}
                theme={emojiTheme}
                emojiStyle={"native" as EmojiStyle}
                height={320}
                width="100%"
                searchPlaceholder="Search emojis..."
                previewConfig={{ showPreview: false }}
                skinTonesDisabled
              />
            </div>
          )}

          {/* Composer */}
          <form onSubmit={handleSendMessage} className="p-2.5 border-t border-border shrink-0 relative">
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

            {(showMentions || showCommands) && suggestionCount > 0 && (
              <div
                id={listboxId}
                role="listbox"
                aria-label={showMentions ? "Mention suggestions" : "Command suggestions"}
                className="mb-1.5 rounded-lg border border-border bg-card shadow-lg max-h-40 overflow-y-auto"
              >
                {showMentions &&
                  mentionSuggestions.map((u, i) => (
                    <button
                      key={u.id}
                      id={`${listboxId}-opt-${i}`}
                      role="option"
                      aria-selected={i === suggestIndex}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onMentionSelect(u.username || u.name)}
                      className={cn(
                        "w-full text-left px-2 py-1.5 text-xs flex items-center gap-2 hover:bg-secondary",
                        i === suggestIndex && "bg-secondary"
                      )}
                    >
                      <span className="font-medium">@{u.username || u.name}</span>
                    </button>
                  ))}
                {showCommands &&
                  commandSuggestions.map((c, i) => (
                    <button
                      key={c.name}
                      id={`${listboxId}-opt-${i}`}
                      role="option"
                      aria-selected={i === suggestIndex}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onCommandSelect(c.name)}
                      className={cn(
                        "w-full text-left px-2 py-1.5 text-xs flex items-center justify-between gap-2 hover:bg-secondary",
                        i === suggestIndex && "bg-secondary"
                      )}
                    >
                      <span className="font-medium">/{c.name}</span>
                      <span className="text-muted-foreground truncate">{c.desc}</span>
                    </button>
                  ))}
              </div>
            )}

            {room?.locked && !isStaff && (
              <p className="mb-1.5 flex items-center gap-1.5 text-xs text-amber-500">
                <Lock className="w-3 h-3" /> This room is locked — only moderators can post right now.
              </p>
            )}
            {!room?.locked && room && room.slowModeSeconds > 0 && (
              <p className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Timer className="w-3 h-3" /> Slow mode: one message every {room.slowModeSeconds}s.
              </p>
            )}

            <div className="flex gap-1.5 items-center">
              <button
                type="button"
                onClick={() => setShowEmoji(!showEmoji)}
                className={`p-2 rounded-lg transition-colors ${showEmoji ? "bg-primary/10 text-primary" : "hover:bg-secondary text-muted-foreground"}`}
                aria-label="Open emoji picker"
                aria-expanded={showEmoji}
              >
                <Smile className="w-5 h-5" />
              </button>
              <input
                ref={inputRef}
                type="text"
                maxLength={1000}
                title="Maximum 1000 characters"
                role="combobox"
                aria-expanded={(showMentions || showCommands) && suggestionCount > 0}
                aria-controls={listboxId}
                aria-activedescendant={suggestionCount > 0 ? `${listboxId}-opt-${suggestIndex}` : undefined}
                aria-autocomplete="list"
                placeholder={
                  !room
                    ? "Loading chat room..."
                    : room.locked && !isStaff
                      ? "Chat is locked"
                      : replyingTo
                        ? `Reply to ${replyingTo.author.username || replyingTo.author.name}...`
                        : `Message ${room.name}... try @terpbot or /help`
                }
                className="flex-1 px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                disabled={!room || sending || (room?.locked && !isStaff)}
                value={inputValue}
                onChange={(e) => handleInputChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
                onSelect={(e) => setCursor(e.currentTarget.selectionStart ?? e.currentTarget.value.length)}
                onKeyDown={(e) => {
                  if (suggestionCount > 0) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault()
                      setSuggestIndex((i) => (i + 1) % suggestionCount)
                      return
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault()
                      setSuggestIndex((i) => (i - 1 + suggestionCount) % suggestionCount)
                      return
                    }
                    if (e.key === "Enter" || e.key === "Tab") {
                      e.preventDefault()
                      if (showMentions) onMentionSelect(mentionSuggestions[suggestIndex].username || mentionSuggestions[suggestIndex].name)
                      else onCommandSelect(commandSuggestions[suggestIndex].name)
                      return
                    }
                    if (e.key === "Escape") {
                      setShowMentions(false)
                      setShowCommands(false)
                      return
                    }
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    handleSendMessage(e)
                  } else if (e.key === "Escape") {
                    setShowEmoji(false)
                    setReplyingTo(null)
                    setActiveMenu(null)
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
      </div>
    </div>
  )
}
