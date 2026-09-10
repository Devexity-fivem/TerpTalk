"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { MessageSquare, HelpCircle, Sprout, Settings, Dna, BookOpen, Plus, X } from "lucide-react"
import { useSession } from "next-auth/react"

const OPTIONS = [
  { label: "Discussion", icon: MessageSquare, href: "/forum/new", description: "Start a forum thread" },
  { label: "Question", icon: HelpCircle, href: "/forum/new", description: "Ask the community" },
  { label: "Grow Diary", icon: Sprout, href: "/diaries/new", description: "Document your grow" },
  { label: "Setup", icon: Settings, href: "/setups/new", description: "Show your gear" },
  { label: "Strain", icon: Dna, href: "/strains/new", description: "Add a strain" },
]

export default function CreateMenu() {
  const { data: session } = useSession()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    if (open) {
      document.addEventListener("mousedown", onClick)
      document.addEventListener("keydown", onKey)
    }
    return () => {
      document.removeEventListener("mousedown", onClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const isStaff = ["MODERATOR", "ADMINISTRATOR"].includes((session?.user as { role?: string } | undefined)?.role || "")

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {open ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        <span className="hidden sm:inline">Create</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-56 rounded-xl border border-border bg-card p-1.5 shadow-lg"
        >
          {OPTIONS.map((opt) => (
            <Link
              key={opt.label}
              href={opt.href}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-secondary transition-colors"
              role="menuitem"
            >
              <opt.icon className="h-4 w-4 text-primary shrink-0" />
              <div>
                <div className="font-medium">{opt.label}</div>
                <div className="text-[11px] text-muted-foreground">{opt.description}</div>
              </div>
            </Link>
          ))}
          {isStaff && (
            <Link
              href="/guides/new"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-secondary transition-colors border-t border-border mt-1 pt-2"
              role="menuitem"
            >
              <BookOpen className="h-4 w-4 text-amber-500 shrink-0" />
              <div>
                <div className="font-medium">Guide</div>
                <div className="text-[11px] text-muted-foreground">Staff knowledge article</div>
              </div>
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
