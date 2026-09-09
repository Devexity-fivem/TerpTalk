"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Package, MapPin, Loader2, Search, Tag } from "lucide-react"

const CATEGORIES = [
  { value: "", label: "All" },
  { value: "EQUIPMENT", label: "Equipment" },
  { value: "SEEDS", label: "Seeds" },
  { value: "NUTRIENTS", label: "Nutrients" },
  { value: "CLOTHING", label: "Clothing" },
  { value: "GEAR", label: "Gear" },
  { value: "OTHER", label: "Other" },
]

interface Listing {
  id: string
  title: string
  price: number | null
  condition: string | null
  location: string | null
  category: string
  createdAt: string
  images: { url: string }[]
  seller: { name: string | null; profile: { username: string | null } | null }
  _count: { inquiries: number }
}

function getInitialQuery() {
  if (typeof window === "undefined") return { q: "", category: "" }
  const params = new URLSearchParams(window.location.search)
  return { q: params.get("q") || "", category: params.get("category") || "" }
}

export default function MarketplacePage() {
  const initial = getInitialQuery()
  const [listings, setListings] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState(initial.q)
  const [category, setCategory] = useState(initial.category)

  useEffect(() => {
    const url = new URL("/api/listings", window.location.origin)
    if (category) url.searchParams.set("category", category)
    if (q) url.searchParams.set("q", q)
    fetch(url.toString())
      .then((r) => (r.ok ? r.json() : { listings: [] }))
      .then((d) => { setListings(d.listings || []); setLoading(false) })
      .catch(() => { setListings([]); setLoading(false) })
  }, [category, q])

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Package className="w-6 h-6 text-primary" /> Marketplace</h1>
            <p className="text-muted-foreground text-sm">Gear, equipment, seeds, and more from the community.</p>
          </div>
          <Link href="/marketplace/new" className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
            + List Item
          </Link>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search listings..."
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="px-4 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>

        {loading && <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}

        {!loading && listings.length === 0 && (
          <p className="text-center text-muted-foreground py-12">No listings found.</p>
        )}

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {listings.map((l) => (
            <Link key={l.id} href={`/marketplace/${l.id}`} className="bg-card border border-border rounded-xl overflow-hidden hover:border-primary/50 transition-colors">
              <div className="aspect-video bg-secondary flex items-center justify-center">
                {l.images[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={l.images[0].url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Package className="w-8 h-8 text-muted-foreground" />
                )}
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h3 className="font-semibold text-sm line-clamp-2">{l.title}</h3>
                  <span className="text-xs font-medium text-primary whitespace-nowrap">{l.price !== null ? `$${l.price.toFixed(2)}` : "Trade/obo"}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Tag className="w-3 h-3" />{l.category}</span>
                  {l.condition && <span>{l.condition}</span>}
                  {l.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{l.location}</span>}
                </div>
                <p className="text-xs text-muted-foreground mt-2">by {l.seller.profile?.username || l.seller.name}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
