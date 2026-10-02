"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Pin, PinOff, Loader2 } from "@/lib/icons"
import { useToast } from "@/components/ui/toast"
import Tooltip from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/**
 * Owner-only "Feature on profile" toggle (Profile V2 §7). Sets/clears
 * Profile.featuredDiaryId via PATCH /api/profile — the server re-checks
 * that the diary belongs to the member. A featured grow leads the public
 * profile; featuring a non-public diary is allowed (visitors just don't
 * see it — visibility still governs render).
 */
export default function FeatureGrowButton({
  diaryId,
  featured,
}: {
  diaryId: string
  featured: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [isFeatured, setIsFeatured] = useState(featured)
  const [busy, setBusy] = useState(false)

  const toggle = async () => {
    setBusy(true)
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featuredDiaryId: isFeatured ? null : diaryId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast(data.error || "Couldn't update the featured grow", "error")
        return
      }
      setIsFeatured(!isFeatured)
      toast(isFeatured ? "Removed from your profile" : "Featured on your profile", "success")
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const label = isFeatured ? "Unfeature on profile" : "Feature on profile"
  return (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-label={label}
        aria-pressed={isFeatured}
        className={cn(
          "inline-flex items-center justify-center p-2 rounded-lg transition-colors hover:bg-secondary",
          isFeatured ? "text-primary" : "text-muted-foreground",
          "disabled:opacity-50"
        )}
      >
        {busy ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : isFeatured ? (
          <PinOff className="w-4 h-4" />
        ) : (
          <Pin className="w-4 h-4" />
        )}
      </button>
    </Tooltip>
  )
}
