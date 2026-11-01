"use client"

import { useEffect, useState } from "react"
import { Sprout, X } from "@/lib/icons"

// PWA install nudge — appears once `beforeinstallprompt` fires (Chromium
// only; other browsers simply never see it). Dismissal persists 14 days
// so regulars aren't nagged on every visit.
const DISMISS_KEY = "tt:install-dismissed"
const DISMISS_TTL_MS = 14 * 24 * 60 * 60 * 1000

type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

export default function InstallPrompt() {
  const [evt, setEvt] = useState<BIP | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DISMISS_KEY)
      if (raw && Date.now() - Number(raw) < DISMISS_TTL_MS) return
    } catch { /* private mode — show anyway */ }

    const onPrompt = (e: Event) => {
      e.preventDefault()
      setEvt(e as BIP)
      // Small delay so the banner doesn't fight first paint.
      window.setTimeout(() => setVisible(true), 3000)
    }
    window.addEventListener("beforeinstallprompt", onPrompt)
    return () => window.removeEventListener("beforeinstallprompt", onPrompt)
  }, [])

  const dismiss = () => {
    setVisible(false)
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch { /* noop */ }
  }

  const install = async () => {
    if (!evt) return
    await evt.prompt()
    const { outcome } = await evt.userChoice
    if (outcome === "accepted") dismiss()
  }

  if (!visible || !evt) return null

  return (
    <div
      role="dialog"
      aria-label="Install TerpTalk"
      className="tt-spotlight fixed bottom-4 right-4 z-50 w-72 rounded-2xl border border-border/70 bg-card/95 p-4 shadow-2xl backdrop-blur"
    >
      <button
        onClick={dismiss}
        aria-label="Dismiss install prompt"
        className="absolute right-2 top-2 rounded-lg p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
      <div className="flex items-start gap-3">
        <div className="tt-brand-tile rounded-xl p-2 shrink-0">
          <Sprout className="w-5 h-5 text-primary" />
        </div>
        <div className="min-w-0">
          <div className="font-display text-sm font-semibold">Install TerpTalk</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Add it to your home screen — log your grow right from the garden.
          </p>
          <button
            onClick={install}
            className="tt-cta mt-2.5 inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold text-primary-foreground"
          >
            Install app
          </button>
        </div>
      </div>
    </div>
  )
}
