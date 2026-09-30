"use client"

import { useEffect, useState } from "react"
import { Loader2, Sprout, RefreshCw } from "@/lib/icons"
import SectionCard from "@/components/ui/section-card"
import StatStrip from "@/components/ui/stat-strip"
import Tag from "@/components/ui/tag"
import type { ProfileIntelDTO } from "@/lib/terpbot-profile"

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`)

/**
 * Owner-only TerpBot profile intelligence (P5). Fetches lazily — the
 * panel never costs a public-profile render anything, and the endpoint
 * only ever answers for the session owner. Renders nothing on error so
 * a failed analysis silently drops rather than showing a broken card.
 */
export default function TerpBotInsights({ compact }: { compact: boolean }) {
  const [intel, setIntel] = useState<ProfileIntelDTO | null>(null)
  const [state, setState] = useState<"loading" | "ready" | "error">("loading")

  const fetchIntel = () =>
    fetch("/api/profile/terpbot")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => {
        setIntel(j as ProfileIntelDTO)
        setState("ready")
      })
      .catch(() => setState("error"))

  const load = () => {
    setState("loading")
    fetchIntel()
  }

  useEffect(() => {
    fetchIntel()
  }, [])

  if (state === "error") return null

  return (
    <SectionCard
      title="TerpBot insights"
      id="terpbot-insights"
      compact={compact}
      actions={
        <span className="inline-flex items-center gap-1.5">
          <Tag variant="muted">Only you</Tag>
          {state === "ready" && (
            <button
              type="button"
              onClick={load}
              aria-label="Refresh insights"
              className="text-muted-foreground hover:text-foreground transition-colors p-1"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
        </span>
      }
    >
      {state === "loading" || !intel ? (
        <span className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Reading your grow records…
        </span>
      ) : (
        <div className="space-y-4">
          {/* Recorded — facts directly stored in TerpTalk. */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Recorded</p>
            <StatStrip
              className="sm:grid-cols-4"
              items={[
                { label: "Grows", value: String(intel.recorded.growsDocumented) },
                { label: "Updates", value: String(intel.recorded.updatesLogged) },
                { label: "Harvests", value: String(intel.recorded.harvestsCompleted) },
                { label: "Experiments", value: String(intel.recorded.experimentsRun) },
                { label: "Strains", value: String(intel.recorded.strainsGrown) },
                { label: "Documented weeks", value: String(intel.recorded.documentedWeeks) },
                { label: "Live experiments", value: String(intel.recorded.activeExperiments) },
              ]}
            />
          </div>

          {/* Derived — deterministic calculation, not stored fact. */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Derived</p>
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
              <div><dt className="text-muted-foreground">Environment logged</dt><dd className="font-medium">{pct(intel.derived.environmentCoverage)}</dd></div>
              <div><dt className="text-muted-foreground">pH logged</dt><dd className="font-medium">{pct(intel.derived.phCoverage)}</dd></div>
              <div><dt className="text-muted-foreground">EC logged</dt><dd className="font-medium">{pct(intel.derived.ecCoverage)}</dd></div>
              <div><dt className="text-muted-foreground">Updates / grow</dt><dd className="font-medium">{intel.derived.avgUpdatesPerGrow ?? "—"}</dd></div>
              {intel.derived.mostGrownStrain && (
                <div className="col-span-2"><dt className="text-muted-foreground">Most-grown strain</dt><dd className="font-medium">{intel.derived.mostGrownStrain}</dd></div>
              )}
            </dl>
            {intel.derived.strongestSignal && intel.derived.weakestSignal && (
              <p className="mt-2 text-xs text-muted-foreground">
                You log {intel.derived.strongestSignal} most consistently; {intel.derived.weakestSignal} are least documented.
              </p>
            )}
          </div>

          {/* Recommendation — one deterministic suggestion. */}
          {intel.recommendation && (
            <div className="rounded-xl border border-primary/20 bg-primary/[0.06] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-primary mb-1">
                Recommended next
                {intel.recommendation.growTitle && <span className="text-muted-foreground normal-case font-normal"> · {intel.recommendation.growTitle}</span>}
              </p>
              <p className="text-sm font-medium flex items-start gap-1.5">
                <Sprout className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                {intel.recommendation.text}
              </p>
              {intel.recommendation.why && (
                <p className="mt-1 text-xs text-muted-foreground">{intel.recommendation.why}</p>
              )}
            </div>
          )}
        </div>
      )}
    </SectionCard>
  )
}
