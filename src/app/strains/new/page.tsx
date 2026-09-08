"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Leaf, Loader2 } from "lucide-react"
import Link from "next/link"

export default function NewStrainPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [formData, setFormData] = useState({
    name: "",
    genetics: "",
    breeder: "",
    type: "",
    description: "",
    growingInfo: "",
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

    if (!formData.name.trim()) {
      setError("Please enter a strain name")
      return
    }

    setLoading(true)

    try {
      const response = await fetch("/api/strains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to create strain")
      }

      const data = await response.json()
      router.push(`/strains/${data.strain.id}`)
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
          <Link href="/strains" className="text-sm text-muted-foreground hover:text-foreground mb-2 block">
            ← Back to Strains
          </Link>
          <h1 className="text-3xl font-bold mb-2">Add New Strain</h1>
          <p className="text-muted-foreground">Contribute to our community strain database</p>
        </div>

        {/* Form */}
        <div className="bg-card rounded-lg border border-border p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="name" className="block text-sm font-medium mb-2">
                Strain Name *
              </label>
              <input
                id="name"
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="e.g., Blue Dream, OG Kush"
                maxLength={100}
              />
            </div>

            <div className="grid md:grid-cols-2 gap-4">
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
                  placeholder="e.g., Blueberry x Haze"
                />
              </div>

              <div>
                <label htmlFor="breeder" className="block text-sm font-medium mb-2">
                  Breeder
                </label>
                <input
                  id="breeder"
                  type="text"
                  value={formData.breeder}
                  onChange={(e) => setFormData({ ...formData, breeder: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="e.g., DJ Short, Barney's Farm"
                />
              </div>
            </div>

            <div>
              <label htmlFor="type" className="block text-sm font-medium mb-2">
                Type
              </label>
              <select
                id="type"
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Select type</option>
                <option value="Sativa">Sativa</option>
                <option value="Indica">Indica</option>
                <option value="Hybrid">Hybrid</option>
                <option value="Ruderalis">Ruderalis</option>
              </select>
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
                placeholder="Describe the strain's effects, aroma, and characteristics..."
                rows={4}
              />
            </div>

            <div>
              <label htmlFor="growingInfo" className="block text-sm font-medium mb-2">
                Growing Information
              </label>
              <textarea
                id="growingInfo"
                value={formData.growingInfo}
                onChange={(e) => setFormData({ ...formData, growingInfo: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                placeholder="Flowering time, yield information, growing difficulty, etc."
                rows={4}
              />
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
                    Adding strain...
                  </>
                ) : (
                  <>
                    <Leaf className="w-4 h-4" />
                    Add Strain
                  </>
                )}
              </button>
              <Link
                href="/strains"
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
