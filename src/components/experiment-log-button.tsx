"use client"

import { useState } from "react"
import { FlaskConical, X } from "lucide-react"
import ExperimentForm from "@/components/experiment-form"

/** Owner-only "Log experiment" entry — opens the compact capture form
 *  inline next to the timeline's Add Update button. */
export default function ExperimentLogButton({ diaryId }: { diaryId: string }) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="border border-border px-4 py-2 rounded-full hover:bg-secondary transition-colors text-sm flex items-center gap-2 min-h-11 text-muted-foreground hover:text-foreground"
      >
        <FlaskConical className="w-4 h-4" />
        <span className="hidden sm:inline">Log experiment</span>
        <span className="sm:hidden">Experiment</span>
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Log an experiment">
      <div className="w-full max-w-lg bg-card border border-border/70 rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card z-10">
          <h2 className="font-display font-semibold flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-primary" /> Log an experiment
          </h2>
          <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4">
          <p className="text-xs text-muted-foreground mb-4">
            Record a deliberate change — what you changed, why, and what you&apos;re watching for. Follow-up updates become its evidence.
          </p>
          <ExperimentForm diaryId={diaryId} onDone={() => setOpen(false)} />
        </div>
      </div>
    </div>
  )
}
