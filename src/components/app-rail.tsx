"use client"

// Persistent left navigation rail — the social-first counterpart to the
// top pill. Icon-only at lg (like a slim toolbar), expands to labeled
// rows at xl. Rendered inside <nav id="tt-top-nav"> so it shares the
// primary-navigation landmark; position:fixed pins it to the viewport.
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useSession } from "next-auth/react"
import {
  Home, Calendar, TrendingUp, MessageCircle, HelpCircle, MessagesSquare, Mail, Bell,
  Leaf, Tent, Dna, Stethoscope, BookOpen, Users, Medal, Tag, Search, Plus, User,
} from "@/lib/icons"
import { cn } from "@/lib/utils"
import { signInHref } from "@/lib/callback-url"
import Tooltip from "@/components/ui/tooltip"
import { useChatPanel } from "@/components/chat-panel"
import { useCommandPalette } from "@/components/command-palette"
import { useShareComposer } from "@/components/share-composer"

interface AppRailProps {
  unread: number
  dmUnread: number
}

interface RailItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  /** show only when signed in */
  auth?: boolean
  /** chat opens the persistent panel instead of navigating */
  panel?: boolean
}

const RAIL_SECTIONS: { label: string | null; items: RailItem[] }[] = [
  {
    label: null,
    items: [
      { href: "/", label: "Home", icon: Home },
      { href: "/feed", label: "Feed", icon: Calendar },
      { href: "/discover", label: "Discover", icon: TrendingUp },
    ],
  },
  {
    label: "Community",
    items: [
      { href: "/forum", label: "Discussions", icon: MessageCircle },
      { href: "/questions", label: "Questions", icon: HelpCircle },
      { href: "/chat", label: "Chat", icon: MessagesSquare, panel: true },
      { href: "/messages", label: "Messages", icon: Mail, auth: true },
      { href: "/notifications", label: "Notifications", icon: Bell, auth: true },
    ],
  },
  {
    label: "Grow",
    items: [
      { href: "/diaries", label: "Diaries", icon: Leaf },
      { href: "/setups", label: "Setups", icon: Tent },
      { href: "/strains", label: "Strains", icon: Dna },
      { href: "/plant-doctor", label: "Plant Doctor", icon: Stethoscope },
    ],
  },
  {
    label: "Library",
    items: [
      { href: "/guides", label: "Guides", icon: BookOpen },
      { href: "/growers", label: "Growers", icon: Users },
      { href: "/leaderboard", label: "Leaderboard", icon: Medal },
      { href: "/deals", label: "Deals", icon: Tag },
    ],
  },
]

export default function AppRail({ unread, dmUnread }: AppRailProps) {
  const { data: session } = useSession()
  const pathname = usePathname()
  const { chatUnread, openPanel, open: chatOpen } = useChatPanel()
  const { openPalette } = useCommandPalette()
  const composer = useShareComposer()

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href)

  const badgeFor = (href: string) =>
    href === "/notifications" ? unread : href === "/messages" ? dmUnread : 0

  const chatClick = (e: React.MouseEvent) => {
    e.preventDefault()
    openPanel()
  }

  const badgeEl = (badge: number) =>
    badge > 0 ? (
      <span
        className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-semibold text-destructive-foreground"
        aria-live="polite"
      >
        {badge > 99 ? "99+" : badge}
      </span>
    ) : null

  const iconContent = (it: RailItem, badge: number) => (
    <span className="relative shrink-0">
      <it.icon className="h-5 w-5" aria-hidden="true" />
      {it.panel && chatUnread && (
        <span
          className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-primary"
          role="status"
          aria-label="New chat activity"
        />
      )}
      {badgeEl(badge)}
    </span>
  )

  // One item → two rendered variants (icon at lg, labeled row at xl);
  // exactly one is visible per breakpoint so the a11y tree stays single.
  const renderItem = (it: RailItem) => {
    const active = isActive(it.href) || (it.panel && chatOpen)
    const badge = badgeFor(it.href)
    const onClick = it.panel && session ? chatClick : undefined
    const ariaLabel = badge > 0 ? `${it.label} (${badge} unread)` : it.label

    return (
      <li key={it.href}>
        {/* lg icon variant */}
        <Tooltip content={it.label} side="right">
          <Link
            href={it.href}
            onClick={onClick}
            aria-current={isActive(it.href) ? "page" : undefined}
            aria-label={ariaLabel}
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-xl transition-colors xl:hidden",
              active
                ? "bg-primary/12 text-primary ring-1 ring-inset ring-primary/25"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
          >
            {iconContent(it, badge)}
          </Link>
        </Tooltip>
        {/* xl labeled variant */}
        <Link
          href={it.href}
          onClick={onClick}
          aria-current={isActive(it.href) ? "page" : undefined}
          aria-label={ariaLabel}
          className={cn(
            "hidden items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors xl:flex",
            active
              ? "bg-primary/12 font-semibold text-primary ring-1 ring-inset ring-primary/25"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground"
          )}
        >
          {iconContent(it, badge)}
          <span className="min-w-0 flex-1 truncate">{it.label}</span>
        </Link>
      </li>
    )
  }

  return (
    <div
      className="fixed inset-y-0 left-0 z-40 hidden w-[72px] flex-col border-r border-border/60 bg-card/60 pt-24 backdrop-blur-sm lg:flex xl:w-56"
      aria-label="All sections"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 pb-4 scrollbar-none">
        {/* Search — palette, same affordance as the header trigger */}
        <Tooltip content="Search TerpTalk" side="right">
          <button
            onClick={openPalette}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground xl:hidden"
            aria-label="Search TerpTalk"
          >
            <Search className="h-5 w-5 shrink-0" aria-hidden="true" />
          </button>
        </Tooltip>
        <button
          onClick={openPalette}
          className="hidden items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground xl:flex"
          aria-label="Search TerpTalk"
        >
          <Search className="h-5 w-5 shrink-0" aria-hidden="true" />
          Search
        </button>

        {RAIL_SECTIONS.map((section, i) => {
          const items = section.items.filter((it) => !it.auth || session)
          if (items.length === 0) return null
          return (
            <div key={section.label ?? "primary"}>
              {i > 0 && <div className="mx-auto mb-2 h-px w-8 bg-border/70 xl:hidden" />}
              {section.label && (
                <div className="hidden px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground xl:block">
                  {section.label}
                </div>
              )}
              <ul className="flex flex-col items-center gap-1 xl:items-stretch">
                {items.map(renderItem)}
              </ul>
            </div>
          )
        })}
      </div>

      {/* Bottom cluster — creation affordance, then account */}
      <div className="flex flex-col items-center gap-1 border-t border-border/60 px-3 py-3 xl:items-stretch">
        {session ? (
          <>
            <Tooltip content="Share something" side="right">
              <button
                onClick={() => composer.open()}
                className="tt-cta flex h-11 w-11 items-center justify-center rounded-xl text-primary-foreground transition-all xl:hidden"
                aria-label="Share something"
              >
                <Plus className="h-5 w-5 shrink-0" aria-hidden="true" />
              </button>
            </Tooltip>
            <button
              onClick={() => composer.open()}
              className="tt-cta hidden items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-all xl:flex"
              aria-label="Share something"
            >
              <Plus className="h-5 w-5 shrink-0" aria-hidden="true" />
              Create
            </button>
            <Tooltip content="Your profile" side="right">
              <Link
                href="/profile"
                aria-current={isActive("/profile") ? "page" : undefined}
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-xl transition-colors xl:hidden",
                  isActive("/profile")
                    ? "bg-primary/12 text-primary ring-1 ring-inset ring-primary/25"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                <User className="h-5 w-5 shrink-0" aria-hidden="true" />
              </Link>
            </Tooltip>
            <Link
              href="/profile"
              aria-current={isActive("/profile") ? "page" : undefined}
              className={cn(
                "hidden items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors xl:flex",
                isActive("/profile")
                  ? "bg-primary/12 font-semibold text-primary ring-1 ring-inset ring-primary/25"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              <User className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">Profile</span>
            </Link>
          </>
        ) : (
          <Link
            href={signInHref(pathname)}
            className="tt-cta flex h-11 w-11 items-center justify-center rounded-xl text-primary-foreground transition-all xl:h-auto xl:w-full xl:justify-center xl:rounded-full xl:px-4 xl:py-2.5"
          >
            <User className="h-5 w-5 shrink-0 xl:hidden" aria-hidden="true" />
            <span className="hidden text-sm font-semibold xl:inline">Sign in</span>
          </Link>
        )}
      </div>
    </div>
  )
}
