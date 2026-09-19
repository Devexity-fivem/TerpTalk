"use client"

import { useState, useEffect } from "react"
import { Loader2 } from "lucide-react"
import Link from "next/link"
import StrainCombobox from "@/components/strain-combobox"
import { MEDIUM_TYPES, MEDIUM_LABELS, LIGHT_TYPES, LIGHT_LABELS, TECHNIQUES, TECHNIQUE_LABELS } from "@/lib/grow-fields"
import { localDateInputValue } from "@/lib/diary-weeks"
import { DIARY_VISIBILITY_OPTIONS } from "@/lib/diary-visibility"

export interface DiaryFormData {
  title: string
  description: string
  strain: string
  strainId: string | null
  genetics: string
  growType: string
  startDate: string
  medium: string
  mediumType: string
  containerSize: string
  lighting: string
  lightType: string
  nutrients: string
  equipment: string
  techniques: string[]
  spaceDimensions: string
  setupId: string
  visibility: string
}

interface Props {
  initial: DiaryFormData
  submitLabel: string
  pendingLabel: string
  /** Throws Error(message) on failure; resolves on success. */
  onSubmit: (data: DiaryFormData) => Promise<void>
  cancelHref: string
  /**
   * When set, the start-date input is replaced with this read-only
   * display string — startDate anchors all derived analytics and is
   * immutable after creation.
   */
  startDateDisplay?: string
  /** Unique normalized-exact catalog match for the diary's free-text
   *  strain — rendered as a suggestion the owner must explicitly select. */
  strainSuggestion?: { id: string; name: string } | null
}

const inputCls =
  "w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"

// Shared diary metadata form — used by both create (/diaries/new) and
// edit (/diaries/[id]/edit). Field markup and controls are identical;
// only the submit wiring and start-date treatment differ.
export default function DiaryForm({ initial, submitLabel, pendingLabel, onSubmit, cancelHref, startDateDisplay, strainSuggestion }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [setups, setSetups] = useState<{ id: string; title: string }[]>([])
  const [formData, setFormData] = useState<DiaryFormData>(initial)

  // Default the start date to today (local) on mount — client-only so the
  // server-rendered "" never fights hydration, and an explicit user or
  // prefill value is never overwritten. Edit mode passes startDateDisplay
  // and locks the field entirely.
  useEffect(() => {
    if (startDateDisplay) return
    // Deferred so the server-rendered "" and first client render match and
    // the fill never becomes a synchronous cascading render.
    const t = setTimeout(() => {
      setFormData((prev) => (prev.startDate ? prev : { ...prev, startDate: localDateInputValue() }))
    }, 0)
    return () => clearTimeout(t)
  }, [startDateDisplay])

  // The member's own setups — the API is owner-scoped by construction.
  useEffect(() => {
    fetch("/api/setups")
      .then((res) => res.json())
      .then((data) => setSetups(data.setups || []))
      .catch(() => setSetups([]))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!formData.title.trim() || (!startDateDisplay && !formData.startDate)) {
      setError("Please fill in all required fields")
      return
    }

    setLoading(true)
    try {
      await onSubmit(formData)
    } catch (err: unknown) {
      setError((err as Error).message)
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Basic Information */}
      <div className="space-y-4">
        <h3 className="font-semibold text-lg">Basic Information</h3>

        <div>
          <label htmlFor="title" className="block text-sm font-medium mb-2">
            Diary Title *
          </label>
          <input
            id="title"
            type="text"
            required
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            className={inputCls}
            placeholder="Give your grow diary a name"
            maxLength={100}
          />
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium mb-2">
            Description
          </label>
          <textarea
            id="description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            className={`${inputCls} resize-none`}
            placeholder="Describe your grow goals, strain, and what you hope to achieve..."
            rows={4}
          />
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="strain" className="block text-sm font-medium mb-2">
              Strain
            </label>
            <StrainCombobox
              value={formData.strain}
              strainId={formData.strainId}
              onChange={(text, strainId) => setFormData({ ...formData, strain: text, strainId })}
            />
            {strainSuggestion && !formData.strainId && (
              <p className="mt-2 text-xs text-muted-foreground">
                Possible catalog match:{" "}
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, strain: strainSuggestion.name, strainId: strainSuggestion.id })}
                  className="font-medium text-primary hover:underline"
                >
                  {strainSuggestion.name} — select this strain
                </button>
              </p>
            )}
          </div>

          <div>
            <label htmlFor="genetics" className="block text-sm font-medium mb-2">
              Genetics
            </label>
            <input
              id="genetics"
              type="text"
              value={formData.genetics}
              onChange={(e) => setFormData({ ...formData, genetics: e.target.value })}
              className={inputCls}
              placeholder="e.g., Sativa, Indica, Hybrid"
            />
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="growType" className="block text-sm font-medium mb-2">
              Grow Type *
            </label>
            <select
              id="growType"
              required
              value={formData.growType}
              onChange={(e) => setFormData({ ...formData, growType: e.target.value })}
              className={inputCls}
            >
              <option value="INDOOR">Indoor</option>
              <option value="OUTDOOR">Outdoor</option>
              <option value="GREENHOUSE">Greenhouse</option>
            </select>
          </div>

          <div>
            <label htmlFor="startDate" className="block text-sm font-medium mb-2">
              Start Date {startDateDisplay ? "" : "*"}
            </label>
            {startDateDisplay ? (
              <p className="px-4 py-2 rounded-lg border border-border bg-secondary/50 text-sm text-muted-foreground">
                {startDateDisplay} — start date can&apos;t be changed
              </p>
            ) : (
              <input
                id="startDate"
                type="date"
                required
                value={formData.startDate}
                onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                className={inputCls}
              />
            )}
          </div>
        </div>

        <div>
          <label htmlFor="visibility" className="block text-sm font-medium mb-2">
            Visibility
          </label>
          <select
            id="visibility"
            value={formData.visibility}
            onChange={(e) => setFormData({ ...formData, visibility: e.target.value })}
            className={inputCls}
          >
            {DIARY_VISIBILITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {DIARY_VISIBILITY_OPTIONS.find((o) => o.value === formData.visibility)?.help}
          </p>
        </div>
      </div>

      {/* Grow Setup */}
      <div className="space-y-4">
        <h3 className="font-semibold text-lg">Grow Setup</h3>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="mediumType" className="block text-sm font-medium mb-2">
              Growing Medium
            </label>
            <select
              id="mediumType"
              value={formData.mediumType}
              onChange={(e) => setFormData({ ...formData, mediumType: e.target.value })}
              className={inputCls}
            >
              <option value="">Select (optional)</option>
              {MEDIUM_TYPES.map((t) => (
                <option key={t} value={t}>{MEDIUM_LABELS[t]}</option>
              ))}
            </select>
            <input
              id="medium"
              type="text"
              value={formData.medium}
              onChange={(e) => setFormData({ ...formData, medium: e.target.value })}
              className={`${inputCls} mt-2`}
              placeholder="Details, e.g., Fox Farm Ocean Forest"
            />
          </div>

          <div>
            <label htmlFor="containerSize" className="block text-sm font-medium mb-2">
              Container Size
            </label>
            <input
              id="containerSize"
              type="text"
              value={formData.containerSize}
              onChange={(e) => setFormData({ ...formData, containerSize: e.target.value })}
              className={inputCls}
              placeholder="e.g., 5 gallon, 10L"
            />
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="lightType" className="block text-sm font-medium mb-2">
              Lighting
            </label>
            <select
              id="lightType"
              value={formData.lightType}
              onChange={(e) => setFormData({ ...formData, lightType: e.target.value })}
              className={inputCls}
            >
              <option value="">Select (optional)</option>
              {LIGHT_TYPES.map((t) => (
                <option key={t} value={t}>{LIGHT_LABELS[t]}</option>
              ))}
            </select>
            <input
              id="lighting"
              type="text"
              value={formData.lighting}
              onChange={(e) => setFormData({ ...formData, lighting: e.target.value })}
              className={`${inputCls} mt-2`}
              placeholder="Details, e.g., 240W quantum board"
            />
          </div>

          <div>
            <label htmlFor="nutrients" className="block text-sm font-medium mb-2">
              Nutrients
            </label>
            <input
              id="nutrients"
              type="text"
              value={formData.nutrients}
              onChange={(e) => setFormData({ ...formData, nutrients: e.target.value })}
              className={inputCls}
              placeholder="e.g., Fox Farm, Advanced Nutrients"
            />
          </div>
        </div>

        <div>
          <label htmlFor="spaceDimensions" className="block text-sm font-medium mb-2">
            Grow Space Dimensions
          </label>
          <input
            id="spaceDimensions"
            type="text"
            value={formData.spaceDimensions}
            onChange={(e) => setFormData({ ...formData, spaceDimensions: e.target.value })}
            className={inputCls}
            placeholder="e.g., 4x4x7 tent, 10x10 room"
          />
        </div>

        <div>
          <label htmlFor="equipment" className="block text-sm font-medium mb-2">
            Equipment
          </label>
          <textarea
            id="equipment"
            value={formData.equipment}
            onChange={(e) => setFormData({ ...formData, equipment: e.target.value })}
            className={`${inputCls} resize-none`}
            placeholder="List any additional equipment like fans, filters, controllers, etc."
            rows={3}
          />
        </div>

        <div>
          <span className="block text-sm font-medium mb-2">Training techniques (optional)</span>
          <div className="flex flex-wrap gap-2">
            {TECHNIQUES.map((t) => {
              const active = formData.techniques.includes(t)
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() =>
                    setFormData({
                      ...formData,
                      techniques: active
                        ? formData.techniques.filter((x) => x !== t)
                        : [...formData.techniques, t],
                    })
                  }
                  className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border hover:bg-secondary"
                  }`}
                >
                  {TECHNIQUE_LABELS[t]}
                </button>
              )
            })}
          </div>
        </div>

        {setups.length > 0 && (
          <div>
            <label htmlFor="setupId" className="block text-sm font-medium mb-2">
              Link a grow setup (optional)
            </label>
            <select
              id="setupId"
              value={formData.setupId}
              onChange={(e) => setFormData({ ...formData, setupId: e.target.value })}
              className={inputCls}
            >
              <option value="">None</option>
              {setups.map((s) => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-4">
        <button
          type="submit"
          disabled={loading}
          className="flex-1 bg-primary text-primary-foreground py-3 rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {pendingLabel}
            </>
          ) : (
            submitLabel
          )}
        </button>
        <Link
          href={cancelHref}
          className="px-6 py-3 border border-border rounded-lg hover:bg-secondary transition-colors text-center"
        >
          Cancel
        </Link>
      </div>
    </form>
  )
}
