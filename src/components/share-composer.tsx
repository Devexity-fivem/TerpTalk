"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { useSession } from "next-auth/react"
import { usePathname, useRouter } from "next/navigation"
import { createPortal } from "react-dom"
import {
  X, MessageSquare, HelpCircle, Sprout, Dna, Loader2,
  BarChart3, Leaf, Settings, ArrowLeft, Send, ImageIcon, Wheat,
} from "lucide-react"
import ImageUploader from "@/components/image-uploader"
import PollComposer from "@/components/poll-composer"
import { getReputationTier, POLL_CREATION_REP } from "@/lib/reputation-config"
import { signInHref } from "@/lib/callback-url"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

// Client-side mirror of the server gate in POST /api/forum/threads —
// isStaff() lives in a Prisma-importing module, so the role set is inlined.
const STAFF = new Set(["SUPPORT", "MODERATOR", "ADMINISTRATOR"])

// ── Context ────────────────────────────────────────────────────────

/** Optional prefill — lets surfaces like the grow intel panel open the
 *  composer with a question already framed. The type selector still
 *  shows so the member can change their mind. */
export interface ComposerPrefill {
  type?: ComposerType
  title?: string
  content?: string
  tags?: string[]
}

interface ShareComposerContextValue {
  open: (prefill?: ComposerPrefill) => void
  close: () => void
}

const ShareComposerContext = createContext<ShareComposerContextValue>({ open: () => {}, close: () => {} })

export function useShareComposer() {
  return useContext(ShareComposerContext)
}

export function ShareComposerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; prefill?: ComposerPrefill }>({ open: false })
  const handleOpen = useCallback((prefill?: ComposerPrefill) => setState({ open: true, prefill }), [])
  const handleClose = useCallback(() => setState((s) => ({ ...s, open: false })), [])

  return (
    <ShareComposerContext.Provider value={{ open: handleOpen, close: handleClose }}>
      {children}
      {state.open && <ShareComposerDialog prefill={state.prefill} onClose={handleClose} />}
    </ShareComposerContext.Provider>
  )
}

// ── Content types ──────────────────────────────────────────────────

type ComposerType =
  | "discussion"
  | "question"
  | "grow-update"
  | "diary"
  | "moment"
  | "harvest"
  | "poll"
  | "setup"
  | "strain"

interface ComposerOption {
  type: ComposerType
  label: string
  icon: LucideIcon
  description: string
}

const COMPOSER_TYPES: ComposerOption[] = [
  { type: "discussion", label: "Discussion", icon: MessageSquare, description: "Start a conversation" },
  { type: "question", label: "Question", icon: HelpCircle, description: "Ask a focused question" },
  { type: "grow-update", label: "Grow Update", icon: Sprout, description: "Update an active grow" },
  { type: "diary", label: "Grow Diary", icon: Leaf, description: "Track a new grow" },
  { type: "moment", label: "Photo / Moment", icon: ImageIcon, description: "Share something visual" },
  { type: "harvest", label: "Harvest", icon: Wheat, description: "Log a completed grow" },
  { type: "poll", label: "Poll", icon: BarChart3, description: "Ask the community to weigh in" },
  { type: "setup", label: "Setup", icon: Settings, description: "Document your gear" },
  { type: "strain", label: "Strain", icon: Dna, description: "Add to the strain database" },
]

// ── Helpers ────────────────────────────────────────────────────────

interface PageContext {
  /** Diary slug/id from the URL — the real id comes from data-tt-diary */
  diaryId?: string
  /** Strain slug/id from the URL */
  strainId?: string
}

function getPageContext(pathname: string): PageContext {
  const parts = pathname.split("/").filter(Boolean)
  if (parts[0] === "diaries" && parts[1] && parts[1] !== "new" && !pathname.endsWith("/edit")) {
    return { diaryId: parts[1] }
  }
  if (parts[0] === "strains" && parts[1] && parts[1] !== "new") {
    return { strainId: parts[1] }
  }
  return {}
}

function getDefaultType(ctx: PageContext): ComposerType {
  if (ctx.diaryId) return "grow-update"
  if (ctx.strainId) return "diary"
  return "discussion"
}

// ── Stage/grow vocab (matches the server enums) ────────────────────

const UPDATE_STAGES = ["GERMINATION", "SEEDLING", "VEGETATIVE", "FLOWER", "HARVEST", "DRYING", "CURING", "COMPLETED"] as const
const GROW_TYPES = ["INDOOR", "OUTDOOR", "GREENHOUSE", "HYDROPONIC", "OTHER"] as const
const YIELD_UNITS = ["g", "oz", "lb", "kg"] as const
const HARVEST_DIFFICULTIES = ["EASY", "NORMAL", "HARD"] as const

const INPUT =
  "w-full px-3 py-2 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"

// ── Dialog ─────────────────────────────────────────────────────────

function ShareComposerDialog({ prefill, onClose }: { prefill?: ComposerPrefill; onClose: () => void }) {
  const { data: session, status } = useSession()
  const pathname = usePathname()
  const router = useRouter()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [ctx] = useState(() => getPageContext(pathname))
  const [type, setType] = useState<ComposerType>(prefill?.type ?? getDefaultType(ctx))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  const [categories, setCategories] = useState<{ id: string; name: string; slug: string }[]>([])
  const [diaryInfo, setDiaryInfo] = useState<{ id: string; title: string; stage: string; harvested?: boolean; own?: boolean } | null>(null)
  const [strainInfo, setStrainInfo] = useState<{ id: string; name: string } | null>(null)
  const [ctxChecked, setCtxChecked] = useState(false)
  // null = still loading — reputation decides whether the poll type is
  // unlocked. Staff bypass the fetch entirely.
  const [pollPerk, setPollPerk] = useState<boolean | null>(null)

  const isStaff = STAFF.has((session?.user as { role?: string } | undefined)?.role ?? "")
  const canCreatePoll = isStaff ? true : pollPerk

  // Load initial data. The DOM attribute reads are deferred to a microtask
  // so no setState runs synchronously inside the effect body.
  useEffect(() => {
    fetch("/api/categories").then((r) => r.json()).then((d) => setCategories(d.categories ?? [])).catch(() => {})

    queueMicrotask(() => {
      if (ctx.diaryId) {
        const el = document.querySelector("[data-tt-diary]")
        if (el) {
          try {
            const d = JSON.parse(el.getAttribute("data-tt-diary") || "{}")
            if (d.id) setDiaryInfo(d)
          } catch { /* ignore */ }
        }
      }

      if (ctx.strainId) {
        const el = document.querySelector("[data-tt-strain]")
        if (el) {
          try {
            const s = JSON.parse(el.getAttribute("data-tt-strain") || "{}")
            if (s.id) setStrainInfo(s)
          } catch { /* ignore */ }
        }
      }

      setCtxChecked(true)
    })
  }, [ctx.diaryId, ctx.strainId])

  // Poll perk gate — mirrors POST /api/forum/threads; server still enforces.
  // Staff bypass is derived during render so no synchronous setState is
  // needed in the effect; non-staff users are checked via /api/profile.
  useEffect(() => {
    if (!session || isStaff) return
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setPollPerk(getReputationTier(d?.reputation ?? 0).perks.pollCreation === true))
      .catch(() => setPollPerk(false))
  }, [session, isStaff])

  // Keyboard: Escape to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  // Focus the first form field when the type changes — keeps keyboard
  // users inside the form instead of landing on a header button.
  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    const field = el.querySelector<HTMLElement>("input:not([type=hidden]):not([type=file]), textarea, select")
    field?.focus()
  }, [type])

  const handleSubmit = async (data: Record<string, unknown>, method: "POST" | "PATCH" = "POST") => {
    setSubmitting(true)
    setError("")
    try {
      let url = ""

      switch (type) {
        case "discussion":
        case "question":
        case "moment":
        case "poll":
          url = "/api/forum/threads"
          break
        case "grow-update":
          url = "/api/diaries/updates"
          break
        case "diary":
          url = "/api/diaries"
          break
        case "harvest":
          url = `/api/diaries/${diaryInfo?.id}/harvest`
          break
        case "setup":
        case "strain":
          // Dedicated multi-field forms — navigate rather than duplicate logic
          onClose()
          router.push(type === "setup" ? "/setups/new" : "/strains/new")
          return
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })

      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || "Failed to create")
      }

      const result = await res.json()
      onClose()

      if (result.thread?.slug) router.push(`/forum/thread/${result.thread.slug}`)
      else if (result.diary?.slug) router.push(`/diaries/${result.diary.slug}`)
      else if (result.diary?.id) router.push(`/diaries/${result.diary.id}`)
      else router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  // ctx.diaryId means we're on a diary page but diaryInfo may still be
  // resolving from the DOM attribute — show a brief loading state rather
  // than flashing the "open a diary" prompt. ctxChecked guarantees we
  // never spin forever if the attribute is absent.
  const contextPending = !!ctx.diaryId && diaryInfo === null && !ctxChecked
  const needsDiary = (type === "grow-update" || type === "harvest") && !contextPending && (!diaryInfo || diaryInfo.own !== true)

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
        className="w-full max-w-lg bg-card border border-border/70 rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]"
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

        <div className="p-4">
          {/* Type selector — always visible so guests see the creation model */}
          <div className="grid grid-cols-3 gap-2 mb-4" role="tablist" aria-label="Content type">
            {COMPOSER_TYPES.map((opt) => (
              <button
                key={opt.type}
                onClick={() => setType(opt.type)}
                className={cn(
                  "flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all text-center min-h-[64px]",
                  type === opt.type
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border hover:border-border/80 hover:bg-secondary/50 text-muted-foreground"
                )}
                role="tab"
                aria-selected={type === opt.type}
                title={opt.description}
              >
                <opt.icon className="w-5 h-5" />
                <span className="text-xs font-medium leading-tight">{opt.label}</span>
              </button>
            ))}
          </div>

          {/* Context banners */}
          {diaryInfo && (type === "grow-update" || type === "harvest" || type === "moment") && (
            <div className="mb-4 p-3 rounded-xl bg-primary/5 border border-primary/20 text-sm">
              <div className="flex items-center gap-2 text-primary font-medium">
                <Sprout className="w-4 h-4" />
                <span className="truncate">{diaryInfo.title}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Stage: {diaryInfo.stage.toLowerCase()}</p>
            </div>
          )}
          {strainInfo && (type === "diary" || type === "discussion" || type === "question") && (
            <div className="mb-4 p-3 rounded-xl bg-primary/5 border border-primary/20 text-sm">
              <div className="flex items-center gap-2 text-primary font-medium">
                <Leaf className="w-4 h-4" />
                <span className="truncate">{strainInfo.name}</span>
              </div>
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive" role="alert">
              {error}
            </div>
          )}

          {/* Guest gate — show the creation model, require sign-in to post.
              While the session is still resolving, show a spinner so
              signed-in users never see the guest prompt flash. */}
          {status === "loading" ? (
            <div className="py-6 text-center" role="status" aria-label="Loading">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto" />
            </div>
          ) : !session ? (
            <div className="text-center py-6">
              <p className="text-sm text-muted-foreground mb-1">
                {COMPOSER_TYPES.find((o) => o.type === type)?.description ?? "Share something"}
              </p>
              <p className="text-sm text-muted-foreground mb-4">
                Sign in to share with the TerpTalk community.
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => { onClose(); router.push(signInHref(pathname)) }}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors min-h-11"
                >
                  Sign in
                </button>
                <button
                  onClick={() => { onClose(); router.push("/auth/signup") }}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full border border-border text-sm font-medium hover:bg-secondary transition-colors min-h-11"
                >
                  Create account
                </button>
              </div>
            </div>
          ) : contextPending && (type === "grow-update" || type === "harvest") ? (
            <div className="py-6 text-center" role="status" aria-label="Loading grow context">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto" />
            </div>
          ) : needsDiary ? (
            <div className="text-center py-6">
              <Sprout className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground mb-3">
                {diaryInfo && diaryInfo.own !== true
                  ? "This grow belongs to another member — only its grower can post updates or log a harvest."
                  : type === "harvest"
                    ? "Harvest logging happens on a grow diary — open your grow first."
                    : "Open a grow diary to share an update, or start a new one."}
              </p>
              {(!diaryInfo || diaryInfo.own === true) && (
                <button
                  onClick={() => setType("diary")}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors min-h-11"
                >
                  <Sprout className="w-4 h-4" /> Start a grow diary
                </button>
              )}
            </div>
          ) : type === "discussion" || type === "question" || type === "moment" || type === "poll" ? (
            <ThreadForm
              categories={categories}
              variant={type}
              strainName={strainInfo?.name}
              canCreatePoll={canCreatePoll}
              submitting={submitting}
              onSubmit={handleSubmit}
              initialTitle={prefill?.title}
              initialContent={prefill?.content}
              initialTags={prefill?.tags}
            />
          ) : type === "grow-update" ? (
            <GrowUpdateForm
              diaryId={diaryInfo!.id}
              currentStage={diaryInfo!.stage}
              submitting={submitting}
              onSubmit={handleSubmit}
            />
          ) : type === "harvest" ? (
            <HarvestForm
              diaryTitle={diaryInfo!.title}
              alreadyHarvested={diaryInfo!.harvested === true}
              submitting={submitting}
              onSubmit={(d) => handleSubmit(d, "PATCH")}
            />
          ) : type === "diary" ? (
            <DiaryForm
              strainId={strainInfo?.id}
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

function ThreadForm({ categories, variant, strainName, canCreatePoll, submitting, onSubmit, initialTitle, initialContent, initialTags }: FormProps & {
  categories: { id: string; name: string; slug: string }[]
  variant: "discussion" | "question" | "moment" | "poll"
  strainName?: string
  canCreatePoll: boolean | null
  initialTitle?: string
  initialContent?: string
  initialTags?: string[]
}) {
  const isQuestion = variant === "question"
  const isMoment = variant === "moment"
  const isPoll = variant === "poll"

  const [title, setTitle] = useState(initialTitle ?? "")
  const [content, setContent] = useState(initialContent ?? "")
  const [categoryId, setCategoryId] = useState("")
  const [tags, setTags] = useState(initialTags?.join(", ") ?? "")
  const [images, setImages] = useState<string[]>([])
  const [poll, setPoll] = useState<{ question: string; options: string[] } | null>(
    isPoll ? { question: "", options: ["", ""] } : null
  )

  const effectiveCategoryId =
    categoryId ||
    (isQuestion
      ? categories.find((c) => c.slug === "new-grower-questions" || c.slug === "questions")?.id ?? categories[0]?.id ?? ""
      : categories.find((c) => c.slug === "general-cannabis-discussion")?.id ?? categories[0]?.id ?? "")

  const tagList = [
    ...(tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : []),
    ...(strainName ? [strainName] : []),
  ]

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // The thread API requires non-empty content — a Moment uses the
    // caption as the body when no details were written.
    const body = content.trim() || title.trim()
    if (!title.trim() || !body || !effectiveCategoryId) return
    if (isMoment && images.length === 0) return
    if (isPoll) {
      const opts = poll?.options.map((o) => o.trim()).filter(Boolean) ?? []
      if (!poll?.question.trim() || opts.length < 2) return
      onSubmit({
        title: title.trim(),
        content: body,
        categoryId: effectiveCategoryId,
        tags: tagList,
        images,
        poll: { question: poll.question.trim(), options: opts },
      })
      return
    }
    onSubmit({
      title: title.trim(),
      content: body,
      categoryId: effectiveCategoryId,
      tags: tagList,
      images,
    })
  }

  const submitDisabled =
    submitting ||
    !title.trim() ||
    !(content.trim() || (isMoment && title.trim())) ||
    !effectiveCategoryId ||
    (isMoment && images.length === 0) ||
    (isPoll &&
      (!poll?.question.trim() ||
        poll.options.map((o) => o.trim()).filter(Boolean).length < 2))

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {isMoment && (
        <ImageUploader value={images} onChange={setImages} max={4} disabled={submitting} />
      )}
      <div>
        <label className="block text-sm font-medium mb-1">
          {isPoll ? "Poll title" : isMoment ? "Caption" : isQuestion ? "Question" : "Title"}
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={
            isPoll ? "What are you asking the community?"
            : isMoment ? "Give this moment a caption"
            : isQuestion ? "What do you want to ask?"
            : "What's the discussion about?"
          }
          maxLength={150}
          className={INPUT}
          required
        />
        <span className="text-[10px] text-muted-foreground">{title.length}/150</span>
      </div>
      {!isPoll && (
        <div>
          <label className="block text-sm font-medium mb-1">{isMoment ? "Details (optional)" : "Details"}</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={
              isMoment ? "Add context about this photo..."
              : isQuestion ? "Describe what you're seeing — the more detail, the better the answers."
              : "Share your thoughts..."
            }
            rows={isMoment ? 2 : 4}
            maxLength={10000}
            className={cn(INPUT, "resize-y")}
            required={!isMoment}
          />
        </div>
      )}
      {isPoll && (
        <>
          <div>
            <label className="block text-sm font-medium mb-1">Details (optional)</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Add context for the poll..."
              rows={2}
              maxLength={10000}
              className={cn(INPUT, "resize-y")}
            />
          </div>
          {canCreatePoll === null ? (
            <div className="py-2 text-center" role="status" aria-label="Checking poll permissions">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mx-auto" />
            </div>
          ) : (
            <PollComposer
              value={poll}
              onChange={setPoll}
              disabled={submitting}
              lockedReason={
                canCreatePoll === false
                  ? `Polls unlock at ${POLL_CREATION_REP.toLocaleString()} reputation (Rooted).`
                  : null
              }
            />
          )}
        </>
      )}
      {!isMoment && (
        <div>
          <label className="block text-sm font-medium mb-1">Photos</label>
          <ImageUploader value={images} onChange={setImages} max={4} disabled={submitting} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Category</label>
          <select
            value={effectiveCategoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className={INPUT}
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
            className={INPUT}
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
        disabled={submitDisabled}
        className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-full font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 min-h-11"
      >
        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        {isPoll ? "Post poll" : isMoment ? "Share moment" : isQuestion ? "Ask question" : "Post discussion"}
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
          className={INPUT}
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
          className={cn(INPUT, "resize-y")}
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Stage</label>
        <select
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          className={INPUT}
        >
          {UPDATE_STAGES.map((s) => (
            <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Photos</label>
        <ImageUploader value={photos} onChange={setPhotos} max={4} disabled={submitting} />
      </div>
      <button
        type="submit"
        disabled={submitting || !selectedDiary || !title.trim() || !content.trim()}
        className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-full font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 min-h-11"
      >
        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        Share update
      </button>
    </form>
  )
}

function HarvestForm({ diaryTitle, alreadyHarvested, submitting, onSubmit }: FormProps & {
  diaryTitle: string
  alreadyHarvested: boolean
}) {
  const [yieldAmount, setYieldAmount] = useState("")
  const [yieldUnit, setYieldUnit] = useState<string>("g")
  const [rating, setRating] = useState("")
  const [difficulty, setDifficulty] = useState("")
  const [notes, setNotes] = useState("")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const payload: Record<string, unknown> = { harvested: true }
    if (yieldAmount.trim()) {
      const n = parseFloat(yieldAmount)
      if (Number.isFinite(n) && n >= 0) {
        payload.yieldAmount = n
        payload.yieldUnit = yieldUnit
      }
    }
    if (rating) {
      const r = parseInt(rating, 10)
      if (r >= 1 && r <= 10) payload.harvestRating = r
    }
    if (difficulty) payload.harvestDifficulty = difficulty
    if (notes.trim()) payload.harvestNotes = notes.trim()
    onSubmit(payload)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {alreadyHarvested && (
        <p className="text-xs text-muted-foreground p-2 rounded-lg bg-secondary/40">
          This grow is already marked harvested — submitting will update the record.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Yield</label>
          <input
            type="number"
            min="0"
            step="any"
            value={yieldAmount}
            onChange={(e) => setYieldAmount(e.target.value)}
            placeholder="e.g. 120"
            className={INPUT}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Unit</label>
          <select value={yieldUnit} onChange={(e) => setYieldUnit(e.target.value)} className={INPUT}>
            {YIELD_UNITS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Rating</label>
          <select value={rating} onChange={(e) => setRating(e.target.value)} className={INPUT}>
            <option value="">No rating</option>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}/10</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Difficulty</label>
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className={INPUT}>
            <option value="">Not set</option>
            {HARVEST_DIFFICULTIES.map((d) => (
              <option key={d} value={d}>{d.charAt(0) + d.slice(1).toLowerCase()}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Harvest notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={`How did ${diaryTitle} turn out?`}
          rows={3}
          maxLength={1000}
          className={cn(INPUT, "resize-y")}
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-full font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 min-h-11"
      >
        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wheat className="w-4 h-4" />}
        Log harvest
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
          className={INPUT}
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
            className={INPUT}
          />
          {strainName && <p className="text-[10px] text-muted-foreground mt-0.5">Pre-selected from {strainName}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Grow type</label>
          <select
            value={growType}
            onChange={(e) => setGrowType(e.target.value)}
            className={INPUT}
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
          className={INPUT}
          required
        />
      </div>
      <button
        type="submit"
        disabled={submitting || !title.trim()}
        className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-full font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 min-h-11"
      >
        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sprout className="w-4 h-4" />}
        Start grow diary
      </button>
    </form>
  )
}
