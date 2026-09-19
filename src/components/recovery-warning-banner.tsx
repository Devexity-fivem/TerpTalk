"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { X, KeyRound } from "lucide-react"
import Link from "next/link"

const DISMISS_KEY = "terptalk-no-recovery-phrase"

// Warns signed-in members who never generated a recovery phrase. Dismissal is
// per-session (sessionStorage) — the warning comes back next session while the
// account still has no recovery path.
export default function RecoveryWarningBanner() {
  const { status } = useSession()
  const [missing, setMissing] = useState(false)
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    if (status !== "authenticated") return
    let cancelled = false
    fetch("/api/profile/recovery")
      .then((res) => (res.ok ? res.json() : { hasPhrase: true }))
      .then((d: { hasPhrase?: boolean }) => {
        if (cancelled) return
        if (d.hasPhrase === false) {
          setMissing(true)
          setDismissed(sessionStorage.getItem(DISMISS_KEY) === "1")
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [status])

  if (!missing || dismissed) return null

  return (
    <div className="bg-amber-500/10 text-amber-600 border-b border-amber-500/20 px-4 py-2.5">
      <div className="max-w-6xl mx-auto flex items-start gap-3">
        <KeyRound className="w-4 h-4 shrink-0 mt-0.5" />
        <div className="flex-1 text-sm">
          <span className="font-semibold mr-1">Protect your account.</span>
          <span className="text-amber-700">
            You haven&apos;t saved a recovery phrase — lose your password and there&apos;s no way back in.
          </span>
          <Link href="/profile" className="tap-target ml-2 underline font-medium hover:text-amber-700">
            Set one up
          </Link>
        </div>
        <button
          onClick={() => {
            sessionStorage.setItem(DISMISS_KEY, "1")
            setDismissed(true)
          }}
          className="tap-target shrink-0 p-1 hover:bg-amber-500/20 rounded"
          aria-label="Dismiss recovery warning"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
