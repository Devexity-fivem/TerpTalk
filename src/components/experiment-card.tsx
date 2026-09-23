"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { FlaskConical, Loader2, MessageCircleQuestion, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useShareComposer } from "@/components/share-composer"
import {
  EXPERIMENT_CATEGORY_LABELS,
  EXPERIMENT_FOLLOW_UP_LABELS,
  EXPERIMENT_OUTCOME_LABELS,
  EXPERIMENT_OUTCOMES,
  EXPERIMENT_STATUS_LABELS,
  type ExperimentView,
} from "@/lib/experiments"

/**
 * Experiment evidence card — shows the grower's recorded reasoning:
 * what changed, why, what's being watched for, and what evidence has
 * accumulated since. Descriptive only — "observed after change", never
 * attributing improvement to the change. The outcome label only ever appears when
 * the grower explicitly recorded one.
 */

const STATUS_STYLES: Record<string, string> = {
  PLANNED: "bg-secondary text-muted-foreground",
  ACTIVE: "bg-primary/10 text-primary",
  OBSERVING: "bg-spectrum/10 text-spectrum",
  COMPLETED: "bg-emerald-500/10 text-emerald-500",
  ABANDONED: "bg-secondary text-muted-foreground line-through decoration-muted-foreground/50",
}

export default function ExperimentCard({
  experiment,
  diaryId,
  startDay,
  lastObservationDay,
  isOwner,
  strainName,
}: {
  experiment: ExperimentView
  diaryId: string
  /** Day number of startedAt (server-computed from diary startDate) */
  startDay: number
  lastObservationDay: number | null
  isOwner: boolean
  strainName?: string | null
}) {
  const router = useRouter()
  const composer = useShareComposer()
  const [managing, setManaging] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [outcome, setOutcome] = useState<string>(experiment.outcome ?? "")
  const [conclusion, setConclusion] = useState(experiment.conclusion ?? "")

  const patch = async (data: Record<string, unknown>) => {
    setSaving(true)
    setError("")
    try {
      const res = await fetch(`/api/diaries/${diaryId}/experiments/${experiment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || "Failed to update experiment")
      }
      setManaging(false)
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const askCommunity = () => {
    const ctx = [
      `Experiment on my grow: ${experiment.title}`,
      `Changed: ${experiment.change}`,
      experiment.reason ? `Reason: ${experiment.reason}` : null,
      `Day ${startDay} · ${experiment.observationCount} observation${experiment.observationCount === 1 ? "" : "s"} recorded after the change`,
    ]
      .filter(Boolean)
      .join("\n")
    composer.open({
      type: "question",
      title: `Has anyone tried this? — ${experiment.title}`.slice(0, 120),
      content: `${ctx}\n\n`,
      tags: strainName ? [strainName] : [],
    })
  }

  return (
    <div id={`experiment-${experiment.id}`} className="rounded-xl border border-primary/30 bg-primary/[0.03] p-3.5 scroll-mt-24" data-experiment={experiment.id}>
      <div className="flex items-center gap-2 flex-wrap">
        <FlaskConical className="w-4 h-4 text-primary shrink-0" />
        <span className="text-xs font-medium text-muted-foreground">
          {EXPERIMENT_CATEGORY_LABELS[experiment.category] ?? "Experiment"}
        </span>
        <span className={cn("text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full", STATUS_STYLES[experiment.status] ?? STATUS_STYLES.ACTIVE)}>
          {EXPERIMENT_STATUS_LABELS[experiment.status] ?? experiment.status}
        </span>
        {experiment.outcome && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-secondary text-foreground">
            {EXPERIMENT_OUTCOME_LABELS[experiment.outcome]}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground ml-auto">your record · day {startDay}</span>
      </div>

      <h4 className="font-display font-semibold text-sm mt-2">{experiment.title}</h4>

      <dl className="mt-2 space-y-1.5 text-sm">
        <div className="flex gap-2">
          <dt className="text-xs text-muted-foreground w-20 shrink-0 pt-0.5">Changed</dt>
          <dd>{experiment.change}</dd>
        </div>
        {experiment.reason && (
          <div className="flex gap-2">
            <dt className="text-xs text-muted-foreground w-20 shrink-0 pt-0.5">Reason</dt>
            <dd>{experiment.reason}</dd>
          </div>
        )}
        {experiment.expected && (
          <div className="flex gap-2">
            <dt className="text-xs text-muted-foreground w-20 shrink-0 pt-0.5">Watching for</dt>
            <dd>{experiment.expected}</dd>
          </div>
        )}
        {experiment.baseline && (
          <div className="flex gap-2">
            <dt className="text-xs text-muted-foreground w-20 shrink-0 pt-0.5">Baseline</dt>
            <dd className="text-muted-foreground">{experiment.baseline}</dd>
          </div>
        )}
      </dl>

      <div className="mt-2.5 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        <span>
          {experiment.observationCount} observation{experiment.observationCount === 1 ? "" : "s"} after change
        </span>
        {lastObservationDay != null && <span>latest · day {lastObservationDay}</span>}
        {experiment.followUp && (
          <span className="text-amber-500 font-medium">
            {EXPERIMENT_FOLLOW_UP_LABELS[experiment.followUp]}
          </span>
        )}
      </div>

      {experiment.outcome && experiment.conclusion && (
        <p className="mt-2 text-sm text-muted-foreground border-t border-border/50 pt-2">
          “{experiment.conclusion}”
        </p>
      )}

      {isOwner && (
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          {experiment.status === "PLANNED" && (
            <button
              onClick={() => patch({ status: "ACTIVE" })}
              disabled={saving}
              className="text-xs px-3 py-1.5 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors min-h-8"
            >
              Start
            </button>
          )}
          {(experiment.status === "ACTIVE" || experiment.status === "OBSERVING") && (
            <>
              <button
                onClick={() => composer.open({ type: "grow-update", experimentId: experiment.id })}
                className="text-xs px-3 py-1.5 rounded-full border border-border hover:bg-secondary transition-colors min-h-8"
              >
                Record observation
              </button>
              <button
                onClick={() => setManaging((m) => !m)}
                className="text-xs px-3 py-1.5 rounded-full border border-border hover:bg-secondary transition-colors min-h-8"
              >
                {managing ? "Close" : "Complete / edit"}
              </button>
            </>
          )}
          {(experiment.status === "COMPLETED" || experiment.status === "ABANDONED") && (
            <button
              onClick={() => patch({ status: "ACTIVE" })}
              disabled={saving}
              className="text-xs px-3 py-1.5 rounded-full border border-border hover:bg-secondary transition-colors min-h-8"
            >
              Reopen
            </button>
          )}
          <button
            onClick={askCommunity}
            className="text-xs px-3 py-1.5 rounded-full border border-border hover:bg-secondary transition-colors min-h-8 inline-flex items-center gap-1"
          >
            <MessageCircleQuestion className="w-3 h-3" /> Ask the community
          </button>
        </div>
      )}

      {managing && isOwner && (
        <div className="mt-3 pt-3 border-t border-border/50 space-y-2.5">
          <div className="grid sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium mb-1">Outcome (your call)</label>
              <select
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
                className="w-full px-2.5 py-2 rounded-lg border border-border bg-background text-sm min-h-9"
              >
                <option value="">Not stated</option>
                {EXPERIMENT_OUTCOMES.map((o) => (
                  <option key={o} value={o}>{EXPERIMENT_OUTCOME_LABELS[o]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Status</label>
              <select
                defaultValue=""
                onChange={(e) => {
                  const s = e.target.value
                  if (!s) return
                  patch({ status: s, ...(s === "COMPLETED" ? { outcome: outcome || null, conclusion: conclusion || null } : {}) })
                }}
                disabled={saving}
                className="w-full px-2.5 py-2 rounded-lg border border-border bg-background text-sm min-h-9"
              >
                <option value="">Move to…</option>
                {experiment.status !== "OBSERVING" && <option value="OBSERVING">Observing</option>}
                <option value="COMPLETED">Completed</option>
                <option value="ABANDONED">Abandoned</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Conclusion (optional)</label>
            <textarea
              value={conclusion}
              onChange={(e) => setConclusion(e.target.value)}
              rows={2}
              placeholder="What did you observe? Your words — the record stays yours."
              className="w-full px-2.5 py-2 rounded-lg border border-border bg-background text-sm resize-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => patch({ outcome: outcome || null, conclusion: conclusion || null })}
              disabled={saving}
              className="text-xs px-3 py-1.5 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors min-h-8 inline-flex items-center gap-1.5"
            >
              {saving && <Loader2 className="w-3 h-3 animate-spin" />} Save notes
            </button>
            <DeleteExperiment diaryId={diaryId} experimentId={experiment.id} />
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-destructive" role="alert">{error}</p>}
    </div>
  )
}

function DeleteExperiment({ diaryId, experimentId }: { diaryId: string; experimentId: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="text-xs px-3 py-1.5 rounded-full text-muted-foreground hover:text-destructive transition-colors min-h-8 inline-flex items-center gap-1"
      >
        <X className="w-3 h-3" /> Delete
      </button>
    )
  }
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">Delete this record? Linked updates stay.</span>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          await fetch(`/api/diaries/${diaryId}/experiments/${experimentId}`, { method: "DELETE" })
          router.refresh()
        }}
        className="text-destructive font-medium min-h-8 px-2"
      >
        Confirm
      </button>
      <button onClick={() => setConfirming(false)} className="text-muted-foreground min-h-8 px-2">
        Keep
      </button>
    </span>
  )
}
