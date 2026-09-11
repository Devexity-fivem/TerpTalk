"use client"

import { useEffect, useState, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { ShieldCheck, Loader2, ImageIcon, Trash2 } from "lucide-react"

interface MediaItem {
  id: string
  type: string
  url: string
  createdAt: string
  author: string
}

export default function AdminMediaPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const role = (session?.user as { role?: string })?.role

  const [items, setItems] = useState<MediaItem[]>([])
  const [type, setType] = useState("")
  const [q, setQ] = useState("")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const params = new URLSearchParams()
    if (type) params.set("type", type)
    if (q) params.set("q", q)
    const res = await fetch(`/api/admin/media?${params.toString()}`)
    const d = res.ok ? await res.json() : { items: [] }
    setItems(d.items || [])
    setLoading(false)
  }, [type, q])

  useEffect(() => {
    if (status === "unauthenticated") router.push("/auth/signin")
    else if (status === "authenticated") { const t = setTimeout(load, 0); return () => clearTimeout(t) }
  }, [status, router, load])

  const remove = async (id: string, itemType: string) => {
    if (!confirm("Delete this image and its Blob? This cannot be undone.")) return
    setBusy(id)
    try {
      const res = await fetch("/api/admin/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id, type: itemType }),
      })
      if (res.ok) { load() }
    } finally { setBusy(null) }
  }

  if (status === "loading" || (loading && !items.length)) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
  }

  if (role !== "ADMINISTRATOR") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <ShieldCheck className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Access denied</h1>
          <p className="text-muted-foreground">Administrator access required.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <ImageIcon className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Media Moderation</h1>
            <p className="text-muted-foreground text-sm">Review and remove user-uploaded images</p>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border p-4 mb-6 flex gap-3 flex-wrap">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
            placeholder="Search URL or author..."
            className="flex-1 min-w-48 px-3 py-2 rounded-lg border border-border bg-background text-sm"
          />
          <select value={type} onChange={(e) => setType(e.target.value)} className="px-3 py-2 rounded-lg border border-border bg-background text-sm">
            <option value="">All types</option>
            <option value="post">Posts</option>
            <option value="diary">Diaries</option>
            <option value="setup">Setups</option>
            <option value="strain">Strains</option>
            <option value="contest">Contest</option>
            <option value="avatar">Avatars</option>
          </select>
          <button onClick={load} className="px-4 py-2 bg-secondary rounded-lg text-sm hover:bg-secondary/80">Search</button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {items.length === 0 && <p className="col-span-full text-sm text-muted-foreground">No media found.</p>}
          {items.map((item) => (
            <div key={`${item.type}-${item.id}`} className="bg-card rounded-xl border border-border p-3">
              <a href={item.url} target="_blank" rel="noopener noreferrer" className="block aspect-video bg-black/5 rounded-lg overflow-hidden mb-2">
                <img src={item.url} alt="" className="w-full h-full object-contain" loading="lazy" />
              </a>
              <div className="text-xs text-muted-foreground mb-1">{item.type} · @{item.author} · {new Date(item.createdAt).toLocaleDateString()}</div>
              <button
                onClick={() => remove(item.id, item.type)}
                disabled={busy === item.id}
                className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-sm bg-destructive/10 text-destructive rounded-lg hover:bg-destructive/20 disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" /> Remove
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
