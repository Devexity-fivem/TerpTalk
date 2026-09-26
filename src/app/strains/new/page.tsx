"use client"

import { signInHref } from "@/lib/callback-url"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Leaf, Loader2 } from "lucide-react"
import Link from "next/link"
import { strainPath } from "@/lib/slugs"
import {
  STRAIN_EFFECTS,
  STRAIN_EFFECT_LABELS,
  STRAIN_FLAVORS,
  STRAIN_FLAVOR_LABELS,
  STRAIN_DIFFICULTIES,
  STRAIN_DIFFICULTY_LABELS,
} from "@/lib/strain-fields"

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
    difficulty: "",
    thcMin: "",
    thcMax: "",
    floweringWeeks: "",
    seedToHarvestWeeks: "",
  })
  const [effects, setEffects] = useState<string[]>([])
  const [flavors, setFlavors] = useState<string[]>([])

  const toggle = (list: string[], setList: (v: string[]) => void, v: string) =>
    setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

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

    if (!formData.name.trim()) {
      setError("Please enter a strain name")
      return
    }

    setLoading(true)

    try {
      const response = await fetch("/api/strains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          difficulty: formData.difficulty || undefined,
          thcMin: formData.thcMin === "" ? undefined : Number(formData.thcMin),
          thcMax: formData.thcMax === "" ? undefined : Number(formData.thcMax),
          floweringWeeks:
            formData.type.toUpperCase() === "AUTO_FLOWER" || formData.floweringWeeks === ""
              ? undefined
              : Number(formData.floweringWeeks),
          seedToHarvestWeeks:
            formData.type.toUpperCase() !== "AUTO_FLOWER" || formData.seedToHarvestWeeks === ""
              ? undefined
              : Number(formData.seedToHarvestWeeks),
          effects,
          flavors,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to create strain")
      }

      const data = await response.json()
      router.push(strainPath(data.strain))
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
          <h1 className="font-display text-3xl font-bold mb-2 tracking-tight">Add New Strain</h1>
          <p className="text-muted-foreground">Contribute to our community strain database</p>
        </div>

        {/* Form */}
        <div className="bg-card/80 rounded-2xl border border-border/70 p-6">
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
                className="w-full px-4 py-2 rounded-xl border border-border/70 bg-background focus:outline-none focus:ring-2 focus:ring-primary"
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
                  className="w-full px-4 py-2 rounded-xl border border-border/70 bg-background focus:outline-none focus:ring-2 focus:ring-primary"
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
                  className="w-full px-4 py-2 rounded-xl border border-border/70 bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="e.g., DJ Short, Barney's Farm"
                />
              </div>
            </div>

            <div>
              <label htmlFor="type" className="block text-sm font-medium mb-2">
                Type <span className="text-destructive">*</span>
              </label>
              <select
                id="type"
                required
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                className="w-full px-4 py-2 rounded-xl border border-border/70 bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Select type</option>
                <option value="Sativa">Sativa</option>
                <option value="Indica">Indica</option>
                <option value="Hybrid">Hybrid</option>
                <option value="Auto_Flower">Auto-flower</option>
                <option value="CBD">CBD</option>
                <option value="Other">Other</option>
              </select>
            </div>

            {/* Catalog facets — optional, controlled vocab so the index
                can filter on real values instead of free text. */}
            <div className="grid sm:grid-cols-3 gap-4">
              <div>
                <label htmlFor="difficulty" className="block text-sm font-medium mb-2">
                  Grow difficulty
                </label>
                <select
                  id="difficulty"
                  value={formData.difficulty}
                  onChange={(e) => setFormData({ ...formData, difficulty: e.target.value })}
                  className="w-full px-4 py-2 rounded-xl border border-border/70 bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Not reported</option>
                  {STRAIN_DIFFICULTIES.map((d) => (
                    <option key={d} value={d}>{STRAIN_DIFFICULTY_LABELS[d]}</option>
                  ))}
                </select>
              </div>
              {formData.type.toUpperCase() === "AUTO_FLOWER" ? (
                <div>
                  <label htmlFor="seedToHarvestWeeks" className="block text-sm font-medium mb-2">
                    Seed to harvest (weeks)
                  </label>
                  <input
                    id="seedToHarvestWeeks"
                    type="number"
                    min={6}
                    max={24}
                    value={formData.seedToHarvestWeeks}
                    onChange={(e) => setFormData({ ...formData, seedToHarvestWeeks: e.target.value })}
                    className="w-full px-4 py-2 rounded-xl border border-border/70 bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="e.g. 10"
                  />
                </div>
              ) : (
                <div>
                  <label htmlFor="floweringWeeks" className="block text-sm font-medium mb-2">
                    Flowering (weeks, est.)
                  </label>
                  <input
                    id="floweringWeeks"
                    type="number"
                    min={4}
                    max={20}
                    value={formData.floweringWeeks}
                    onChange={(e) => setFormData({ ...formData, floweringWeeks: e.target.value })}
                    className="w-full px-4 py-2 rounded-xl border border-border/70 bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="e.g. 9"
                  />
                </div>
              )}
              <div>
                <span className="block text-sm font-medium mb-2">THC % (optional)</span>
                <div className="flex items-center gap-2">
                  <input
                    aria-label="THC minimum percent"
                    type="number"
                    min={0}
                    max={45}
                    step={0.1}
                    value={formData.thcMin}
                    onChange={(e) => setFormData({ ...formData, thcMin: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-border/70 bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="min"
                  />
                  <span className="text-muted-foreground text-xs">–</span>
                  <input
                    aria-label="THC maximum percent"
                    type="number"
                    min={0}
                    max={45}
                    step={0.1}
                    value={formData.thcMax}
                    onChange={(e) => setFormData({ ...formData, thcMax: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-border/70 bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="max"
                  />
                </div>
              </div>
            </div>

            <div>
              <span className="block text-sm font-medium mb-2">Reported effects (optional)</span>
              <div className="flex flex-wrap gap-2">
                {STRAIN_EFFECTS.map((e) => {
                  const active = effects.includes(e)
                  return (
                    <button
                      key={e}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggle(effects, setEffects, e)}
                      className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                        active ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-secondary"
                      }`}
                    >
                      {STRAIN_EFFECT_LABELS[e]}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <span className="block text-sm font-medium mb-2">Flavor profile (optional)</span>
              <div className="flex flex-wrap gap-2">
                {STRAIN_FLAVORS.map((f) => {
                  const active = flavors.includes(f)
                  return (
                    <button
                      key={f}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggle(flavors, setFlavors, f)}
                      className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                        active ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-secondary"
                      }`}
                    >
                      {STRAIN_FLAVOR_LABELS[f]}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <label htmlFor="description" className="block text-sm font-medium mb-2">
                Description
              </label>
              <textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-4 py-2 rounded-xl border border-border/70 bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none"
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
                className="w-full px-4 py-2 rounded-xl border border-border/70 bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none"
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
                className="flex-1 bg-primary text-primary-foreground py-3 rounded-full font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
