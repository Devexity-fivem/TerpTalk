"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { X, KeyRound } from "@/lib/icons"
import Link from "next/link"

const DISMISS_KEY = "terptalk-no-recovery-phrase"

// Warns signed-in members who never generated a recovery phrase. Dismissal is
// per-session (sessionStorage) — the warning comes back next session while the
// account still has no recovery path.
export default function RecoveryWarningBanner() {
  const { data: session, status } = useSession()
  const [dismissed, setDismissed] = useState(true)

  // Derived from the session (the auth callback loads recoveryPhraseHash
  // server-side and exposes only the boolean) — no /api/profile/recovery
  // request needed.
  const missing = status === "authenticated" && session?.user.hasRecoveryPhrase === false

  // sessionStorage read is deferred to a microtask so no setState runs
  // synchronously inside the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!missing) return
    queueMicrotask(() => setDismissed(sessionStorage.getItem(DISMISS_KEY) === "1"))
  }, [missing])

  if (!missing || dismissed) return null

  return (
    <div className="bg-amber-500/10 text-warning border-b border-amber-500/20 px-4 py-2.5">
      <div className="max-w-6xl mx-auto flex items-start gap-3">
        <KeyRound className="w-4 h-4 shrink-0 mt-0.5" />
        <div className="flex-1 text-sm">
          <span className="font-semibold mr-1">Protect your account.</span>
          <span className="text-warning">
            You haven&apos;t saved a recovery phrase — lose your password and there&apos;s no way back in.
          </span>
          <Link href="/profile" className="tap-target ml-2 underline font-medium hover:text-warning">
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
