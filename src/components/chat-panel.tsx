"use client"

// Persistent global Chat panel — the Stake-style "chat while you browse"
// interaction model, adapted to the existing chat stack.
//
// Architecture:
//   ChatPanelProvider  — owns open state + the lightweight activity poll
//                        (moved here from Navigation so the dock's FAB and
//                        the nav share one request stream, never two).
//   ChatPanelInset     — wraps page content; on lg+ the content column
//                        narrows so the panel pushes layout instead of
//                        overlapping it.
//   ChatDock           — desktop right panel / mobile sheet + closed-state
//                        FAB. Renders nothing on /chat (the dedicated page
//                        IS the expanded surface) or when signed out.
//
// Realtime: ChatRoom only mounts while the panel is open, so its Pusher
// room subscription lives exactly as long as the panel is visible. The
// per-user notification channel in Navigation reuses the same shared
// socket — no extra connections, no global chat subscription.

import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useSession } from "next-auth/react"
import { Loader2, Maximize2, MessageSquare, MessagesSquare, X } from "@/lib/icons"
import ChatRoom from "@/components/chat-room"
import Tooltip from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  syncUnread,
  CHAT_SEEN_EVENT,
  CHAT_MESSAGE_EVENT,
  CHAT_MESSAGE_DELETED_EVENT,
  CHAT_ACTIVITY_CHANNEL,
  type ChatMessageTickle,
  type RoomActivity,
} from "@/lib/chat-client"
import { getSharedPusher, peekSharedPusher } from "@/lib/pusher-client"

interface ChatPanelContextValue {
  open: boolean
  openPanel: () => void
  closePanel: () => void
  togglePanel: () => void
  chatUnread: boolean
  chatUnreadRooms: number
}

const ChatPanelContext = createContext<ChatPanelContextValue>({
  open: false,
  openPanel: () => {},
  closePanel: () => {},
  togglePanel: () => {},
  chatUnread: false,
  chatUnreadRooms: 0,
})

export function useChatPanel() {
  return useContext(ChatPanelContext)
}

export function ChatPanelProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession()
  const [open, setOpen] = useState(false)
  const [chatUnreadRooms, setChatUnreadRooms] = useState(0)
  // Accessible-room activity list — seeded by the badge fetch, then kept
  // current by realtime tickles so a healthy Pusher connection needs no
  // periodic DB-backed polling.
  const roomsRef = useRef<RoomActivity[]>([])

  const openPanel = useCallback(() => setOpen(true), [])
  const closePanel = useCallback(() => setOpen(false), [])
  const togglePanel = useCallback(() => setOpen((o) => !o), [])

  // Chat activity signal — per-room latest activity vs localStorage
  // last-seen. One bounded fetch on mount, then the shared "chat-activity"
  // channel's content-free tickles update the dot locally; the 60s poll
  // only runs when realtime is unavailable (same pattern as the nav
  // notification fallback). This is the ONLY chat data fetched while the
  // panel is closed — no message content.
  useEffect(() => {
    if (!session) return
    const storage = window.localStorage
    const recompute = () => setChatUnreadRooms(syncUnread(roomsRef.current, storage).size)
    const refreshChat = async () => {
      try {
        const res = await fetch("/api/chat/rooms?badge=1")
        if (!res.ok) return
        const d = await res.json()
        if (!d) return
        roomsRef.current = (d.rooms || []).map(
          (r: { id: string; latestAt: string | null }) => ({ id: r.id, latestAt: r.latestAt })
        )
        recompute()
      } catch { /* transient — next tickle/poll resyncs */ }
    }
    void refreshChat()

    let poll: ReturnType<typeof setInterval> | null = null
    let cancelled = false
    let everConnected = false
    let boundPusher: import("pusher-js").default | null = null
    const startPolling = () => {
      if (!poll) poll = setInterval(() => void refreshChat(), 60_000)
    }
    const stopPolling = () => {
      if (poll) {
        clearInterval(poll)
        poll = null
      }
    }

    // The shared activity channel is a content-free tickle (no room ids),
    // so every event lands here — coalesce bursts into one badge fetch.
    // 3s bounds the worst case at ~20 fetches/min/client under sustained
    // public-room spam while staying near-instant for badge purposes.
    let resyncTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleResync = () => {
      if (resyncTimer) return
      resyncTimer = setTimeout(() => {
        resyncTimer = null
        void refreshChat()
      }, 3000)
    }

    const onTickle = (e: ChatMessageTickle) => {
      const room = roomsRef.current.find((r) => r.id === e.roomId)
      // Unknown room (new room, or one gated from this user) — resync
      // rather than guessing at visibility.
      if (!room) {
        scheduleResync()
        return
      }
      if (e.latestAt > (room.latestAt ?? "")) room.latestAt = e.latestAt
      recompute()
    }

    // The chat surface dispatches this after marking a room seen — the
    // last-seen write already landed in storage, so recompute locally
    // instead of refetching.
    const onSeen = () => recompute()
    window.addEventListener(CHAT_SEEN_EVENT, onSeen)
    // Sleeping tabs miss pushed events — authoritative resync on focus.
    const onVisible = () => {
      if (!document.hidden) void refreshChat()
    }
    document.addEventListener("visibilitychange", onVisible)

    const onConnState = (s: { previous: string; current: string }) => {
      if (cancelled) return
      if (s.current === "connected") {
        // Resubscribes happen automatically, but events emitted while the
        // socket was down are never replayed — resync on reconnect.
        if (everConnected) void refreshChat()
        everConnected = true
        stopPolling()
        return
      }
      // Only react to a genuine drop or an initial-connect failure — the
      // "connecting" transition on mount is not an outage.
      if (everConnected || s.current === "failed" || s.current === "unavailable") startPolling()
    }

    const pusherKey = process.env.NEXT_PUBLIC_PUSHER_KEY
    const pusherCluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER
    if (pusherKey && pusherCluster) {
      getSharedPusher()
        .then((p) => {
          // Effect may have cleaned up before the import resolved.
          if (cancelled) return
          if (!p) {
            startPolling()
            return
          }
          boundPusher = p
          const ch = p.subscribe(CHAT_ACTIVITY_CHANNEL)
          ch.bind(CHAT_MESSAGE_EVENT, onTickle)
          ch.bind(CHAT_MESSAGE_DELETED_EVENT, scheduleResync)
          ch.bind("pusher:subscription_error", startPolling)
          ch.bind("pusher:subscription_succeeded", stopPolling)
          p.connection.bind("state_change", onConnState)
        })
        .catch(startPolling)
    } else {
      startPolling()
    }

    return () => {
      cancelled = true
      window.removeEventListener(CHAT_SEEN_EVENT, onSeen)
      document.removeEventListener("visibilitychange", onVisible)
      if (poll) clearInterval(poll)
      if (resyncTimer) clearTimeout(resyncTimer)
      boundPusher?.connection.unbind("state_change", onConnState)
      // The socket is shared — drop only this channel, never disconnect.
      peekSharedPusher()?.unsubscribe(CHAT_ACTIVITY_CHANNEL)
    }
  }, [session])

  return (
    <ChatPanelContext.Provider
      value={{
        open,
        openPanel,
        closePanel,
        togglePanel,
        // Derived rather than reset on sign-out: guests never see a stale unread dot
        chatUnread: !!session && chatUnreadRooms > 0,
        chatUnreadRooms: session ? chatUnreadRooms : 0,
      }}
    >
      {children}
    </ChatPanelContext.Provider>
  )
}

// Wraps <main> + footer — on lg+ the open panel consumes real layout width
// instead of floating over content.
export function ChatPanelInset({ children }: { children: ReactNode }) {
  const { open } = useChatPanel()
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col transition-[padding] duration-200",
        open && "lg:pr-[340px]"
      )}
    >
      {children}
    </div>
  )
}

function PanelFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-primary" />
    </div>
  )
}

export function ChatDock() {
  const { open, openPanel, closePanel, chatUnread, chatUnreadRooms } = useChatPanel()
  const { data: session } = useSession()
  const pathname = usePathname()
  // The panel's top edge tracks the sticky nav's REAL bottom, not a fixed
  // offset — when an announcement/recovery banner sits above the nav, the
  // nav's rect is lower until it sticks, and the panel must not cover it.
  const [panelTop, setPanelTop] = useState(64)

  useEffect(() => {
    if (!open) return
    const update = () => {
      const bottom = document
        .getElementById("tt-top-nav")
        ?.getBoundingClientRect().bottom
      setPanelTop(Math.max(0, Math.round(bottom ?? 64)))
    }
    update()
    window.addEventListener("scroll", update, { passive: true })
    window.addEventListener("resize", update)
    // A banner mounting late (e.g. the recovery banner resolving with the
    // session) changes layout without a scroll — re-measure on body resize.
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null
    ro?.observe(document.body)
    return () => {
      window.removeEventListener("scroll", update)
      window.removeEventListener("resize", update)
      ro?.disconnect()
    }
  }, [open])

  // Escape closes the panel — keyboard path for the dialog surface.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, closePanel])

  // The dedicated /chat page is the expanded surface — never stack the
  // panel on top of it (also guarantees only one ChatRoom ever mounts).
  const onChatPage = pathname === "/chat"
  if (!session || onChatPage) return null

  const actions = (
    <>
      <Tooltip content="Continue as a discussion">
        <Link
          href="/forum/new"
          onClick={closePanel}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          aria-label="Start a discussion from this conversation"
        >
          <MessageSquare className="h-4 w-4" />
        </Link>
      </Tooltip>
      <Tooltip content="Open full chat">
        <Link
          href="/chat"
          onClick={closePanel}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          aria-label="Open full chat"
        >
          <Maximize2 className="h-4 w-4" />
        </Link>
      </Tooltip>
      <Tooltip content="Close chat panel">
        <button
          onClick={closePanel}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          aria-label="Close chat panel"
        >
          <X className="h-4 w-4" />
        </button>
      </Tooltip>
    </>
  )

  return (
    <>
      {/* Closed state — desktop edge tab. On mobile the bottom-nav Chat
          item is the trigger, so no floating button is needed there. */}
      {!open && (
        <Tooltip content="Open chat" align="end" className="hidden lg:inline-flex">
          <button
            onClick={openPanel}
            className="fixed right-0 top-1/2 z-30 flex -translate-y-1/2 flex-col items-center gap-1 rounded-l-xl border border-r-0 border-border bg-card px-2.5 py-3 shadow-md transition-colors hover:bg-secondary"
            aria-label={chatUnread ? `Open chat (${chatUnreadRooms} rooms with new activity)` : "Open chat"}
            aria-haspopup="dialog"
          >
            <span className="relative">
              <MessagesSquare className="h-5 w-5 text-primary" aria-hidden="true" />
              {chatUnread && (
                <Tooltip content="New chat activity" align="end" className="absolute -right-1 -top-1">
                  <span
                    className="h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-card"
                    role="status"
                    aria-label="New chat activity"
                  />
                </Tooltip>
              )}
            </span>
            <span className="text-[10px] font-medium text-muted-foreground">Chat</span>
          </button>
        </Tooltip>
      )}

      {/* ONE element for both form factors — two hidden-via-CSS surfaces
          would still mount two ChatRoom instances (duplicate sockets).
          Mobile: sheet between header and bottom nav (nav stays tappable).
          lg+: persistent right panel beside the inset content. */}
      {open && (
        <aside
          role="dialog"
          aria-label="Chat panel"
          style={{ top: panelTop }}
          className={cn(
            "fixed inset-x-0 top-16 z-40 flex flex-col border-t border-border bg-card",
            "bottom-[calc(3.5rem+env(safe-area-inset-bottom))]",
            "lg:left-auto lg:bottom-0 lg:right-0 lg:w-[340px] lg:border-l lg:border-t-0"
          )}
        >
          <Suspense fallback={<PanelFallback />}>
            <ChatRoom embedded headerActions={actions} />
          </Suspense>
        </aside>
      )}
    </>
  )
}
