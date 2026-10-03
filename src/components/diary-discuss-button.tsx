"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { MessageSquare, Loader2 } from "@/lib/icons"
import Link from "next/link"
import { signInHref } from "@/lib/callback-url"

// "Discuss this grow" — lazy-creates the diary's canonical discussion
// thread on first click, then always links to it. Update cards reuse the
// same flow with a contextual label/link style — one discussion per diary.
export default function DiaryDiscussButton({
  diaryId,
  diaryHref,
  existingSlug,
  label,
  variant = "button",
}: {
  diaryId: string
  diaryHref: string
  existingSlug: string | null
  /** Context label — e.g. "Discuss this update" on update cards. */
  label?: string
  /** "link" renders the inline text-link style used inside cards. */
  variant?: "button" | "link"
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const cls =
    variant === "link"
      ? "inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      : "inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-secondary hover:bg-secondary/80 transition-colors"
  const iconCls = variant === "link" ? "w-3.5 h-3.5" : "w-4 h-4"

  if (existingSlug) {
    return (
      <Link
        href={`/forum/thread/${existingSlug}`}
        className={cls}
      >
        <MessageSquare className={iconCls} /> {label ?? "Discussion"}
      </Link>
    )
  }

  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          const res = await fetch(`/api/diaries/${diaryId}/discuss`, { method: "POST" })
          if (res.status === 401) {
            router.push(signInHref(diaryHref))
            return
          }
          const data = await res.json().catch(() => ({}))
          if (res.ok && data.threadSlug) {
            router.push(`/forum/thread/${data.threadSlug}`)
          }
        } finally {
          setBusy(false)
        }
      }}
      className={cls + " disabled:opacity-50"}
    >
      {busy ? <Loader2 className={iconCls + " animate-spin"} /> : <MessageSquare className={iconCls} />}
      {label ?? "Discuss this grow"}
    </button>
  )
}
