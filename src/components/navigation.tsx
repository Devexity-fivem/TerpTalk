"use client"

import { useSession, signOut } from "next-auth/react"
import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Leaf, MessageCircle, MessagesSquare, Home, Calendar,
  Settings, Dna, Bell, Menu, X, Mail, Search, Trophy, BookOpen, Stethoscope, Tag, TrendingUp, Info, Shield,
  ScrollText, Image as ImageIcon, Video, Tent, HelpCircle, Medal,
} from "lucide-react"
import CannabisLeaf from "@/components/cannabis-leaf"
import MobileNav from "@/components/mobile-nav"
import ThemeToggle from "@/components/theme-toggle"
import CreateMenu from "@/components/create-menu"
import UserMenu from "@/components/user-menu"
import Tooltip from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { signInHref } from "@/lib/callback-url"
import { getSharedPusher, peekSharedPusher } from "@/lib/pusher-client"
import { useChatPanel } from "@/components/chat-panel"

const NAV_LINKS = [
  { href: "/", label: "Home", icon: Home, section: "Explore" },
  { href: "/discover", label: "Discover", icon: TrendingUp, section: "Explore" },
  { href: "/feed", label: "Feed", icon: Calendar, section: "Explore" },
  { href: "/forum", label: "Discussions", icon: MessageCircle, section: "Community" },
  { href: "/diaries", label: "Grow Diaries", icon: Leaf, section: "Community" },
  { href: "/setups", label: "Setups", icon: Tent, section: "Community" },
  { href: "/guides", label: "Guides", icon: BookOpen, section: "Community" },
  { href: "/plant-doctor", label: "Plant Doctor", icon: Stethoscope, section: "Community" },
  { href: "/chat", label: "Chat", icon: MessagesSquare, section: "Community" },
  { href: "/strains", label: "Strains", icon: Dna, section: "Library" },
  { href: "/contest", label: "Contest", icon: Trophy, section: "Library" },
  { href: "/leaderboard", label: "Leaderboard", icon: Medal, section: "Library" },
  { href: "/deals", label: "Deals", icon: Tag, section: "Library" },
]

const NAV_SECTIONS = ["Explore", "Community", "Library"]

// Shown inline on large screens; the full list stays in the drawer.
const DESKTOP_LINKS = [
  { href: "/discover", label: "Discover", icon: TrendingUp },
  { href: "/forum", label: "Discussions", icon: MessageCircle },
  { href: "/diaries", label: "Diaries", icon: Leaf },
  { href: "/strains", label: "Strains", icon: Dna },
  { href: "/chat", label: "Chat", icon: MessagesSquare },
]

export function Navigation() {
  const { data: session, status } = useSession()
  const pathname = usePathname()
  const [unread, setUnread] = useState(0)
  const [dmUnread, setDmUnread] = useState(0)
  // Chat activity signal lives in the panel provider so the nav, the
  // bottom bar, and the closed-panel FAB all share one poll.
  const { chatUnread, openPanel } = useChatPanel()
  const [menuOpen, setMenuOpen] = useState(false)
  const role = (session?.user as { role?: string } | undefined)?.role
  const isAdmin = role === "ADMINISTRATOR"

  // Server-side session invalidation (ban, suspension, sessionVersion bump)
  // returns a session with an empty user object — without this guard the
  // client would sit in a broken "authenticated" state until the JWT aged
  // out. Detect it and sign out so the UI transitions cleanly.
  useEffect(() => {
    if (status === "authenticated" && session && !(session.user as { id?: string } | undefined)?.id) {
      void signOut({ redirect: false })
    }
  }, [status, session])

  useEffect(() => {
    const userId = (session?.user as { id?: string } | undefined)?.id
    if (!userId) return // signed out, or an invalidated ghost session
    const refresh = () => {
      fetch("/api/notifications")
        .then((res) => (res.ok ? res.json() : null))
        .then((d) => setUnread(d?.unreadCount || 0))
        .catch(() => {})
      // One indexed COUNT — never the whole inbox — for the mail badge.
      fetch("/api/messages?unread=1")
        .then((res) => (res.ok ? res.json() : null))
        .then((d) => setDmUnread(d?.unread || 0))
        .catch(() => {})
    }
    refresh()
    const onRead = () => refresh()
    window.addEventListener("tt-notifications-read", onRead)
    // Presence ping — updates lastSeenAt/online status (server throttled)
    fetch("/api/ping", { method: "POST" }).catch(() => {})

    // Realtime notifications via a per-user private channel on the SHARED
    // Pusher socket — the chat page subscribes its room channels on the
    // same connection, so a signed-in user never holds two sockets.
    let poll: ReturnType<typeof setInterval> | null = null
    let cancelled = false
    const startPolling = () => {
      if (!poll) poll = setInterval(refresh, 60_000)
    }
    const pusherKey = process.env.NEXT_PUBLIC_PUSHER_KEY
    const pusherCluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER
    const channel = `private-user-${userId}`
    if (userId && pusherKey && pusherCluster) {
      getSharedPusher()
        .then((p) => {
          // Effect may have cleaned up before the import resolved —
          // don't leave an orphaned subscription behind.
          if (cancelled || !p) return
          const ch = p.subscribe(channel)
          ch.bind("new-notification", (n: unknown) => {
            refresh()
            window.dispatchEvent(new CustomEvent("tt-new-notification", { detail: n }))
          })
          ch.bind("pusher:subscription_error", startPolling)
        })
        .catch(startPolling)
    } else {
      startPolling()
    }

    return () => {
      cancelled = true
      window.removeEventListener("tt-notifications-read", onRead)
      if (poll) clearInterval(poll)
      // The socket is shared — drop only this channel, never disconnect.
      peekSharedPusher()?.unsubscribe(channel)
    }
  }, [session])

  // Close the drawer on Escape and on browser back/forward. Link clicks close
  // it directly, so this covers the cases those handlers miss.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false)
    }
    const onPopState = () => setMenuOpen(false)
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("popstate", onPopState)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("popstate", onPopState)
    }
  }, [])

  // Stop the page behind the drawer from scrolling while it is open.
  useEffect(() => {
    if (!menuOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previous
    }
  }, [menuOpen])

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href)

  const linkClass = (href: string) =>
    cn(
      "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
      isActive(href)
        ? "bg-primary/10 text-primary"
        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
    )

  return (
    <>
      <nav id="tt-top-nav" className="sticky top-0 z-50 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-3 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between gap-2">
            {/* Logo — compact below sm so the header fits 320px devices. */}
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              <Tooltip content="Go to homepage" side="bottom">
                <Link href="/" className="flex items-center gap-1.5 sm:gap-2" aria-label="TerpTalk home">
                  <div className="rounded-xl bg-primary/15 p-1.5 ring-1 ring-primary/30 sm:p-2">
                    <CannabisLeaf className="h-5 w-5 text-primary sm:h-6 sm:w-6" />
                  </div>
                  <span className="text-base font-bold tracking-tight sm:text-lg">TerpTalk</span>
                </Link>
              </Tooltip>
            </div>

            {/* Desktop primary links — xl and up only; below that the
                drawer carries the full nav so lg has room for the
                authenticated control cluster. */}
            <div className="hidden items-center gap-1 xl:flex">
              {DESKTOP_LINKS.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={linkClass(href)}
                  // Chat opens the persistent panel in place — the page
                  // underneath stays put. The href remains so the link is
                  // still a real, deep-linkable navigation element.
                  // Guests get normal navigation to /chat's sign-in wall.
                  onClick={
                    href === "/chat" && session
                      ? (e) => {
                          e.preventDefault()
                          openPanel()
                        }
                      : undefined
                  }
                >
                  <Icon className="h-4 w-4" />
                  {label}
                  {href === "/chat" && chatUnread && (
                    <Tooltip content="New chat activity" side="bottom">
                      <span
                        className="h-2 w-2 rounded-full bg-primary"
                        role="status"
                        aria-label="New chat activity"
                      />
                    </Tooltip>
                  )}
                </Link>
              ))}
            </div>

            {/* Right side */}
            <div className="flex min-w-0 items-center gap-1 sm:gap-1.5">
              {/* Search — full input only while the inline links are hidden;
                  at xl (when every control competes for the 1280px container)
                  it collapses to an icon so the bar doesn't crowd. */}
              <form
                action="/search"
                className="hidden md:block xl:hidden"
                onSubmit={(e) => {
                  const input = e.currentTarget.elements.namedItem("q") as HTMLInputElement
                  if (!input.value.trim()) e.preventDefault()
                }}
              >
                <label className="relative block">
                  <span className="sr-only">Search TerpTalk</span>
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    name="q"
                    placeholder="Search..."
                    className="w-40 rounded-lg border border-border bg-background py-1.5 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring lg:w-52 xl:w-40 2xl:w-52"
                  />
                </label>
              </form>

              {status === "loading" ? (
                <div className="h-8 w-8 animate-pulse rounded-full bg-secondary" />
              ) : session ? (
                <>
                  <CreateMenu />
                  <Tooltip content="Messages" side="bottom" className="hidden lg:inline-flex">
                    <Link
                      href="/messages"
                      className="relative rounded-lg p-2 transition-colors hover:bg-secondary"
                      aria-label={dmUnread > 0 ? `Messages (${dmUnread} unread)` : "Messages"}
                    >
                      <Mail className="h-5 w-5" />
                      {dmUnread > 0 && (
                        <span
                          className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground"
                          aria-live="polite"
                        >
                          {dmUnread > 99 ? "99+" : dmUnread}
                        </span>
                      )}
                    </Link>
                  </Tooltip>
                  <Tooltip content="Notifications" side="bottom" className="hidden lg:inline-flex">
                    <Link
                      href="/notifications"
                      className="relative rounded-lg p-2 transition-colors hover:bg-secondary"
                      aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
                    >
                      <Bell className="h-5 w-5" />
                      {unread > 0 && (
                        <span
                          className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground"
                          aria-live="polite"
                        >
                          {unread > 99 ? "99+" : unread}
                        </span>
                      )}
                    </Link>
                  </Tooltip>
                  <UserMenu />
                </>
              ) : (
                <>
                  <Link
                    href={signInHref(pathname)}
                    className="px-3 py-2 text-sm font-medium transition-colors hover:text-foreground"
                  >
                    Sign In
                  </Link>
                  <Link
                    href="/auth/signup"
                    className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    Sign Up
                  </Link>
                </>
              )}

              {/* Mobile search entry — the search input is md+; below sm the
                  drawer's search field is the search path so the header fits
                  320px devices. */}
              <Tooltip content="Search TerpTalk" side="bottom" className="hidden sm:inline-flex md:hidden">
                <Link
                  href="/search"
                  className="rounded-lg p-2 transition-colors hover:bg-secondary"
                  aria-label="Search"
                >
                  <Search className="h-5 w-5" />
                </Link>
              </Tooltip>

              {/* Search icon for xl+ — replaces the input while the inline
                  desktop links are shown so the bar stays uncrowded. */}
              <Tooltip content="Search TerpTalk" side="bottom" className="hidden xl:inline-flex">
                <Link
                  href="/search"
                  className="rounded-lg p-2 transition-colors hover:bg-secondary"
                  aria-label="Search"
                >
                  <Search className="h-5 w-5" />
                </Link>
              </Tooltip>

              {/* Drawer trigger */}
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border border-border px-2.5 py-2 transition-colors sm:px-3",
                  menuOpen ? "bg-secondary text-foreground" : "bg-card hover:bg-secondary"
                )}
                aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
                aria-expanded={menuOpen}
                aria-controls="tt-nav-drawer"
              >
                {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                <span className="hidden text-sm font-medium sm:inline">Menu</span>
              </button>
            </div>
          </div>
        </div>

        {/* Drawer */}
        {menuOpen && (
          <div id="tt-nav-drawer" className="max-h-[calc(100vh-4rem)] overflow-y-auto border-t border-border bg-card">
            <div className="mx-auto grid max-w-7xl auto-rows-min grid-cols-1 gap-6 px-4 py-3 md:grid-cols-2 lg:grid-cols-3">
              <form
                action="/search"
                onSubmit={(e) => {
                  const input = e.currentTarget.elements.namedItem("q") as HTMLInputElement
                  if (!input.value.trim()) e.preventDefault()
                  else setMenuOpen(false)
                }}
                className="pb-2 lg:hidden"
              >
                <label className="relative block">
                  <span className="sr-only">Search TerpTalk</span>
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    name="q"
                    placeholder="Search threads, strains, members..."
                    className="w-full rounded-lg border border-border bg-background py-2.5 pl-9 pr-3 focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
              </form>

              {NAV_SECTIONS.map((section) => (
                <div key={section} className="space-y-1">
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {section}
                  </div>
                  {NAV_LINKS.filter((l) => l.section === section).map(({ href, label, icon: Icon }) => (
                    <Link
                      key={href}
                      href={href}
                      className={linkClass(href)}
                      onClick={
                        href === "/chat" && session
                          ? (e) => {
                              e.preventDefault()
                              setMenuOpen(false)
                              openPanel()
                            }
                          : () => setMenuOpen(false)
                      }
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                      {href === "/chat" && chatUnread && (
                        <span className="ml-auto flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                          <span className="h-2 w-2 rounded-full bg-primary" role="status" aria-label="New chat activity" />
                          New
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              ))}

              <div className="space-y-1">
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Info
                </div>
                <Link href="/about" className={linkClass("/about")} onClick={() => setMenuOpen(false)}>
                  <Info className="h-4 w-4" />
                  About
                </Link>
                <Link href="/help" className={linkClass("/help")} onClick={() => setMenuOpen(false)}>
                  <HelpCircle className="h-4 w-4" />
                  Help Center
                </Link>
                <Link href="/rules" className={linkClass("/rules")} onClick={() => setMenuOpen(false)}>
                  <ScrollText className="h-4 w-4" />
                  Community Rules
                </Link>
                <Link href="/terms" className={linkClass("/terms")} onClick={() => setMenuOpen(false)}>
                  <ScrollText className="h-4 w-4" />
                  Terms
                </Link>
                <Link href="/privacy" className={linkClass("/privacy")} onClick={() => setMenuOpen(false)}>
                  <Shield className="h-4 w-4" />
                  Privacy
                </Link>
              </div>


              {/* Signed-in: the navbar Mail icon is desktop-only, so the
                  drawer carries the mobile Messages entry + unread badge. */}
              {session && (
                <div className="space-y-1 lg:hidden">
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Connect
                  </div>
                  <Link
                    href="/messages"
                    className={linkClass("/messages")}
                    onClick={() => setMenuOpen(false)}
                  >
                    <Mail className="h-4 w-4" />
                    Messages
                    {dmUnread > 0 && (
                      <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
                        {dmUnread > 99 ? "99+" : dmUnread}
                      </span>
                    )}
                  </Link>
                </div>
              )}
              {/* Admin-only extras — Moderation and Admin Dashboard live in
                  the avatar menu for every staff role. */}
              {isAdmin && (
                <div className="space-y-1 md:col-span-2 lg:col-span-3">
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-500/80">
                    Admin
                  </div>
                  <div className="grid grid-cols-1 gap-1 md:grid-cols-2 lg:grid-cols-3">
                    <Link href="/admin/audit" className={cn(linkClass("/admin/audit"), "!text-amber-500")} onClick={() => setMenuOpen(false)}>
                      <ScrollText className="h-4 w-4" />
                      Audit Log
                    </Link>
                    <Link href="/admin/media" className={cn(linkClass("/admin/media"), "!text-amber-500")} onClick={() => setMenuOpen(false)}>
                      <ImageIcon className="h-4 w-4" />
                      Media Moderation
                    </Link>
                    <Link href="/admin/settings" className={cn(linkClass("/admin/settings"), "!text-amber-500")} onClick={() => setMenuOpen(false)}>
                      <Settings className="h-4 w-4" />
                      Site Settings
                    </Link>
                    <Link href="/admin/features" className={cn(linkClass("/admin/features"), "!text-amber-500")} onClick={() => setMenuOpen(false)}>
                      <Trophy className="h-4 w-4" />
                      Feature Flags
                    </Link>
                    <Link href="/admin/youtubers" className={cn(linkClass("/admin/youtubers"), "!text-amber-500")} onClick={() => setMenuOpen(false)}>
                      <Video className="h-4 w-4" />
                      YouTubers
                    </Link>
                  </div>
                </div>
              )}
            </div>

            <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 border-t border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Theme</span>
                <ThemeToggle />
              </div>

            </div>
          </div>
        )}
      </nav>

      <MobileNav unread={unread} chatUnread={chatUnread} />
    </>
  )
}
