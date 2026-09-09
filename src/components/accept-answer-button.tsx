"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, XCircle, Loader2 } from "lucide-react"

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
    <button
      onClick={onClick}
      disabled={loading}
      className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full transition-colors ${
        isAnswer
          ? "bg-green-500/20 text-green-400 hover:bg-green-500/30"
          : "bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80"
      }`}
      title={isAnswer ? "Unmark as accepted answer" : "Mark as accepted answer"}
    >
      {loading ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : isAnswer ? (
        <>
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Accepted answer</span>
          <XCircle className="w-3.5 h-3.5 ml-1 opacity-70" />
        </>
      ) : (
        <>
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Mark as answer</span>
        </>
      )}
    </button>
  )
}
