"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import Link from "next/link"
import {
  MessageSquare, HelpCircle, Sprout, Settings, Dna, BookOpen, Plus, X,
  Camera, BarChart3, Leaf,
} from "lucide-react"
import { useSession } from "next-auth/react"
import type { LucideIcon } from "lucide-react"

interface CreateOption {
  label: string
  icon: LucideIcon
  href: string
  description: string
  /** When set, only shown if the pathname starts with this prefix */
  contextPath?: string
}

const CORE_OPTIONS: CreateOption[] = [
  { label: "Discussion", icon: MessageSquare, href: "/forum/new", description: "Ask the community or start a conversation" },
  { label: "Grow Diary", icon: Sprout, href: "/diaries/new", description: "Start tracking your grow journey" },
  { label: "Grow Update", icon: Camera, href: "/diaries", description: "Share what's happening in your grow", contextPath: "/diaries" },
  { label: "Question", icon: HelpCircle, href: "/forum/new?category=questions", description: "Ask the community a focused question" },
  { label: "Setup", icon: Settings, href: "/setups/new", description: "Document your grow space and gear" },
  { label: "Strain", icon: Dna, href: "/strains/new", description: "Add a strain to the community database" },
]

function getContextualHint(pathname: string): string | null {
  if (pathname.startsWith("/diaries/") && pathname !== "/diaries/new") return "Share an update to this grow"
  if (pathname.startsWith("/strains/")) return "Start a discussion about this strain"
  if (pathname.startsWith("/forum/")) return "Reply to this conversation"
  return null
}

function getContextualOptions(pathname: string, options: CreateOption[]): CreateOption[] {
  // On a diary detail page, promote "Grow Update" and link directly
  if (pathname.startsWith("/diaries/") && pathname !== "/diaries/new" && !pathname.endsWith("/edit")) {
    const diaryPath = pathname
    return [
      { label: "Grow Update", icon: Camera, href: diaryPath, description: "Share what's happening in this grow" },
      ...options.filter((o) => o.label !== "Grow Update"),
    ]
  }
  // On a strain page, pre-fill strain context
  if (pathname.startsWith("/strains/")) {
    const parts = pathname.split("/")
    const strainId = parts[2]
    if (strainId) {
      return [
        { label: "Start a Grow", icon: Sprout, href: `/diaries/new?strain=${strainId}`, description: "Grow this strain and track it" },
        ...options,
      ]
    }
  }
  // General: filter out context-specific options when not in that context
  return options.filter((o) => !o.contextPath || pathname.startsWith(o.contextPath))
}

export default function CreateMenu() {
  const { data: session } = useSession()
  const pathname = usePathname()
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
  const contextHint = getContextualHint(pathname)
  const options = getContextualOptions(pathname, CORE_OPTIONS)

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="tt-cta inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-primary-foreground transition-all"
        aria-label="Create"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {open ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        <span className="hidden sm:inline">Create</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-72 rounded-2xl border border-border/70 tt-glass p-2 shadow-lg"
        >
          {contextHint && (
            <p className="px-3 py-1.5 text-[11px] font-medium text-primary uppercase tracking-wider">
              {contextHint}
            </p>
          )}
          <p className="px-3 py-1.5 text-xs text-muted-foreground">Share something with TerpTalk</p>
          {options.map((opt) => (
            <Link
              key={opt.label + opt.href}
              href={opt.href}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-secondary/80 transition-colors"
              role="menuitem"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                <opt.icon className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="font-medium">{opt.label}</div>
                <div className="text-[11px] text-muted-foreground leading-tight">{opt.description}</div>
              </div>
            </Link>
          ))}
          {isStaff && (
            <>
              <div className="mx-3 my-1 border-t border-border" />
              <Link
                href="/guides/new"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-secondary/80 transition-colors"
                role="menuitem"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-warning/10 shrink-0">
                  <BookOpen className="h-4 w-4 text-warning" />
                </div>
                <div>
                  <div className="font-medium">Guide</div>
                  <div className="text-[11px] text-muted-foreground leading-tight">Staff knowledge article</div>
                </div>
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  )
}
