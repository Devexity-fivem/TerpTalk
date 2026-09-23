"use client"

import { useState } from "react"
import {
  Bot, Loader2, AlertTriangle, Gauge, Bug, Wrench, MessagesSquare,
  ListChecks, Activity, ClipboardList, Ruler, History, Sparkles,
} from "lucide-react"
import type { GrowIntel } from "@/lib/grow-intel"
import { useShareComposer } from "@/components/share-composer"
import { cn } from "@/lib/utils"

/**
 * Grow intel panel — the owner-facing TerpBot surface on a diary page.
 * Server renders the deterministic summary; the quick actions call
 * /api/diaries/[id]/intel which runs the SAME renderers as the chat
 * commands (next/status/check/plan/measurements/changes). Deterministic,
 * evidence-backed — no generative text, no invented advice.
 */

const ACTIONS: { action: string; label: string; icon: typeof Activity }[] = [
  { action: "next", label: "What next?", icon: Sparkles },
  { action: "status", label: "Status", icon: Activity },
  { action: "check", label: "Check grow", icon: ListChecks },
  { action: "plan", label: "Plan", icon: ClipboardList },
  { action: "measurements", label: "Readings", icon: Ruler },
  { action: "changes", label: "What changed", icon: History },
]

// Mirrors postureLabel in grow-intel.ts — kept client-local so this
// module never imports the server-side engine.
const POSTURE_LABEL: Record<string, string> = {
  act: "action suggested",
  wait: "evaluating a change",
  monitor: "watching things settle",
  collect: "needs more data",
  stable: "on track",
}

const POSTURE_STYLE: Record<string, string> = {
  act: "bg-warning/15 text-warning",
  wait: "bg-spectrum/15 text-spectrum",
  monitor: "bg-spectrum/15 text-spectrum",
  collect: "bg-secondary text-muted-foreground",
  stable: "bg-primary/15 text-primary",
}

const STAGE_LABEL: Record<string, string> = {
  GERMINATION: "germination", SEEDLING: "seedling", VEGETATIVE: "vegetative",
  FLOWER: "flowering", HARVEST: "harvest", DRYING: "drying",
  CURING: "curing", COMPLETED: "completed", UNKNOWN: "stage unknown",
}

export default function GrowIntelPanel({
  diaryId,
  intel,
  strainName,
}: {
  diaryId: string
  intel: GrowIntel
  strainName: string | null
}) {
  const { open } = useShareComposer()
  const [active, setActive] = useState<string | null>(null)
  const [lines, setLines] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")

  const run = async (action: string) => {
    setBusy(true)
    setErr("")
    setActive(action)
    try {
      const res = await fetch(`/api/diaries/${diaryId}/intel?action=${action}`)
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || "Could not load intel")
      setLines(d.lines ?? [])
    } catch (e) {
      setErr((e as Error).message)
      setLines(null)
    } finally {
      setBusy(false)
    }
  }

  const discuss = () => {
    const stage = STAGE_LABEL[intel.stage] ?? intel.stage.toLowerCase()
    const flags = [...intel.concerns, ...intel.episodes, ...intel.due].map((f) => f.text)
    const readings = intel.readings.map((r) => `${r.label} ${r.value}`).join(", ")
    open({
      type: "question",
      title: `Help with ${strainName ?? "my grow"} — ${stage} stage`,
      content: [
        `Grow: ${strainName ? `${strainName} — ` : ""}${stage}, day ${intel.day}.`,
        readings ? `Latest readings: ${readings}.` : null,
        flags.length ? `What I'm seeing: ${flags.join("; ")}.` : null,
        "",
        "My question:",
      ].filter((l): l is string => l != null).join("\n"),
      tags: strainName ? [strainName] : [],
    })
  }

  const hasFlags =
    intel.concerns.length > 0 ||
    intel.episodes.length > 0 ||
    intel.due.length > 0 ||
    intel.pendingInterventions.length > 0

  return (
    <section
      className="bg-card/80 rounded-2xl border border-primary/25 p-4 sm:p-5 mb-4"
      aria-label="TerpBot grow intelligence"
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="flex items-center gap-2 font-display text-sm font-semibold">
          <Bot className="h-4 w-4 text-primary" />
          TerpBot intel
        </h2>
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", POSTURE_STYLE[intel.posture])}>
          {POSTURE_LABEL[intel.posture] ?? intel.posture}
        </span>
      </div>

      {/* Latest readings */}
      {intel.readings.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {intel.readings.map((r) => (
            <span
              key={r.label}
              className={cn(
                "inline-flex items-center rounded-lg px-2 py-1 text-xs tabular-nums",
                r.outOfBand
                  ? "bg-warning/15 text-warning font-medium"
                  : "bg-secondary/60 text-muted-foreground",
                r.stale && "opacity-60"
              )}
              title={r.stale ? `${r.label} — stale reading` : r.label}
            >
              {r.label} {r.value}
            </span>
          ))}
        </div>
      )}

      {/* Deterministic flags */}
      {hasFlags && (
        <ul className="space-y-1 mb-3 text-sm">
          {intel.concerns.map((f) => (
            <li key={`c-${f.text}`} className="flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-warning" aria-label="Out of range" />
              <span>{f.text}</span>
            </li>
          ))}
          {intel.episodes.map((f) => (
            <li key={`e-${f.text}`} className="flex items-start gap-2">
              <Bug className="h-3.5 w-3.5 mt-0.5 shrink-0 text-destructive" aria-label="Open symptom" />
              <span>{f.text}</span>
            </li>
          ))}
          {intel.due.map((f) => (
            <li key={`d-${f.text}`} className="flex items-start gap-2">
              <Gauge className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" aria-label="Measurement due" />
              <span>{f.text}</span>
            </li>
          ))}
          {intel.pendingInterventions.map((f) => (
            <li key={`i-${f.text}`} className="flex items-start gap-2">
              <Wrench className="h-3.5 w-3.5 mt-0.5 shrink-0 text-spectrum" aria-label="Adjustment pending" />
              <span>{f.text}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Next step — canonical decision line */}
      <p className="text-sm mb-3">
        <span className="font-medium">Next: </span>
        <span className="text-muted-foreground">{intel.nextStep}</span>
      </p>

      {/* Ask TerpBot — deterministic quick actions */}
      <div className="flex flex-wrap gap-1.5">
        {ACTIONS.map((a) => (
          <button
            key={a.action}
            onClick={() => run(a.action)}
            disabled={busy}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-8",
              active === a.action && lines
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border/70 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            )}
          >
            {busy && active === a.action ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <a.icon className="h-3 w-3" />
            )}
            {a.label}
          </button>
        ))}
        <button
          onClick={discuss}
          className="inline-flex items-center gap-1 rounded-full border border-spectrum/40 px-3 py-1.5 text-xs font-medium text-spectrum hover:bg-spectrum/10 transition-colors min-h-8"
        >
          <MessagesSquare className="h-3 w-3" />
          Ask the community
        </button>
      </div>

      {/* Deterministic response — same lines the chat command renders */}
      {(lines || err) && (
        <div
          className="mt-3 rounded-xl border border-border/60 bg-secondary/30 p-3 text-sm"
          role="status"
          aria-live="polite"
        >
          {err ? (
            <p className="text-destructive">{err}</p>
          ) : (
            lines!.map((l, i) => (
              <p key={i} className={i > 0 ? "mt-1.5" : ""}>
                {l}
              </p>
            ))
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            Deterministic — built from your logged updates and the rule engine.
          </p>
        </div>
      )}
    </section>
  )
}
