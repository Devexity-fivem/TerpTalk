"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, XCircle, Loader2 } from "lucide-react"
import Tooltip from "@/components/ui/tooltip"

export function AcceptAnswerButton({
  postId,
  threadId,
  isAnswer,
  canAccept,
}: {
  postId: string
  threadId: string
  isAnswer: boolean
  canAccept: boolean
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  if (!isAnswer && !canAccept) return null

  const onClick = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/forum/threads/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, postId: isAnswer ? null : postId }),
      })
      if (res.ok) {
        router.refresh()
      } else {
        const data = await res.json().catch(() => ({}))
        alert(data.error || "Could not update accepted answer")
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Tooltip content={isAnswer ? "Remove accepted-answer status" : "Mark this reply as the solution to your thread"}>
      <button
        onClick={onClick}
        disabled={loading}
        className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors ${
          isAnswer
            ? "bg-green-500/15 text-green-400 hover:bg-green-500/25"
            : "bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80"
        }`}
      >
        {loading ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : isAnswer ? (
          <>
            <CheckCircle2 className="w-3 h-3" />
            <span>Accepted</span>
            <XCircle className="w-3 h-3 ml-0.5 opacity-70" />
          </>
        ) : (
          <>
            <CheckCircle2 className="w-3 h-3" />
            <span>Accept</span>
          </>
        )}
      </button>
    </Tooltip>
  )
}
