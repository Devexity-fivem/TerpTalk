"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import { useSession } from "next-auth/react"
import { Loader2, MessageSquarePlus, X } from "lucide-react"
import { signInHref } from "@/lib/callback-url"
import { useRouter } from "next/navigation"

const TYPE_OPTIONS = [
  { value: "BUG", label: "Something is broken" },
  { value: "UX", label: "Something is confusing" },
  { value: "FEATURE", label: "I have an idea" },
  { value: "CONTENT", label: "Something looks wrong" },
  { value: "OTHER", label: "Other" },
] as const

// Shared feedback trigger + modal. Renders `children` as the clickable
// entry point; the modal captures the current route when opened.
export default function FeedbackTrigger({
  children,
  className,
  onOpen,
  role,
}: {
  children: React.ReactNode
  className?: string
  onOpen?: () => void
  role?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" role={role} className={className} onClick={() => { onOpen?.(); setOpen(true) }}>
        {children}
      </button>
      {open && <FeedbackModal onClose={() => setOpen(false)} />}
    </>
  )
}

// Also usable standalone: mount it outside dismissable containers (e.g. a
// dropdown that unmounts on selection) so the dialog survives the close.
export function FeedbackModal({ onClose }: { onClose: () => void }) {
  const { data: session } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  const [type, setType] = useState("BUG")
  const [title, setTitle] = useState("")
  const [message, setMessage] = useState("")
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState("")
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!session?.user) {
      router.push(signInHref(pathname))
      return
    }
    if (sending || done) return
    setSending(true)
    setError("")
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, title, message, pagePath: pathname }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d.error || "Could not save feedback")
        setSending(false)
        return
      }
      setDone(true)
      setTimeout(onClose, 1500)
    } catch {
      setError("Could not save feedback")
      setSending(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        className="bg-card border border-border rounded-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 id="feedback-title" className="text-lg font-semibold flex items-center gap-2">
              <MessageSquarePlus className="w-5 h-5 text-primary" /> Feedback
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Help shape TerpTalk — bugs, confusing bits, ideas, anything.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {done ? (
          <div className="py-8 text-center">
            <p className="font-medium text-primary">Thanks — your feedback was saved.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label htmlFor="fb-type" className="block text-sm font-medium mb-1.5">
                What type of feedback is this?
              </label>
              <select
                id="fb-type"
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="fb-title" className="block text-sm font-medium mb-1.5">
                Short title
              </label>
              <input
                id="fb-title"
                ref={titleRef}
                type="text"
                required
                maxLength={150}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Profile stats don't line up on mobile"
                className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div>
              <label htmlFor="fb-message" className="block text-sm font-medium mb-1.5">
                Details
              </label>
              <textarea
                id="fb-message"
                required
                maxLength={5000}
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Tell us what happened, what you expected, and what you were trying to do."
                className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[96px]"
              />
            </div>

            <p className="text-xs text-muted-foreground">
              Page: <span className="font-mono">{pathname}</span> — sent automatically with your feedback.
            </p>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <button
              type="submit"
              disabled={sending}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground font-medium px-4 py-2.5 text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {sending && <Loader2 className="w-4 h-4 animate-spin" />}
              {session?.user ? "Send feedback" : "Sign in to send feedback"}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
