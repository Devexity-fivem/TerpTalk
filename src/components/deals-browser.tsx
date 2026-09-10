"use client"

import { useState } from "react"
import { Search, Tag, ExternalLink } from "lucide-react"

interface Deal {
  slug: string
  name: string
  description: string
  category: string
  imageUrl: string | null
  price: string | null
  recommendedFor: string | null
  featured: boolean
  promoCode: string | null
  partnerName: string
}

export default function DealsBrowser({ products }: { products: Deal[] }) {
  const [q, setQ] = useState("")
  const [cat, setCat] = useState("all")
  const categories = ["all", ...new Set(products.map((p) => p.category))]

  const filtered = products.filter((p) => {
    const matchCat = cat === "all" || p.category === cat
    const matchQ = !q || `${p.name} ${p.description} ${p.partnerName}`.toLowerCase().includes(q.toLowerCase())
    return matchCat && matchQ
  })

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search products..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${cat === c ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-secondary/80"}`}
            >
              {c === "all" ? "All" : c}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-center text-muted-foreground py-10 text-sm">No products match.</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <div key={p.slug} className="bg-card border border-border rounded-xl p-4 flex flex-col">
              {p.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.imageUrl} alt={p.name} loading="lazy" decoding="async" className="w-full aspect-video object-cover rounded-lg mb-3" />
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-sm">{p.name}</h3>
                {p.featured && <span className="text-[10px] bg-amber-500/15 text-amber-500 px-1.5 py-0.5 rounded font-semibold">Featured</span>}
              </div>
              <p className="text-xs text-muted-foreground mt-1 flex-1">{p.description}</p>
              {p.recommendedFor && <p className="text-[11px] text-muted-foreground mt-1">For: {p.recommendedFor}</p>}
              <div className="flex items-center justify-between mt-3 gap-2">
                <div className="flex items-center gap-2">
                  {p.price && <span className="text-sm font-bold">{p.price}</span>}
                  {p.promoCode && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold bg-primary/15 text-primary px-2 py-0.5 rounded">
                      <Tag className="w-3 h-3" /> {p.promoCode}
                    </span>
                  )}
                </div>
                <a
                  href={`/go/${p.slug}?from=/deals`}
                  rel="sponsored nofollow"
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:bg-primary/90"
                >
                  Shop <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
