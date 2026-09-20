"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { Ban, Loader2 } from "lucide-react"
import { Avatar } from "@/components/ui/avatar"
import { signInHref } from "@/lib/callback-url"

interface BlockedUser {
  id: string
  userId: string
  username: string
  avatarUrl: string | null
  createdAt: string
}

export default function BlockedMembers() {
  const { status } = useSession()
  const [blocks, setBlocks] = useState<BlockedUser[] | null>(null)
  const [error, setError] = useState("")
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    if (status === "unauthenticated") {
      window.location.href = signInHref("/settings/blocked")
      return
    }
    if (status !== "authenticated") return
    fetch("/api/blocks")
      .then(async (res) => {
        if (!res.ok) throw new Error()
        const d = await res.json()
        setBlocks(d.blocks || [])
      })
      .catch(() => setError("Couldn't load your blocked members. Try again."))
  }, [status])

  const unblock = async (userId: string) => {
    setBusyId(userId)
    setError("")
    try {
      const res = await fetch("/api/blocks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || "Couldn't unblock that member. Try again.")
        return
      }
      setBlocks((prev) => prev?.filter((b) => b.userId !== userId) ?? prev)
    } finally {
      setBusyId(null)
      setConfirmId(null)
    }
  }

  if (error && !blocks) {
    return <p role="alert" className="text-sm text-destructive">{error}</p>
  }

  if (status === "loading" || (status === "authenticated" && !blocks)) {
    return (
      <div className="flex justify-center py-8" role="status" aria-label="Loading blocked members">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    )
  }

  if (!blocks || blocks.length === 0) {
    return (
      <div className="bg-card/80 rounded-2xl border border-border/70 p-6 text-center">
        <Ban className="w-8 h-8 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">
          You haven&apos;t blocked anyone. You can block a member from their profile — blocked members can&apos;t message or follow you.
        </p>
      </div>
    )
  }

  return (
    <div>
      <ul className="bg-card/80 rounded-2xl border border-border/70 divide-y divide-border">
        {blocks.map((b) => (
          <li key={b.id} className="p-4">
            <div className="flex items-center gap-3">
              <Avatar src={b.avatarUrl} alt={`${b.username} avatar`} size="sm" />
              <div className="flex-1 min-w-0">
                <Link href={`/u/${encodeURIComponent(b.username)}`} className="font-medium text-sm hover:underline truncate block">
                  @{b.username}
                </Link>
                <p className="text-xs text-muted-foreground">
                  Blocked {new Date(b.createdAt).toLocaleDateString()}
                </p>
              </div>
              {confirmId === b.userId ? (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => unblock(b.userId)}
                    disabled={busyId === b.userId}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-destructive text-destructive-foreground disabled:opacity-50"
                  >
                    {busyId === b.userId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Confirm"}
                  </button>
                  <button
                    onClick={() => setConfirmId(null)}
                    className="px-3 py-1.5 text-xs rounded-lg bg-secondary"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmId(b.userId)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border hover:bg-secondary transition-colors shrink-0"
                >
                  Unblock
                </button>
              )}
            </div>
            {confirmId === b.userId && (
              <p className="text-xs text-muted-foreground mt-2">
                Unblock @{b.username}? They&apos;ll be able to message and follow you again.
              </p>
            )}
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="text-sm text-destructive mt-3">{error}</p>}
    </div>
  )
}
