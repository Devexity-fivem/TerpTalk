"use client"

import { useEffect, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { usePathname } from "next/navigation"
import Link from "next/link"
import {
  Plus, X, MessageSquare, Sprout, Settings, Dna, HelpCircle, Camera,
} from "lucide-react"

const OPTIONS = [
  { href: "/forum/new", label: "Discussion", desc: "Start a conversation", icon: MessageSquare },
  { href: "/diaries/new", label: "Grow Diary", desc: "Track your grow", icon: Sprout },
  { href: "/forum/new?category=questions", label: "Question", desc: "Ask the community", icon: HelpCircle },
  { href: "/setups/new", label: "Setup", desc: "Document your gear", icon: Settings },
  { href: "/strains/new", label: "Strain", desc: "Add a strain", icon: Dna },
]

export default function QuickPostButton() {
  const { data: session } = useSession()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside tap
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])

  if (!session) return null

  // On diary detail pages, promote grow update
  const onDiary = pathname.startsWith("/diaries/") && pathname !== "/diaries/new" && !pathname.endsWith("/edit")
  const contextOptions = onDiary
    ? [{ href: pathname, label: "Grow Update", desc: "Update this grow", icon: Camera }, ...OPTIONS]
    : OPTIONS

  return (
    /* Bottom-right, lifted above the mobile bottom navigation. */
    <div ref={ref} className="lg:hidden fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-40">
      {open && (
        <div className="absolute bottom-14 right-0 bg-card border border-border rounded-2xl shadow-lg p-2 min-w-[13rem]">
          <p className="px-3 py-1 text-[11px] text-muted-foreground">Share something</p>
          {contextOptions.map((opt) => (
            <Link
              key={opt.label + opt.href}
              href={opt.href}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2.5 text-sm rounded-xl hover:bg-secondary transition-colors"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                <opt.icon className="w-3.5 h-3.5 text-primary" />
              </div>
              <div>
                <div className="font-medium text-sm">{opt.label}</div>
                <div className="text-[10px] text-muted-foreground leading-tight">{opt.desc}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
      <button
        onClick={() => setOpen(!open)}
        className="w-12 h-12 bg-primary text-primary-foreground rounded-full shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors"
        aria-label="Create"
        aria-expanded={open}
      >
        {open ? <X className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
      </button>
    </div>
  )
}
