"use client"

import { useSession, signOut } from "next-auth/react"
import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Leaf, User, LogOut, MessageCircle, Home, Calendar,
  Settings, Dna, Bell, Shield, Menu, X,
} from "lucide-react"

const NAV_LINKS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/feed", label: "Feed", icon: Calendar },
  { href: "/forum", label: "Discussions", icon: MessageCircle },
  { href: "/diaries", label: "Grow Diaries", icon: Leaf },
  { href: "/setups", label: "Setups", icon: Settings },
  { href: "/strains", label: "Strains", icon: Dna },
]

export function Navigation() {
  const { data: session, status } = useSession()
  const pathname = usePathname()
  const [unread, setUnread] = useState(0)
  const [mobileOpen, setMobileOpen] = useState(false)
  const role = (session?.user as { role?: string } | undefined)?.role
  const isMod = role === "MODERATOR" || role === "ADMINISTRATOR"
  const isAdmin = role === "ADMINISTRATOR"

  useEffect(() => {
    if (!session) return
    fetch("/api/notifications")
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => setUnread(d?.unreadCount || 0))
      .catch(() => {})
  }, [session])

  // Close mobile menu on navigation
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href)

  const linkClass = (href: string) =>
    `flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      isActive(href)
        ? "bg-primary/10 text-primary"
        : "text-muted-foreground hover:text-foreground hover:bg-secondary"
    }`

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-card/95 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <div className="bg-primary/10 p-2 rounded-lg">
              <Leaf className="w-6 h-6 text-primary" />
            </div>
            <span className="font-bold text-lg">TerpTalk</span>
            <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">
              BETA
            </span>
          </Link>

          {/* Desktop nav links */}
          <div className="hidden lg:flex items-center gap-1">
            {NAV_LINKS.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} className={linkClass(href)} onClick={() => setMobileOpen(false)}>
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            ))}
            {isMod && (
              <Link href="/moderation" className={`${linkClass("/moderation")} !text-amber-500`} onClick={() => setMobileOpen(false)}>
                <Shield className="w-4 h-4" />
                Moderation
              </Link>
            )}
            {isAdmin && (
              <Link href="/admin" className={`${linkClass("/admin")} !text-amber-500`} onClick={() => setMobileOpen(false)}>
                <Shield className="w-4 h-4" />
                Admin
              </Link>
            )}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2">
            {status === "loading" ? (
              <div className="w-8 h-8 bg-secondary rounded-full animate-pulse" />
            ) : session ? (
              <>
                <Link
                  href="/notifications"
                  className="relative p-2 hover:bg-secondary rounded-lg transition-colors"
                  title="Notifications"
                >
                  <Bell className="w-5 h-5" />
                  {unread > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-destructive text-destructive-foreground text-[10px] rounded-full flex items-center justify-center">
                      {unread > 9 ? "9+" : unread}
                    </span>
                  )}
                </Link>
                <Link
                  href="/profile"
                  className="flex items-center gap-2 text-sm hover:text-foreground transition-colors p-1 rounded-lg"
                >
                  <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                    <User className="w-4 h-4 text-primary" />
                  </div>
                  <span className="hidden sm:inline font-medium">{session.user?.name}</span>
                </Link>
                <button
                  onClick={() => signOut()}
                  className="p-2 hover:bg-secondary rounded-lg transition-colors"
                  title="Sign out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/auth/signin"
                  className="px-4 py-2 text-sm font-medium hover:text-foreground transition-colors"
                >
                  Sign In
                </Link>
                <Link
                  href="/auth/signup"
                  className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                >
                  Sign Up
                </Link>
              </>
            )}

            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="lg:hidden p-2 hover:bg-secondary rounded-lg transition-colors"
              aria-label="Toggle menu"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="lg:hidden border-t border-border bg-card">
          <div className="max-w-7xl mx-auto px-4 py-3 space-y-1">
            {NAV_LINKS.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} className={linkClass(href)} onClick={() => setMobileOpen(false)}>
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            ))}
            {isMod && (
              <Link href="/moderation" className={`${linkClass("/moderation")} !text-amber-500`} onClick={() => setMobileOpen(false)}>
                <Shield className="w-4 h-4" />
                Moderation
              </Link>
            )}
            {isAdmin && (
              <Link href="/admin" className={`${linkClass("/admin")} !text-amber-500`} onClick={() => setMobileOpen(false)}>
                <Shield className="w-4 h-4" />
                Admin
              </Link>
            )}
          </div>
        </div>
      )}
    </nav>
  )
}
