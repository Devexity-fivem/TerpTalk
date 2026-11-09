"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { BookOpen, Loader2, ArrowLeft } from "@/lib/icons"
import { isModerator } from "@/lib/roles"
import EmptyState from "@/components/ui/empty-state"

const TOPICS = [
  { value: "BASICS", label: "Basics" },
  { value: "NUTRIENTS", label: "Nutrients" },
  { value: "HARVEST", label: "Harvest" },
  { value: "PESTS", label: "Pests" },
  { value: "ENVIRONMENT", label: "Environment" },
  { value: "GENETICS", label: "Genetics" },
  { value: "TRAINING", label: "Training" },
  { value: "LAW", label: "Law" },
]

export default function NewGuidePage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [form, setForm] = useState({ title: "", excerpt: "", topic: TOPICS[0].value, content: "" })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const role = (session?.user as { role?: string })?.role
  const isStaff = isModerator(role)

  if (status === "loading") return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
  if (!session || !isStaff) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="w-full max-w-md tt-spotlight bg-card/80 rounded-2xl border border-border/70">
          <EmptyState
            icon={BookOpen}
            title="Staff only"
            description="Guide authoring is limited to TerpTalk staff."
            action={{ label: "Back to guides", href: "/guides" }}
          />
        </div>
      </div>
    )
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

  const inputCls = "w-full px-4 py-2.5 rounded-xl border border-border/70 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-5">
          <Link href="/guides" className="text-sm text-primary hover:underline inline-flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> Back to guides
          </Link>
        </div>
        <header className="mb-6">
          <p className="tt-eyebrow mb-1">Knowledge base</p>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2 tracking-tight">
            <BookOpen className="w-6 h-6 text-primary" /> New Guide
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Staff-authored and published immediately.</p>
        </header>
        <form onSubmit={submit} className="tt-spotlight bg-card/80 border border-border/70 rounded-2xl p-6 space-y-4">
          <div>
            <label htmlFor="guide-title" className="block text-sm font-medium mb-1">Title</label>
            <input id="guide-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={120} className={inputCls} placeholder="e.g. Your First Grow: A Complete Checklist" />
          </div>
          <div>
            <label htmlFor="guide-topic" className="block text-sm font-medium mb-1">Topic</label>
            <select id="guide-topic" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} className={inputCls}>
              {TOPICS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="guide-excerpt" className="block text-sm font-medium mb-1">Excerpt (shown in listings)</label>
            <input id="guide-excerpt" value={form.excerpt} onChange={(e) => setForm({ ...form, excerpt: e.target.value })} required maxLength={300} className={inputCls} placeholder="One-line summary of what this guide teaches" />
          </div>
          <div>
            <label htmlFor="guide-content" className="block text-sm font-medium mb-1">Content</label>
            <textarea id="guide-content" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} required rows={16} className={`${inputCls} resize-y font-mono text-xs`} placeholder="Write the guide. Plain text with line breaks — use '##' style headers for sections." />
          </div>
          {error && <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-lg text-sm">{error}</div>}
          <button type="submit" disabled={busy} className="w-full bg-primary text-primary-foreground py-2.5 rounded-full font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Publish Guide"}
          </button>
        </form>
      </div>
    </div>
  )
}
