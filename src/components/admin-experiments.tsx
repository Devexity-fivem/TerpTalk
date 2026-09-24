"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, FlaskConical, GitCommitVertical } from "lucide-react"

interface Item {
  id: string
  kind: "CHANGE" | "EXPERIMENT"
  title: string
  surface: string | null
  hypothesis: string | null
  description: string
  primaryMetric: string | null
  status: "PLANNED" | "ACTIVE" | "CONCLUDED" | "REVERTED"
  result: string | null
  conclusion: string | null
  createdAt: string
  endedAt: string | null
  createdBy: { profile: { username: string } | null; name: string | null } | null
}

const STATUS_STYLE: Record<string, string> = {
  PLANNED: "bg-secondary text-muted-foreground",
  ACTIVE: "bg-primary/15 text-primary",
  CONCLUDED: "bg-blue-500/15 text-blue-500",
  REVERTED: "bg-destructive/15 text-destructive",
}

export default function AdminExperiments() {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [form, setForm] = useState({ kind: "CHANGE", title: "", surface: "", hypothesis: "", description: "", primaryMetric: "" })
  const [editing, setEditing] = useState<string | null>(null)
  const [editFields, setEditFields] = useState({ result: "", conclusion: "" })

  const load = useCallback(() => {
    fetch("/api/admin/experiments")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => { setItems(d.items || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])
  useEffect(load, [load])

  const flash = (m: string) => { setNotice(m); setTimeout(() => setNotice(""), 3000) }

  const create = async () => {
    if (!form.title.trim() || !form.description.trim()) { setError("Title and description required"); return }
    setBusy(true); setError("")
    try {
      const res = await fetch("/api/admin/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      if (res.ok) {
        setForm({ kind: "CHANGE", title: "", surface: "", hypothesis: "", description: "", primaryMetric: "" })
        load(); flash("Recorded")
      } else { const d = await res.json(); setError(d.error || "Failed") }
    } finally { setBusy(false) }
  }

  const update = async (id: string, patch: Record<string, string>) => {
    setBusy(true); setError("")
    try {
      const res = await fetch(`/api/admin/experiments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      if (res.ok) { setEditing(null); load(); flash("Updated") }
      else { const d = await res.json(); setError(d.error || "Failed") }
    } finally { setBusy(false) }
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>

  return (
    <div className="space-y-5">
      {error && <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-lg text-sm">{error}</div>}
      {notice && <div className="bg-primary/10 text-primary px-4 py-2 rounded-lg text-sm">{notice}</div>}

      <section className="rounded-2xl border border-border/60 bg-card/40 p-4 md:p-5 space-y-3">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">Record a change or experiment</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
            className="px-3 py-2 rounded-lg border border-border bg-background text-sm">
            <option value="CHANGE">Change</option>
            <option value="EXPERIMENT">Experiment</option>
          </select>
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Title — e.g. Simplified signup CTA" maxLength={200}
            className="px-3 py-2 rounded-lg border border-border bg-background text-sm md:col-span-2" />
          <input value={form.surface} onChange={(e) => setForm({ ...form, surface: e.target.value })}
            placeholder="Surface — e.g. composer, onboarding" maxLength={80}
            className="px-3 py-2 rounded-lg border border-border bg-background text-sm" />
          {form.kind === "EXPERIMENT" && (
            <>
              <input value={form.hypothesis} onChange={(e) => setForm({ ...form, hypothesis: e.target.value })}
                placeholder="Hypothesis — what should move" maxLength={2000}
                className="px-3 py-2 rounded-lg border border-border bg-background text-sm" />
              <input value={form.primaryMetric} onChange={(e) => setForm({ ...form, primaryMetric: e.target.value })}
                placeholder="Primary metric — e.g. diary starts ≤24h" maxLength={120}
                className="px-3 py-2 rounded-lg border border-border bg-background text-sm" />
            </>
          )}
        </div>
        <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="What changed — be specific enough to correlate with behavior later" maxLength={2000} rows={2}
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
        <button onClick={create} disabled={busy}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50">
          Record
        </button>
      </section>

      <section className="rounded-2xl border border-border/60 bg-card/40 divide-y divide-border/50">
        {items.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nothing recorded yet.</p>}
        {items.map((it) => (
          <article key={it.id} className="p-4">
            <div className="flex items-center gap-2 flex-wrap">
              {it.kind === "EXPERIMENT"
                ? <FlaskConical className="w-4 h-4 text-primary shrink-0" />
                : <GitCommitVertical className="w-4 h-4 text-muted-foreground shrink-0" />}
              <span className="font-medium text-sm">{it.title}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${STATUS_STYLE[it.status]}`}>{it.status}</span>
              {it.surface && <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">{it.surface}</span>}
              <span className="ml-auto text-xs text-muted-foreground">
                {new Date(it.createdAt).toLocaleDateString()}
                {it.createdBy ? ` · ${it.createdBy.profile?.username || it.createdBy.name}` : ""}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">{it.description}</p>
            {it.hypothesis && <p className="text-xs mt-1"><span className="text-muted-foreground">Hypothesis:</span> {it.hypothesis}</p>}
            {it.primaryMetric && <p className="text-xs mt-0.5"><span className="text-muted-foreground">Metric:</span> {it.primaryMetric}</p>}
            {it.result && <p className="text-xs mt-1"><span className="text-muted-foreground">Result:</span> {it.result}</p>}
            {it.conclusion && <p className="text-xs mt-0.5"><span className="text-muted-foreground">Conclusion:</span> {it.conclusion}</p>}

            {editing === it.id ? (
              <div className="mt-2 space-y-2">
                <textarea value={editFields.result} onChange={(e) => setEditFields({ ...editFields, result: e.target.value })}
                  placeholder="Observed result" rows={2} maxLength={2000}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-xs" />
                <textarea value={editFields.conclusion} onChange={(e) => setEditFields({ ...editFields, conclusion: e.target.value })}
                  placeholder="Conclusion" rows={2} maxLength={2000}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-xs" />
                <div className="flex gap-2">
                  <button onClick={() => update(it.id, editFields)} disabled={busy}
                    className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg disabled:opacity-50">Save</button>
                  <button onClick={() => setEditing(null)} className="px-3 py-1.5 text-xs bg-secondary rounded-lg">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2 mt-2 flex-wrap">
                {(it.status === "PLANNED" || it.status === "REVERTED") && (
                  <button onClick={() => update(it.id, { status: "ACTIVE" })} disabled={busy}
                    className="px-3 py-1.5 text-xs bg-primary/10 text-primary rounded-lg">Mark active</button>
                )}
                {it.status === "ACTIVE" && (
                  <>
                    <button onClick={() => { setEditing(it.id); setEditFields({ result: it.result ?? "", conclusion: it.conclusion ?? "" }) }}
                      className="px-3 py-1.5 text-xs bg-secondary rounded-lg">Conclude…</button>
                    <button onClick={() => update(it.id, { status: "REVERTED" })} disabled={busy}
                      className="px-3 py-1.5 text-xs bg-destructive/10 text-destructive rounded-lg">Revert</button>
                  </>
                )}
                {it.status === "CONCLUDED" && (
                  <button onClick={() => { setEditing(it.id); setEditFields({ result: it.result ?? "", conclusion: it.conclusion ?? "" }) }}
                    className="px-3 py-1.5 text-xs bg-secondary rounded-lg">Edit result…</button>
                )}
              </div>
            )}
          </article>
        ))}
      </section>
    </div>
  )
}
