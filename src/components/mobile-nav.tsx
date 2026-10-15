"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useSession } from "next-auth/react"
import { Home, Calendar, Leaf, Bell, User, MessagesSquare, Plus, TrendingUp } from "@/lib/icons"
import { cn } from "@/lib/utils"
import { signInHref } from "@/lib/callback-url"
import { useChatPanel } from "@/components/chat-panel"
import { useShareComposer } from "@/components/share-composer"

interface MobileNavProps {
  unread: number
  chatUnread?: boolean
}

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  exact?: boolean
  chat?: boolean
  alerts?: boolean
}

// Feed-first ordering with a centered creation affordance — the social
// pattern: browse left, act center, connect right. Forums stays out of
// the bar (reachable via Menu/rail/feed), as does raw Search — the
// drawer and Discover cover it.
const ITEMS = {
  left: [
    { href: "/", label: "Home", icon: Home, exact: true },
    { href: "/feed", label: "Feed", icon: Calendar },
    { href: "/diaries", label: "Diaries", icon: Leaf },
  ] as NavItem[],
  right: [
    { href: "/chat", label: "Chat", icon: MessagesSquare, chat: true },
  ] as NavItem[],
  account: { href: "/profile", label: "You", icon: User } as NavItem,
  alerts: { href: "/notifications", label: "Alerts", icon: Bell, alerts: true } as NavItem,
  guestExplore: { href: "/discover", label: "Discover", icon: TrendingUp } as NavItem,
}

/**
 * Purpose-built bottom navigation for touch devices. Hidden from lg upwards
 * where the left rail + header take over. Targets are 56px tall for
 * comfortable taps; the center action is a raised composer FAB.
 */
export default function MobileNav({ unread, chatUnread }: MobileNavProps) {
  const pathname = usePathname()
  const { data: session } = useSession()
  // Chat opens the persistent sheet in place — tapping the bottom-nav item
  // never navigates away. href stays so it remains a real link.
  const { togglePanel, open: chatOpen } = useChatPanel()
  const composer = useShareComposer()

  const isActive = (item: NavItem) =>
    item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`)

  const renderLink = (item: NavItem) => {
    const active = isActive(item) || (item.chat && chatOpen)
    return (
      <li key={item.href} className="min-w-0 flex-1">
        <Link
          href={item.href}
          aria-current={isActive(item) ? "page" : undefined}
          onClick={
            // Guests have no panel — let the link reach /chat's
            // sign-in wall as before.
            item.href === "/chat" && session
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
            <item.icon className="h-5 w-5" aria-hidden="true" />
            {item.chat && chatUnread && (
              <span
                className="absolute -right-1.5 -top-1 h-2 w-2 rounded-full bg-primary"
                role="status"
                aria-label="New chat activity"
              />
            )}
            {item.alerts && unread > 0 && (
              <span
                className="absolute -right-1.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground"
                aria-label={`${unread} unread notifications`}
                aria-live="polite"
              >
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </span>
          <span className="max-w-full truncate">{item.label}</span>
        </Link>
      </li>
    )
  }

  const right = session
    ? [...ITEMS.right, ITEMS.alerts, ITEMS.account]
    : [...ITEMS.right, ITEMS.guestExplore, { ...ITEMS.account, href: signInHref("/profile"), label: "Sign in" }]

  return (
    <nav
      aria-label="Primary"
      className="safe-bottom fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur lg:hidden"
    >
      <ul className="flex items-stretch">
        {ITEMS.left.map(renderLink)}

        {/* Center create FAB — opens the unified share composer in place.
            Guests get the composer's sign-in gate, same as the header's
            Create button. */}
        <li className="min-w-0 flex-1">
          <button
            onClick={() => composer.open()}
            className="relative flex h-14 min-w-0 w-full flex-col items-center justify-center px-0.5"
            aria-label="Share something"
          >
            <span className="tt-cta -mt-5 flex h-11 w-11 items-center justify-center rounded-full text-primary-foreground shadow-lg ring-4 ring-card">
              <Plus className="h-5 w-5" aria-hidden="true" />
            </span>
          </button>
        </li>

        {right.map(renderLink)}
      </ul>
    </nav>
  )
}
