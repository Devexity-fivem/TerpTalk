"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { usePathname, useRouter } from "next/navigation"
import { Plus, Loader2, X, Camera, ImagePlus } from "lucide-react"
import { signInHref } from "@/lib/callback-url"
import { STAGE_TIPS } from "@/lib/stage-tips"

// The API silently drops data-URIs over 400K chars — step the quality down
// until the encoded image fits instead of losing the photo.
function resizeImage(file: File, max = 800): Promise<string> {
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
  currentStage: string
  currentDay: number
  currentWeek: number
}

export default function UpdateForm({ diaryId, currentStage, currentDay, currentWeek }: UpdateFormProps) {
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
    feeding: "",
    training: "",
  })

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
      setFormData((f) => ({ ...f, title: "", content: "", feeding: "", training: "" }))
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
        onClick={() => setIsOpen(true)}
        className="bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors text-sm flex items-center gap-2 min-h-11"
      >
        <Plus className="w-4 h-4" />
        Add Update
      </button>
    )
  }

  return (
    <div className="bg-card rounded-lg border border-border p-6 mb-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold">Add New Update</h3>
        <button
          onClick={() => setIsOpen(false)}
          className="p-1 hover:bg-secondary rounded transition-colors"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {!session ? (
        <p className="text-muted-foreground">
          Please <a href={signInHref(pathname)} className="text-primary hover:underline">sign in</a> to add updates.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Title *</label>
            <input
              type="text"
              required
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"
              placeholder="e.g., Pistils forming, defoliated lower canopy"
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Stage</label>
              <select
                value={formData.stage}
                onChange={(e) => setFormData({ ...formData, stage: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"
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
            <div className="flex items-end">
              <span className="text-xs text-muted-foreground px-2 py-1.5 bg-secondary rounded">
                Day {currentDay} · Week {currentWeek} (auto)
              </span>
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
              className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none text-sm"
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
              Environment &amp; notes (optional)
            </summary>
            <div className="px-4 pb-4 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                <div>
                  <label className="block text-xs font-medium mb-1">Temp (°F)</label>
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
                  <label className="block text-xs font-medium mb-1">VPD</label>
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
                  <label className="block text-xs font-medium mb-1">EC</label>
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
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Feeding Notes</label>
                  <textarea
                    value={formData.feeding}
                    onChange={(e) => setFormData({ ...formData, feeding: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none text-sm"
                    placeholder="Nutrients, feeding schedule..."
                    rows={2}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Training Notes</label>
                  <textarea
                    value={formData.training}
                    onChange={(e) => setFormData({ ...formData, training: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none text-sm"
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

          {/* Sticky on mobile so the submit button stays reachable in the long form */}
          <div className="flex justify-end gap-2 sticky z-30 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] lg:bottom-0 -mx-6 -mb-6 px-6 py-3 bg-card border-t border-border rounded-b-lg">
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
              className="bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center gap-2 min-h-11"
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
  )
}
