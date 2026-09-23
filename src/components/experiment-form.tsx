"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { FlaskConical, Loader2 } from "lucide-react"
import {
  EXPERIMENT_CATEGORIES,
  EXPERIMENT_CATEGORY_LABELS,
} from "@/lib/experiments"

const INPUT =
  "w-full px-3 py-2 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"

/**
 * Compact experiment capture — "I changed X because I observed Y".
 * Progressive: title + category + change are the required core; reason,
 * expectation and baseline sit behind a collapsed section so the form
 * stays two-thumb friendly on mobile.
 */
export default function ExperimentForm({
  diaryId,
  onDone,
}: {
  diaryId: string
  onDone?: () => void
}) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [form, setForm] = useState({
    title: "",
    category: "OTHER",
    change: "",
    reason: "",
    expected: "",
    baseline: "",
    status: "ACTIVE",
  })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    if (!form.title.trim() || !form.change.trim()) {
      setError("Name the experiment and describe what changed")
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/diaries/${diaryId}/experiments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          category: form.category,
          change: form.change,
          ...(form.reason.trim() ? { reason: form.reason } : {}),
          ...(form.expected.trim() ? { expected: form.expected } : {}),
          ...(form.baseline.trim() ? { baseline: form.baseline } : {}),
          status: form.status,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || "Failed to save experiment")
      }
      router.refresh()
      onDone?.()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className="block text-sm font-medium mb-1">Experiment name *</label>
        <input
          type="text"
          required
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          className={INPUT}
          placeholder="e.g. Raised light intensity"
          maxLength={120}
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">What kind of change? *</label>
        <select
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
          className={INPUT}
        >
          {EXPERIMENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>{EXPERIMENT_CATEGORY_LABELS[c]}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">What changed? *</label>
        <textarea
          required
          value={form.change}
          onChange={(e) => setForm({ ...form, change: e.target.value })}
          className={`${INPUT} resize-none`}
          placeholder="e.g. Dimmer from 60% to 80%, ~45cm above canopy"
          rows={2}
          maxLength={600}
        />
      </div>

      <details className="border border-border rounded-lg">
        <summary className="px-3 py-2.5 text-sm font-medium cursor-pointer select-none text-muted-foreground">
          Why &amp; what to watch (optional)
        </summary>
        <div className="px-3 pb-3 space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1">Reason — what did you observe?</label>
            <textarea
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              className={`${INPUT} resize-none`}
              placeholder="e.g. Leaf posture changed after lights-on"
              rows={2}
              maxLength={600}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Watching for</label>
            <input
              type="text"
              value={form.expected}
              onChange={(e) => setForm({ ...form, expected: e.target.value })}
              className={INPUT}
              placeholder="e.g. Leaf posture recovers within 48h"
              maxLength={600}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Baseline (optional)</label>
            <input
              type="text"
              value={form.baseline}
              onChange={(e) => setForm({ ...form, baseline: e.target.value })}
              className={INPUT}
              placeholder="e.g. Temp 76°F · RH 58% · pH 6.4"
              maxLength={600}
            />
          </div>
        </div>
      </details>

      <div className="flex items-center gap-2 text-sm">
        <span className="text-xs font-medium text-muted-foreground">State:</span>
        {(["ACTIVE", "PLANNED"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setForm({ ...form, status: s })}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors min-h-8 ${
              form.status === s
                ? "border-primary bg-primary/10 text-primary font-medium"
                : "border-border text-muted-foreground hover:bg-secondary"
            }`}
          >
            {s === "ACTIVE" ? "Started now" : "Planned"}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

      <button
        type="submit"
        disabled={saving}
        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 min-h-11"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
        Record experiment
      </button>
    </form>
  )
}
