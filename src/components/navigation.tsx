"use client"

import { useSession, signOut } from "next-auth/react"
import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Leaf, User, LogOut, MessageCircle, Home, Calendar,
  Settings, Dna, Bell, Shield, Menu, X, Mail, Search, Trophy, BookOpen, Stethoscope, Tag, Award, Calculator, Info, FileText, Video, PenLine,
} from "lucide-react"
import CannabisLeaf from "@/components/cannabis-leaf"
import MobileNav from "@/components/mobile-nav"
import ThemeToggle from "@/components/theme-toggle"
import { cn } from "@/lib/utils"

const NAV_LINKS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/feed", label: "Feed", icon: Calendar },
  { href: "/forum", label: "Discussions", icon: MessageCircle },
  { href: "/diaries", label: "Grow Diaries", icon: Leaf },
  { href: "/setups", label: "Setups", icon: Settings },
  { href: "/strains", label: "Strains", icon: Dna },
  { href: "/contest", label: "Contest", icon: Trophy },
  { href: "/guides", label: "Guides", icon: BookOpen },
  { href: "/help", label: "Plant Help", icon: Stethoscope },
  { href: "/deals", label: "Deals", icon: Tag },
  { href: "/leaderboard", label: "Leaderboard", icon: Award },
  { href: "/calculator", label: "Calculator", icon: Calculator },
  { href: "/youtubers", label: "YouTubers", icon: Video },
  { href: "/about", label: "About", icon: Info },
  { href: "/terms", label: "Terms", icon: FileText },
  { href: "/privacy", label: "Privacy", icon: Shield },
]

// Shown inline on large screens; the full list stays in the drawer.
const DESKTOP_LINKS = [
  { href: "/forum", label: "Discussions", icon: MessageCircle },
  { href: "/diaries", label: "Diaries", icon: Leaf },
  { href: "/strains", label: "Strains", icon: Dna },
  { href: "/leaderboard", label: "Leaderboard", icon: Award },
]

export function Navigation() {
  const { data: session, status } = useSession()
  const pathname = usePathname()
  const [unread, setUnread] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const role = (session?.user as { role?: string } | undefined)?.role
  const isMod = role === "MODERATOR" || role === "ADMINISTRATOR"
  const isAdmin = role === "ADMINISTRATOR"

  useEffect(() => {
    if (!session) return
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
    return () => window.removeEventListener("tt-notifications-read", onRead)
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
      <nav className="sticky top-0 z-50 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between gap-2">
            {/* Logo */}
            <Link href="/" className="flex shrink-0 items-center gap-2">
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
              {isMod && (
                <Link href="/moderation" className={cn(linkClass("/moderation"), "!text-amber-500")}>
                  <Shield className="h-4 w-4" />
                  Moderation
                </Link>
              )}
              {isAdmin && (
                <Link href="/admin" className={cn(linkClass("/admin"), "!text-amber-500")}>
                  <Shield className="h-4 w-4" />
                  Admin
                </Link>
              )}
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
                  <Link
                    href="/forum/new"
                    className="hidden items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 sm:inline-flex"
                  >
                    <PenLine className="h-4 w-4" />
                    Post
                  </Link>
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
                      <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
                        {unread > 9 ? "9+" : unread}
                      </span>
                    )}
                  </Link>
                  <Link
                    href="/profile"
                    className="hidden items-center gap-2 rounded-lg p-1 text-sm transition-colors hover:text-foreground lg:flex"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                      <User className="h-4 w-4 text-primary" />
                    </div>
                    <span className="font-medium">{session.user?.name}</span>
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
                    href="/auth/signin"
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
            <div className="mx-auto max-w-7xl space-y-1 px-4 py-3 lg:grid lg:grid-cols-3 lg:gap-1 lg:space-y-0">
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

              {NAV_LINKS.map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href} className={linkClass(href)} onClick={() => setMenuOpen(false)}>
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              ))}

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
              {isMod && (
                <Link href="/moderation" className={cn(linkClass("/moderation"), "!text-amber-500")} onClick={() => setMenuOpen(false)}>
                  <Shield className="h-4 w-4" />
                  Moderation
                </Link>
              )}
              {isAdmin && (
                <Link href="/admin" className={cn(linkClass("/admin"), "!text-amber-500")} onClick={() => setMenuOpen(false)}>
                  <Shield className="h-4 w-4" />
                  Admin
                </Link>
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
