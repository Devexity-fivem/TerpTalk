"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Stethoscope, RotateCcw, AlertTriangle, ArrowRight, CheckCircle2, MessageSquare } from "lucide-react"
import { WIZARD_START, WIZARD_NODES, WIZARD_RESULTS } from "@/lib/problem-wizard"

interface CommunityThread {
  id: string
  slug: string
  title: string
  replyCount: number
  solved: boolean
  authorName: string
}

const SEVERITY = {
  urgent: { label: "Act now", cls: "bg-destructive/15 text-destructive" },
  moderate: { label: "Fix this week", cls: "bg-amber-500/15 text-amber-500" },
  watch: { label: "Monitor", cls: "bg-primary/15 text-primary" },
}

export default function ProblemWizard() {
  const [nodeId, setNodeId] = useState(WIZARD_START)
  const [resultId, setResultId] = useState<string | null>(null)
  const [history, setHistory] = useState<string[]>([])

  const node = WIZARD_NODES[nodeId]
  const result = resultId ? WIZARD_RESULTS[resultId] : null

  // Community threads that hit the same wizard result (or similar symptoms).
  // Kept with the resultId they were fetched for so a previous diagnosis
  // can't flash while the next one loads.
  const [community, setCommunity] = useState<{ forId: string; threads: CommunityThread[] } | null>(null)
  useEffect(() => {
    if (!resultId) return
    let cancelled = false
    fetch(`/api/forum/threads/symptom?result=${encodeURIComponent(resultId)}`)
      .then((res) => res.json())
      .then((data) => { if (!cancelled) setCommunity({ forId: resultId, threads: data.threads || [] }) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [resultId])

  const reset = () => { setNodeId(WIZARD_START); setResultId(null); setHistory([]); setCommunity(null) }
  const communityThreads = community?.forId === resultId ? community.threads : []

  return (
    <div className="bg-card/80 border border-border/70 rounded-2xl p-6">
      {result ? (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-xl font-bold">{result.title}</h2>
            <span className={`text-xs font-semibold px-2 py-1 rounded-full ${SEVERITY[result.severity].cls}`}>
              {SEVERITY[result.severity].label}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mb-4">{result.cause}</p>
          <h3 className="font-display text-sm font-semibold mb-2">How to fix it</h3>
          <ul className="space-y-2 mb-5">
            {result.fixes.map((f, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <ArrowRight className="w-4 h-4 text-primary shrink-0 mt-0.5" /> {f}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3">
            <button onClick={reset} className="flex items-center gap-1.5 px-4 py-2 bg-secondary rounded-xl text-sm hover:bg-secondary/80">
              <RotateCcw className="w-4 h-4" /> Diagnose another issue
            </button>
            <Link href={`/forum/new?category=plant-problems&result=${encodeURIComponent(resultId || "")}`} className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-full text-sm hover:bg-primary/90">
              Ask in Plant Problems <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          {/* Community threads — real member answers, not a diagnosis */}
          {communityThreads.length > 0 && (
            <div className="mt-5 pt-4 border-t border-border">
              <h3 className="font-display text-sm font-semibold mb-1 flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-primary" />
                Community threads about similar problems
              </h3>
              <p className="text-xs text-muted-foreground mb-3">
                Real member experiences — not medical or scientific certainty.
              </p>
              <ul className="space-y-2">
                {communityThreads.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/forum/thread/${t.slug}`}
                      className="text-sm text-primary hover:underline flex items-center gap-2 flex-wrap"
                    >
                      {t.solved && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                      <span>{t.title}</span>
                      <span className="text-xs text-muted-foreground">
                        · {t.authorName} · {t.replyCount} repl{t.replyCount === 1 ? "y" : "ies"}
                        {t.solved ? " · solved" : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : node ? (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Stethoscope className="w-5 h-5 text-primary" />
            <span className="text-xs text-muted-foreground">Step {history.length + 1}</span>
          </div>
          <h2 className="font-display text-lg font-semibold mb-4">{node.question}</h2>
          <div className="grid gap-2">
            {node.options.map((opt) => (
              <button
                key={opt.label}
                onClick={() => {
                  setHistory([...history, nodeId])
                  if (opt.next) setNodeId(opt.next)
                  else if (opt.result) setResultId(opt.result)
                }}
                className="text-left px-4 py-3 rounded-lg border border-border hover:border-primary/50 hover:bg-secondary/50 transition-colors text-sm font-medium"
              >
                {opt.label}
              </button>
            ))}
          </div>
          {history.length > 0 && (
            <button
              onClick={() => { setNodeId(history[history.length - 1]); setHistory(history.slice(0, -1)) }}
              className="mt-4 text-xs text-muted-foreground hover:text-foreground"
            >
              ← Back
            </button>
          )}
        </div>
      ) : null}

      <p className="text-[11px] text-muted-foreground mt-6 flex items-start gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
        A starting point, not a diagnosis — every grow is different. When in doubt, post photos in Plant Problems.
      </p>
    </div>
  )
}
