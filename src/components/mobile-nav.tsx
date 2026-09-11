"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useSession } from "next-auth/react"
import { Home, MessageCircle, Leaf, Bell, User, Search } from "lucide-react"
import { cn } from "@/lib/utils"

interface MobileNavProps {
  unread: number
}

const ITEMS = [
  { href: "/", label: "Home", icon: Home, exact: true },
  { href: "/forum", label: "Forums", icon: MessageCircle },
  { href: "/diaries", label: "Diaries", icon: Leaf },
  { href: "/search", label: "Search", icon: Search },
]

/**
 * Purpose-built bottom navigation for touch devices. Hidden from lg upwards
 * where the header nav takes over. Targets are 56px tall for comfortable taps.
 */
export default function MobileNav({ unread }: MobileNavProps) {
  const pathname = usePathname()
  const { data: session } = useSession()

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)

  const accountHref = session ? "/profile" : "/auth/signin"
  const accountLabel = session ? "You" : "Sign in"

  return (
    <nav
      aria-label="Primary"
        className="safe-bottom fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur lg:hidden"
      >
      <ul className="flex items-stretch">
        {ITEMS.map(({ href, label, icon: Icon, exact }) => {
          const active = isActive(href, exact)
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground"
                )}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                {label}
              </Link>
            </li>
          )
        })}
        {session && (
          <li className="flex-1">
            <Link
              href="/notifications"
              aria-current={isActive("/notifications") ? "page" : undefined}
              className={cn(
                "relative flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors",
                isActive("/notifications") ? "text-primary" : "text-muted-foreground"
              )}
            >
              <span className="relative">
                <Bell className="h-5 w-5" aria-hidden="true" />
                {unread > 0 && (
                  <span
                    className="absolute -right-1.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground"
                    aria-label={`${unread} unread notifications`}
                  >
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </span>
              Alerts
            </Link>
          </li>
        )}
        <li className="flex-1">
          <Link
            href={accountHref}
            aria-current={isActive("/profile") ? "page" : undefined}
            className={cn(
              "flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors",
              isActive("/profile") ? "text-primary" : "text-muted-foreground"
            )}
          >
            <User className="h-5 w-5" aria-hidden="true" />
            {accountLabel}
          </Link>
        </li>
      </ul>
    </nav>
  )
}
