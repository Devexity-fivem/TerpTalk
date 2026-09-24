"use client"

import { useSession, signOut } from "next-auth/react"
import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Leaf, MessageCircle, MessagesSquare, Home, Calendar,
  Settings, Dna, Bell, Menu, X, Mail, Search, Trophy, BookOpen, Stethoscope, Tag, TrendingUp, Info, Shield,
  ScrollText, Image as ImageIcon, Video, Tent, HelpCircle, Medal, Users, Sprout,
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
import { useCommandPalette } from "@/components/command-palette"

// Information architecture: Grow first — the diary/strain/doctor loop is
// what TerpTalk is — then Community, then the browse/discovery surfaces,
// then reference material. Feed and Discover stay reachable from Explore.
const NAV_LINKS = [
  { href: "/diaries", label: "Grow Diaries", icon: Leaf, section: "Grow" },
  { href: "/setups", label: "Setups", icon: Tent, section: "Grow" },
  { href: "/plant-doctor", label: "Plant Doctor", icon: Stethoscope, section: "Grow" },
  { href: "/strains", label: "Strains", icon: Dna, section: "Grow" },
  { href: "/forum", label: "Discussions", icon: MessageCircle, section: "Community" },
  { href: "/questions", label: "Questions", icon: HelpCircle, section: "Community" },
  { href: "/chat", label: "Chat", icon: MessagesSquare, section: "Community" },
  { href: "/contest", label: "Contest", icon: Trophy, section: "Community" },
  { href: "/", label: "Home", icon: Home, section: "Explore" },
  { href: "/discover", label: "Discover", icon: TrendingUp, section: "Explore" },
  { href: "/feed", label: "Feed", icon: Calendar, section: "Explore" },
  { href: "/guides", label: "Guides", icon: BookOpen, section: "Library" },
  { href: "/growers", label: "Growers", icon: Users, section: "Library" },
  { href: "/leaderboard", label: "Leaderboard", icon: Medal, section: "Library" },
  { href: "/deals", label: "Deals", icon: Tag, section: "Library" },
]

const NAV_SECTIONS = ["Grow", "Community", "Explore", "Library"]

// Shown inline on large screens; the full list stays in the drawer.
// Grower-first ordering — diaries and strains lead, chat stays last so
// its unread dot never jumps position mid-list.
const DESKTOP_LINKS = [
  { href: "/diaries", label: "Diaries", icon: Leaf },
  { href: "/strains", label: "Strains", icon: Dna },
  { href: "/questions", label: "Questions", icon: HelpCircle },
  { href: "/forum", label: "Discussions", icon: MessageCircle },
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
  const { openPalette } = useCommandPalette()
  const [menuOpen, setMenuOpen] = useState(false)
  // One-time ⌘K discoverability hint on the icon search buttons — cleared
  // permanently the first time the palette is opened.
  const [paletteHint, setPaletteHint] = useState(false)
  useEffect(() => {
    // Deferred one frame — reading localStorage in the effect body is an
    // external-system sync; rAF avoids a synchronous cascading render and
    // keeps server/client markup identical through hydration.
    const id = requestAnimationFrame(() => {
      setPaletteHint(localStorage.getItem("tt-palette-seen") !== "1")
    })
    return () => cancelAnimationFrame(id)
  }, [])
  const handleOpenPalette = () => {
    if (paletteHint) {
      localStorage.setItem("tt-palette-seen", "1")
      setPaletteHint(false)
    }
    openPalette()
  }
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
      "flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
      isActive(href)
        ? "bg-primary/12 text-primary ring-1 ring-inset ring-primary/25"
        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
    )

  return (
    <>
      <nav id="tt-top-nav" className="sticky top-2 z-50 px-2 sm:top-3 sm:px-3 lg:px-4">
        <div className="tt-glass tt-spotlight relative mx-auto max-w-7xl rounded-2xl border border-border/60 shadow-lg shadow-black/5">
          <div className="tt-spectrum-bar absolute inset-x-8 bottom-0 h-[2px] rounded-full opacity-50" />
          <div className="flex h-14 items-center justify-between gap-2 px-3 sm:h-16 sm:px-4">
            {/* Logo — compact below sm so the header fits 320px devices. */}
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              <Tooltip content="Go to homepage" side="bottom">
                <Link href="/" className="flex items-center gap-1.5 sm:gap-2" aria-label="TerpTalk home">
                  <div className="tt-brand-tile rounded-full p-1.5 sm:p-2">
                    <CannabisLeaf className="h-5 w-5 text-primary sm:h-6 sm:w-6" />
                  </div>
                  <span className="font-display text-base font-bold tracking-tight sm:text-lg">TerpTalk</span>
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
              {/* Search trigger — opens the command palette instead of a
                  plain search form. Shows as a fake input on md-xl, as an
                  icon on sm and xl+. */}
              <button
                onClick={handleOpenPalette}
                className="hidden md:flex xl:hidden items-center gap-2 w-40 lg:w-52 rounded-xl border border-border/70 bg-background py-1.5 pl-3 pr-2 text-sm text-muted-foreground hover:border-primary/40 transition-colors"
                aria-label="Search TerpTalk"
              >
                <Search className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-left truncate">Search...</span>
                <kbd className="hidden lg:inline-flex items-center gap-0.5 rounded border border-border bg-secondary px-1 py-0.5 text-[10px] font-medium">
                  ⌘K
                </kbd>
              </button>

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
                  {/* Guests see the same Create affordance — the composer
                      opens with a sign-in gate so they can preview the
                      creation model before being asked for an account. */}
                  <CreateMenu />
                  <Link
                    href={signInHref(pathname)}
                    className="whitespace-nowrap px-2 py-2 text-sm font-medium transition-colors hover:text-foreground sm:px-3"
                  >
                    Sign In
                  </Link>
                  <Link
                    href="/auth/signup"
                    className="tt-cta whitespace-nowrap rounded-full px-3 py-2 text-sm font-semibold text-primary-foreground transition-all sm:px-4"
                  >
                    Sign Up
                  </Link>
                </>
              )}

              {/* Mobile search entry — opens the command palette */}
              <Tooltip content="Search TerpTalk" side="bottom" className="hidden sm:inline-flex md:hidden">
                <button
                  onClick={handleOpenPalette}
                  className="relative rounded-lg p-2 transition-colors hover:bg-secondary"
                  aria-label="Search"
                >
                  <Search className="h-5 w-5" />
                  {paletteHint && (
                    <kbd className="absolute -right-1.5 -top-1.5 animate-pulse rounded border border-primary/40 bg-card px-1 text-[9px] font-semibold text-primary shadow-sm">
                      ⌘K
                    </kbd>
                  )}
                </button>
              </Tooltip>

              {/* Search icon for xl+ — replaces the trigger input while the
                  inline desktop links are shown so the bar stays uncrowded. */}
              <Tooltip content="Search TerpTalk" side="bottom" className="hidden xl:inline-flex">
                <button
                  onClick={handleOpenPalette}
                  className="relative rounded-lg p-2 transition-colors hover:bg-secondary"
                  aria-label="Search"
                >
                  <Search className="h-5 w-5" />
                  {paletteHint && (
                    <kbd className="absolute -right-1.5 -top-1.5 animate-pulse rounded border border-primary/40 bg-card px-1 text-[9px] font-semibold text-primary shadow-sm">
                      ⌘K
                    </kbd>
                  )}
                </button>
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

        {/* Drawer — a second floating panel docked under the pill */}
        {menuOpen && (
          <div id="tt-nav-drawer" className="tt-glass animate-in mx-auto mt-2 max-h-[calc(100vh-6.5rem)] max-w-7xl overflow-y-auto rounded-2xl border border-border/60 shadow-xl">
            <div className="grid auto-rows-min grid-cols-1 gap-6 px-4 py-4 md:grid-cols-2 lg:grid-cols-3">
              <button
                onClick={() => { setMenuOpen(false); handleOpenPalette() }}
                className="flex w-full items-center gap-2 rounded-xl border border-border/70 bg-background py-2.5 pl-3 pr-3 text-sm text-muted-foreground hover:border-primary/40 transition-colors lg:hidden"
                aria-label="Search TerpTalk"
              >
                <Search className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-left">Search threads, strains, members...</span>
              </button>

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
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-warning/80">
                    Admin
                  </div>
                  <div className="grid grid-cols-1 gap-1 md:grid-cols-2 lg:grid-cols-3">
                    <Link href="/admin/audit" className={cn(linkClass("/admin/audit"), "!text-warning")} onClick={() => setMenuOpen(false)}>
                      <ScrollText className="h-4 w-4" />
                      Audit Log
                    </Link>
                    <Link href="/admin/media" className={cn(linkClass("/admin/media"), "!text-warning")} onClick={() => setMenuOpen(false)}>
                      <ImageIcon className="h-4 w-4" />
                      Media Moderation
                    </Link>
                    <Link href="/admin/settings" className={cn(linkClass("/admin/settings"), "!text-warning")} onClick={() => setMenuOpen(false)}>
                      <Settings className="h-4 w-4" />
                      Site Settings
                    </Link>
                    <Link href="/admin/features" className={cn(linkClass("/admin/features"), "!text-warning")} onClick={() => setMenuOpen(false)}>
                      <Trophy className="h-4 w-4" />
                      Feature Flags
                    </Link>
                    <Link href="/admin/youtubers" className={cn(linkClass("/admin/youtubers"), "!text-warning")} onClick={() => setMenuOpen(false)}>
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
              {/* Persistent grow CTA — the full-field diary form routes
                  cleanly rather than duplicating creation logic. */}
              <Link
                href="/diaries/new"
                onClick={() => setMenuOpen(false)}
                className="tt-cta inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-primary-foreground transition-all"
              >
                <Sprout className="h-4 w-4" />
                Start a Diary
              </Link>
            </div>
          </div>
        )}
      </nav>

      <MobileNav unread={unread} chatUnread={chatUnread} />
    </>
  )
}
