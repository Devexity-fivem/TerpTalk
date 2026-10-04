"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { MessageSquare, Loader2 } from "@/lib/icons"
import Link from "next/link"
import { signInHref } from "@/lib/callback-url"

// "Discuss this setup" — lazy-creates the setup's canonical discussion
// thread on first click, then always links to it. One discussion per setup.
export default function SetupDiscussButton({
  setupId,
  setupHref,
  existingSlug,
  label,
  variant = "button",
}: {
  setupId: string
  setupHref: string
  existingSlug: string | null
  /** Context label override. */
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
          const res = await fetch(`/api/setups/${setupId}/discuss`, { method: "POST" })
          if (res.status === 401) {
            router.push(signInHref(setupHref))
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
      {label ?? "Discuss this setup"}
    </button>
  )
}
