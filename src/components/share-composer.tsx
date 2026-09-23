"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { useSession } from "next-auth/react"
import { usePathname, useRouter } from "next/navigation"
import { createPortal } from "react-dom"
import {
  X, MessageSquare, HelpCircle, Sprout, Camera, Dna, Loader2,
  BarChart3, Leaf, Settings, ArrowLeft, Send,
} from "lucide-react"
import { resizeImage } from "@/components/update-form"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

// ── Context ────────────────────────────────────────────────────────

interface ShareComposerContextValue {
  open: () => void
  close: () => void
}

const ShareComposerContext = createContext<ShareComposerContextValue>({ open: () => {}, close: () => {} })

export function useShareComposer() {
  return useContext(ShareComposerContext)
}

export function ShareComposerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const handleOpen = useCallback(() => setOpen(true), [])
  const handleClose = useCallback(() => setOpen(false), [])

  return (
    <ShareComposerContext.Provider value={{ open: handleOpen, close: handleClose }}>
      {children}
      {open && <ShareComposerDialog onClose={handleClose} />}
    </ShareComposerContext.Provider>
  )
}

// ── Content types ──────────────────────────────────────────────────

type ComposerType = "discussion" | "question" | "grow-update" | "diary" | "setup" | "strain"

interface ComposerOption {
  type: ComposerType
  label: string
  icon: LucideIcon
  description: string
}

const COMPOSER_TYPES: ComposerOption[] = [
  { type: "discussion", label: "Discussion", icon: MessageSquare, description: "Start a conversation with the community" },
  { type: "question", label: "Question", icon: HelpCircle, description: "Ask the community a focused question" },
  { type: "grow-update", label: "Grow Update", icon: Camera, description: "Share what's happening in your grow" },
  { type: "diary", label: "Grow Diary", icon: Sprout, description: "Start tracking a new grow" },
  { type: "setup", label: "Setup", icon: Settings, description: "Document your grow space and gear" },
  { type: "strain", label: "Strain", icon: Dna, description: "Add a strain to the database" },
]

// ── Helpers ────────────────────────────────────────────────────────

interface PageContext {
  /** Diary ID if on a diary detail page */
  diaryId?: string
  diaryTitle?: string
  diaryStage?: string
  /** Strain ID if on a strain page */
  strainId?: string
  strainName?: string
  /** Thread slug if on a thread page */
  threadSlug?: string
}

function getPageContext(pathname: string): PageContext {
  const parts = pathname.split("/").filter(Boolean)
  if (parts[0] === "diaries" && parts[1] && parts[1] !== "new" && !pathname.endsWith("/edit")) {
    return { diaryId: parts[1] }
  }
  if (parts[0] === "strains" && parts[1] && parts[1] !== "new") {
    return { strainId: parts[1] }
  }
  if (parts[0] === "forum" && parts[1] === "thread" && parts[2]) {
    return { threadSlug: parts[2] }
  }
  return {}
}

function getDefaultType(ctx: PageContext): ComposerType {
  if (ctx.diaryId) return "grow-update"
  if (ctx.strainId) return "diary"
  return "discussion"
}

// ── Stage list (matches UPDATE_STAGES on the server) ───────────────

const UPDATE_STAGES = ["GERMINATION", "SEEDLING", "VEGETATIVE", "FLOWER", "HARVEST", "DRYING", "CURING", "COMPLETED"] as const
const GROW_TYPES = ["INDOOR", "OUTDOOR", "GREENHOUSE", "HYDROPONIC", "OTHER"] as const

// ── Dialog ─────────────────────────────────────────────────────────

function ShareComposerDialog({ onClose }: { onClose: () => void }) {
  const { data: session } = useSession()
  const pathname = usePathname()
  const router = useRouter()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [ctx] = useState(() => getPageContext(pathname))
  const [type, setType] = useState<ComposerType>(getDefaultType(ctx))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  // Fetch context data (diary info, strain info, categories)
  const [categories, setCategories] = useState<{ id: string; name: string; slug: string }[]>([])
  const [diaryInfo, setDiaryInfo] = useState<{ id: string; title: string; stage: string } | null>(null)
  const [strainInfo, setStrainInfo] = useState<{ id: string; name: string } | null>(null)

  // Load initial data
  useEffect(() => {
    // Fetch categories for discussion/question forms
    fetch("/api/categories").then((r) => r.json()).then((d) => setCategories(d.categories ?? [])).catch(() => {})

    // Read diary context from data attribute (set by the diary page)
    if (ctx.diaryId) {
      const el = document.querySelector("[data-tt-diary]")
      if (el) {
        try {
          const d = JSON.parse(el.getAttribute("data-tt-diary") || "{}")
          if (d.id) setDiaryInfo(d)
        } catch { /* ignore */ }
      }
    }

    // Read strain context from data attribute (set by the strain page)
    if (ctx.strainId) {
      const el = document.querySelector("[data-tt-strain]")
      if (el) {
        try {
          const s = JSON.parse(el.getAttribute("data-tt-strain") || "{}")
          if (s.id) setStrainInfo(s)
        } catch { /* ignore */ }
      }
    }
  }, [ctx.diaryId, ctx.strainId])

  // Keyboard: Escape to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  // Focus trap
  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    const focusable = el.querySelectorAll<HTMLElement>("button, input, select, textarea, [tabindex]")
    if (focusable.length > 0) focusable[0].focus()
  }, [type])

  if (!session) {
    router.push("/auth/signin")
    return null
  }

  const handleSubmit = async (data: Record<string, unknown>) => {
    setSubmitting(true)
    setError("")
    try {
      let url = ""
      let redirectPath = ""

      switch (type) {
        case "discussion":
        case "question":
          url = "/api/forum/threads"
          break
        case "grow-update":
          url = "/api/diaries/updates"
          break
        case "diary":
          url = "/api/diaries"
          break
        case "setup":
        case "strain":
          // These use their own forms — redirect to the dedicated page
          onClose()
          router.push(type === "setup" ? "/setups/new" : "/strains/new")
          return
      }

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })

      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || "Failed to create")
      }

      const result = await res.json()
      onClose()

      // Navigate to the created content
      if (result.thread?.slug) router.push(`/forum/thread/${result.thread.slug}`)
      else if (result.diary?.slug) router.push(`/diaries/${result.diary.slug}`)
      else if (result.diary?.id) router.push(`/diaries/${result.diary.id}`)
      else if (result.update) router.refresh()
      else router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-label="Share something"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-lg bg-card border border-border/70 rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto overscroll-contain"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card z-10">
          <div className="flex items-center gap-2">
            {type !== getDefaultType(ctx) && (
              <button
                onClick={() => setType(getDefaultType(ctx))}
                className="p-1.5 rounded-lg hover:bg-secondary transition-colors"
                aria-label="Back to type selector"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <h2 className="font-display font-semibold">Share something</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-secondary transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Type selector — shown when on the default view or general context */}
        <div className="p-4">
          <div className="grid grid-cols-3 gap-2 mb-4">
            {COMPOSER_TYPES.map((opt) => (
              <button
                key={opt.type}
                onClick={() => setType(opt.type)}
                className={cn(
                  "flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all text-center",
                  type === opt.type
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border hover:border-border/80 hover:bg-secondary/50 text-muted-foreground"
                )}
                role="tab"
                aria-selected={type === opt.type}
              >
                <opt.icon className="w-5 h-5" />
                <span className="text-xs font-medium">{opt.label}</span>
              </button>
            ))}
          </div>

          {/* Context banner */}
          {ctx.diaryId && diaryInfo && (
            <div className="mb-4 p-3 rounded-xl bg-primary/5 border border-primary/20 text-sm">
              <div className="flex items-center gap-2 text-primary font-medium">
                <Sprout className="w-4 h-4" />
                <span>{diaryInfo.title}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Stage: {diaryInfo.stage.toLowerCase()}</p>
            </div>
          )}
          {ctx.strainId && strainInfo && (
            <div className="mb-4 p-3 rounded-xl bg-primary/5 border border-primary/20 text-sm">
              <div className="flex items-center gap-2 text-primary font-medium">
                <Leaf className="w-4 h-4" />
                <span>{strainInfo.name}</span>
              </div>
            </div>
          )}

          {/* Forms */}
          {error && (
            <div className="mb-4 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive" role="alert">
              {error}
            </div>
          )}

          {type === "discussion" || type === "question" ? (
            <ThreadForm
              categories={categories}
              isQuestion={type === "question"}
              strainName={strainInfo?.name}
              submitting={submitting}
              onSubmit={handleSubmit}
            />
          ) : type === "grow-update" ? (
            diaryInfo ? (
              <GrowUpdateForm
                diaryId={diaryInfo.id}
                currentStage={diaryInfo.stage}
                submitting={submitting}
                onSubmit={handleSubmit}
              />
            ) : (
              <div className="text-center py-6">
                <Sprout className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground mb-3">
                  Open a grow diary to share an update, or start a new one.
                </p>
                <button
                  onClick={() => setType("diary")}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                >
                  <Sprout className="w-4 h-4" /> Start a grow diary
                </button>
              </div>
            )
          ) : type === "diary" ? (
            <DiaryForm
              strainId={ctx.strainId}
              strainName={strainInfo?.name}
              submitting={submitting}
              onSubmit={handleSubmit}
            />
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── Sub-forms ─────────────────────────────────────────────────────

interface FormProps {
  submitting: boolean
  onSubmit: (data: Record<string, unknown>) => void
}

function ThreadForm({ categories, isQuestion, strainName, submitting, onSubmit }: FormProps & {
  categories: { id: string; name: string; slug: string }[]
  isQuestion: boolean
  strainName?: string
}) {
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [categoryId, setCategoryId] = useState("")
  const [tags, setTags] = useState("")

  const effectiveCategoryId = categoryId || (isQuestion
    ? categories.find((c) => c.slug === "questions")?.id ?? categories[0]?.id ?? ""
    : categories[0]?.id ?? "")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !content.trim() || !effectiveCategoryId) return
    onSubmit({
      title: title.trim(),
      content: content.trim(),
      categoryId: effectiveCategoryId,
      tags: tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
      ...(strainName ? { tags: [...(tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : []), strainName] } : {}),
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="block text-sm font-medium mb-1">{isQuestion ? "Question" : "Title"}</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={isQuestion ? "What do you want to ask?" : "What's the discussion about?"}
          maxLength={150}
          className="w-full px-3 py-2 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"
          required
        />
        <span className="text-[10px] text-muted-foreground">{title.length}/150</span>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Details</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={isQuestion ? "Describe what you're seeing — the more detail, the better the answers." : "Share your thoughts..."}
          rows={4}
          maxLength={10000}
          className="w-full px-3 py-2 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm resize-y"
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Category</label>
          <select
            value={effectiveCategoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Tags</label>
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="comma-separated"
            className="w-full px-3 py-2 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"
          />
        </div>
      </div>
      {strainName && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Leaf className="w-3 h-3" /> Tagged with {strainName}
        </p>
      )}
      <button
        type="submit"
        disabled={submitting || !title.trim() || !content.trim() || !effectiveCategoryId}
        className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-full font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        {isQuestion ? "Ask question" : "Post discussion"}
      </button>
    </form>
  )
}

function GrowUpdateForm({ diaryId, currentStage, submitting, onSubmit }: FormProps & {
  diaryId?: string
  currentStage?: string
}) {
  const selectedDiary = diaryId ?? ""
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [stage, setStage] = useState(currentStage ?? "VEGETATIVE")
  const [photos, setPhotos] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const addPhotos = async (files: FileList | null) => {
    if (!files) return
    for (const f of Array.from(files)) {
      if (photos.length >= 4) break
      if (f.size > 10 * 1024 * 1024) continue
      try {
        const resized = await resizeImage(f)
        setPhotos((prev) => (prev.length < 4 ? [...prev, resized] : prev))
      } catch { /* ignore */ }
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedDiary || !title.trim() || !content.trim()) return
    onSubmit({
      diaryId: selectedDiary,
      title: title.trim(),
      content: content.trim(),
      stage,
      images: photos,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="block text-sm font-medium mb-1">Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What's happening in your grow?"
          maxLength={100}
          className="w-full px-3 py-2 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">What changed?</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Describe what you observed, measured, or did..."
          rows={3}
          maxLength={10000}
          className="w-full px-3 py-2 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm resize-y"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Stage</label>
        <select
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"
        >
          {UPDATE_STAGES.map((s) => (
            <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Photos</label>
        <div className="flex gap-2">
          {photos.map((p, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={p} alt="" className="w-16 h-16 rounded-lg object-cover border border-border" />
          ))}
          {photos.length < 4 && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-16 h-16 rounded-lg border border-dashed border-border flex items-center justify-center text-muted-foreground hover:bg-secondary/50 transition-colors"
              aria-label="Add photo"
            >
              <Camera className="w-5 h-5" />
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => addPhotos(e.target.files)}
          />
        </div>
      </div>
      <button
        type="submit"
        disabled={submitting || !selectedDiary || !title.trim() || !content.trim()}
        className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-full font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        Share update
      </button>
    </form>
  )
}

function DiaryForm({ strainId, strainName, submitting, onSubmit }: FormProps & {
  strainId?: string
  strainName?: string
}) {
  const [title, setTitle] = useState("")
  const [strain, setStrain] = useState(strainName ?? "")
  const [startDate, setStartDate] = useState(new Date().toISOString().split("T")[0])
  const [growType, setGrowType] = useState<string>("INDOOR")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    onSubmit({
      title: title.trim(),
      strain: strain.trim() || undefined,
      strainId: strainId || undefined,
      startDate,
      growType,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="block text-sm font-medium mb-1">Grow name</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Blue Dream — Tent Grow 2026"
          maxLength={100}
          className="w-full px-3 py-2 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Strain</label>
          <input
            type="text"
            value={strain}
            onChange={(e) => setStrain(e.target.value)}
            placeholder="Strain name"
            maxLength={500}
            className="w-full px-3 py-2 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"
          />
          {strainName && <p className="text-[10px] text-muted-foreground mt-0.5">Pre-selected from {strainName}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Grow type</label>
          <select
            value={growType}
            onChange={(e) => setGrowType(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"
          >
            {GROW_TYPES.map((g) => (
              <option key={g} value={g}>{g.charAt(0) + g.slice(1).toLowerCase()}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Start date</label>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"
          required
        />
      </div>
      <button
        type="submit"
        disabled={submitting || !title.trim()}
        className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-full font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sprout className="w-4 h-4" />}
        Start grow diary
      </button>
    </form>
  )
}
