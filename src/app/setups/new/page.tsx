"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Settings, Loader2, Camera, X } from "lucide-react"
import Link from "next/link"

export default function NewSetupPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [photos, setPhotos] = useState<string[]>([])
  const [formData, setFormData] = useState({
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
  })

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (!session) {
    router.push("/auth/signin")
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!formData.title.trim()) {
      setError("Please enter a title")
      return
    }

    setLoading(true)

    try {
      const response = await fetch("/api/setups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, images: photos }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to create setup")
      }

      const data = await response.json()
      router.push(`/setups/${data.setup.id}`)
    } catch (error: unknown) {
      setError((error as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <Link href="/setups" className="text-sm text-muted-foreground hover:text-foreground mb-2 block">
            ← Back to Setups
          </Link>
          <h1 className="text-3xl font-bold mb-2">Share Your Grow Setup</h1>
          <p className="text-muted-foreground">Show off your grow room and equipment to the community</p>
        </div>

        {/* Form */}
        <div className="bg-card rounded-lg border border-border p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Basic Information */}
            <div className="space-y-4">
              <h3 className="font-semibold text-lg">Basic Information</h3>
              
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
                  className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
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
                  className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none"
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
                  className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="e.g., Blue Dream, OG Kush"
                  maxLength={80}
                />
              </div>
            </div>

            {/* Equipment Details */}
            <div className="space-y-4">
              <h3 className="font-semibold text-lg">Equipment Details</h3>
              
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="space" className="block text-sm font-medium mb-2">
                    Grow Space
                  </label>
                  <input
                    id="space"
                    type="text"
                    value={formData.space}
                    onChange={(e) => setFormData({ ...formData, space: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="e.g., 4x4 tent, 10x10 room"
                  />
                </div>

                <div>
                  <label htmlFor="tent" className="block text-sm font-medium mb-2">
                    Tent/Greenhouse
                  </label>
                  <input
                    id="tent"
                    type="text"
                    value={formData.tent}
                    onChange={(e) => setFormData({ ...formData, tent: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="e.g., Gorilla Grow Tent 4x4"
                  />
                </div>

                <div>
                  <label htmlFor="lighting" className="block text-sm font-medium mb-2">
                    Lighting
                  </label>
                  <input
                    id="lighting"
                    type="text"
                    value={formData.lighting}
                    onChange={(e) => setFormData({ ...formData, lighting: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="e.g., LED 600W, HPS 1000W"
                  />
                </div>

                <div>
                  <label htmlFor="ventilation" className="block text-sm font-medium mb-2">
                    Ventilation
                  </label>
                  <input
                    id="ventilation"
                    type="text"
                    value={formData.ventilation}
                    onChange={(e) => setFormData({ ...formData, ventilation: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="e.g., 6 inch inline fan, carbon filter"
                  />
                </div>

                <div>
                  <label htmlFor="fans" className="block text-sm font-medium mb-2">
                    Fans
                  </label>
                  <input
                    id="fans"
                    type="text"
                    value={formData.fans}
                    onChange={(e) => setFormData({ ...formData, fans: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="e.g., Oscillating fans, clip-on fans"
                  />
                </div>

                <div>
                  <label htmlFor="containers" className="block text-sm font-medium mb-2">
                    Containers
                  </label>
                  <input
                    id="containers"
                    type="text"
                    value={formData.containers}
                    onChange={(e) => setFormData({ ...formData, containers: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="e.g., 5 gallon fabric pots, 10L smart pots"
                  />
                </div>

                <div>
                  <label htmlFor="medium" className="block text-sm font-medium mb-2">
                    Growing Medium
                  </label>
                  <input
                    id="medium"
                    type="text"
                    value={formData.medium}
                    onChange={(e) => setFormData({ ...formData, medium: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="e.g., Living soil, Coco coir, Hydroponics"
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
                    className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="e.g., Fox Farm, Advanced Nutrients"
                  />
                </div>

                <div>
                  <label htmlFor="controllers" className="block text-sm font-medium mb-2">
                    Environmental Controllers
                  </label>
                  <input
                    id="controllers"
                    type="text"
                    value={formData.controllers}
                    onChange={(e) => setFormData({ ...formData, controllers: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="e.g., Temperature controller, humidity controller"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="equipment" className="block text-sm font-medium mb-2">
                  Additional Equipment
                </label>
                <textarea
                  id="equipment"
                  value={formData.equipment}
                  onChange={(e) => setFormData({ ...formData, equipment: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  placeholder="List any additional equipment like timers, meters, pH pens, etc."
                  rows={3}
                />
              </div>
            </div>

            {/* Photos */}
            <div>
              <label className="block text-sm font-medium mb-2">Photos (up to 6)</label>
              <div className="flex items-center gap-3 flex-wrap">
                {photos.map((p, i) => (
                  <div key={i} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p} alt={`Setup photo ${i + 1}`} className="w-24 h-24 object-cover rounded-lg border border-border" />
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
                {photos.length < 6 && (
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
                            img.src = URL.createObjectURL(f)
                          })
                          setPhotos([...photos, dataUrl])
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
                className="flex-1 bg-primary text-primary-foreground py-3 rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating setup...
                  </>
                ) : (
                  <>
                    <Settings className="w-4 h-4" />
                    Share Setup
                  </>
                )}
              </button>
              <Link
                href="/setups"
                className="px-6 py-3 border border-border rounded-lg hover:bg-secondary transition-colors text-center"
              >
                Cancel
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
