"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { usePathname } from "next/navigation"
import { Users, UserCheck, Loader2 } from "@/lib/icons"
import { signInHref } from "@/lib/callback-url"
import Tooltip from "@/components/ui/tooltip"

// Compact member-follow toggle for suggestion cards. Suggested growers
// are never already-followed (excluded at query time), but the button
// still handles the toggle honestly — unfollow keeps the card, a later
// refetch re-excludes them.
export default function GrowerFollowButton({ userId, username }: { userId: string; username: string | null }) {
  const { data: session } = useSession()
  const pathname = usePathname()
  const [following, setFollowing] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!session) {
    return (
      <Tooltip content="Sign in to follow this grower">
        <a href={signInHref(pathname)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-full font-medium hover:bg-primary/90 transition-colors">
          <Users className="w-3.5 h-3.5" /> Follow
        </a>
      </Tooltip>
    )
  }
  if (session.user?.id === userId) return null

  return (
    <Tooltip content={following ? `Unfollow ${username ? `@${username}` : "this grower"}` : `Follow ${username ? `@${username}` : "this grower"}`}>
      <button
        onClick={async () => {
          if (busy) return
          setBusy(true)
          try {
            const res = await fetch("/api/follows", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userId }),
            })
            if (res.ok) {
              const d = await res.json()
              setFollowing(d.following)
            }
          } finally { setBusy(false) }
        }}
        disabled={busy}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full font-medium transition-colors disabled:opacity-50 ${
          following
            ? "bg-primary/10 text-primary border border-primary/30"
            : "bg-primary text-primary-foreground hover:bg-primary/90"
        }`}
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : following ? <UserCheck className="w-3.5 h-3.5" /> : <Users className="w-3.5 h-3.5" />}
        {following ? "Following" : "Follow"}
      </button>
    </Tooltip>
  )
}
