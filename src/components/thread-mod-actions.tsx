"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Pin, Lock } from "lucide-react"

// Staff-only thread controls — pin/unpin and lock/unlock
export default function ThreadModActions({
  threadId,
  authorId,
  pinned,
  locked,
}: {
  threadId: string
  authorId: string
  pinned: boolean
  locked: boolean
}) {
  const { data: session } = useSession()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const role = (session?.user as { role?: string })?.role
  if (role !== "MODERATOR" && role !== "ADMINISTRATOR") return null

  const act = async (actionType: "PIN_THREAD" | "LOCK_THREAD") => {
    setBusy(true)
    try {
      const res = await fetch("/api/moderation/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionType,
          targetId: threadId,
          targetUserId: authorId,
          reason: actionType === "PIN_THREAD" ? "Thread pin toggled" : "Thread lock toggled",
        }),
      })
      if (res.ok) router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex gap-2">
      <button
        onClick={() => act("PIN_THREAD")}
        disabled={busy}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-primary/10 text-primary rounded-lg hover:bg-primary/20 disabled:opacity-50"
      >
        <Pin className="w-3 h-3" /> {pinned ? "Unpin" : "Pin"}
      </button>
      <button
        onClick={() => act("LOCK_THREAD")}
        disabled={busy}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-amber-500/10 text-amber-500 rounded-lg hover:bg-amber-500/20 disabled:opacity-50"
      >
        <Lock className="w-3 h-3" /> {locked ? "Unlock" : "Lock"}
      </button>
    </div>
  )
}
