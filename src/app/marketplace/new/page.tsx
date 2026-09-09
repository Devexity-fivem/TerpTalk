"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import Link from "next/link"
import { Loader2, Package, ArrowLeft } from "lucide-react"

const CATEGORIES = ["EQUIPMENT", "SEEDS", "NUTRIENTS", "CLOTHING", "GEAR", "OTHER"]
const CONDITIONS = ["NEW", "LIKE_NEW", "GOOD", "FAIR", "PARTS"]

export default function NewListingPage() {
  const { status } = useSession()
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [form, setForm] = useState({
    title: "",
    description: "",
    price: "",
    condition: "",
    location: "",
    category: "EQUIPMENT",
    images: [""],
  })

  if (status === "unauthenticated") {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-xl font-bold mb-2">Sign in to list an item</h1>
          <Link href="/auth/signin" className="text-primary hover:underline">Sign in</Link>
        </div>
      </div>
    )
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")
    const price = form.price.trim() ? parseFloat(form.price) : null
    const images = form.images.filter((url) => url.trim().startsWith("https://"))
    const res = await fetch("/api/listings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.title,
        description: form.description,
        price,
        condition: form.condition || null,
        location: form.location || null,
        category: form.category,
        images,
      }),
    })
    setLoading(false)
    if (res.ok) {
      const d = await res.json()
      router.push(`/marketplace/${d.listing.id}`)
    } else {
      const d = await res.json().catch(() => ({}))
      setError(d.error || "Failed to create listing")
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Link href="/marketplace" className="text-sm text-primary hover:underline flex items-center gap-1 mb-4"><ArrowLeft className="w-4 h-4" /> Marketplace</Link>
        <h1 className="text-2xl font-bold mb-6 flex items-center gap-2"><Package className="w-6 h-6 text-primary" /> List an Item</h1>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Title *</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={150} required className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Category *</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary">
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Condition</label>
              <select value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })} className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary">
                <option value="">—</option>
                {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Price (USD)</label>
              <input type="number" step="0.01" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary" placeholder="Leave blank for trade/obo" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Location</label>
              <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} maxLength={100} className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description *</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={8} minLength={20} maxLength={5000} required className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-y" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Images (https:// URLs, one per line, max 5)</label>
            <textarea value={form.images.join("\n")} onChange={(e) => setForm({ ...form, images: e.target.value.split("\n") })} rows={4} className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-y font-mono text-sm" />
          </div>
          {error && <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-lg text-sm">{error}</div>}
          <button type="submit" disabled={loading} className="w-full bg-primary text-primary-foreground py-3 rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "List Item"}
          </button>
        </form>
      </div>
    </div>
  )
}
