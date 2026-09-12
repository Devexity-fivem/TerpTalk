"use client"

import { useSession, signOut } from "next-auth/react"
import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  Leaf, User, LogOut, MessageCircle, Home, Calendar,
  Settings, Dna, Bell, Shield, Menu, X, Mail, Search, Trophy, BookOpen, Stethoscope, Tag, TrendingUp,
  ScrollText, Image as ImageIcon, Video,
} from "lucide-react"
import CannabisLeaf from "@/components/cannabis-leaf"
import MobileNav from "@/components/mobile-nav"
import ThemeToggle from "@/components/theme-toggle"
import CreateMenu from "@/components/create-menu"
import { cn } from "@/lib/utils"
import { signInHref } from "@/lib/callback-url"

const NAV_LINKS = [
  { href: "/", label: "Home", icon: Home, section: "Explore" },
  { href: "/discover", label: "Discover", icon: TrendingUp, section: "Explore" },
  { href: "/feed", label: "Feed", icon: Calendar, section: "Explore" },
  { href: "/forum", label: "Discussions", icon: MessageCircle, section: "Community" },
  { href: "/diaries", label: "Grow Diaries", icon: Leaf, section: "Community" },
  { href: "/setups", label: "Setups", icon: Settings, section: "Community" },
  { href: "/guides", label: "Guides", icon: BookOpen, section: "Community" },
  { href: "/help", label: "Plant Help", icon: Stethoscope, section: "Community" },
  { href: "/strains", label: "Strains", icon: Dna, section: "Library" },
  { href: "/contest", label: "Contest", icon: Trophy, section: "Library" },
  { href: "/deals", label: "Deals", icon: Tag, section: "Library" },
]

const NAV_SECTIONS = ["Explore", "Community", "Library"]

// Shown inline on large screens; the full list stays in the drawer.
const DESKTOP_LINKS = [
  { href: "/discover", label: "Discover", icon: TrendingUp },
  { href: "/forum", label: "Discussions", icon: MessageCircle },
  { href: "/diaries", label: "Diaries", icon: Leaf },
  { href: "/strains", label: "Strains", icon: Dna },
]

export function Navigation() {
  const { data: session, status } = useSession()
  const pathname = usePathname()
  const router = useRouter()
  const [unread, setUnread] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const role = (session?.user as { role?: string } | undefined)?.role
  const isMod = role === "MODERATOR" || role === "ADMINISTRATOR"
  const isAdmin = role === "ADMINISTRATOR"
  const isSupport = role === "SUPPORT"
  const isStaff = isMod || isSupport

  useEffect(() => {
    if (!session) return
    const userId = (session.user as { id?: string } | undefined)?.id
    const refresh = () => {
      fetch("/api/notifications")
        .then((res) => (res.ok ? res.json() : null))
        .then((d) => setUnread(d?.unreadCount || 0))
        .catch(() => {})
    }
    refresh()
    const onRead = () => refresh()
    window.addEventListener("tt-notifications-read", onRead)
    // Presence ping — updates lastSeenAt/online status (server throttled)
    fetch("/api/ping", { method: "POST" }).catch(() => {})

    // Realtime notifications via a per-user private channel. The DB
    // remains the source of truth; the poll below is the fallback.
    let p: import("pusher-js").default | null = null
    let poll: ReturnType<typeof setInterval> | null = null
    let cancelled = false
    const startPolling = () => {
      if (!poll) poll = setInterval(refresh, 60_000)
    }
    const pusherKey = process.env.NEXT_PUBLIC_PUSHER_KEY
    const pusherCluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER
    const channel = `private-user-${userId}`
    if (userId && pusherKey && pusherCluster) {
      import("pusher-js")
        .then(({ default: Pusher }) => {
          // Effect may have cleaned up before the import resolved —
          // don't leave an orphaned connection behind.
          if (cancelled) return
          p = new Pusher(pusherKey, { cluster: pusherCluster, authEndpoint: "/api/pusher/auth" })
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
      if (p) {
        p.unsubscribe(channel)
        p.disconnect()
      }
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

  const openChat = () => {
    if (session) {
      window.dispatchEvent(new CustomEvent("tt-open-chat"))
    } else {
      router.push(signInHref(pathname))
    }
  }

  const linkClass = (href: string) =>
    cn(
      "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
      isActive(href)
        ? "bg-primary/10 text-primary"
        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
    )

  return (
    <>
      <nav className="sticky top-0 z-50 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between gap-2">
            {/* Logo */}
            <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="TerpTalk home" title="Go to homepage">
              <div className="rounded-xl bg-primary/15 p-2 ring-1 ring-primary/30">
                <CannabisLeaf className="h-6 w-6 text-primary" />
              </div>
              <span className="text-lg font-bold tracking-tight">TerpTalk</span>
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-500">
                Beta
              </span>
            </Link>

            {/* Desktop primary links */}
            <div className="hidden items-center gap-1 lg:flex">
              {DESKTOP_LINKS.map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href} className={linkClass(href)}>
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              ))}
            </div>

            {/* Right side */}
            <div className="flex items-center gap-1.5">
              <form
                action="/search"
                className="hidden md:block"
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
                    className="w-40 rounded-lg border border-border bg-background py-1.5 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring lg:w-52"
                  />
                </label>
              </form>

              {status === "loading" ? (
                <div className="h-8 w-8 animate-pulse rounded-full bg-secondary" />
              ) : session ? (
                <>
                  <CreateMenu />
                  <Link
                    href="/messages"
                    className="hidden rounded-lg p-2 transition-colors hover:bg-secondary lg:block"
                    aria-label="Messages"
                  >
                    <Mail className="h-5 w-5" />
                  </Link>
                  <Link
                    href="/notifications"
                    className="relative hidden rounded-lg p-2 transition-colors hover:bg-secondary lg:block"
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
                  <Link
                    href="/profile"
                    className="hidden items-center gap-2 rounded-lg p-1 text-sm transition-colors hover:text-foreground lg:flex"
                    aria-label="Your profile"
                    title="Your profile"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                      <User className="h-4 w-4 text-primary" />
                    </div>
                    <span className="font-medium hidden xl:inline">{session.user?.name}</span>
                  </Link>
                  <button
                    onClick={() => signOut()}
                    className="hidden rounded-lg p-2 transition-colors hover:bg-secondary lg:block"
                    aria-label="Sign out"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
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

              {/* Chat shortcut — on <lg screens the sidebar is closed by
                  default, so this is the most visible entry point. */}
              {session && (
                <button
                  onClick={openChat}
                  className="rounded-lg p-2 transition-colors hover:bg-secondary lg:hidden"
                  aria-label="Open live chat"
                  title="Live Chat"
                >
                  <MessageCircle className="h-5 w-5" />
                </button>
              )}

              {/* Drawer trigger */}
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border border-border px-3 py-2 transition-colors",
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
                    <Link key={href} href={href} className={linkClass(href)} onClick={() => setMenuOpen(false)}>
                      <Icon className="h-4 w-4" />
                      {label}
                    </Link>
                  ))}
                </div>
              ))}

              <div className="space-y-1">
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Connect
                </div>
                <button
                  onClick={() => { openChat(); setMenuOpen(false) }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors",
                    "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  <MessageCircle className="h-4 w-4" />
                  Chat
                </button>
                {session && (
                  <>
                    <Link href="/messages" className={linkClass("/messages")} onClick={() => setMenuOpen(false)}>
                      <Mail className="h-4 w-4" />
                      Messages
                    </Link>
                    <Link href="/profile" className={linkClass("/profile")} onClick={() => setMenuOpen(false)}>
                      <User className="h-4 w-4" />
                      Profile
                    </Link>
                  </>
                )}
              </div>
              {isStaff && (
                <div className="space-y-1 md:col-span-2 lg:col-span-3">
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-500/80">
                    Staff Tools
                  </div>
                  <div className="grid grid-cols-1 gap-1 md:grid-cols-2 lg:grid-cols-3">
                    {isMod && (
                      <Link href="/moderation" className={cn(linkClass("/moderation"), "!text-amber-500")} onClick={() => setMenuOpen(false)}>
                        <Shield className="h-4 w-4" />
                        Moderation
                      </Link>
                    )}
                    {isSupport && (
                      <Link href="/moderation" className={cn(linkClass("/moderation"), "!text-teal-500")} onClick={() => setMenuOpen(false)}>
                        <Shield className="h-4 w-4" />
                        Support Queue
                      </Link>
                    )}
                    {isAdmin && (
                      <>
                        <Link href="/admin" className={cn(linkClass("/admin"), "!text-amber-500")} onClick={() => setMenuOpen(false)}>
                          <Shield className="h-4 w-4" />
                          Admin Dashboard
                        </Link>
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
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 border-t border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Theme</span>
                <ThemeToggle />
              </div>
              {session && (
                <button
                  onClick={() => signOut()}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground lg:hidden"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              )}
            </div>
          </div>
        )}
      </nav>

      <MobileNav unread={unread} />
    </>
  )
}
