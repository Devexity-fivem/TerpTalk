"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { BookOpen, Loader2 } from "lucide-react"

const TOPICS = ["Basics", "Nutrients", "Environment", "Training", "Pests & Problems", "Harvest & Cure", "Equipment"]

export default function NewGuidePage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [form, setForm] = useState({ title: "", excerpt: "", topic: TOPICS[0], content: "" })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const role = (session?.user as { role?: string })?.role
  const isStaff = role === "MODERATOR" || role === "ADMINISTRATOR"

  if (status === "loading") return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
  if (!session || !isStaff) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Staff only.</div>
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError("")
    try {
      const res = await fetch("/api/guides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const d = await res.json()
      if (res.ok) router.push(`/guides/${d.guide.slug}`)
      else setError(d.error || "Failed")
    } finally { setBusy(false) }
  }

  const inputCls = "w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-primary" /> New Guide
        </h1>
        <form onSubmit={submit} className="bg-card border border-border rounded-xl p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Title</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={120} className={inputCls} placeholder="e.g. Your First Grow: A Complete Checklist" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Topic</label>
            <select value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} className={inputCls}>
              {TOPICS.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Excerpt (shown in listings)</label>
            <input value={form.excerpt} onChange={(e) => setForm({ ...form, excerpt: e.target.value })} required maxLength={300} className={inputCls} placeholder="One-line summary of what this guide teaches" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Content</label>
            <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} required rows={16} className={`${inputCls} resize-y font-mono text-xs`} placeholder="Write the guide. Plain text with line breaks — use '##' style headers for sections." />
          </div>
          {error && <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-lg text-sm">{error}</div>}
          <button type="submit" disabled={busy} className="w-full bg-primary text-primary-foreground py-2.5 rounded-lg font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Publish Guide"}
          </button>
        </form>
      </div>
    </div>
  )
}
