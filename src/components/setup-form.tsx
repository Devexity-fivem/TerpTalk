"use client"

// Shared GrowSetup form — used by both /setups/new (create) and
// /setups/[id]/edit (PATCH). Owns field state plus image state: existing
// images render as keep/remove tiles, new photos as separate tiles, and
// the combined total is capped at 6 client-side (the server re-checks).

import { useState } from "react"
import { Settings, Loader2, Camera, X } from "lucide-react"
import Link from "next/link"

export interface SetupFormValues {
  title: string
  description: string
  space: string
  tent: string
  lighting: string
  ventilation: string
  fans: string
  containers: string
  medium: string
  nutrients: string
  controllers: string
  equipment: string
  strain: string
}

export interface SetupFormImage {
  id: string
  url: string
}

export interface SetupFormSubmit {
  fields: SetupFormValues
  /** Ids of initial images still kept. Undefined when there were none. */
  keepImageIds: string[] | undefined
  newImages: string[]
}

interface SetupFormProps {
  initialValues?: Partial<SetupFormValues>
  initialImages?: SetupFormImage[]
  onSubmit: (payload: SetupFormSubmit) => Promise<void>
  submitLabel: string
  submitBusyLabel: string
  cancelHref: string
}

const EMPTY: SetupFormValues = {
  title: "",
  description: "",
  space: "",
  tent: "",
  lighting: "",
  ventilation: "",
  fans: "",
  containers: "",
  medium: "",
  nutrients: "",
  controllers: "",
  equipment: "",
  strain: "",
}

const MAX_IMAGES = 6

const fieldInput =
  "w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"

async function resizePhoto(file: File): Promise<string> {
  const img = new Image()
  const dataUrl = await new Promise<string>((resolve, reject) => {
    img.onload = () => {
      const scale = Math.min(1, 1000 / Math.max(img.width, img.height))
      const canvas = document.createElement("canvas")
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext("2d")
      if (!ctx) return reject(new Error("no canvas"))
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL("image/webp", 0.82))
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
  return dataUrl
}

export default function SetupForm({
  initialValues,
  initialImages,
  onSubmit,
  submitLabel,
  submitBusyLabel,
  cancelHref,
}: SetupFormProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [kept, setKept] = useState<SetupFormImage[]>(initialImages ?? [])
  const [photos, setPhotos] = useState<string[]>([])
  const [formData, setFormData] = useState<SetupFormValues>({ ...EMPTY, ...initialValues })

  const specField = (id: keyof SetupFormValues, label: string, placeholder: string) => (
    <div key={id}>
      <label htmlFor={id} className="block text-sm font-medium mb-2">
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={formData[id]}
        onChange={(e) => setFormData({ ...formData, [id]: e.target.value })}
        className={fieldInput}
        placeholder={placeholder}
      />
    </div>
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!formData.title.trim()) {
      setError("Please enter a title")
      return
    }

    setLoading(true)
    try {
      await onSubmit({
        fields: formData,
        keepImageIds: initialImages?.length ? kept.map((i) => i.id) : undefined,
        newImages: photos,
      })
    } catch (error: unknown) {
      setError((error as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const totalImages = kept.length + photos.length

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Basic Information */}
      <div className="space-y-4">
        <h3 className="font-display font-semibold text-lg">Basic Information</h3>

        <div>
          <label htmlFor="title" className="block text-sm font-medium mb-2">
            Setup Title *
          </label>
          <input
            id="title"
            type="text"
            required
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            className={fieldInput}
            placeholder="Give your setup a name"
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
            className={`${fieldInput} resize-none`}
            placeholder="Describe your setup, what you're growing, and your goals..."
            rows={4}
          />
        </div>

        <div>
          <label htmlFor="strain" className="block text-sm font-medium mb-2">
            Primary Strain (optional)
          </label>
          <input
            id="strain"
            type="text"
            value={formData.strain}
            onChange={(e) => setFormData({ ...formData, strain: e.target.value })}
            className={fieldInput}
            placeholder="e.g., Blue Dream, OG Kush"
            maxLength={80}
          />
        </div>
      </div>

      {/* Equipment Details */}
      <div className="space-y-4">
        <h3 className="font-display font-semibold text-lg">Equipment Details</h3>

        <div className="grid md:grid-cols-2 gap-4">
          {specField("space", "Grow Space", "e.g., 4x4 tent, 10x10 room")}
          {specField("tent", "Tent/Greenhouse", "e.g., Gorilla Grow Tent 4x4")}
          {specField("lighting", "Lighting", "e.g., LED 600W, HPS 1000W")}
          {specField("ventilation", "Ventilation", "e.g., 6 inch inline fan, carbon filter")}
          {specField("fans", "Fans", "e.g., Oscillating fans, clip-on fans")}
          {specField("containers", "Containers", "e.g., 5 gallon fabric pots, 10L smart pots")}
          {specField("medium", "Growing Medium", "e.g., Living soil, Coco coir, Hydroponics")}
          {specField("nutrients", "Nutrients", "e.g., Fox Farm, Advanced Nutrients")}
          {specField("controllers", "Environmental Controllers", "e.g., Temperature controller, humidity controller")}
        </div>

        <div>
          <label htmlFor="equipment" className="block text-sm font-medium mb-2">
            Additional Equipment
          </label>
          <textarea
            id="equipment"
            value={formData.equipment}
            onChange={(e) => setFormData({ ...formData, equipment: e.target.value })}
            className={`${fieldInput} resize-none`}
            placeholder="List any additional equipment like timers, meters, pH pens, etc."
            rows={3}
          />
        </div>
      </div>

      {/* Photos */}
      <div>
        <label className="block text-sm font-medium mb-2">Photos (up to {MAX_IMAGES})</label>
        <div className="flex items-center gap-3 flex-wrap">
          {kept.map((img) => (
            <div key={img.id} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt="Setup photo" className="w-24 h-24 object-cover rounded-lg border border-border" />
              <button
                type="button"
                onClick={() => setKept(kept.filter((i) => i.id !== img.id))}
                aria-label="Remove photo"
                className="absolute -top-2 -right-2 w-5 h-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          {photos.map((p, i) => (
            <div key={`new-${i}`} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p} alt={`New photo ${i + 1}`} className="w-24 h-24 object-cover rounded-lg border border-primary/40" />
              <button
                type="button"
                onClick={() => setPhotos(photos.filter((_, j) => j !== i))}
                aria-label="Remove photo"
                className="absolute -top-2 -right-2 w-5 h-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          {totalImages < MAX_IMAGES && (
            <label className="w-24 h-24 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-primary/50 transition-colors text-muted-foreground">
              <Camera className="w-6 h-6" />
              <span className="text-[10px]">Add photo</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  if (f.size > 10 * 1024 * 1024) { setError("Image must be under 10MB"); return }
                  try {
                    const dataUrl = await resizePhoto(f)
                    setPhotos((prev) => (prev.length < MAX_IMAGES ? [...prev, dataUrl] : prev))
                  } catch { setError("Could not process image") }
                  e.target.value = ""
                }}
              />
            </label>
          )}
        </div>
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
          className="flex-1 bg-primary text-primary-foreground py-3 rounded-full font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {submitBusyLabel}
            </>
          ) : (
            <>
              <Settings className="w-4 h-4" />
              {submitLabel}
            </>
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
