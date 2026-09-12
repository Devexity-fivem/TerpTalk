"use client"

import { useEffect, useState } from "react"
import { KeyRound, Loader2, Copy, Check, AlertTriangle } from "lucide-react"

// Recovery phrase manager — generates a 12-word BIP39 phrase, shown ONCE.
export default function RecoveryPhraseCard() {
  const [hasPhrase, setHasPhrase] = useState<boolean | null>(null)
  const [phrase, setPhrase] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    fetch("/api/profile/recovery")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setHasPhrase(!!d?.hasPhrase))
      .catch(() => setHasPhrase(false))
  }, [])

  const startGenerate = () => {
    if (hasPhrase && !confirm("Generate a NEW phrase? Your old phrase will stop working.")) return
    setError("")
    setConfirming(true)
  }

  const generate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password) return
    setBusy(true)
    setError("")
    try {
      const res = await fetch("/api/profile/recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok) {
        setPhrase(d.phrase)
        setHasPhrase(true)
        setConfirming(false)
      } else {
        setError(d.error || "Failed to generate phrase")
      }
    } finally {
      setPassword("")
      setBusy(false)
    }
  }

  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <div className="flex items-center gap-2 mb-4">
        <KeyRound className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">Account Recovery</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        No email? No problem. Your recovery phrase is a 12-word backup — like a crypto wallet seed.
        Anyone with it can reset your password, so store it somewhere safe and offline.
      </p>

      {hasPhrase === null ? (
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
      ) : phrase ? (
        <div className="space-y-4">
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
            <p className="text-xs text-amber-500 font-semibold mb-2 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" /> Shown only once — write it down now
            </p>
            <div className="grid grid-cols-3 gap-2 font-mono text-sm">
              {phrase.split(" ").map((w, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="text-muted-foreground text-xs w-4">{i + 1}.</span>
                  <span className="font-medium">{w}</span>
                </div>
              ))}
            </div>
            <button
              onClick={() => { navigator.clipboard.writeText(phrase); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
              className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied!" : "Copy phrase"}
            </button>
          </div>
          <button
            onClick={() => setPhrase("")}
            className="px-4 py-2 text-sm bg-secondary rounded-lg hover:bg-secondary/80"
          >
            I&apos;ve saved it
          </button>
        </div>
      ) : confirming ? (
        <form onSubmit={generate} className="space-y-3">
          <div>
            <label htmlFor="recovery-password" className="block text-sm font-medium mb-1">
              Confirm your password
            </label>
            <input
              id="recovery-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="current-password"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Current password"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {hasPhrase
                ? "Replacing your phrase signs out all sessions, including this one."
                : "You can regenerate this phrase later from your profile."}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={busy || !password}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {hasPhrase ? "Regenerate phrase" : "Generate recovery phrase"}
            </button>
            <button
              type="button"
              onClick={() => { setConfirming(false); setPassword(""); setError("") }}
              className="px-4 py-2 text-sm bg-secondary rounded-lg hover:bg-secondary/80"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex items-center gap-3">
          <button
            onClick={startGenerate}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 flex items-center gap-2"
          >
            {hasPhrase ? "Regenerate phrase" : "Generate recovery phrase"}
          </button>
          {hasPhrase && (
            <span className="text-xs text-primary flex items-center gap-1">
              <Check className="w-3.5 h-3.5" /> Phrase is set
            </span>
          )}
        </div>
      )}
      {error && <p className="text-xs text-destructive mt-2">{error}</p>}
    </div>
  )
}
