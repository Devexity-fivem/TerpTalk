"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { usePathname } from "next/navigation"
import { Bell, BellRing, Loader2 } from "lucide-react"
import { useToast } from "@/components/ui/toast"
import { signInHref } from "@/lib/callback-url"

export default function ThreadFollowButton({ threadId, initiallyFollowing }: { threadId: string; initiallyFollowing: boolean }) {
  const { data: session } = useSession()
  const { toast } = useToast()
  const pathname = usePathname()
  const [following, setFollowing] = useState(initiallyFollowing)
  const [busy, setBusy] = useState(false)

  if (!session) {
    return (
      <a
        href={signInHref(pathname)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-secondary hover:bg-secondary/80 transition-colors"
        aria-label="Sign in to follow this discussion"
        title="Sign in to follow this discussion"
      >
        <Bell className="w-3.5 h-3.5" /> Follow
      </a>
    )
  }

  return (
    <button
      onClick={async () => {
        if (busy) return
        setBusy(true)
        try {
          const res = await fetch("/api/forum/threads/follow", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ threadId }),
          })
          if (res.ok) {
            const d = await res.json()
            setFollowing(d.following)
            toast(d.following ? "Following — you'll be notified of new replies" : "Unfollowed thread")
          } else {
            toast("Could not update follow. Try again.", "error")
          }
        } catch {
          toast("Network error — check your connection.", "error")
        } finally { setBusy(false) }
      }}
      disabled={busy}
      aria-pressed={following}
      aria-label={following ? "Unfollow this discussion" : "Follow this discussion for reply notifications"}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors disabled:opacity-50 ${
        following ? "bg-primary/10 text-primary" : "bg-secondary hover:bg-secondary/80"
      }`}
      title={following ? "Unfollow discussion" : "Follow discussion — get notified of new replies"}
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : following ? <BellRing className="w-3.5 h-3.5" /> : <Bell className="w-3.5 h-3.5" />}
      {following ? "Following" : "Follow"}
    </button>
  )
}
