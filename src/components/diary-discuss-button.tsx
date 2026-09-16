"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { MessageSquare, Loader2 } from "lucide-react"
import Link from "next/link"
import { signInHref } from "@/lib/callback-url"

// "Discuss this grow" — lazy-creates the diary's canonical discussion
// thread on first click, then always links to it.
export default function DiaryDiscussButton({
  diaryId,
  existingSlug,
}: {
  diaryId: string
  existingSlug: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  if (existingSlug) {
    return (
      <Link
        href={`/forum/thread/${existingSlug}`}
        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-secondary hover:bg-secondary/80 transition-colors"
      >
        <MessageSquare className="w-4 h-4" /> Discussion
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
            router.push(signInHref(`/diaries/${diaryId}`))
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
      className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-secondary hover:bg-secondary/80 transition-colors disabled:opacity-50"
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
      Discuss this grow
    </button>
  )
}
