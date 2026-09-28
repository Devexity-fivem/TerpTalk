"use client"

import { Avatar } from "@/components/ui/avatar"
import TierChip from "@/components/tier-chip"
import UserPopover from "@/components/user-popover"
import { cn } from "@/lib/utils"

interface ProfileCardProps {
  username: string | null | undefined
  /** Display name text (usually username) */
  name?: string | null
  avatarUrl?: string | null
  /** Rank chip XP — omit to hide */
  xp?: number | null
  /** Optional muted tail text (e.g. "· 2h ago") */
  meta?: React.ReactNode
  size?: "sm" | "md"
  className?: string
}

/**
 * Compact member-identity row — avatar + name + rank chip wrapped in the
 * shared `UserPopover` (tap/hover social card backed by /api/users/[u]/card).
 * This is the single author-card contract for threads, diaries, comments,
 * search results, leaderboards, and notifications — don't fork it.
 */
export default function ProfileCard({
  username,
  name,
  avatarUrl,
  xp,
  meta,
  size = "md",
  className,
}: ProfileCardProps) {
  return (
    <UserPopover username={username}>
      <span className={cn("inline-flex items-center gap-2 min-w-0", className)}>
        <Avatar src={avatarUrl ?? null} size={size} />
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span className={cn("truncate font-medium", size === "sm" ? "text-xs" : "text-sm")}>
            {name || username || "Member"}
          </span>
          {xp != null && <TierChip xp={xp} size="sm" />}
        </span>
        {meta && <span className="text-xs text-muted-foreground whitespace-nowrap">{meta}</span>}
      </span>
    </UserPopover>
  )
}
