"use client"

import { Plus } from "lucide-react"
import { useShareComposer } from "@/components/share-composer"

export default function CreateMenu() {
  const composer = useShareComposer()

  return (
    <button
      onClick={() => composer.open()}
      className="tt-cta inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-primary-foreground transition-all"
      aria-label="Share something"
    >
      <Plus className="h-4 w-4" />
      <span className="hidden sm:inline">Create</span>
    </button>
  )
}
