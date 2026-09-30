"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Pin, Lock, FolderInput, Trash2 } from "@/lib/icons"
import Tooltip from "@/components/ui/tooltip"
import { useToast } from "@/components/ui/toast"

interface CategoryOption {
  id: string
  name: string
}

// Staff-only thread controls — pin/unpin, lock/unlock, move, delete.
// Renders client-side for MODERATOR/ADMINISTRATOR; the API re-checks the
// role against the database on every call.
export default function ThreadModActions({
  threadId,
  authorId,
  categoryId,
  pinned,
  locked,
}: {
  threadId: string
  authorId: string
  categoryId: string
  pinned: boolean
  locked: boolean
}) {
  const { data: session } = useSession()
  const router = useRouter()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [categories, setCategories] = useState<CategoryOption[] | null>(null)
  const role = (session?.user as { role?: string })?.role
  if (role !== "MODERATOR" && role !== "ADMINISTRATOR") return null

  const post = async (body: Record<string, unknown>) => {
    setBusy(true)
    try {
      const res = await fetch("/api/moderation/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast(d.error || "Moderation action failed", "error")
        return false
      }
      return true
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (actionType: "PIN_THREAD" | "LOCK_THREAD") => {
    const ok = await post({
      actionType,
      targetId: threadId,
      targetUserId: authorId,
      reason: actionType === "PIN_THREAD" ? "Thread pin toggled" : "Thread lock toggled",
    })
    if (ok) router.refresh()
  }

  const openMove = async () => {
    setMoveOpen((v) => !v)
    if (!categories) {
      const res = await fetch("/api/categories").catch(() => null)
      const d = res?.ok ? await res.json().catch(() => ({})) : {}
      setCategories(d.categories ?? [])
    }
  }

  const moveTo = async (cat: CategoryOption) => {
    const ok = await post({
      actionType: "MOVE_THREAD",
      targetId: threadId,
      targetUserId: authorId,
      targetCategoryId: cat.id,
      reason: `Thread moved to ${cat.name}`,
    })
    setMoveOpen(false)
    if (ok) {
      toast(`Moved to ${cat.name}`, "success")
      router.refresh()
    }
  }

  const remove = async () => {
    if (!confirm("Delete this thread? All replies are removed and the author is notified.")) return
    const reason = prompt("Reason shown to the author (required):")
    if (!reason?.trim()) return
    const ok = await post({
      actionType: "CONTENT_DELETION",
      targetType: "THREAD",
      targetId: threadId,
      targetUserId: authorId,
      reason: reason.trim(),
    })
    if (ok) {
      toast("Thread deleted", "success")
      router.push("/forum")
    }
  }

  const btn = "flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg transition-colors disabled:opacity-50"

  return (
    <div className="flex items-center gap-2">
      <Tooltip content={pinned ? "Unpin: remove this thread from the top of the category" : "Pin: keep this thread at the top of the category"}>
        <button onClick={() => toggle("PIN_THREAD")} disabled={busy} className={`${btn} bg-primary/10 text-primary hover:bg-primary/20`}>
          <Pin className="w-3 h-3" /> {pinned ? "Unpin" : "Pin"}
        </button>
      </Tooltip>
      <Tooltip content={locked ? "Unlock: allow new replies again" : "Lock: prevent new replies"}>
        <button onClick={() => toggle("LOCK_THREAD")} disabled={busy} className={`${btn} bg-amber-500/10 text-warning hover:bg-amber-500/20`}>
          <Lock className="w-3 h-3" /> {locked ? "Unlock" : "Lock"}
        </button>
      </Tooltip>
      <div className="relative">
        <Tooltip content="Move: re-file this thread under another category">
          <button onClick={openMove} disabled={busy} aria-expanded={moveOpen} className={`${btn} bg-secondary text-muted-foreground hover:bg-secondary/70 hover:text-foreground`}>
            <FolderInput className="w-3 h-3" /> Move
          </button>
        </Tooltip>
        {moveOpen && (
          <>
            <button className="fixed inset-0 z-10 cursor-default" onClick={() => setMoveOpen(false)} aria-label="Close move menu" />
            <div className="absolute left-0 top-full z-20 mt-1 w-48 rounded-xl border border-border bg-card p-1 shadow-lg animate-in">
              {categories === null ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">Loading…</div>
              ) : (
                categories.filter((c) => c.id !== categoryId).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => moveTo(c)}
                    disabled={busy}
                    className="w-full rounded-lg px-3 py-1.5 text-left text-sm transition-colors hover:bg-secondary disabled:opacity-50"
                  >
                    {c.name}
                  </button>
                ))
              )}
              {categories !== null && categories.filter((c) => c.id !== categoryId).length === 0 && (
                <div className="px-3 py-2 text-xs text-muted-foreground">No other categories</div>
              )}
            </div>
          </>
        )}
      </div>
      <Tooltip content="Delete: remove this thread and all replies (audited, author notified)">
        <button onClick={remove} disabled={busy} className={`${btn} bg-destructive/10 text-destructive hover:bg-destructive/20`}>
          <Trash2 className="w-3 h-3" /> Delete
        </button>
      </Tooltip>
    </div>
  )
}
