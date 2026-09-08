"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { Plus, Loader2, X, Camera } from "lucide-react"

function resizeImage(file: File, max = 800): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height))
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
}

interface UpdateFormProps {
  diaryId: string
}

export default function UpdateForm({ diaryId }: UpdateFormProps) {
  const { data: session } = useSession()
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [photos, setPhotos] = useState<string[]>([])
  const [formData, setFormData] = useState({
    title: "",
    content: "",
    dayNumber: "",
    weekNumber: "",
    stage: "VEGETATIVE",
    temperature: "",
    humidity: "",
    vpd: "",
    ph: "",
    ec: "",
    feeding: "",
    training: "",
  })

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
          dayNumber: formData.dayNumber ? parseInt(formData.dayNumber) : null,
          weekNumber: formData.weekNumber ? parseInt(formData.weekNumber) : null,
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

      // Refresh the page to show the new update
      window.location.reload()
    } catch (error: unknown) {
      setError((error as Error).message)
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors text-sm flex items-center gap-2"
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
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {!session ? (
        <p className="text-muted-foreground">
          Please <a href="/auth/signin" className="text-primary hover:underline">sign in</a> to add updates.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Title *</label>
              <input
                type="text"
                required
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                placeholder="e.g., Day 30 - Flowering begins"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Day Number</label>
              <input
                type="number"
                value={formData.dayNumber}
                onChange={(e) => setFormData({ ...formData, dayNumber: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                placeholder="e.g., 30"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Week Number</label>
              <input
                type="number"
                value={formData.weekNumber}
                onChange={(e) => setFormData({ ...formData, weekNumber: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                placeholder="e.g., 4"
              />
            </div>
          </div>

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

          <div>
            <label className="block text-sm font-medium mb-1">Content *</label>
            <textarea
              required
              value={formData.content}
              onChange={(e) => setFormData({ ...formData, content: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none text-sm"
              placeholder="Describe what's happening with your plants..."
              rows={4}
            />
          </div>

          <div className="grid grid-cols-5 gap-2">
            <div>
              <label className="block text-xs font-medium mb-1">Temp (°F)</label>
              <input
                type="number"
                step="0.1"
                value={formData.temperature}
                onChange={(e) => setFormData({ ...formData, temperature: e.target.value })}
                className="w-full px-2 py-1 rounded border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary text-xs"
                placeholder="75"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Humidity (%)</label>
              <input
                type="number"
                step="0.1"
                value={formData.humidity}
                onChange={(e) => setFormData({ ...formData, humidity: e.target.value })}
                className="w-full px-2 py-1 rounded border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary text-xs"
                placeholder="50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">VPD</label>
              <input
                type="number"
                step="0.01"
                value={formData.vpd}
                onChange={(e) => setFormData({ ...formData, vpd: e.target.value })}
                className="w-full px-2 py-1 rounded border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary text-xs"
                placeholder="1.2"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">pH</label>
              <input
                type="number"
                step="0.1"
                value={formData.ph}
                onChange={(e) => setFormData({ ...formData, ph: e.target.value })}
                className="w-full px-2 py-1 rounded border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary text-xs"
                placeholder="6.5"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">EC</label>
              <input
                type="number"
                step="0.1"
                value={formData.ec}
                onChange={(e) => setFormData({ ...formData, ec: e.target.value })}
                className="w-full px-2 py-1 rounded border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary text-xs"
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

          {/* Photos */}
          <div>
            <label className="block text-sm font-medium mb-1">Photos (up to 4)</label>
            <div className="flex items-center gap-3 flex-wrap">
              {photos.map((p, i) => (
                <div key={i} className="relative group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p} alt="" className="w-20 h-20 object-cover rounded-lg border border-border" />
                  <button
                    type="button"
                    onClick={() => setPhotos(photos.filter((_, j) => j !== i))}
                    className="absolute -top-2 -right-2 w-5 h-5 bg-destructive text-destructive-foreground rounded-full text-xs flex items-center justify-center"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {photos.length < 4 && (
                <label className="w-20 h-20 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-primary/50 transition-colors text-muted-foreground">
                  <Camera className="w-5 h-5" />
                  <span className="text-[10px]">Add</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0]
                      if (!f) return
                      if (f.size > 10 * 1024 * 1024) { setError("Image must be under 10MB"); return }
                      try {
                        setPhotos([...photos, await resizeImage(f)])
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

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="px-4 py-2 border border-border rounded-lg hover:bg-secondary transition-colors text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center gap-2"
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