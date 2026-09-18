"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Trash2, Loader2 } from "lucide-react"
import { useToast } from "@/components/ui/toast"
import Tooltip from "@/components/ui/tooltip"

interface OwnerDeleteButtonProps {
  /** API route that accepts DELETE { id } */
  endpoint: string
  id: string
  /** Only rendered for the owner — the API still re-checks server-side. */
  authorId: string
  /** Plain-language confirmation, e.g. "Delete this diary? ..." */
  confirmText: string
  /** Redirect target after delete; omit to just refresh. */
  redirectTo?: string
  label?: string
  iconOnly?: boolean
}

export default function OwnerDeleteButton({
  endpoint,
  id,
  authorId,
  confirmText,
  redirectTo,
  label = "Delete",
  iconOnly = false,
}: OwnerDeleteButtonProps) {
  const { data: session } = useSession()
  const router = useRouter()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)

  if (!session?.user?.id || session.user.id !== authorId) return null

  const handleDelete = async () => {
    if (!confirm(confirmText)) return
    setBusy(true)
    try {
      const res = await fetch(endpoint, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
      if (res.ok) {
        toast("Deleted", "success")
        if (redirectTo) router.push(redirectTo)
        else router.refresh()
      } else {
        const d = await res.json().catch(() => ({}))
        toast(d.error || "Delete failed", "error")
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Tooltip content={label}>
      <button
        onClick={handleDelete}
        disabled={busy}
        className={
          iconOnly
            ? "p-1.5 -m-1 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
            : "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-destructive border border-destructive/40 rounded-lg hover:bg-destructive/10 transition-colors disabled:opacity-50"
        }
        aria-label={label}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
        {!iconOnly && label}
      </button>
    </Tooltip>
  )
}
