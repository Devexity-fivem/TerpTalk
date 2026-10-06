"use client"

import { useState } from "react"
import { UserPlus, UserCheck, X, Loader2 } from "@/lib/icons"

/**
 * Ask-only consent prompt on an accepted answer — offers the asker a
 * durable person-follow on the grower who solved their question. The
 * follow itself goes through POST /api/follows (the authoritative
 * endpoint); "Not now" is a view-local dismissal only.
 */
export default function AnswerFollowPrompt({ userId, username }: { userId: string; username: string }) {
  const [state, setState] = useState<"prompt" | "busy" | "following" | "dismissed">("prompt")

  if (state === "dismissed") return null
  if (state === "following") {
    return (
      <p className="mt-3 flex items-center gap-1.5 text-xs text-success">
        <UserCheck className="w-3.5 h-3.5" /> Following @{username}
      </p>
    )
  }

  const follow = async () => {
    setState("busy")
    try {
      const res = await fetch("/api/follows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      })
      if (res.ok) {
        const d = await res.json().catch(() => ({}))
        setState(d.following ? "following" : "dismissed")
      } else {
        setState("prompt")
      }
    } catch {
      setState("prompt")
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border/60 bg-secondary/30 px-3 py-2">
      <p className="text-xs text-muted-foreground">
        Helpful answer? Follow <span className="font-medium text-foreground">@{username}</span> to see more of their grows and advice.
      </p>
      <span className="flex-1" />
      <button
        onClick={follow}
        disabled={state === "busy"}
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/25 transition-colors disabled:opacity-50"
      >
        {state === "busy" ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
        Follow grower
      </button>
      <button
        onClick={() => setState("dismissed")}
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <X className="w-3 h-3" /> Not now
      </button>
    </div>
  )
}
