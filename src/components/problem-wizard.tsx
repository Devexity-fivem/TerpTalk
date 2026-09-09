"use client"

import { useState } from "react"
import Link from "next/link"
import { Stethoscope, RotateCcw, AlertTriangle, ArrowRight } from "lucide-react"
import { WIZARD_START, WIZARD_NODES, WIZARD_RESULTS } from "@/lib/problem-wizard"

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

  const reset = () => { setNodeId(WIZARD_START); setResultId(null); setHistory([]) }

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      {result ? (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xl font-bold">{result.title}</h2>
            <span className={`text-xs font-semibold px-2 py-1 rounded-full ${SEVERITY[result.severity].cls}`}>
              {SEVERITY[result.severity].label}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mb-4">{result.cause}</p>
          <h3 className="text-sm font-semibold mb-2">How to fix it</h3>
          <ul className="space-y-2 mb-5">
            {result.fixes.map((f, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <ArrowRight className="w-4 h-4 text-primary shrink-0 mt-0.5" /> {f}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3">
            <button onClick={reset} className="flex items-center gap-1.5 px-4 py-2 bg-secondary rounded-lg text-sm hover:bg-secondary/80">
              <RotateCcw className="w-4 h-4" /> Diagnose another issue
            </button>
            <Link href={`/forum/new?category=plant-problems&result=${encodeURIComponent(resultId || "")}`} className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm hover:bg-primary/90">
              Ask in Plant Problems <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      ) : node ? (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Stethoscope className="w-5 h-5 text-primary" />
            <span className="text-xs text-muted-foreground">Step {history.length + 1}</span>
          </div>
          <h2 className="text-lg font-semibold mb-4">{node.question}</h2>
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
