"use client"

import { useSession, signOut } from "next-auth/react"
import { useEffect, useState } from "react"
import Link from "next/link"
import { Leaf, User, LogOut, MessageCircle, Home, Calendar, Settings, Dna, Bell, Shield } from "lucide-react"

export function Navigation() {
  const { data: session, status } = useSession()
  const [unread, setUnread] = useState(0)
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

  return (
    <nav className="border-b border-border bg-card">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <div className="bg-primary/10 p-2 rounded-lg">
              <Leaf className="w-6 h-6 text-primary" />
            </div>
            <span className="font-bold text-lg">TerpTalk</span>
            <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">BETA</span>
          </Link>

          {/* Navigation Links */}
          <div className="hidden md:flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
              <Home className="w-4 h-4" />
              Home
            </Link>
            <Link href="/feed" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
              <Calendar className="w-4 h-4" />
              Feed
            </Link>
            <Link href="/forum" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
              <MessageCircle className="w-4 h-4" />
              Discussions
            </Link>
            <Link href="/diaries" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
              <Leaf className="w-4 h-4" />
              Grow Diaries
            </Link>
            <Link href="/setups" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
              <Settings className="w-4 h-4" />
              Setups
            </Link>
            <Link href="/strains" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
              <Dna className="w-4 h-4" />
              Strains
            </Link>
            {isMod && (
              <Link href="/moderation" className="flex items-center gap-2 text-amber-500 hover:text-amber-600 transition-colors">
                <Shield className="w-4 h-4" />
                Moderation
              </Link>
            )}
            {isAdmin && (
              <Link href="/admin" className="flex items-center gap-2 text-amber-500 hover:text-amber-600 transition-colors">
                <Shield className="w-4 h-4" />
                Admin
              </Link>
            )}
          </div>

          {/* User Menu */}
          <div className="flex items-center gap-4">
            {status === "loading" ? (
              <div className="w-8 h-8 bg-secondary rounded-full animate-pulse" />
            ) : session ? (
              <div className="flex items-center gap-3">
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
                  className="flex items-center gap-2 text-sm hover:text-foreground transition-colors"
                >
                  <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                    <User className="w-4 h-4 text-primary" />
                  </div>
                  <span className="hidden sm:inline">{session.user?.name}</span>
                </Link>
                <button
                  onClick={() => signOut()}
                  className="p-2 hover:bg-secondary rounded-lg transition-colors"
                  title="Sign out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
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
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  )
}
