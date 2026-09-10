"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import Link from "next/link"
import { Plus, X, MessageSquare, BookOpen, Wrench, Dna } from "lucide-react"

const OPTIONS = [
  { href: "/forum/new", label: "Discussion", icon: MessageSquare },
  { href: "/diaries/new", label: "Diary", icon: BookOpen },
  { href: "/setups/new", label: "Setup", icon: Wrench },
  { href: "/strains/new", label: "Strain", icon: Dna },
]

export default function QuickPostButton() {
  const { data: session } = useSession()
  const [open, setOpen] = useState(false)

  if (!session) return null

  return (
    /* Bottom-left so it clears the chat button on the right, and lifted above
       the mobile bottom navigation. */
    <div className="md:hidden fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-4 z-40">
      {open && (
        <div className="absolute bottom-14 left-0 bg-card border border-border rounded-2xl shadow-lg p-2 space-y-1 min-w-[10rem]">
          {OPTIONS.map((opt) => (
            <Link
              key={opt.href}
              href={opt.href}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-secondary transition-colors"
            >
              <opt.icon className="w-4 h-4 text-primary" /> {opt.label}
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
