"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { BarChart3, Loader2 } from "lucide-react"

interface PollProps {
  poll: {
    id: string
    question: string
    options: { id: string; text: string }[]
  }
  initialCounts: Record<string, number>
  initialTotal: number
  userVoteOptionId?: string | null
}

export default function Poll({ poll, initialCounts, initialTotal, userVoteOptionId = null }: PollProps) {
  const { data: session } = useSession()
  const [votedOption, setVotedOption] = useState<string | null>(userVoteOptionId)
  const [counts, setCounts] = useState(initialCounts)
  const [total, setTotal] = useState(initialTotal)
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState("")

  const handleVote = async (optionId: string) => {
    if (!session || votedOption) return
    setLoading(optionId)
    setError("")
    try {
      const res = await fetch(`/api/forum/polls/${poll.id}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Vote failed")
      const next: Record<string, number> = {}
      data.counts.forEach((c: { optionId: string; count: number }) => {
        next[c.optionId] = c.count
      })
      setCounts(next)
      setTotal(data.total)
      setVotedOption(optionId)
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setLoading(null)
    }
  }

  const showResults = votedOption !== null || !session

  return (
    <div className="bg-card border border-border rounded-lg p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="w-4 h-4 text-primary" />
        <h3 className="font-semibold">{poll.question}</h3>
      </div>
      <div className="space-y-2">
        {poll.options.map((opt) => {
          const count = counts[opt.id] || 0
          const percent = total > 0 ? Math.round((count / total) * 100) : 0
          const isVoted = votedOption === opt.id
          return (
            <div key={opt.id} className="relative">
              {showResults ? (
                <div className="w-full">
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className={isVoted ? "font-semibold text-primary" : ""}>{opt.text}</span>
                    <span className="text-muted-foreground">{count} ({percent}%)</span>
                  </div>
                  <div className="h-2 bg-secondary rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${isVoted ? "bg-primary" : "bg-primary/40"}`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => handleVote(opt.id)}
                  disabled={loading !== null}
                  className="w-full text-left px-4 py-2 rounded-lg border border-border bg-background hover:border-primary hover:bg-primary/5 transition-colors disabled:opacity-50 flex items-center justify-between"
                >
                  <span>{opt.text}</span>
                  {loading === opt.id && <Loader2 className="w-4 h-4 animate-spin" />}
                </button>
              )}
            </div>
          )
        })}
      </div>
      {showResults && (
        <p className="text-xs text-muted-foreground mt-3">
          {total} vote{total === 1 ? "" : "s"}
          {!session && " · Sign in to vote"}
        </p>
      )}
      {error && <p className="text-xs text-destructive mt-2">{error}</p>}
    </div>
  )
}
