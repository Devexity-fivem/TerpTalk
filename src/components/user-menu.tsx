"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useSession, signOut } from "next-auth/react"
import {
  User, Award, TrendingUp, Leaf, Mail, Bell, Settings, Shield, LogOut, ChevronDown,
} from "lucide-react"
import { Avatar } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

const LINKS = [
  { href: "/profile", label: "My Profile", icon: User, desc: "Account, badges, saved threads" },
  { href: "/diaries", label: "Grow Diaries", icon: Leaf, desc: "Track and share your grows" },
  { href: "/achievements", label: "Achievements", icon: Award, desc: "Badges and progress" },
  { href: "/reputation", label: "Reputation", icon: TrendingUp, desc: "Tiers and unlocks" },
  { href: "/messages", label: "Messages", icon: Mail, desc: "Private conversations" },
  { href: "/notifications", label: "Notifications", icon: Bell, desc: "Replies, mentions, milestones" },
  { href: "/settings/notifications", label: "Settings", icon: Settings, desc: "Notification preferences" },
] as const

export default function UserMenu() {
  const { data: session } = useSession()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    if (open) {
      document.addEventListener("mousedown", onClick)
      document.addEventListener("keydown", onKey)
    }
    return () => {
      document.removeEventListener("mousedown", onClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  if (!session?.user) return null

  const role = (session.user as { role?: string }).role
  const isStaff = ["MODERATOR", "ADMINISTRATOR", "SUPPORT"].includes(role || "")
  const isAdmin = role === "ADMINISTRATOR"
  const name = session.user.name || "Member"
  const image = (session.user as { image?: string | null }).image

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-2 rounded-lg p-1 pr-2 text-sm transition-colors",
          open ? "bg-secondary text-foreground" : "hover:bg-secondary"
        )}
        aria-label="Account menu"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Avatar src={image} alt={name} size="sm" className="ring-1 ring-primary/30" />
        <span className="font-medium hidden xl:inline max-w-28 truncate">{name}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-border bg-card p-1.5 shadow-lg"
        >
          {/* Identity header */}
          <Link
            href="/profile"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-secondary transition-colors"
          >
            <Avatar src={image} alt={name} size="md" className="ring-1 ring-primary/30" />
            <div className="min-w-0">
              <div className="truncate font-medium">@{name}</div>
              <div className="text-[11px] text-muted-foreground">View profile</div>
            </div>
          </Link>

          <div className="my-1 border-t border-border" />

          {LINKS.map(({ href, label, icon: Icon, desc }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-secondary transition-colors"
              role="menuitem"
            >
              <Icon className="h-4 w-4 text-primary shrink-0" />
              <div>
                <div className="font-medium">{label}</div>
                <div className="text-[11px] text-muted-foreground">{desc}</div>
              </div>
            </Link>
          ))}

          {isStaff && (
            <>
              <div className="my-1 border-t border-border" />
              <Link
                href="/moderation"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-secondary transition-colors"
                role="menuitem"
              >
                <Shield className="h-4 w-4 text-amber-500 shrink-0" />
                <div>
                  <div className="font-medium">Moderation</div>
                  <div className="text-[11px] text-muted-foreground">Reports and queue</div>
                </div>
              </Link>
              {isAdmin && (
                <Link
                  href="/admin"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-secondary transition-colors"
                  role="menuitem"
                >
                  <Shield className="h-4 w-4 text-destructive shrink-0" />
                  <div>
                    <div className="font-medium">Admin Panel</div>
                    <div className="text-[11px] text-muted-foreground">Site administration</div>
                  </div>
                </Link>
              )}
            </>
          )}

          <div className="my-1 border-t border-border" />
          <button
            onClick={() => { setOpen(false); signOut() }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-destructive hover:bg-secondary transition-colors"
            role="menuitem"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <div className="font-medium">Sign Out</div>
          </button>
        </div>
      )}
    </div>
  )
}
