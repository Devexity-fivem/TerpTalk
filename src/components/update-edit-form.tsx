"use client"

// Inline DiaryUpdate editor + owner affordance. Renders the read-only update
// card; when the owner clicks the pencil the card body swaps to an edit form
// preloaded with the current values. The server remains the authorization
// boundary — the pencil visibility is only a UI convenience.

import { useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Pencil, Loader2, X, Plus, Camera, ImagePlus, FlaskConical } from "lucide-react"
import { useToast } from "@/components/ui/toast"
import { STAGE_TIPS } from "@/lib/stage-tips"
import { resizeImage } from "@/components/update-form"
import ImageGallery from "@/components/image-gallery"
import OwnerDeleteButton from "@/components/owner-delete-button"
import Tooltip from "@/components/ui/tooltip"

export interface EditableUpdate {
  id: string
  authorId: string
  title: string
  content: string
  stage: string
  temperature: number | null
  humidity: number | null
  vpd: number | null
  ph: number | null
  ec: number | null
  heightCm: number | null
  nightTemperature: number | null
  substrateTemperature: number | null
  co2Ppm: number | null
  wateringLiters: number | null
  ppfd: number | null
  photoperiodHours: number | null
  runoffPh: number | null
  runoffEc: number | null
  lampDistanceCm: number | null
  feeding: string | null
  training: string | null
  /** Structured nutrient rows. Undefined = the query didn't load them —
   *  the edit form then omits `nutrients` from PATCH rather than sending
   *  an empty array that would wipe rows it never saw. */
  nutrients?: { id: string; productName: string; doseMlPerL: number | null }[]
  images: { id: string; url: string; caption: string | null }[]
  /** linked experiment — this update is follow-up evidence for it */
  experiment?: { id: string; title: string } | null
}

interface UpdateEditSectionProps {
  update: EditableUpdate
  /** Day number derived server-side from createdAt + startDate. */
  day: number
  dateLabel: string
  /** updatedAt - createdAt > 60s — informational "edited" marker. */
  edited: boolean
}

const num = (v: number | null) => (v == null ? "" : String(v))

export default function UpdateEditSection({ update, day, dateLabel, edited }: UpdateEditSectionProps) {
  const { data: session } = useSession()
  const router = useRouter()
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [kept, setKept] = useState(update.images)
  const [newPhotos, setNewPhotos] = useState<string[]>([])
  const [formData, setFormData] = useState({
    title: update.title,
    content: update.content,
    stage: update.stage,
    temperature: num(update.temperature),
    humidity: num(update.humidity),
    vpd: num(update.vpd),
    ph: num(update.ph),
    ec: num(update.ec),
    heightCm: num(update.heightCm),
    nightTemperature: num(update.nightTemperature),
    substrateTemperature: num(update.substrateTemperature),
    co2Ppm: num(update.co2Ppm),
    wateringLiters: num(update.wateringLiters),
    ppfd: num(update.ppfd),
    photoperiodHours: num(update.photoperiodHours),
    runoffPh: num(update.runoffPh),
    runoffEc: num(update.runoffEc),
    lampDistanceCm: num(update.lampDistanceCm),
    feeding: update.feeding ?? "",
    training: update.training ?? "",
  })
  const [nutrientRows, setNutrientRows] = useState<{ productName: string; doseMlPerL: string }[]>(
    () => (update.nutrients ?? []).map((n) => ({
      productName: n.productName,
      doseMlPerL: n.doseMlPerL != null ? String(n.doseMlPerL) : "",
    }))
  )

  const isOwner = session?.user?.id === update.authorId

  const addPhotoFiles = async (files: FileList | null) => {
    if (!files) return
    for (const f of Array.from(files)) {
      if (kept.length + newPhotos.length >= 4) break
      if (f.size > 10 * 1024 * 1024) { setError("Image must be under 10MB"); continue }
      try {
        const resized = await resizeImage(f)
        setNewPhotos((prev) => (prev.length < 4 ? [...prev, resized] : prev))
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
    setLoading(true)
    try {
      const response = await fetch("/api/diaries/updates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: update.id,
          ...formData,
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
          // Full-replacement semantics — only sent when rows were loaded,
          // so a form that never saw nutrients can't wipe them.
          ...(update.nutrients !== undefined && {
            nutrients: nutrientRows
              .filter((r) => r.productName.trim() || r.doseMlPerL !== "")
              .map((r) => ({
                productName: r.productName,
                doseMlPerL: r.doseMlPerL !== "" ? parseFloat(r.doseMlPerL) : null,
              })),
          }),
          keepImageIds: kept.map((i) => i.id),
          images: newPhotos,
        }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to save changes")
      }
      toast("Update saved", "success")
      setEditing(false)
      setNewPhotos([])
      router.refresh()
    } catch (error: unknown) {
      setError((error as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const envInput = "w-full px-2 py-2 sm:py-1 rounded border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary text-xs min-h-9"

  // Derive visual event type chips from the update data
  const eventChips: { label: string; color: string }[] = []
  if (update.images.length > 0) eventChips.push({ label: "Photo", color: "text-primary bg-primary/10" })
  if (update.heightCm != null || update.temperature != null || update.humidity != null || update.ph != null || update.ec != null ||
      update.nightTemperature != null || update.substrateTemperature != null || update.co2Ppm != null ||
      update.wateringLiters != null || update.ppfd != null || update.photoperiodHours != null ||
      update.runoffPh != null || update.runoffEc != null || update.lampDistanceCm != null)
    eventChips.push({ label: "Measurement", color: "text-foreground bg-secondary" })
  if (update.training) eventChips.push({ label: "Training", color: "text-warning bg-warning/10" })
  if (update.feeding) eventChips.push({ label: "Feeding", color: "text-success bg-success/10" })
  if (update.nutrients?.length) eventChips.push({ label: "Nutrients", color: "text-success bg-success/10" })

  return (
    <div className="bg-card/80 rounded-2xl border border-border/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground px-2 py-1 bg-secondary rounded">
              {update.stage}
            </span>
            <span className="text-xs text-muted-foreground px-2 py-1 bg-secondary rounded">
              Day {day}
            </span>
            {eventChips.map((chip) => (
              <span key={chip.label} className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${chip.color}`}>
                {chip.label}
              </span>
            ))}
          </div>
          {!editing && <h4 className="font-display font-semibold text-sm">{update.title}</h4>}
          {!editing && update.experiment && (
            <a
              href={`#experiment-${update.experiment.id}`}
              className="inline-flex items-center gap-1 mt-1 text-[11px] text-primary/90 hover:text-primary transition-colors"
            >
              <FlaskConical className="w-3 h-3" />
              follow-up to experiment: {update.experiment.title}
            </a>
          )}
        </div>
        <span className="text-xs text-muted-foreground flex items-center gap-2">
          {dateLabel}
          {edited && (
            <Tooltip content="Edited after posting">
              <span>· edited</span>
            </Tooltip>
          )}
          {isOwner && !editing && (
            <Tooltip content="Edit update">
              <button
                onClick={() => setEditing(true)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Edit update"
              >
                <Pencil className="w-4 h-4" />
              </button>
            </Tooltip>
          )}
          <OwnerDeleteButton
            endpoint="/api/diaries/updates"
            id={update.id}
            authorId={update.authorId}
            confirmText="Delete this update? This permanently removes the update and its photos."
            iconOnly
          />
        </span>
      </div>

      {editing ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Title *</label>
            <input
              type="text"
              required
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-border/70 bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"
            />
          </div>

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
            {STAGE_TIPS[formData.stage] && (
              <p className="text-xs text-muted-foreground mt-1.5">
                {STAGE_TIPS[formData.stage][0]}
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">What&apos;s happening? *</label>
            <textarea
              required
              value={formData.content}
              onChange={(e) => setFormData({ ...formData, content: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-border/70 bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none text-sm"
              rows={4}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Photos (up to 4)</label>
            <div className="flex items-center gap-3 flex-wrap">
              {kept.map((img) => (
                <div key={img.id} className="relative group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt="Update photo" className="w-20 h-20 object-cover rounded-lg border border-border" />
                  <button
                    type="button"
                    onClick={() => setKept(kept.filter((i) => i.id !== img.id))}
                    aria-label="Remove photo"
                    className="absolute -top-2 -right-2 w-5 h-5 bg-destructive text-destructive-foreground rounded-full text-xs flex items-center justify-center"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {newPhotos.map((p, i) => (
                <div key={`new-${i}`} className="relative group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p} alt={`New photo ${i + 1}`} className="w-20 h-20 object-cover rounded-lg border border-primary/40" />
                  <button
                    type="button"
                    onClick={() => setNewPhotos(newPhotos.filter((_, j) => j !== i))}
                    aria-label="Remove photo"
                    className="absolute -top-2 -right-2 w-5 h-5 bg-destructive text-destructive-foreground rounded-full text-xs flex items-center justify-center"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {kept.length + newPhotos.length < 4 && (
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

          <details className="border border-border rounded-lg">
            <summary className="px-4 py-3 text-sm font-medium cursor-pointer select-none text-muted-foreground">
              Environment &amp; notes (optional)
            </summary>
            <div className="px-4 pb-4 space-y-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Environment</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                  <div>
                    <label className="block text-xs font-medium mb-1">Day temp (°F)</label>
                    <input type="number" inputMode="decimal" step="0.1" value={formData.temperature}
                      onChange={(e) => setFormData({ ...formData, temperature: e.target.value })} className={envInput} placeholder="75" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Night temp (°F)</label>
                    <input type="number" inputMode="decimal" step="0.1" min="32" max="122" value={formData.nightTemperature}
                      onChange={(e) => setFormData({ ...formData, nightTemperature: e.target.value })} className={envInput} placeholder="65" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Humidity (%)</label>
                    <input type="number" inputMode="decimal" step="0.1" value={formData.humidity}
                      onChange={(e) => setFormData({ ...formData, humidity: e.target.value })} className={envInput} placeholder="50" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">VPD (kPa)</label>
                    <input type="number" inputMode="decimal" step="0.01" value={formData.vpd}
                      onChange={(e) => setFormData({ ...formData, vpd: e.target.value })} className={envInput} placeholder="1.2" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">CO₂ (ppm)</label>
                    <input type="number" inputMode="decimal" step="10" min="300" max="2500" value={formData.co2Ppm}
                      onChange={(e) => setFormData({ ...formData, co2Ppm: e.target.value })} className={envInput} placeholder="420" />
                  </div>
                </div>
              </div>

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Root zone &amp; feeding</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                  <div>
                    <label className="block text-xs font-medium mb-1">Substrate temp (°F)</label>
                    <input type="number" inputMode="decimal" step="0.1" min="32" max="122" value={formData.substrateTemperature}
                      onChange={(e) => setFormData({ ...formData, substrateTemperature: e.target.value })} className={envInput} placeholder="70" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">pH</label>
                    <input type="number" inputMode="decimal" step="0.1" value={formData.ph}
                      onChange={(e) => setFormData({ ...formData, ph: e.target.value })} className={envInput} placeholder="6.5" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">EC (mS/cm)</label>
                    <input type="number" inputMode="decimal" step="0.1" value={formData.ec}
                      onChange={(e) => setFormData({ ...formData, ec: e.target.value })} className={envInput} placeholder="1.5" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Runoff pH</label>
                    <input type="number" inputMode="decimal" step="0.1" min="3" max="10" value={formData.runoffPh}
                      onChange={(e) => setFormData({ ...formData, runoffPh: e.target.value })} className={envInput} placeholder="6.2" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Runoff EC (mS/cm)</label>
                    <input type="number" inputMode="decimal" step="0.1" min="0" max="10" value={formData.runoffEc}
                      onChange={(e) => setFormData({ ...formData, runoffEc: e.target.value })} className={envInput} placeholder="2.1" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Water (L)</label>
                    <input type="number" inputMode="decimal" step="0.1" min="0" max="50" value={formData.wateringLiters}
                      onChange={(e) => setFormData({ ...formData, wateringLiters: e.target.value })} className={envInput} placeholder="2" />
                  </div>
                </div>

                {/* Structured nutrient rows — additive to Feeding Notes. */}
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium">Nutrients</span>
                    {nutrientRows.length < 20 && (
                      <button type="button"
                        onClick={() => setNutrientRows((r) => [...r, { productName: "", doseMlPerL: "" }])}
                        className="text-xs text-primary hover:underline flex items-center gap-1 min-h-8">
                        <Plus className="w-3 h-3" /> Add nutrient
                      </button>
                    )}
                  </div>
                  {nutrientRows.map((row, i) => (
                    <div key={i} className="flex items-center gap-2 mb-1.5">
                      <input type="text" value={row.productName}
                        onChange={(e) => setNutrientRows((r) => r.map((x, j) => (j === i ? { ...x, productName: e.target.value } : x)))}
                        className={`${envInput} flex-1 min-w-0`} placeholder="Product name" maxLength={100} />
                      <input type="number" inputMode="decimal" step="0.1" min="0" max="100" value={row.doseMlPerL}
                        onChange={(e) => setNutrientRows((r) => r.map((x, j) => (j === i ? { ...x, doseMlPerL: e.target.value } : x)))}
                        className={`${envInput} w-20 shrink-0`} placeholder="Dose" />
                      <span className="text-xs text-muted-foreground shrink-0">mL/L</span>
                      <button type="button"
                        onClick={() => setNutrientRows((r) => r.filter((_, j) => j !== i))}
                        className="text-muted-foreground hover:text-destructive shrink-0 min-h-8 min-w-8 flex items-center justify-center"
                        aria-label="Remove nutrient">
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
                    <input type="number" inputMode="decimal" step="10" min="0" max="2500" value={formData.ppfd}
                      onChange={(e) => setFormData({ ...formData, ppfd: e.target.value })} className={envInput} placeholder="600" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Photoperiod (h)</label>
                    <input type="number" inputMode="decimal" step="0.5" min="0" max="24" value={formData.photoperiodHours}
                      onChange={(e) => setFormData({ ...formData, photoperiodHours: e.target.value })} className={envInput} placeholder="18" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Lamp distance (cm)</label>
                    <input type="number" inputMode="decimal" step="1" min="5" max="300" value={formData.lampDistanceCm}
                      onChange={(e) => setFormData({ ...formData, lampDistanceCm: e.target.value })} className={envInput} placeholder="45" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Height (cm)</label>
                    <input type="number" inputMode="decimal" step="0.5" min="0" value={formData.heightCm}
                      onChange={(e) => setFormData({ ...formData, heightCm: e.target.value })} className={envInput} placeholder="45" />
                  </div>
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Feeding Notes</label>
                  <textarea value={formData.feeding} rows={2}
                    onChange={(e) => setFormData({ ...formData, feeding: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-border/70 bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Training Notes</label>
                  <textarea value={formData.training} rows={2}
                    onChange={(e) => setFormData({ ...formData, training: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-border/70 bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none text-sm" />
                </div>
              </div>
            </div>
          </details>

          {error && (
            <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setEditing(false)
                setError("")
                setNewPhotos([])
                setKept(update.images)
                setNutrientRows((update.nutrients ?? []).map((n) => ({
                  productName: n.productName,
                  doseMlPerL: n.doseMlPerL != null ? String(n.doseMlPerL) : "",
                })))
              }}
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
                  Saving...
                </>
              ) : (
                "Save"
              )}
            </button>
          </div>
        </form>
      ) : (
        <>
          {update.images.length > 0 && (
            <ImageGallery images={update.images} />
          )}

          <p className="text-muted-foreground my-4 whitespace-pre-wrap break-words">{update.content}</p>

          {(update.temperature != null || update.humidity != null || update.vpd != null || update.ph != null || update.ec != null || update.heightCm != null ||
            update.nightTemperature != null || update.substrateTemperature != null || update.co2Ppm != null || update.wateringLiters != null ||
            update.ppfd != null || update.photoperiodHours != null || update.runoffPh != null || update.runoffEc != null || update.lampDistanceCm != null) && (
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 sm:gap-4 mb-4 p-4 bg-secondary/50 rounded-xl">
              {update.temperature != null && (
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">Day temp</div>
                  <div className="font-semibold">{update.temperature}°F</div>
                </div>
              )}
              {update.nightTemperature != null && (
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">Night temp</div>
                  <div className="font-semibold">{update.nightTemperature}°F</div>
                </div>
              )}
              {update.humidity != null && (
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">Humidity</div>
                  <div className="font-semibold">{update.humidity}%</div>
                </div>
              )}
              {update.vpd != null && (
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">VPD</div>
                  <div className="font-semibold">{update.vpd}</div>
                </div>
              )}
              {update.co2Ppm != null && (
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">CO₂</div>
                  <div className="font-semibold">{update.co2Ppm}ppm</div>
                </div>
              )}
              {update.substrateTemperature != null && (
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">Substrate</div>
                  <div className="font-semibold">{update.substrateTemperature}°F</div>
                </div>
              )}
              {update.ph != null && (
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">pH</div>
                  <div className="font-semibold">{update.ph}</div>
                </div>
              )}
              {update.ec != null && (
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">EC</div>
                  <div className="font-semibold">{update.ec}</div>
                </div>
              )}
              {update.runoffPh != null && (
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">Runoff pH</div>
                  <div className="font-semibold">{update.runoffPh}</div>
                </div>
              )}
              {update.runoffEc != null && (
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">Runoff EC</div>
                  <div className="font-semibold">{update.runoffEc}</div>
                </div>
              )}
              {update.wateringLiters != null && (
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">Water</div>
                  <div className="font-semibold">{update.wateringLiters}L</div>
                </div>
              )}
              {update.ppfd != null && (
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">PPFD</div>
                  <div className="font-semibold">{update.ppfd}</div>
                </div>
              )}
              {update.photoperiodHours != null && (
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">Photoperiod</div>
                  <div className="font-semibold">{update.photoperiodHours}h</div>
                </div>
              )}
              {update.lampDistanceCm != null && (
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">Lamp dist.</div>
                  <div className="font-semibold">{update.lampDistanceCm}cm</div>
                </div>
              )}
              {update.heightCm != null && (
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">Height</div>
                  <div className="font-semibold">{update.heightCm}cm</div>
                </div>
              )}
            </div>
          )}

          {(update.feeding || update.training) && (
            <div className="space-y-2 mb-4">
              {update.feeding && (
                <div>
                  <span className="text-sm text-muted-foreground">Feeding:</span>
                  <p className="text-sm">{update.feeding}</p>
                </div>
              )}
              {update.training && (
                <div>
                  <span className="text-sm text-muted-foreground">Training:</span>
                  <p className="text-sm">{update.training}</p>
                </div>
              )}
            </div>
          )}

          {update.nutrients && update.nutrients.length > 0 && (
            <div className="mb-4">
              <span className="text-sm text-muted-foreground">Nutrients:</span>
              <ul className="text-sm space-y-0.5">
                {update.nutrients.map((n) => (
                  <li key={n.id}>
                    {n.productName}{n.doseMlPerL != null ? ` — ${n.doseMlPerL} mL/L` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}
