"use client"

import { Plus } from "lucide-react"
import { useShareComposer } from "@/components/share-composer"

export default function QuickPostButton() {
  const composer = useShareComposer()

  return (
    /* Bottom-right, lifted above the mobile bottom navigation. */
    <div className="lg:hidden fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-40">
      <button
        onClick={() => composer.open()}
        className="w-12 h-12 bg-primary text-primary-foreground rounded-full shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors"
        aria-label="Share something"
      >
        <Plus className="w-5 h-5" />
      </button>
    </div>
  )
}
