"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { Heart } from "lucide-react"

const EMOJIS: Record<string, string> = {
  LIKE: "❤️",
  LOVE: "😍",
  LAUGH: "😂",
  THINKING: "🤔",
  FIRE: "🔥",
  THUMBS_UP: "👍",
  THUMBS_DOWN: "👎",
}

const ORDER = ["LIKE", "LOVE", "LAUGH", "THINKING", "FIRE", "THUMBS_UP", "THUMBS_DOWN"]

export default function DiaryReactions({
  diaryId,
  initialCounts,
  initialMine,
}: {
  diaryId: string
  initialCounts: Record<string, number>
  initialMine: string | null
}) {
  const { data: session } = useSession()
  const [counts, setCounts] = useState(initialCounts)
  const [mine, setMine] = useState<string | null>(initialMine)
  const [showPicker, setShowPicker] = useState(false)
  const [busy, setBusy] = useState(false)

  const react = async (type: string) => {
    if (!session || busy) return
    setBusy(true)
    setShowPicker(false)
    try {
      const res = await fetch("/api/reactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, diaryId }),
      })
      if (!res.ok) return
      const data = await res.json()
      const next = { ...counts }
      const old = mine
      if (data.action === "added") {
        next[type] = (next[type] || 0) + 1
        setMine(type)
      } else if (data.action === "switched" && old) {
        next[old] = Math.max(0, (next[old] || 0) - 1)
        if (next[old] === 0) delete next[old]
        next[type] = (next[type] || 0) + 1
        setMine(type)
      } else if (data.action === "removed" && old) {
        next[old] = Math.max(0, (next[old] || 0) - 1)
        if (next[old] === 0) delete next[old]
        setMine(null)
      }
      setCounts(next)
    } finally {
      setBusy(false)
    }
  }

  const hasReactions = Object.values(counts).some((c) => c > 0)

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div className="relative">
        <button
          onClick={() => (mine ? react(mine) : setShowPicker(!showPicker))}
          disabled={!session || busy}
          className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg transition-colors disabled:opacity-50 ${
            mine
              ? "bg-primary/10 text-primary border border-primary/20"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary"
          }`}
          title={session ? "React" : "Sign in to react"}
        >
          {mine ? <span className="text-sm">{EMOJIS[mine]}</span> : <Heart className="w-3.5 h-3.5" />}
          <span>React</span>
        </button>
        {showPicker && (
          <div className="absolute bottom-full left-0 mb-2 flex gap-1 bg-card border border-border rounded-lg px-1.5 py-1 shadow-lg z-10">
            {ORDER.map((type) => (
              <button
                key={type}
                onClick={() => react(type)}
                className="w-7 h-7 flex items-center justify-center text-base hover:bg-secondary rounded-md transition-colors"
                title={type.toLowerCase()}
                aria-label={`React with ${type.toLowerCase()}`}
              >
                {EMOJIS[type]}
              </button>
            ))}
          </div>
        )}
      </div>
      {hasReactions &&
        ORDER.filter((t) => counts[t] > 0)
          .sort((a, b) => (counts[b] || 0) - (counts[a] || 0))
          .map((type) => (
            <button
              key={type}
              onClick={() => session && react(type)}
              disabled={!session || busy}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs border transition-colors disabled:opacity-50 ${
                mine === type
                  ? "bg-primary/10 border-primary text-primary"
                  : "bg-secondary border-border/50 text-muted-foreground hover:bg-secondary/80"
              }`}
            >
              <span>{EMOJIS[type]}</span>
              <span className="font-medium">{counts[type]}</span>
            </button>
          ))}
    </div>
  )
}
