"use client"

import { useState } from "react"
import Link from "next/link"
import { KeyRound, Loader2, Check, Copy, AlertTriangle } from "lucide-react"

export default function RecoverPage() {
  const [username, setUsername] = useState("")
  const [phrase, setPhrase] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [newPhrase, setNewPhrase] = useState("")
  const [copied, setCopied] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setBusy(true)
    try {
      const res = await fetch("/api/auth/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, phrase, newPassword }),
      })
      const d = await res.json()
      if (res.ok) {
        // The API rotates the phrase and returns the new one exactly once.
        setNewPhrase(d.phrase || "")
      } else {
        setError(d.error || "Recovery failed")
      }
    } finally { setBusy(false) }
  }

  if (newPhrase) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="bg-card border border-border rounded-xl p-8 max-w-md w-full">
          <div className="text-center mb-5">
            <Check className="w-12 h-12 text-primary mx-auto mb-4" />
            <h1 className="text-xl font-bold mb-2">Password reset</h1>
            <p className="text-sm text-muted-foreground">
              Your password has been updated. Your old recovery phrase no longer works — here is your new one.
            </p>
          </div>

          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-5">
            <p className="text-xs text-amber-500 font-semibold mb-2 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" /> Shown only once — write it down now
            </p>
            <div className="grid grid-cols-3 gap-2 font-mono text-sm">
              {newPhrase.split(" ").map((w, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="text-muted-foreground text-xs w-4">{i + 1}.</span>
                  <span className="font-medium">{w}</span>
                </div>
              ))}
            </div>
            <button
              onClick={() => { navigator.clipboard.writeText(newPhrase); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
              className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied!" : "Copy phrase"}
            </button>
          </div>

          {acknowledged ? (
            <Link href="/auth/signin" className="block text-center bg-primary text-primary-foreground px-6 py-2.5 rounded-lg font-semibold hover:bg-primary/90">
              Sign in
            </Link>
          ) : (
            <button
              onClick={() => setAcknowledged(true)}
              className="w-full bg-secondary px-6 py-2.5 rounded-lg font-semibold hover:bg-secondary/80"
            >
              I&apos;ve saved my new phrase
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="bg-card border border-border rounded-xl p-8 max-w-md w-full">
        <div className="text-center mb-6">
          <KeyRound className="w-10 h-10 text-primary mx-auto mb-3" />
          <h1 className="text-2xl font-bold">Recover your account</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Enter your username and the 12-word recovery phrase you saved.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Username</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="your username"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Recovery phrase</label>
            <textarea
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              required
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              placeholder="word1 word2 word3 ... word12"
            />
            <p className="text-xs text-muted-foreground mt-1">All 12 words, in order, separated by spaces.</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">New password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="At least 8 characters"
            />
          </div>

          {error && (
            <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-lg text-sm">{error}</div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full bg-primary text-primary-foreground py-2.5 rounded-lg font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Reset password"}
          </button>

          <p className="text-center text-sm text-muted-foreground">
            Remember your password? <Link href="/auth/signin" className="text-primary hover:underline">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  )
}
