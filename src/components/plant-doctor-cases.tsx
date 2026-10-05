"use client"

import { useState } from "react"
import Link from "next/link"
import { ClipboardCheck, CheckCircle2, ArrowRight } from "@/lib/icons"
import { PD_OUTCOME_LABELS, type PlantDoctorOutcomeValue } from "@/lib/plant-doctor-outcomes"

// Owner-scoped follow-up list — the grower is the source of truth for
// what happened after a tracked diagnosis. Buttons append a new outcome
// report; the latest one is shown as current state.
export interface PlantDoctorCaseItem {
  id: string
  resultId: string
  title: string
  severity: string | null
  tagSlug: string | null
  diaryId: string | null
  diaryHref: string | null
  diaryTitle: string | null
  createdAt: string | Date
  outcome: PlantDoctorOutcomeValue | null
  outcomeCount: number
  open: boolean
}

const OUTCOME_ORDER: PlantDoctorOutcomeValue[] = ["IMPROVED", "NO_CHANGE", "WORSE", "UNSURE"]

export default function PlantDoctorCases({ initialCases }: { initialCases: PlantDoctorCaseItem[] }) {
  const [cases, setCases] = useState(initialCases)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The wizard's track action calls router.refresh() — re-rendered server
  // props are the source of truth. Render-phase adjustment (not an effect)
  // re-syncs local state when the refreshed list arrives.
  const [lastProp, setLastProp] = useState(initialCases)
  if (lastProp !== initialCases) {
    setLastProp(initialCases)
    setCases(initialCases)
  }

  if (!cases.length) return null

  const report = async (caseId: string, outcome: PlantDoctorOutcomeValue) => {
    setPending(caseId)
    setError(null)
    try {
      const res = await fetch(`/api/plant-doctor/cases/${caseId}/outcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome }),
      })
      if (!res.ok) throw new Error()
      setCases((prev) =>
        prev.map((c) =>
          c.id === caseId ? { ...c, outcome, outcomeCount: c.outcomeCount + 1, open: outcome === "UNSURE" } : c
        )
      )
    } catch {
      setError("Couldn't save that report — try again.")
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="mt-8 bg-card/80 rounded-2xl border border-border/70 p-5">
      <div className="flex items-center gap-2 mb-1">
        <ClipboardCheck className="w-4 h-4 text-primary" />
        <h2 className="font-display font-semibold text-sm">Your tracked fixes</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Private to you — tell us what happened and it becomes evidence for the next grower.
      </p>
      <ul className="space-y-3">
        {cases.map((c) => (
          <li key={c.id} className="rounded-xl border border-border/60 bg-background/40 p-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{c.title}</p>
                <p className="text-[11px] text-muted-foreground">
                  {new Date(c.createdAt).toLocaleDateString()}
                  {c.diaryHref && c.diaryTitle ? (
                    <>
                      {" · "}
                      <Link href={c.diaryHref} className="text-primary hover:underline">
                        {c.diaryTitle}
                      </Link>
                    </>
                  ) : null}
                </p>
              </div>
              {!c.open && c.outcome && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-success">
                  <CheckCircle2 className="w-3.5 h-3.5" /> {PD_OUTCOME_LABELS[c.outcome]}
                </span>
              )}
            </div>
            {c.open ? (
              <div className="mt-2">
                <p className="text-[11px] text-muted-foreground mb-1.5">Did it help?</p>
                <div className="flex flex-wrap gap-1.5">
                  {OUTCOME_ORDER.map((o) => (
                    <button
                      key={o}
                      disabled={pending === c.id}
                      onClick={() => report(c.id, o)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors disabled:opacity-50 ${
                        c.outcome === o
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border hover:border-primary/50 hover:bg-secondary/50"
                      }`}
                    >
                      {PD_OUTCOME_LABELS[o]}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Reported{c.outcomeCount > 1 ? ` ${c.outcomeCount} times — latest shown` : ""}. Changed since?{" "}
                <span className="inline-flex flex-wrap gap-1.5 align-middle">
                  {OUTCOME_ORDER.filter((o) => o !== c.outcome).map((o) => (
                    <button
                      key={o}
                      disabled={pending === c.id}
                      onClick={() => report(c.id, o)}
                      className="underline hover:text-foreground disabled:opacity-50"
                    >
                      {PD_OUTCOME_LABELS[o]}
                    </button>
                  ))}
                </span>
              </p>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
      <p className="mt-4 text-[11px] text-muted-foreground flex items-start gap-1.5">
        <ArrowRight className="w-3.5 h-3.5 shrink-0 mt-px" />
        Reports are member experiences, not medical or scientific certainty.
      </p>
    </div>
  )
}
