"use client"

import { useState, useEffect, useRef, useMemo, memo, useCallback, Fragment, type ReactNode } from "react"
import { useSession } from "next-auth/react"
import { useSearchParams } from "next/navigation"
import {
  MessageCircle, Send, X, Loader2, Smile, RefreshCw, MoreVertical,
  Trash2, AlertTriangle, Clock, Shield, User as UserIcon, MessageSquare,
  Lock, Timer, Hash, Bot, Flag, ChevronDown,
} from "lucide-react"
import Link from "next/link"
import RoleBadge from "@/components/role-badge"
import TierChip from "@/components/tier-chip"
import UserPopover from "@/components/user-popover"
import { Avatar } from "@/components/ui/avatar"
import { getAvatarFrame, getProfileTitle } from "@/lib/cosmetics"
import { listCommandsForRole } from "@/lib/chat-commands"
import { getSharedPusher, peekSharedPusher } from "@/lib/pusher-client"
import {
  mergeMessages,
  isStaleBatch,
  applyRoomState,
  getLastSeen,
  markRoomSeen,
  getLastRoom,
  setLastRoom,
  syncUnread,
  firstUnreadId,
  CHAT_SEEN_EVENT,
  CHAT_ROOM_STATE_EVENT,
  type RoomStateEvent,
} from "@/lib/chat-client"
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
  requiredRep: number | null
  accessible: boolean
  slowModeSeconds: number
  locked: boolean
  latestAt?: string | null
  _count: { messages: number }
}

interface Author {
  id: string
  name: string
  username?: string | null
  role?: string | null
  image?: string | null
  reputation?: number | null
  publicMilestoneOptOut?: boolean | null
  avatarFrame?: string | null
  profileTitle?: string | null
}

interface Message {
  id: string
  roomId: string
  content: string
  createdAt: string
  author: Author
  replyTo: { id: string; content: string; author: Author } | null
}

const BOT_USERNAME = "terpbot"

// Group consecutive same-author messages sent within this window — the
// first keeps the full identity header, followers render compact.
const GROUP_WINDOW_MS = 5 * 60 * 1000

// Storage is only available in the browser — this component still SSRs.
const store = typeof window === "undefined" ? null : window.localStorage

// Internal paths emitted by TerpBot (and users) render as real links.
// Allowlisted prefixes only — no arbitrary scheme or external URL is
// ever turned into an anchor here.
const INTERNAL_LINK_RE = /^\/(forum|guides|strains|diaries|u|search|leaderboard|contest|profile|setups|chat|rules|help|plant-doctor|about)(\/[a-zA-Z0-9\-_/?=&%#.]*)?$/

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
  isOwn: boolean
  canManage: boolean
  isAdmin: boolean
  // Compact rows are consecutive same-author followers — no avatar/header.
  compact: boolean
  onToggleMenu: (id: string) => void
  onReply: (msg: Message) => void
  onModerate: (actionType: string, targetUserId: string, opts?: { targetType?: string; targetId?: string; durationDays?: number }) => void
  onDeleteOwn: (id: string) => void
}

// Memoized — a 100-message room re-renders only the row whose menu toggled.
const MessageRow = memo(function MessageRow({
  msg, isMenuOpen, isOwn, canManage, isAdmin, compact, onToggleMenu, onReply, onModerate, onDeleteOwn,
}: MessageRowProps) {
  const isDeleted = msg.content === "[deleted]"
  const isBot = msg.author.username === BOT_USERNAME
  const isAction = !isBot && !isDeleted && /^\*.+\*$/.test(msg.content)
  const displayName = msg.author.username || msg.author.name
  const [reporting, setReporting] = useState(false)
  const [reportReason, setReportReason] = useState("SPAM")
  const [reportDesc, setReportDesc] = useState("")
  const [reportBusy, setReportBusy] = useState(false)
  const [reported, setReported] = useState(false)
  const [reportError, setReportError] = useState("")

  const submitReport = async () => {
    setReportBusy(true)
    setReportError("")
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "CHAT_MESSAGE", targetId: msg.id, reason: reportReason, description: reportDesc }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok) {
        setReported(true)
        setReporting(false)
      } else {
        setReportError(d.error || "Report failed")
      }
    } finally {
      setReportBusy(false)
    }
  }
  // Cosmetics render only for humans — the bot keeps its fixed identity.
  const frame = !isBot ? getAvatarFrame(msg.author.avatarFrame) : null
  const title = !isBot ? getProfileTitle(msg.author.profileTitle) : null

  const menuButton = (
    <button
      onClick={() => onToggleMenu(msg.id)}
      className="p-1 rounded hover:bg-secondary text-muted-foreground"
      aria-label="Message options"
      aria-expanded={isMenuOpen}
      aria-haspopup="menu"
      title="Message options"
    >
      <MoreVertical className="w-3 h-3" />
    </button>
  )
  const timeEl = (
    <time
      dateTime={msg.createdAt}
      className="text-[10px] text-muted-foreground opacity-70 group-hover:opacity-100 transition-opacity"
    >
      {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
    </time>
  )
  const replyEl = msg.replyTo && (
    <div className="mb-1 pl-2 border-l-2 border-primary/30 text-xs text-muted-foreground line-clamp-1">
      <MessageSquare className="w-3 h-3 inline mr-1" aria-hidden="true" />
      <span className="font-medium">{msg.replyTo.author.username || msg.replyTo.author.name}:</span>{" "}
      {msg.replyTo.content}
    </div>
  )
  const bodyEl = isAction ? (
    <p className="text-sm pl-0.5 italic text-muted-foreground">
      {renderContent(msg.content.slice(1, -1))}
    </p>
  ) : (
    <p className="text-sm pl-0.5 break-words">
      {isDeleted ? <span className="italic text-muted-foreground">{msg.content}</span> : renderContent(msg.content)}
    </p>
  )

  const menu = isMenuOpen && (
          reported ? (
            <div className="mt-1 rounded-lg border border-border bg-card shadow-lg p-2.5 relative z-20">
              <p role="status" className="text-xs text-muted-foreground">Report submitted — thank you. Our moderators will take a look.</p>
            </div>
          ) : reporting ? (
            <div className="mt-1 rounded-lg border border-border bg-card shadow-lg p-2.5 space-y-2 relative z-20" role="group" aria-label="Report message">
              <p className="text-xs font-medium">Report this message?</p>
              <select
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
                aria-label="Report reason"
                className="w-full px-2 py-1.5 rounded-lg border border-border bg-background text-xs"
              >
                <option value="SPAM">Spam</option>
                <option value="HARASSMENT">Harassment</option>
                <option value="THREATS">Threats</option>
                <option value="ILLEGAL_CONTENT">Illegal content</option>
                <option value="SCAM">Scam / phishing</option>
                <option value="MALICIOUS_LINKS">Malicious links</option>
                <option value="OTHER">Other</option>
              </select>
              <textarea
                value={reportDesc}
                onChange={(e) => setReportDesc(e.target.value)}
                placeholder="Optional details for moderators..."
                aria-label="Report details"
                className="w-full px-2 py-1.5 rounded-lg border border-border bg-background text-xs"
                maxLength={1000}
              />
              {reportError && <p role="alert" className="text-xs text-destructive">{reportError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={submitReport}
                  disabled={reportBusy}
                  className="px-3 py-1.5 text-xs font-medium bg-destructive text-destructive-foreground rounded-lg disabled:opacity-50"
                >
                  {reportBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Submit report"}
                </button>
                <button
                  onClick={() => { setReporting(false); setReportError("") }}
                  className="px-3 py-1.5 text-xs rounded-lg bg-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
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
            {!isOwn && !isDeleted && !isBot && (
              <button
                role="menuitem"
                onClick={() => setReporting(true)}
                className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs text-left hover:bg-secondary text-foreground"
              >
                <Flag className="w-3 h-3 text-amber-500" /> Report message
              </button>
            )}
            {isOwn && !isDeleted && (
              <button
                role="menuitem"
                onClick={() => onDeleteOwn(msg.id)}
                className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs text-left hover:bg-secondary text-foreground"
              >
                <Trash2 className="w-3 h-3 text-destructive" /> Delete my message
              </button>
            )}
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
          )
        )

  // TerpBot/system posts render as a compact tinted strip — clearly not a
  // member message, but no longer a full identity header + boxed card.
  if (isBot) {
    return (
      <div className="group relative" data-mid={msg.id}>
        <div className="flex items-start gap-2 rounded-lg border border-primary/15 bg-primary/[0.05] px-2.5 py-1.5">
          <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-primary/80">TerpBot</span>
              {timeEl}
              <span className="ml-auto">{menuButton}</span>
            </div>
            {replyEl}
            <div className="text-xs leading-relaxed">
              {isDeleted ? <span className="italic text-muted-foreground">{msg.content}</span> : renderContent(msg.content)}
            </div>
          </div>
        </div>
        {menu}
      </div>
    )
  }

  // Consecutive same-author follower — identity lives on the group's first
  // row; the timestamp appears in the avatar gutter on hover.
  if (compact) {
    return (
      <div className="group relative flex gap-2.5" data-mid={msg.id}>
        <span className="w-8 shrink-0 select-none text-right" aria-hidden="true">
          <time
            dateTime={msg.createdAt}
            className="invisible text-[10px] leading-5 text-muted-foreground group-hover:visible"
          >
            {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </time>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1.5">
            <div className="min-w-0 flex-1">
              <span className="sr-only">{displayName}: </span>
              {bodyEl}
            </div>
            {menuButton}
          </div>
          {menu}
        </div>
      </div>
    )
  }

  return (
    <div className="group relative flex gap-2.5" data-mid={msg.id}>
      <Link
        href={`/u/${encodeURIComponent(displayName)}`}
        className={cn("mt-0.5 shrink-0 rounded-full", frame?.className)}
        aria-label={`${displayName}'s profile`}
        tabIndex={-1}
      >
        <Avatar src={msg.author.image} alt={`${displayName} avatar`} size="sm" />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 mb-0.5">
          <UserPopover username={msg.author.username ?? displayName}>
            <Link
              href={`/u/${encodeURIComponent(displayName)}`}
              className="font-semibold text-xs hover:underline truncate"
            >
              {displayName}
            </Link>
          </UserPopover>
          {title && (
            <span className="text-[9px] font-medium uppercase tracking-wider px-1 py-px rounded truncate bg-primary/10 text-primary/80">
              {title.name}
            </span>
          )}
          <RoleBadge role={msg.author.role} />
          <TierChip
            reputation={msg.author.reputation ?? 0}
            publicMilestoneOptOut={msg.author.publicMilestoneOptOut}
          />
          {timeEl}
          <span className="ml-auto">{menuButton}</span>
        </div>
        {replyEl}
        {bodyEl}
        {menu}
      </div>
    </div>
  )
})

interface ChatRoomProps {
  // Panel mode (global ChatDock): skip the ?room= deep link — the panel
  // restores the last room instead — and don't rewrite the page URL.
  embedded?: boolean
  // Extra controls rendered in the header's right cluster (expand/close).
  headerActions?: ReactNode
}

export default function ChatRoom({ embedded = false, headerActions }: ChatRoomProps = {}) {
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
  const [pickerOpen, setPickerOpen] = useState(false)
  // "New" divider anchor for the active room — set on entry, this visit only.
  const [unreadBoundaryId, setUnreadBoundaryId] = useState<string | null>(null)
  // Bumped whenever a room is marked seen — recomputes picker unread dots.
  const [seenTick, setSeenTick] = useState(0)

  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const lastTsRef = useRef<string | null>(null)
  const nearBottomRef = useRef(true)
  const scrolledToUnreadRef = useRef(false)

  // Record "seen up to ts" for a room and tell the nav badge to recompute.
  const markSeenNow = useCallback((roomId: string, ts: string) => {
    if (!store) return
    markRoomSeen(store, roomId, ts)
    setSeenTick((t) => t + 1)
    window.dispatchEvent(new Event(CHAT_SEEN_EVENT))
  }, [])

  // Per-room unread dots in the picker — same localStorage contract the nav
  // badge uses. syncUnread baselines a first-ever observation so the dot
  // means "new since you've been around", never "things you never saw".
  const unreadIds = useMemo(() => {
    if (!store) return new Set<string>()
    return syncUnread(
      rooms.map((r) => ({ id: r.id, latestAt: r.latestAt ?? null })),
      store
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seenTick re-runs the comparison after marking seen
  }, [rooms, seenTick])

  // Close the room picker on outside click / Escape.
  useEffect(() => {
    if (!pickerOpen) return
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPickerOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [pickerOpen])

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
    if (!el) return
    // On room entry with unread history, land on the "New" divider once
    // instead of the bottom.
    if (unreadBoundaryId && !scrolledToUnreadRef.current) {
      const target = el.querySelector(`[data-mid="${unreadBoundaryId}"]`)
      if (target) {
        scrolledToUnreadRef.current = true
        target.scrollIntoView({ block: "start" })
        return
      }
    }
    if (nearBottomRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: "instant" as ScrollBehavior })
    }
  }, [messages, unreadBoundaryId])

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
        // The dedicated page honors ?room= deep links; the embedded panel
        // restores the last room instead (there is no chat URL to link).
        const wanted = embedded ? null : searchParams.get("room")
        const lastRoom = store ? getLastRoom(store) : null
        const chosen =
          all.find((r) => r.slug === wanted) ||
          all.find((r) => r.slug === lastRoom) ||
          all.find((r) => r.slug === "general") ||
          all[0] ||
          null
        setRoom(chosen)
        if (chosen && store) setLastRoom(store, chosen.slug)
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
    setUnreadBoundaryId(null)
    nearBottomRef.current = true
    scrolledToUnreadRef.current = false
    if (store) {
      setLastRoom(store, slug)
      // Entering a room clears its unread dot immediately — the message
      // load below then advances the marker to the newest message.
      if (next.latestAt) markSeenNow(next.id, next.latestAt)
    }
    // Only the dedicated page owns the URL — the embedded panel must not
    // rewrite whatever page the user is actually browsing.
    if (!embedded) window.history.replaceState(null, "", `/chat?room=${slug}`)
  }

  // Load messages: realtime via Pusher when configured, otherwise poll.
  // Polls are incremental (?after=) so idle polls are near-empty.
  // Gated rooms skip all fetching — the unlock panel needs no data and the
  // API would 403 anyway.
  useEffect(() => {
    if (!session || !room || room.accessible === false) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let subscribedChannel: string | null = null
    const roomId = room.id

    // Single idempotent merge path for GET batches, Pusher pushes, and
    // own-send/command responses — a message id renders at most once, and
    // anything tagged with a different roomId is dropped (room-switch guard).
    const mergeFresh = (fresh: Message[]) => {
      if (cancelled) return
      const inRoom = fresh.filter((m) => m.roomId === roomId)
      if (inRoom.length === 0) return
      const newest = inRoom[inRoom.length - 1].createdAt
      if (!lastTsRef.current || newest > lastTsRef.current) lastTsRef.current = newest
      setMessages((prev) => mergeMessages(prev, inRoom))
      if (!document.hidden) markSeenNow(roomId, newest)
    }

    const load = async () => {
      if (cancelled || document.hidden) return
      try {
        const isInitial = !lastTsRef.current
        const url = lastTsRef.current
          ? `/api/chat/messages?roomId=${roomId}&after=${encodeURIComponent(lastTsRef.current)}`
          : `/api/chat/messages?roomId=${roomId}`
        const res = await fetch(url)
        if (!res.ok) return
        const data = await res.json()
        // The effect's cleanup sets cancelled on room switch — a stale
        // response from the previous room can never land in the new list.
        if (cancelled) return
        const batch: Message[] = (data.messages || []).filter(
          (m: Message) => m.roomId === roomId
        )
        if (isInitial && batch.length > 0 && store) {
          // Anchor the "New" divider at the first post-seen message, then
          // mergeFresh advances the marker past it. A room with no stored
          // last-seen is baselined to its latest — nothing shows as unread
          // on a first visit.
          const seen = getLastSeen(store, roomId)
          if (seen !== null) {
            const fid = firstUnreadId(batch, seen)
            if (fid) setUnreadBoundaryId(fid)
          }
        }
        mergeFresh(batch)
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
        const channelName = `private-chat-${roomId}`
        const channel = p.subscribe(channelName)
        subscribedChannel = channelName
        channel.bind("new-message", (m: Message) => {
          if (isStaleBatch(m.roomId, roomId, cancelled)) return
          mergeFresh([m])
        })
        // Staff room controls (lock/slowmode/clear) fan out on the same
        // channel so every subscriber's UI updates without a remount.
        channel.bind(CHAT_ROOM_STATE_EVENT, (s: RoomStateEvent) => {
          if (cancelled) return
          if (s.cleared) {
            setMessages([])
            setUnreadBoundaryId(null)
          }
          const patch = (r: Room) => (r.id === roomId ? applyRoomState(r, s) : r)
          setRoom((prev) => (prev ? patch(prev) : prev))
          setRooms((prev) => prev.map(patch))
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
      if (subscribedChannel) {
        peekSharedPusher()?.unsubscribe(subscribedChannel)
      }
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [session, room?.id]) // eslint-disable-line react-hooks/exhaustive-deps -- room identity, not the object

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
            setMessages((prev) => mergeMessages(prev, [data.message]))
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
          // Same idempotent merge as push/poll — if Pusher already
          // delivered this message, the id dedupes the response copy.
          setMessages((prev) => mergeMessages(prev, [data.message]))
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

  const deleteOwnMessage = async (msgId: string) => {
    setActiveMenu(null)
    if (!confirm("Delete this message? This cannot be undone.")) return
    try {
      const res = await fetch("/api/chat/messages", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: msgId }),
      })
      if (res.ok) {
        setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, content: "[deleted]" } : m)))
      } else {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Delete failed", "error")
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
    <div className="flex h-full min-h-0">
      {/* Main chat card — conversation-first: a compact header carries the
          room picker + presence; everything else is message viewport. */}
      <div className={cn(
        "flex-1 min-w-0 flex flex-col bg-card overflow-hidden",
        // The panel provides its own frame — no double card chrome inside.
        !embedded && "rounded-xl border border-border"
      )}>
        <div className="flex items-center gap-2 px-2 py-1.5 border-b border-border shrink-0">
          <div className="relative min-w-0" ref={pickerRef}>
            <button
              onClick={() => setPickerOpen((o) => !o)}
              className="flex max-w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-secondary"
              aria-haspopup="listbox"
              aria-expanded={pickerOpen}
              aria-label="Choose chat room"
            >
              {room?.accessible === false ? (
                <Lock className="w-4 h-4 shrink-0 text-amber-500" aria-hidden="true" />
              ) : (
                <Hash className="w-4 h-4 shrink-0 text-primary" aria-hidden="true" />
              )}
              <span className="min-w-0 truncate font-semibold text-sm">
                {room?.name ?? "Community Chat"}
              </span>
              {room?.locked && (
                <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-amber-500">
                  <Lock className="w-3 h-3" /> Locked
                </span>
              )}
              {room && room.slowModeSeconds > 0 && (
                <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-muted-foreground">
                  <Timer className="w-3 h-3" /> {room.slowModeSeconds}s
                </span>
              )}
              <ChevronDown
                className={cn("w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform", pickerOpen && "rotate-180")}
                aria-hidden="true"
              />
            </button>
            {pickerOpen && (
              <div
                role="listbox"
                aria-label="Chat rooms"
                className="absolute left-0 top-full z-30 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-card p-1.5 shadow-lg"
              >
                {rooms.map((r) => (
                  <button
                    key={r.id}
                    role="option"
                    aria-selected={room?.id === r.id}
                    onClick={() => {
                      switchRoom(r.slug)
                      setPickerOpen(false)
                    }}
                    className={cn(
                      "w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                      room?.id === r.id
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                    )}
                  >
                    {r.accessible === false ? (
                      <Lock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    ) : (
                      <Hash className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    )}
                    <span className="truncate flex-1">{r.name}</span>
                    {unreadIds.has(r.id) && (
                      <span
                        className="h-2 w-2 shrink-0 rounded-full bg-primary"
                        role="status"
                        aria-label="New activity"
                      />
                    )}
                    {r.locked && <Lock className="w-3 h-3 shrink-0" aria-label="Locked" />}
                    {r.accessible === false && (
                      <span className="shrink-0 text-[9px] text-muted-foreground">
                        {r.requiredRep?.toLocaleString()} rep
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <span
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
              title="Members active on TerpTalk in the last 15 minutes"
            >
              <span className="flex h-1.5 w-1.5 rounded-full bg-green-400" aria-hidden="true" />
              {onlineCount} online
            </span>
            {headerActions}
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
            ) : room && room.accessible === false ? (
              <div className="text-center py-10 px-4">
                <Lock className="w-8 h-8 text-amber-500 mx-auto mb-2" />
                <p className="font-medium text-sm">{room.name} is a members-only room</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Unlocks at <span className="text-amber-500 font-medium">{room.requiredRep?.toLocaleString()} reputation</span>
                  {room.description ? ` — ${room.description}` : ""}
                </p>
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
              messages.map((msg, i) => {
                // Group consecutive same-author messages — the first row of
                // each run keeps the full identity header.
                const prev = messages[i - 1]
                const grouped =
                  !!prev &&
                  prev.author.id === msg.author.id &&
                  prev.author.username !== BOT_USERNAME &&
                  msg.author.username !== BOT_USERNAME &&
                  !msg.replyTo &&
                  new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS
                return (
                  <Fragment key={msg.id}>
                    {msg.id === unreadBoundaryId && (
                      <div className="flex items-center gap-2 py-0.5" role="separator" aria-label="New messages">
                        <span className="h-px flex-1 bg-primary/30" />
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">New</span>
                        <span className="h-px flex-1 bg-primary/30" />
                      </div>
                    )}
                    <MessageRow
                      msg={msg}
                      compact={grouped}
                      isMenuOpen={activeMenu === msg.id}
                      isOwn={msg.author.id === myId}
                      canManage={isModerator && msg.author.id !== myId}
                      isAdmin={isAdmin}
                      onToggleMenu={toggleMenu}
                      onReply={startReply}
                      onModerate={takeModerationAction}
                      onDeleteOwn={deleteOwnMessage}
                    />
                  </Fragment>
                )
              })
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

          {/* Composer — hidden entirely in gated rooms (server enforces too) */}
          {!(room && room.accessible === false) && (
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
          )}
        </div>
      </div>
    </div>
  )
}
