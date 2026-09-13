"use client"

import { useEffect, useState } from "react"
import { Target } from "lucide-react"
import { cn } from "@/lib/utils"

interface Challenge {
  slug: string
  title: string
  description: string
  icon: string
  reward: number
  target: number
  progress: number
  done: boolean
  paid: boolean
}

export default function WeeklyChallenges() {
  const [challenges, setChallenges] = useState<Challenge[] | null>(null)

  useEffect(() => {
    fetch("/api/challenges", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setChallenges(d?.challenges ?? []))
      .catch(() => setChallenges([]))
  }, [])

  if (challenges === null) {
    return (
      <div className="bg-card rounded-lg border border-border p-6">
        <div className="flex items-center gap-2 mb-4">
          <Target className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Weekly Challenges</h2>
        </div>
        <div className="h-16 animate-pulse bg-secondary/50 rounded" />
      </div>
    )
  }

  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <div className="flex items-center gap-2 mb-1">
        <Target className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">Weekly Challenges</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">Resets every Monday. Optional — ignore them freely.</p>
      <div className="space-y-3">
        {challenges.map((c) => (
          <div key={c.slug} className={cn("flex items-center gap-3", c.done && "opacity-80")}>
            <span className="text-lg w-7 text-center shrink-0">{c.done ? "✅" : c.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className={cn("font-medium", c.done && "line-through decoration-muted-foreground/50")}>{c.title}</span>
                <span className="text-xs text-primary font-semibold shrink-0">+{c.reward}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <div className="h-1.5 flex-1 bg-secondary rounded-full overflow-hidden">
                  <div
                    className={cn("h-full transition-all", c.done ? "bg-primary" : "bg-amber-500")}
                    style={{ width: `${Math.round((c.progress / c.target) * 100)}%` }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0 w-8 text-right">{c.progress}/{c.target}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
