"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { usePathname } from "next/navigation"
import { Bell, BellRing, Loader2 } from "lucide-react"
import { signInHref } from "@/lib/callback-url"

export default function CategoryFollowButton({ categoryId, initiallyFollowing }: { categoryId: string; initiallyFollowing: boolean }) {
  const { data: session } = useSession()
  const pathname = usePathname()
  const [following, setFollowing] = useState(initiallyFollowing)
  const [busy, setBusy] = useState(false)

  if (!session) {
    return (
      <a href={signInHref(pathname)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">
        <Bell className="w-4 h-4" /> Follow
      </a>
    )
  }

  return (
    <button
      onClick={async () => {
        if (busy) return
        setBusy(true)
        try {
          const res = await fetch("/api/categories/follow", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ categoryId }),
          })
          if (res.ok) {
            const d = await res.json()
            setFollowing(d.following)
          }
        } finally { setBusy(false) }
      }}
      disabled={busy}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium transition-colors disabled:opacity-50 ${
        following
          ? "bg-primary/10 text-primary border border-primary/30"
          : "bg-primary text-primary-foreground hover:bg-primary/90"
      }`}
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : following ? <BellRing className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
      {following ? "Following" : "Follow"}
    </button>
  )
}
