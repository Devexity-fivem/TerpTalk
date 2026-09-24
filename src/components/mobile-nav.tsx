"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useSession } from "next-auth/react"
import { Home, MessageCircle, Leaf, Bell, User, MessagesSquare, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { signInHref } from "@/lib/callback-url"
import { useChatPanel } from "@/components/chat-panel"
import { useCommandPalette } from "@/components/command-palette"

interface MobileNavProps {
  unread: number
  chatUnread?: boolean
}

const ITEMS = [
  { href: "/", label: "Home", icon: Home, exact: true },
  { href: "/forum", label: "Forums", icon: MessageCircle },
  { href: "/diaries", label: "Diaries", icon: Leaf },
  { href: "/chat", label: "Chat", icon: MessagesSquare },
]

/**
 * Purpose-built bottom navigation for touch devices. Hidden from lg upwards
 * where the header nav takes over. Targets are 56px tall for comfortable taps.
 * Search lives in the header drawer on mobile, keeping the bar at 6 items.
 */
export default function MobileNav({ unread, chatUnread }: MobileNavProps) {
  const pathname = usePathname()
  const { data: session } = useSession()
  // Chat opens the persistent sheet in place — tapping the bottom-nav item
  // never navigates away. href stays so it remains a real link.
  const { togglePanel, open: chatOpen } = useChatPanel()
  const { openPalette } = useCommandPalette()

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)

  const accountHref = session ? "/profile" : signInHref("/profile")
  const accountLabel = session ? "You" : "Sign in"

  return (
    <nav
      aria-label="Primary"
        className="safe-bottom fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur lg:hidden"
      >
      <ul className="flex items-stretch">
        {ITEMS.map(({ href, label, icon: Icon, exact }) => {
          const active = isActive(href, exact) || (href === "/chat" && chatOpen)
          return (
            <li key={href} className="min-w-0 flex-1">
              <Link
                href={href}
                aria-current={isActive(href, exact) ? "page" : undefined}
                onClick={
                  // Guests have no panel — let the link reach /chat's
                  // sign-in wall as before.
                  href === "/chat" && session
                    ? (e) => {
                        e.preventDefault()
                        togglePanel()
                      }
                    : undefined
                }
                className={cn(
                  "flex h-14 min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 text-[11px] font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground"
                )}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {href === "/chat" && chatUnread && (
                    <span
                      className="absolute -right-1.5 -top-1 h-2 w-2 rounded-full bg-primary"
                      role="status"
                      aria-label="New chat activity"
                    />
                  )}
                </span>
                <span className="max-w-full truncate">{label}</span>
              </Link>
            </li>
          )
        })}
        {/* Search — opens the command palette. On a forum this is the
            highest-frequency mobile action, so it earns a bar slot. */}
        <li className="min-w-0 flex-1">
          <button
            onClick={openPalette}
            className="flex h-14 min-w-0 w-full flex-col items-center justify-center gap-0.5 px-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Search TerpTalk"
          >
            <Search className="h-5 w-5" aria-hidden="true" />
            <span className="max-w-full truncate">Search</span>
          </button>
        </li>
        {session && (
          <li className="min-w-0 flex-1">
            <Link
              href="/notifications"
              aria-current={isActive("/notifications") ? "page" : undefined}
              className={cn(
                "relative flex h-14 min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 text-[11px] font-medium transition-colors",
                isActive("/notifications") ? "text-primary" : "text-muted-foreground"
              )}
            >
              <span className="relative">
                <Bell className="h-5 w-5" aria-hidden="true" />
                {unread > 0 && (
                  <span
                    className="absolute -right-1.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground"
                    aria-label={`${unread} unread notifications`}
                    aria-live="polite"
                  >
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </span>
              <span className="max-w-full truncate">Alerts</span>
            </Link>
          </li>
        )}
        <li className="min-w-0 flex-1">
          <Link
            href={accountHref}
            aria-current={isActive("/profile") ? "page" : undefined}
            className={cn(
              "flex h-14 min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 text-[11px] font-medium transition-colors",
              isActive("/profile") ? "text-primary" : "text-muted-foreground"
            )}
          >
            <User className="h-5 w-5" aria-hidden="true" />
            <span className="max-w-full truncate">{accountLabel}</span>
          </Link>
        </li>
      </ul>
    </nav>
  )
}
