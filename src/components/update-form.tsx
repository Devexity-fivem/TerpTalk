"use client"

import { useEffect, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { usePathname, useRouter } from "next/navigation"
import { Plus, Loader2, X, Camera, ImagePlus, History } from "@/lib/icons"
import { signInHref } from "@/lib/callback-url"
import { STAGE_TIPS } from "@/lib/stage-tips"
import {
  UPDATE_EVENT_TAGS,
  UPDATE_EVENT_LABELS,
  UPDATE_ISSUE_TAGS,
  UPDATE_ISSUE_LABELS,
  UPDATE_PLANT_HEALTH_LABELS,
  UPDATE_TRICHOME_LABELS,
} from "@/lib/update-tags"

// The API silently drops data-URIs over 400K chars — step the quality down
// until the encoded image fits instead of losing the photo.
export function resizeImage(file: File, max = 800): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(img.src)
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const canvas = document.createElement("canvas")
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext("2d")
      if (!ctx) return reject(new Error("no canvas"))
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      for (const q of [0.82, 0.7, 0.6, 0.5, 0.4]) {
        const url = canvas.toDataURL("image/webp", q)
        if (url.length <= 390_000) return resolve(url)
      }
      return reject(new Error("Image too large"))
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

interface UpdateFormProps {
  diaryId: string
  /** Drafts are scoped by user + diary — the storage key contains both so a
   *  draft can never leak into another account or another grow. */
  userId: string
  currentStage: string
  currentDay: number
  currentWeek: number
  /** Most recent non-empty feeding note — offered as an explicit reuse
   *  action, never silently injected. */
  lastFeeding?: string | null
}

/** Serialized draft ceiling — text fields only; photos stay out of storage
 *  so a draft can't balloon into a multi-MB base64 blob. */
const DRAFT_LIMIT = 32_000

export default function UpdateForm({ diaryId, userId, currentStage, currentDay, currentWeek, lastFeeding }: UpdateFormProps) {
  const { data: session } = useSession()
  const pathname = usePathname()
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [photos, setPhotos] = useState<string[]>([])
  const [formData, setFormData] = useState({
    title: "",
    content: "",
    // Default to the diary's current stage — hard-coding a stage here used to
    // silently regress the diary stage on every update.
    stage: currentStage,
    temperature: "",
    humidity: "",
    vpd: "",
    ph: "",
    ec: "",
    heightCm: "",
    nightTemperature: "",
    substrateTemperature: "",
    co2Ppm: "",
    wateringLiters: "",
    ppfd: "",
    photoperiodHours: "",
    runoffPh: "",
    runoffEc: "",
    lampDistanceCm: "",
    feeding: "",
    training: "",
    events: [] as string[],
    issues: [] as string[],
    plantHealth: "",
    trichomeState: "",
    aromaIntensity: "",
  })
  // Structured nutrient rows — separate from formData's flat string map;
  // drafts remain text-only by design.
  const [nutrientRows, setNutrientRows] = useState<{ productName: string; doseMlPerL: string }[]>([])
  // Week-tab rail — lets a grower back-fill an update into an earlier week
  // (GD-style week navigation). Null = auto-derive from the diary clock.
  const [weekOverride, setWeekOverride] = useState<number | null>(null)

  // ── Draft autosave (localStorage, user+diary scoped) ──────────────────
  const draftKey = userId ? `tt:update-draft:${userId}:${diaryId}` : null
  const [draftNotice, setDraftNotice] = useState(false)
  const mounted = useRef(false)

  // Restore happens on the first open rather than on mount — a stale draft
  // is never applied to a form the member didn't intend to use, and no
  // state write runs inside an effect. The scoped key guarantees the draft
  // belongs to this member and this diary — no cross-account/grow bleed.
  const draftApplied = useRef(false)
  const openForm = () => {
    if (draftKey && !draftApplied.current) {
      draftApplied.current = true
      try {
        const raw = localStorage.getItem(draftKey)
        if (raw) {
          const draft = JSON.parse(raw)
          if (draft && typeof draft === "object" && draft.fields && typeof draft.fields === "object") {
            setFormData((f) => ({ ...f, ...draft.fields }))
            setDraftNotice(true)
          }
        }
      } catch { /* corrupt draft — ignore and let autosave overwrite */ }
    }
    setIsOpen(true)
  }

  // Autosave on change (debounced). First commit is skipped so the restore
  // above lands before anything writes; an all-empty form removes the key.
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return }
    if (!draftKey) return
    const t = setTimeout(() => {
      try {
        const untouched =
          !formData.title && !formData.content && !formData.feeding && !formData.training &&
          !formData.temperature && !formData.humidity && !formData.vpd &&
          !formData.ph && !formData.ec && !formData.heightCm &&
          !formData.nightTemperature && !formData.substrateTemperature && !formData.co2Ppm &&
          !formData.wateringLiters && !formData.ppfd && !formData.photoperiodHours &&
          !formData.runoffPh && !formData.runoffEc && !formData.lampDistanceCm &&
          formData.events.length === 0 && formData.issues.length === 0 &&
          !formData.plantHealth && !formData.trichomeState && !formData.aromaIntensity &&
          formData.stage === currentStage
        if (untouched) { localStorage.removeItem(draftKey); return }
        const payload = JSON.stringify({ savedAt: Date.now(), fields: formData })
        if (payload.length <= DRAFT_LIMIT) localStorage.setItem(draftKey, payload)
      } catch { /* quota/privacy mode — drafting is best-effort */ }
    }, 400)
    return () => clearTimeout(t)
  }, [draftKey, formData, currentStage])

  const clearDraft = () => {
    if (draftKey) try { localStorage.removeItem(draftKey) } catch { /* noop */ }
    setDraftNotice(false)
  }

  const discardDraft = () => {
    clearDraft()
    setFormData({
      title: "", content: "", stage: currentStage,
      temperature: "", humidity: "", vpd: "", ph: "", ec: "", heightCm: "",
      nightTemperature: "", substrateTemperature: "", co2Ppm: "",
      wateringLiters: "", ppfd: "", photoperiodHours: "",
      runoffPh: "", runoffEc: "", lampDistanceCm: "",
      feeding: "", training: "",
      events: [], issues: [], plantHealth: "", trichomeState: "", aromaIntensity: "",
    })
  }

  const addPhotoFiles = async (files: FileList | null) => {
    if (!files) return
    for (const f of Array.from(files)) {
      if (photos.length >= 4) break
      if (f.size > 10 * 1024 * 1024) { setError("Image must be under 10MB"); continue }
      try {
        const resized = await resizeImage(f)
        setPhotos((prev) => (prev.length < 4 ? [...prev, resized] : prev))
      } catch { setError("Could not process image") }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!formData.title.trim() || !formData.content.trim()) {
      setError("Please fill in all required fields")
      return
    }

    if (!session) {
      setError("You must be signed in to add updates")
      return
    }

    setLoading(true)

    try {
      const response = await fetch("/api/diaries/updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          diaryId,
          temperature: formData.temperature ? parseFloat(formData.temperature) : null,
          humidity: formData.humidity ? parseFloat(formData.humidity) : null,
          vpd: formData.vpd ? parseFloat(formData.vpd) : null,
          ph: formData.ph ? parseFloat(formData.ph) : null,
          ec: formData.ec ? parseFloat(formData.ec) : null,
          heightCm: formData.heightCm ? parseFloat(formData.heightCm) : null,
          nightTemperature: formData.nightTemperature ? parseFloat(formData.nightTemperature) : null,
          substrateTemperature: formData.substrateTemperature ? parseFloat(formData.substrateTemperature) : null,
          co2Ppm: formData.co2Ppm ? parseFloat(formData.co2Ppm) : null,
          wateringLiters: formData.wateringLiters ? parseFloat(formData.wateringLiters) : null,
          ppfd: formData.ppfd ? parseFloat(formData.ppfd) : null,
          photoperiodHours: formData.photoperiodHours ? parseFloat(formData.photoperiodHours) : null,
          runoffPh: formData.runoffPh ? parseFloat(formData.runoffPh) : null,
          runoffEc: formData.runoffEc ? parseFloat(formData.runoffEc) : null,
          lampDistanceCm: formData.lampDistanceCm ? parseFloat(formData.lampDistanceCm) : null,
          weekNumber: weekOverride,
          events: formData.events,
          issues: formData.issues,
          plantHealth: formData.plantHealth || null,
          trichomeState: formData.trichomeState || null,
          aromaIntensity: formData.aromaIntensity ? parseInt(formData.aromaIntensity, 10) : null,
          // Rows that were never touched drop client-side; a row with a dose
          // but no name goes to the server for its authoritative 400.
          nutrients: nutrientRows
            .filter((r) => r.productName.trim() || r.doseMlPerL !== "")
            .map((r) => ({
              productName: r.productName,
              doseMlPerL: r.doseMlPerL !== "" ? parseFloat(r.doseMlPerL) : null,
            })),
          images: photos,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to create update")
      }

      router.refresh()
      setIsOpen(false)
      setPhotos([])
      setNutrientRows([])
      clearDraft()
      setFormData((f) => ({
        ...f, title: "", content: "", feeding: "", training: "",
        events: [], issues: [], plantHealth: "", trichomeState: "", aromaIntensity: "",
      }))
    } catch (error: unknown) {
      setError((error as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const envInput = "w-full px-2 py-2 sm:py-1 rounded border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary text-xs min-h-9"

  if (!isOpen) {
    return (
      <button
        onClick={openForm}
        className="bg-primary text-primary-foreground px-4 py-2 rounded-full hover:bg-primary/90 transition-colors text-sm flex items-center gap-2 min-h-11"
      >
        <Plus className="w-4 h-4" />
        Add Update
      </button>
    )
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Add a diary update"
    >
      <div className="w-full max-w-2xl bg-card border border-border/70 rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
        <div className="flex justify-between items-center p-4 border-b border-border sticky top-0 bg-card z-10">
          <h3 className="font-display font-semibold">Add New Update</h3>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 hover:bg-secondary rounded-lg transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6">
      {!session ? (
        <p className="text-muted-foreground">
          Please <a href={signInHref(pathname)} className="text-primary hover:underline">sign in</a> to add updates.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {draftNotice && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <History className="w-3.5 h-3.5 text-primary shrink-0" />
                Draft restored — your unsaved update was recovered.
              </span>
              <button
                type="button"
                onClick={discardDraft}
                className="shrink-0 text-xs font-medium text-primary hover:underline"
              >
                Discard draft
              </button>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">Title *</label>
            <input
              type="text"
              required
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-border/70 bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"
              placeholder="e.g., Pistils forming, defoliated lower canopy"
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Stage</label>
              <select
                value={formData.stage}
                onChange={(e) => setFormData({ ...formData, stage: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-border/70 bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"
              >
                <option value="GERMINATION">Germination</option>
                <option value="SEEDLING">Seedling</option>
                <option value="VEGETATIVE">Vegetative</option>
                <option value="FLOWER">Flower</option>
                <option value="HARVEST">Harvest</option>
                <option value="DRYING">Drying</option>
                <option value="CURING">Curing</option>
                <option value="COMPLETED">Completed</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Week</label>
              <div className="flex gap-1 overflow-x-auto pb-1 -mx-0.5 px-0.5">
                <button
                  type="button"
                  onClick={() => setWeekOverride(null)}
                  className={
                    "shrink-0 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors " +
                    (weekOverride === null
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:border-primary/40")
                  }
                >
                  Wk {currentWeek} · auto
                </button>
                {Array.from({ length: currentWeek }, (_, i) => currentWeek - i).map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setWeekOverride(w)}
                    className={
                      "shrink-0 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors " +
                      (weekOverride === w
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:border-primary/40")
                    }
                  >
                    Wk {w}
                  </button>
                ))}
              </div>
              <span className="text-xs text-muted-foreground">Day {currentDay}</span>
            </div>
          </div>

          {STAGE_TIPS[formData.stage] && (
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
              <p className="text-xs font-semibold text-primary mb-1">💡 {formData.stage.toLowerCase()} tips</p>
              <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                {STAGE_TIPS[formData.stage].map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">What&apos;s happening? *</label>
            <textarea
              required
              value={formData.content}
              onChange={(e) => setFormData({ ...formData, content: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-border/70 bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none text-sm"
              placeholder="Describe what's happening with your plants..."
              rows={4}
            />
          </div>

          {/* Photos — picker for gallery shots, camera tile for live captures */}
          <div>
            <label className="block text-sm font-medium mb-1">Photos (up to 4)</label>
            <div className="flex items-center gap-3 flex-wrap">
              {photos.map((p, i) => (
                <div key={i} className="relative group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p} alt={`Update photo ${i + 1}`} className="w-20 h-20 object-cover rounded-lg border border-border" />
                  <button
                    type="button"
                    onClick={() => setPhotos(photos.filter((_, j) => j !== i))}
                    aria-label="Remove photo"
                    className="absolute -top-2 -right-2 w-5 h-5 bg-destructive text-destructive-foreground rounded-full text-xs flex items-center justify-center"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {photos.length < 4 && (
                <>
                  <label className="w-20 h-20 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-primary/50 transition-colors text-muted-foreground">
                    <Camera className="w-5 h-5" />
                    <span className="text-[10px]">Take</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      capture="environment"
                      className="hidden"
                      onChange={async (e) => {
                        await addPhotoFiles(e.target.files)
                        e.target.value = ""
                      }}
                    />
                  </label>
                  <label className="w-20 h-20 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-primary/50 transition-colors text-muted-foreground">
                    <ImagePlus className="w-5 h-5" />
                    <span className="text-[10px]">Gallery</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      multiple
                      className="hidden"
                      onChange={async (e) => {
                        await addPhotoFiles(e.target.files)
                        e.target.value = ""
                      }}
                    />
                  </label>
                </>
              )}
            </div>
          </div>

          {/* Optional environment + notes collapsed on mobile — keeps the
              weekly log a 2-field form (title, content, photo). */}
          <details className="border border-border rounded-lg">
            <summary className="px-4 py-3 text-sm font-medium cursor-pointer select-none text-muted-foreground">
              Work, issues &amp; environment (optional)
            </summary>
            <div className="px-4 pb-4 space-y-4">
              {/* What the grower did + what they saw — chips, not prose, so
                  these stay queryable across the community. */}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Work done this update</p>
                <div className="flex flex-wrap gap-1.5">
                  {[...UPDATE_EVENT_TAGS].map((tag) => {
                    const on = formData.events.includes(tag)
                    return (
                      <button
                        key={tag}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setFormData({
                          ...formData,
                          events: on ? formData.events.filter((t) => t !== tag) : [...formData.events, tag],
                        })}
                        className={`px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors min-h-8 ${
                          on ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:bg-secondary/70"
                        }`}
                      >
                        {UPDATE_EVENT_LABELS[tag] ?? tag}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Problems spotted</p>
                <div className="flex flex-wrap gap-1.5">
                  {[...UPDATE_ISSUE_TAGS].map((tag) => {
                    const on = formData.issues.includes(tag)
                    return (
                      <button
                        key={tag}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setFormData({
                          ...formData,
                          issues: on ? formData.issues.filter((t) => t !== tag) : [...formData.issues, tag],
                        })}
                        className={`px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors min-h-8 ${
                          on ? "bg-warning/20 text-warning border border-warning/40" : "bg-secondary text-muted-foreground hover:bg-secondary/70 border border-transparent"
                        }`}
                      >
                        {UPDATE_ISSUE_LABELS[tag] ?? tag}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Plant state</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs font-medium mb-1">Health</label>
                    <select
                      value={formData.plantHealth}
                      onChange={(e) => setFormData({ ...formData, plantHealth: e.target.value })}
                      className={envInput}
                    >
                      <option value="">—</option>
                      {Object.entries(UPDATE_PLANT_HEALTH_LABELS).map(([v, label]) => (
                        <option key={v} value={v}>{label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Trichomes</label>
                    <select
                      value={formData.trichomeState}
                      onChange={(e) => setFormData({ ...formData, trichomeState: e.target.value })}
                      className={envInput}
                    >
                      <option value="">—</option>
                      {Object.entries(UPDATE_TRICHOME_LABELS).map(([v, label]) => (
                        <option key={v} value={v}>{label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Aroma (1–5)</label>
                    <select
                      value={formData.aromaIntensity}
                      onChange={(e) => setFormData({ ...formData, aromaIntensity: e.target.value })}
                      className={envInput}
                    >
                      <option value="">—</option>
                      <option value="1">1 — faint</option>
                      <option value="2">2 — mild</option>
                      <option value="3">3 — noticeable</option>
                      <option value="4">4 — strong</option>
                      <option value="5">5 — loud</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Grouped so a grower can log just the readings they took —
                  every field stays optional. Units match storage: °F, cm. */}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Environment</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                  <div>
                    <label className="block text-xs font-medium mb-1">Day temp (°F)</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      value={formData.temperature}
                      onChange={(e) => setFormData({ ...formData, temperature: e.target.value })}
                      className={envInput}
                      placeholder="75"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Night temp (°F)</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      min="32"
                      max="122"
                      value={formData.nightTemperature}
                      onChange={(e) => setFormData({ ...formData, nightTemperature: e.target.value })}
                      className={envInput}
                      placeholder="65"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Humidity (%)</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      value={formData.humidity}
                      onChange={(e) => setFormData({ ...formData, humidity: e.target.value })}
                      className={envInput}
                      placeholder="50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">VPD (kPa)</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={formData.vpd}
                      onChange={(e) => setFormData({ ...formData, vpd: e.target.value })}
                      className={envInput}
                      placeholder="1.2"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">CO₂ (ppm)</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="10"
                      min="300"
                      max="2500"
                      value={formData.co2Ppm}
                      onChange={(e) => setFormData({ ...formData, co2Ppm: e.target.value })}
                      className={envInput}
                      placeholder="420"
                    />
                  </div>
                </div>
              </div>

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Root zone &amp; feeding</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                  <div>
                    <label className="block text-xs font-medium mb-1">Substrate temp (°F)</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      min="32"
                      max="122"
                      value={formData.substrateTemperature}
                      onChange={(e) => setFormData({ ...formData, substrateTemperature: e.target.value })}
                      className={envInput}
                      placeholder="70"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">pH</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      value={formData.ph}
                      onChange={(e) => setFormData({ ...formData, ph: e.target.value })}
                      className={envInput}
                      placeholder="6.5"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">EC (mS/cm)</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      value={formData.ec}
                      onChange={(e) => setFormData({ ...formData, ec: e.target.value })}
                      className={envInput}
                      placeholder="1.5"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Runoff pH</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      min="3"
                      max="10"
                      value={formData.runoffPh}
                      onChange={(e) => setFormData({ ...formData, runoffPh: e.target.value })}
                      className={envInput}
                      placeholder="6.2"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Runoff EC (mS/cm)</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      min="0"
                      max="10"
                      value={formData.runoffEc}
                      onChange={(e) => setFormData({ ...formData, runoffEc: e.target.value })}
                      className={envInput}
                      placeholder="2.1"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Water (L)</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      min="0"
                      max="50"
                      value={formData.wateringLiters}
                      onChange={(e) => setFormData({ ...formData, wateringLiters: e.target.value })}
                      className={envInput}
                      placeholder="2"
                    />
                  </div>
                </div>

                {/* Structured nutrient rows — optional, additive to the
                    free-text Feeding Notes below. */}
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium">Nutrients</span>
                    {nutrientRows.length < 20 && (
                      <button
                        type="button"
                        onClick={() => setNutrientRows((r) => [...r, { productName: "", doseMlPerL: "" }])}
                        className="text-xs text-primary hover:underline flex items-center gap-1 min-h-8"
                      >
                        <Plus className="w-3 h-3" /> Add nutrient
                      </button>
                    )}
                  </div>
                  {nutrientRows.map((row, i) => (
                    <div key={i} className="flex items-center gap-2 mb-1.5">
                      <input
                        type="text"
                        value={row.productName}
                        onChange={(e) => setNutrientRows((r) => r.map((x, j) => (j === i ? { ...x, productName: e.target.value } : x)))}
                        className={`${envInput} flex-1 min-w-0`}
                        placeholder="Product name"
                        maxLength={100}
                      />
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.1"
                        min="0"
                        max="100"
                        value={row.doseMlPerL}
                        onChange={(e) => setNutrientRows((r) => r.map((x, j) => (j === i ? { ...x, doseMlPerL: e.target.value } : x)))}
                        className={`${envInput} w-20 shrink-0`}
                        placeholder="Dose"
                      />
                      <span className="text-xs text-muted-foreground shrink-0">mL/L</span>
                      <button
                        type="button"
                        onClick={() => setNutrientRows((r) => r.filter((_, j) => j !== i))}
                        className="text-muted-foreground hover:text-destructive shrink-0 min-h-8 min-w-8 flex items-center justify-center"
                        aria-label="Remove nutrient"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Lighting &amp; plant</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  <div>
                    <label className="block text-xs font-medium mb-1">PPFD (µmol/m²/s)</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="10"
                      min="0"
                      max="2500"
                      value={formData.ppfd}
                      onChange={(e) => setFormData({ ...formData, ppfd: e.target.value })}
                      className={envInput}
                      placeholder="600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Photoperiod (h)</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.5"
                      min="0"
                      max="24"
                      value={formData.photoperiodHours}
                      onChange={(e) => setFormData({ ...formData, photoperiodHours: e.target.value })}
                      className={envInput}
                      placeholder="18"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Lamp distance (cm)</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="1"
                      min="5"
                      max="300"
                      value={formData.lampDistanceCm}
                      onChange={(e) => setFormData({ ...formData, lampDistanceCm: e.target.value })}
                      className={envInput}
                      placeholder="45"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Height (cm)</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.5"
                      min="0"
                      value={formData.heightCm}
                      onChange={(e) => setFormData({ ...formData, heightCm: e.target.value })}
                      className={envInput}
                      placeholder="45"
                    />
                  </div>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Feeding Notes</label>
                  <textarea
                    value={formData.feeding}
                    onChange={(e) => setFormData({ ...formData, feeding: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-border/70 bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none text-sm"
                    placeholder="Nutrients, feeding schedule..."
                    rows={2}
                  />
                  {/* Continuity, not automation — the previous note is offered
                      explicitly and only fills the field on click. */}
                  {lastFeeding && formData.feeding.trim() !== lastFeeding && (
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, feeding: lastFeeding })}
                      title={lastFeeding}
                      className="mt-1 text-xs text-primary hover:underline text-left"
                    >
                      Use previous feeding note{lastFeeding.length > 60 ? `: “${lastFeeding.slice(0, 60)}…”` : `: “${lastFeeding}”`}
                    </button>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Training Notes</label>
                  <textarea
                    value={formData.training}
                    onChange={(e) => setFormData({ ...formData, training: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-border/70 bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none text-sm"
                    placeholder="LST, topping, defoliation..."
                    rows={2}
                  />
                </div>
              </div>
            </div>
          </details>

          {error && (
            <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Sticky so the submit button stays reachable in the long form */}
          <div className="flex justify-end gap-2 sticky z-30 bottom-0 -mx-4 sm:-mx-6 -mb-4 sm:-mb-6 px-4 sm:px-6 py-3 bg-card border-t border-border rounded-b-lg">
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="px-4 py-2 border border-border rounded-lg hover:bg-secondary transition-colors text-sm min-h-11"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="bg-primary text-primary-foreground px-4 py-2 rounded-full hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center gap-2 min-h-11"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Adding...
                </>
              ) : (
                "Add Update"
              )}
            </button>
          </div>
        </form>
      )}
        </div>
      </div>
    </div>
  )
}
