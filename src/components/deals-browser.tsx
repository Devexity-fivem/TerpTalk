"use client"

import { useState } from "react"
import { Search, Tag, ExternalLink, Sprout, Wrench } from "lucide-react"

interface Deal {
  slug: string
  name: string
  description: string
  category: string
  section: "clones" | "equipment"
  imageUrl: string | null
  price: string | null
  recommendedFor: string | null
  featured: boolean
  promoCode: string | null
  partnerName: string
}

const SECTIONS = [
  { id: "all", label: "All" },
  { id: "clones", label: "Clones & Genetics", icon: Sprout },
  { id: "equipment", label: "Grow Equipment", icon: Wrench },
] as const

function DealCard({ p }: { p: Deal }) {
  return (
    <div className="tt-spotlight bg-card/80 border border-border/70 rounded-2xl p-4 flex flex-col transition-colors hover:border-primary/40">
      {p.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.imageUrl} alt={p.name} loading="lazy" decoding="async" className="w-full aspect-video object-cover rounded-lg mb-3" />
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="font-display font-semibold text-sm">{p.name}</h3>
        {p.featured && <span className="text-[10px] bg-amber-500/15 text-warning px-1.5 py-0.5 rounded font-semibold">Featured</span>}
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
          className="inline-flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground rounded-full text-xs font-semibold hover:bg-primary/90"
        >
          Shop <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  )
}

export default function DealsBrowser({ products }: { products: Deal[] }) {
  const [q, setQ] = useState("")
  const [section, setSection] = useState<"all" | "clones" | "equipment">("all")
  const [cat, setCat] = useState("all")

  const inSection = section === "all" ? products : products.filter((p) => p.section === section)
  const categories = ["all", ...new Set(inSection.map((p) => p.category))]

  const filtered = inSection.filter((p) => {
    const matchCat = cat === "all" || p.category === cat
    const matchQ = !q || `${p.name} ${p.description} ${p.partnerName}`.toLowerCase().includes(q.toLowerCase())
    return matchCat && matchQ
  })

  // On "All", group under section headers so clones never mix with equipment.
  const groups: [string | null, Deal[]][] =
    section === "all"
      ? [
          ["Clones & Genetics", filtered.filter((p) => p.section === "clones")],
          ["Grow Equipment", filtered.filter((p) => p.section === "equipment")],
        ]
      : [[null, filtered]]

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search products..."
            className="w-full pl-9 pr-3 py-2 rounded-2xl border border-border/70 bg-card/80 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => { setSection(s.id); setCat("all") }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${section === s.id ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-secondary/80"}`}
            >
              {"icon" in s && <s.icon className="w-3.5 h-3.5" />}
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap mb-6">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${cat === c ? "bg-primary/80 text-primary-foreground" : "bg-secondary/70 hover:bg-secondary"}`}
          >
            {c === "all" ? "All categories" : c}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-center text-muted-foreground py-10 text-sm">No products match.</p>
      ) : (
        groups.map(([label, items]) =>
          items.length === 0 ? null : (
            <div key={label ?? "all"}>
              {label && (
                <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 mt-2 first:mt-0">
                  {label} <span className="text-muted-foreground/60 font-normal">({items.length})</span>
                </h2>
              )}
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                {items.map((p) => <DealCard key={p.slug} p={p} />)}
              </div>
            </div>
          )
        )
      )}
    </div>
  )
}
