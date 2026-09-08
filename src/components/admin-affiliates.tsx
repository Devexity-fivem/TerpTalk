"use client"

import { useEffect, useState } from "react"
import { Plus, Loader2, Tag, ExternalLink, Star, StarOff, Pencil, Trash2 } from "lucide-react"

interface Partner {
  id: string; name: string; slug: string; websiteUrl: string; affiliateUrl: string; promoCode: string | null
  description: string; promoText: string | null; active: boolean; featured: boolean
  _count: { products: number; clicks: number }
}
interface Product {
  id: string; name: string; slug: string; category: string; price: string | null
  promoCode: string | null; active: boolean; featured: boolean
  partner: { name: string }; _count: { clicks: number }
}
interface Stats {
  total: number
  byPartner: { name: string; clicks: number }[]
  byProduct: { name: string; clicks: number }[]
  byPage: { page: string; clicks: number }[]
  byDay: { day: string; clicks: number }[]
}

const inputCls = "w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"

export default function AdminAffiliates() {
  const [partners, setPartners] = useState<Partner[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [disclosure, setDisclosure] = useState("")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState("")

  const [partnerForm, setPartnerForm] = useState({ name: "", websiteUrl: "", affiliateUrl: "", promoCode: "", description: "", promoText: "", featured: false })
  const [productForm, setProductForm] = useState({ name: "", partnerId: "", category: "Growing Equipment", description: "", affiliateUrl: "", productUrl: "", imageUrl: "", price: "", promoCode: "", recommendedFor: "", pros: "", cons: "", featured: false })
  const [editPartner, setEditPartner] = useState<string | null>(null)
  const [editProduct, setEditProduct] = useState<string | null>(null)

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 3000) }

  const load = () => Promise.all([
    fetch("/api/admin/affiliates/partners").then((r) => r.json()),
    fetch("/api/admin/affiliates/products").then((r) => r.json()),
    fetch("/api/admin/affiliates/stats").then((r) => r.json()),
  ]).then(([p, pr, s]) => {
    setPartners(p.partners || [])
    setDisclosure(p.disclosure || "")
    setProducts(pr.products || [])
    setStats(s)
    setLoading(false)
  }).catch(() => setLoading(false))

  useEffect(() => { load() }, [])

  const savePartner = async () => {
    setBusy(true)
    const method = editPartner ? "PATCH" : "POST"
    const res = await fetch("/api/admin/affiliates/partners", {
      method, headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editPartner ? { id: editPartner, ...partnerForm } : { type: "partner", ...partnerForm }),
    })
    if (res.ok) {
      setPartnerForm({ name: "", websiteUrl: "", affiliateUrl: "", promoCode: "", description: "", promoText: "", featured: false })
      setEditPartner(null)
      load(); flash(editPartner ? "Partner updated" : "Partner created")
    } else flash((await res.json()).error || "Failed")
    setBusy(false)
  }

  const saveProduct = async () => {
    setBusy(true)
    const method = editProduct ? "PATCH" : "POST"
    const res = await fetch("/api/admin/affiliates/products", {
      method, headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editProduct ? { id: editProduct, ...productForm } : productForm),
    })
    if (res.ok) {
      setProductForm({ name: "", partnerId: "", category: "Growing Equipment", description: "", affiliateUrl: "", productUrl: "", imageUrl: "", price: "", promoCode: "", recommendedFor: "", pros: "", cons: "", featured: false })
      setEditProduct(null)
      load(); flash(editProduct ? "Product updated" : "Product created")
    } else flash((await res.json()).error || "Failed")
    setBusy(false)
  }

  const patchPartner = (id: string, fields: Partial<Partner>) =>
    fetch("/api/admin/affiliates/partners", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...fields }) }).then(load)
  const patchProduct = (id: string, fields: Partial<Product>) =>
    fetch("/api/admin/affiliates/products", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...fields }) }).then(load)

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>

  return (
    <div className="space-y-8">
      {msg && <div className="bg-primary/15 text-primary px-4 py-2 rounded-lg text-sm">{msg}</div>}

      {/* Disclosure */}
      <div className="bg-card rounded-xl border border-border p-5">
        <h2 className="font-semibold mb-2">Affiliate Disclosure</h2>
        <div className="flex gap-2">
          <input value={disclosure} onChange={(e) => setDisclosure(e.target.value)} className={inputCls} />
          <button
            onClick={async () => {
              const res = await fetch("/api/admin/affiliates/partners", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "disclosure", value: disclosure }) })
              flash(res.ok ? "Disclosure saved" : "Failed")
            }}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm shrink-0"
          >Save</button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="bg-card rounded-xl border border-border p-5">
          <h2 className="font-semibold mb-3">Click Analytics — {stats.total} total</h2>
          <div className="grid md:grid-cols-3 gap-4 text-sm">
            <div>
              <h3 className="text-xs text-muted-foreground mb-1">By partner</h3>
              {stats.byPartner.map((b) => <div key={b.name} className="flex justify-between"><span>{b.name}</span><b>{b.clicks}</b></div>)}
              {!stats.byPartner.length && <p className="text-muted-foreground text-xs">No clicks yet</p>}
            </div>
            <div>
              <h3 className="text-xs text-muted-foreground mb-1">Top products</h3>
              {stats.byProduct.slice(0, 5).map((b) => <div key={b.name} className="flex justify-between"><span className="truncate">{b.name}</span><b>{b.clicks}</b></div>)}
              {!stats.byProduct.length && <p className="text-muted-foreground text-xs">No clicks yet</p>}
            </div>
            <div>
              <h3 className="text-xs text-muted-foreground mb-1">Top pages</h3>
              {stats.byPage.slice(0, 5).map((b) => <div key={b.page} className="flex justify-between"><span className="truncate">{b.page}</span><b>{b.clicks}</b></div>)}
              {!stats.byPage.length && <p className="text-muted-foreground text-xs">No clicks yet</p>}
            </div>
          </div>
        </div>
      )}

      {/* Partners */}
      <div className="bg-card rounded-xl border border-border p-5">
        <h2 className="font-semibold mb-4">Partners ({partners.length})</h2>
        <div className="space-y-3 mb-5">
          {partners.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 border border-border rounded-lg p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{p.name}</span>
                  {p.promoCode && <span className="text-xs bg-primary/15 text-primary px-1.5 py-0.5 rounded font-bold">{p.promoCode}</span>}
                  {p.featured && <Star className="w-3.5 h-3.5 text-amber-500" />}
                  {!p.active && <span className="text-[10px] bg-destructive/15 text-destructive px-1.5 rounded">inactive</span>}
                </div>
                <p className="text-xs text-muted-foreground truncate">{p.affiliateUrl}</p>
                <p className="text-[10px] text-muted-foreground">{p._count.products} products · {p._count.clicks} clicks · slug: {p.slug}</p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button onClick={() => patchPartner(p.id, { featured: !p.featured })} className="p-1.5 rounded hover:bg-secondary" title="Toggle featured">
                  {p.featured ? <StarOff className="w-4 h-4 text-amber-500" /> : <Star className="w-4 h-4" />}
                </button>
                <button onClick={() => { setEditPartner(p.id); setPartnerForm({ name: p.name, websiteUrl: p.websiteUrl, affiliateUrl: p.affiliateUrl, promoCode: p.promoCode || "", description: p.description, promoText: p.promoText || "", featured: p.featured }) }} className="p-1.5 rounded hover:bg-secondary"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => patchPartner(p.id, { active: !p.active })} className="px-2 py-1 text-xs rounded bg-secondary hover:bg-secondary/80">{p.active ? "Disable" : "Enable"}</button>
                <button onClick={() => confirm(`Delete ${p.name} and all its products?`) && fetch(`/api/admin/affiliates/partners?id=${p.id}`, { method: "DELETE" }).then(load)} className="p-1.5 rounded hover:bg-destructive/15 text-destructive"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>

        <h3 className="text-sm font-semibold mb-3">{editPartner ? "Edit partner" : "Add partner"}</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <input placeholder="Partner name" value={partnerForm.name} onChange={(e) => setPartnerForm({ ...partnerForm, name: e.target.value })} className={inputCls} />
          <input placeholder="Website URL" value={partnerForm.websiteUrl} onChange={(e) => setPartnerForm({ ...partnerForm, websiteUrl: e.target.value })} className={inputCls} />
          <input placeholder="Default affiliate URL" value={partnerForm.affiliateUrl} onChange={(e) => setPartnerForm({ ...partnerForm, affiliateUrl: e.target.value })} className={`${inputCls} sm:col-span-2`} />
          <input placeholder="Promo code (e.g. TCK)" value={partnerForm.promoCode} onChange={(e) => setPartnerForm({ ...partnerForm, promoCode: e.target.value })} className={inputCls} />
          <input placeholder="Current promo text (e.g. 15% off lights)" value={partnerForm.promoText} onChange={(e) => setPartnerForm({ ...partnerForm, promoText: e.target.value })} className={inputCls} />
          <textarea placeholder="Description" value={partnerForm.description} onChange={(e) => setPartnerForm({ ...partnerForm, description: e.target.value })} rows={2} className={`${inputCls} sm:col-span-2`} />
        </div>
        <div className="flex items-center gap-3 mt-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={partnerForm.featured} onChange={(e) => setPartnerForm({ ...partnerForm, featured: e.target.checked })} /> Featured</label>
          <button onClick={savePartner} disabled={busy} className="ml-auto px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm flex items-center gap-1.5 disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} {editPartner ? "Save changes" : "Add partner"}
          </button>
          {editPartner && <button onClick={() => setEditPartner(null)} className="text-xs text-muted-foreground">Cancel</button>}
        </div>
      </div>

      {/* Products */}
      <div className="bg-card rounded-xl border border-border p-5">
        <h2 className="font-semibold mb-4">Products ({products.length})</h2>
        <div className="space-y-3 mb-5">
          {products.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 border border-border rounded-lg p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{p.name}</span>
                  <span className="text-xs text-muted-foreground">{p.partner.name}</span>
                  {p.promoCode && <span className="text-xs bg-primary/15 text-primary px-1.5 py-0.5 rounded font-bold"><Tag className="w-3 h-3 inline" /> {p.promoCode}</span>}
                  {!p.active && <span className="text-[10px] bg-destructive/15 text-destructive px-1.5 rounded">inactive</span>}
                </div>
                <p className="text-[10px] text-muted-foreground">{p.category} · {p._count.clicks} clicks · slug: {p.slug} · shortcode: [affiliate_product id=&quot;{p.slug}&quot;]</p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <a href={`/go/${p.slug}`} target="_blank" rel="noreferrer" className="p-1.5 rounded hover:bg-secondary" title="Test link"><ExternalLink className="w-4 h-4" /></a>
                <button onClick={() => patchProduct(p.id, { active: !p.active })} className="px-2 py-1 text-xs rounded bg-secondary hover:bg-secondary/80">{p.active ? "Disable" : "Enable"}</button>
                <button onClick={() => confirm(`Delete ${p.name}?`) && fetch(`/api/admin/affiliates/products?id=${p.id}`, { method: "DELETE" }).then(load)} className="p-1.5 rounded hover:bg-destructive/15 text-destructive"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>

        <h3 className="text-sm font-semibold mb-3">{editProduct ? "Edit product" : "Add product"}</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <input placeholder="Product name" value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} className={inputCls} />
          <select value={productForm.partnerId} onChange={(e) => setProductForm({ ...productForm, partnerId: e.target.value })} className={inputCls}>
            <option value="">Select partner…</option>
            {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input placeholder="Category (e.g. Grow Lights)" value={productForm.category} onChange={(e) => setProductForm({ ...productForm, category: e.target.value })} className={inputCls} />
          <input placeholder="Price (optional)" value={productForm.price} onChange={(e) => setProductForm({ ...productForm, price: e.target.value })} className={inputCls} />
          <input placeholder="Affiliate URL (optional — falls back to partner)" value={productForm.affiliateUrl} onChange={(e) => setProductForm({ ...productForm, affiliateUrl: e.target.value })} className={`${inputCls} sm:col-span-2`} />
          <input placeholder="Image URL" value={productForm.imageUrl} onChange={(e) => setProductForm({ ...productForm, imageUrl: e.target.value })} className={inputCls} />
          <input placeholder="Promo code override (optional)" value={productForm.promoCode} onChange={(e) => setProductForm({ ...productForm, promoCode: e.target.value })} className={inputCls} />
          <textarea placeholder="Description" value={productForm.description} onChange={(e) => setProductForm({ ...productForm, description: e.target.value })} rows={2} className={`${inputCls} sm:col-span-2`} />
          <input placeholder="Recommended for (e.g. 2x2 tents)" value={productForm.recommendedFor} onChange={(e) => setProductForm({ ...productForm, recommendedFor: e.target.value })} className={inputCls} />
          <input placeholder="Pros — one per line" value={productForm.pros} onChange={(e) => setProductForm({ ...productForm, pros: e.target.value })} className={inputCls} />
        </div>
        <div className="flex items-center gap-3 mt-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={productForm.featured} onChange={(e) => setProductForm({ ...productForm, featured: e.target.checked })} /> Featured</label>
          <button onClick={saveProduct} disabled={busy} className="ml-auto px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm flex items-center gap-1.5 disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} {editProduct ? "Save changes" : "Add product"}
          </button>
          {editProduct && <button onClick={() => setEditProduct(null)} className="text-xs text-muted-foreground">Cancel</button>}
        </div>
      </div>
    </div>
  )
}
