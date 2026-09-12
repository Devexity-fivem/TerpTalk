"use client"

import { signInHref } from "@/lib/callback-url"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Leaf, Loader2 } from "lucide-react"
import Link from "next/link"

export default function NewDiaryPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    strain: "",
    genetics: "",
    growType: "INDOOR",
    startDate: "",
    medium: "",
    containerSize: "",
    lighting: "",
    nutrients: "",
    equipment: "",
    spaceDimensions: "",
  })

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (!session) {
    router.push(signInHref(window.location.pathname + window.location.search))
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!formData.title.trim() || !formData.startDate) {
      setError("Please fill in all required fields")
      return
    }

    setLoading(true)

    try {
      const response = await fetch("/api/diaries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to create diary")
      }

      const data = await response.json()
      router.push(`/diaries/${data.diary.id}`)
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
          <Link href="/diaries" className="text-sm text-muted-foreground hover:text-foreground mb-2 block">
            ← Back to Diaries
          </Link>
          <h1 className="text-3xl font-bold mb-2">Start New Grow Diary</h1>
          <p className="text-muted-foreground">Document your complete grow journey from seed to harvest</p>
        </div>

        {/* Form */}
        <div className="bg-card rounded-lg border border-border p-6">
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
                  className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
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
                  className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  placeholder="Describe your grow goals, strain, and what you hope to achieve..."
                  rows={4}
                />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="strain" className="block text-sm font-medium mb-2">
                    Strain
                  </label>
                  <input
                    id="strain"
                    type="text"
                    value={formData.strain}
                    onChange={(e) => setFormData({ ...formData, strain: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="e.g., Blue Dream, OG Kush"
                  />
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
                    className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
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
                    className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="INDOOR">Indoor</option>
                    <option value="OUTDOOR">Outdoor</option>
                    <option value="GREENHOUSE">Greenhouse</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="startDate" className="block text-sm font-medium mb-2">
                    Start Date *
                  </label>
                  <input
                    id="startDate"
                    type="date"
                    required
                    value={formData.startDate}
                    onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>
            </div>

            {/* Grow Setup */}
            <div className="space-y-4">
              <h3 className="font-semibold text-lg">Grow Setup</h3>
              
              <div className="grid md:grid-cols-2 gap-4">
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
                    placeholder="e.g., Soil, Coco, Hydroponics"
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
                    className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="e.g., 5 gallon, 10L"
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
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
                  className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
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
                  className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  placeholder="List any additional equipment like fans, filters, controllers, etc."
                  rows={3}
                />
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
                    Creating diary...
                  </>
                ) : (
                  <>
                    <Leaf className="w-4 h-4" />
                    Create Diary
                  </>
                )}
              </button>
              <Link
                href="/diaries"
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