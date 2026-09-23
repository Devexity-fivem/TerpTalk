"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { BookOpen, Loader2, Pencil } from "lucide-react"
import { LESSON_KEYS, LESSON_LABELS, type GrowLessons } from "@/lib/experiments"

/**
 * Grower-recorded lessons — the grower's own conclusions at the end of
 * (or during) a grow. Stored on the diary as structured JSON; displayed
 * as part of the grow's documented history. Never generated, never
 * auto-populated — empty keys simply don't render.
 */
export default function GrowLessonsSection({
  diaryId,
  lessons,
  isOwner,
}: {
  diaryId: string
  lessons: GrowLessons
  isOwner: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [form, setForm] = useState<GrowLessons>({ ...lessons })

  const hasAny = LESSON_KEYS.some((k) => lessons[k])

  const save = async () => {
    setSaving(true)
    setError("")
    try {
      const res = await fetch(`/api/diaries/${diaryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessons: form }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || "Failed to save lessons")
      }
      setEditing(false)
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (!hasAny && !isOwner && !editing) return null

  return (
    <section className="bg-card/80 rounded-2xl border border-border/70 p-4 mb-4" aria-label="Grow lessons">
      <div className="flex items-center gap-2 mb-3">
        <BookOpen className="w-4 h-4 text-primary" />
        <h2 className="font-display font-semibold text-sm">What the grower took away</h2>
        <span className="text-[10px] text-muted-foreground ml-auto">grower-recorded</span>
        {isOwner && !editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-xs inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-border hover:bg-secondary transition-colors min-h-8"
          >
            <Pencil className="w-3 h-3" /> {hasAny ? "Edit" : "Add lessons"}
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-3">
          {LESSON_KEYS.map((k) => (
            <div key={k}>
              <label className="block text-xs font-medium mb-1 text-muted-foreground">
                {LESSON_LABELS[k]}
              </label>
              <textarea
                value={form[k] ?? ""}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                rows={2}
                maxLength={600}
                className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder={LESSON_LABELS[k]}
              />
            </div>
          ))}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 min-h-11"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save lessons
            </button>
            <button
              onClick={() => { setEditing(false); setForm({ ...lessons }) }}
              className="px-4 py-2 rounded-full border border-border text-sm hover:bg-secondary transition-colors min-h-11"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : hasAny ? (
        <dl className="space-y-2.5 text-sm">
          {LESSON_KEYS.filter((k) => lessons[k]).map((k) => (
            <div key={k}>
              <dt className="text-xs font-medium text-muted-foreground">{LESSON_LABELS[k]}</dt>
              <dd className="mt-0.5">{lessons[k]}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">
          No lessons recorded yet — capture what this grow taught you.
        </p>
      )}
    </section>
  )
}
